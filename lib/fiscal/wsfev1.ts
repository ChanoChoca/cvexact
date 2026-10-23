import "server-only";

import { XMLParser } from "fast-xml-parser";
import type { Ticket } from "./wsaa";
import {
  CBTE_TIPO_FACTURA_C,
  CONCEPTO_SERVICIOS,
  CONDICION_IVA_CONSUMIDOR_FINAL,
  DOC_TIPO_CONSUMIDOR_FINAL,
  WSFEV1_URLS,
  type FiscalConfig,
} from "./config";

/**
 * Mismo caveat que `WSAA_NAMESPACE` en `./wsaa.ts`: confirmado contra
 * clientes WSFEv1 conocidos, no contra el WSDL propio. Verificar contra
 * `${WSFEV1_URLS[environment]}?WSDL` antes del primer pedido real.
 */
const WSFEV1_NAMESPACE = "http://ar.gov.afip.dif.FEV1/";

/** AAAAMMDD, la única fecha que WSFEv1 acepta en sus campos de fecha. */
export function fechaArca(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
}

function authBlock(ticket: Ticket, cuit: string): string {
  return `<ar:Auth><ar:Token>${ticket.token}</ar:Token><ar:Sign>${ticket.sign}</ar:Sign><ar:Cuit>${cuit}</ar:Cuit></ar:Auth>`;
}

function soapEnvelope(body: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="${WSFEV1_NAMESPACE}">` +
    `<soapenv:Header/>` +
    `<soapenv:Body>${body}</soapenv:Body>` +
    `</soapenv:Envelope>`
  );
}

export class ArcaError extends Error {
  constructor(
    message: string,
    /** Los `Err`/`Observaciones` que trajo la respuesta, sin procesar. */
    public readonly details: string[] = [],
  ) {
    super(message);
    this.name = "ArcaError";
  }
}

async function callWsfev1(
  environment: FiscalConfig["environment"],
  soapAction: string,
  body: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(WSFEV1_URLS[environment], {
    method: "POST",
    headers: {
      "content-type": "text/xml; charset=utf-8",
      soapaction: `"${soapAction}"`,
    },
    body: soapEnvelope(body),
  });

  const text = await response.text();
  const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true });
  const parsed = parser.parse(text);

  const fault = parsed?.Envelope?.Body?.Fault;
  if (fault) {
    throw new ArcaError(String(fault.faultstring ?? "WSFEv1 rejected the request."));
  }
  if (!response.ok) {
    throw new ArcaError(`WSFEv1 respondió ${response.status}.`);
  }

  return parsed.Envelope.Body as Record<string, unknown>;
}

/**
 * Junta un valor único o un array en un array, tal como devuelve
 * `fast-xml-parser` cuando el XML trae 0, 1 o más repeticiones del mismo tag
 * — sin `isArray` configurado, un solo `<Err>` llega como objeto suelto y dos
 * como array, y tratar el primer caso como "no hay error" sería el bug.
 */
function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function errorsOf(node: Record<string, unknown> | undefined): string[] {
  const errors = asArray<{ Code: unknown; Msg: unknown }>(
    (node?.Errors as { Err?: unknown })?.Err as never,
  );
  return errors.map((e) => `${e.Code}: ${e.Msg}`);
}

/**
 * El último número de comprobante autorizado para un punto de venta y tipo,
 * o 0 si nunca se emitió ninguno. El próximo a pedir es este más uno —
 * `ensureInvoice` en `./invoice.ts` es quien decide eso, esta función sólo
 * pregunta.
 */
export async function ultimoAutorizado(
  ticket: Ticket,
  config: FiscalConfig,
  cbteTipo: number = CBTE_TIPO_FACTURA_C,
): Promise<number> {
  const body =
    `<ar:FECompUltimoAutorizado>` +
    authBlock(ticket, config.cuit) +
    `<ar:PtoVta>${config.ptoVta}</ar:PtoVta>` +
    `<ar:CbteTipo>${cbteTipo}</ar:CbteTipo>` +
    `</ar:FECompUltimoAutorizado>`;

  const responseBody = await callWsfev1(
    config.environment,
    "http://ar.gov.afip.dif.FEV1/FECompUltimoAutorizado",
    body,
  );
  const result = (responseBody as { FECompUltimoAutorizadoResponse?: { FECompUltimoAutorizadoResult?: Record<string, unknown> } })
    .FECompUltimoAutorizadoResponse?.FECompUltimoAutorizadoResult;

  const errors = errorsOf(result);
  if (errors.length > 0) throw new ArcaError("FECompUltimoAutorizado falló.", errors);

  return Number(result?.CbteNro ?? 0);
}

export type FacturaResult = {
  resultado: "A" | "R";
  cae: string | null;
  caeVto: Date | null;
  /** Observaciones: no bloquean la aprobación, pero conviene guardarlas. */
  observaciones: string[];
};

/**
 * Pide el CAE para una Factura C a Consumidor Final, servicio (no producto),
 * por el importe total ya cobrado.
 *
 * Sólo cubre lo que este producto vende — un pack o una suscripción,
 * consumidor final, en pesos, un comprobante por pedido (`CantReg: 1`,
 * `CbteDesde === CbteHasta`). Las reglas de Factura C que este armado
 * respeta, confirmadas contra el manual de FEv4.0: `ImpTotConc`, `ImpOpEx` e
 * `ImpIVA` van en 0, el array `Iva` no se manda, y `ImpTotal = ImpNeto +
 * ImpTrib` (acá `ImpTrib` es 0: no hay percepciones ni tributos propios en
 * este producto).
 */
export async function solicitarCAE(
  ticket: Ticket,
  config: FiscalConfig,
  input: {
    cbteNro: number;
    /** Lo que el gateway cobró de verdad — ver el comentario en `MercadoPagoPayment`. */
    importe: number;
    /** Cuándo se prestó el servicio. Para un pack o un cargo de suscripción, "hoy". */
    fecha: Date;
  },
): Promise<FacturaResult> {
  const fecha = fechaArca(input.fecha);
  // Vencimiento de pago = misma fecha: se cobró antes de prestar el servicio,
  // no hay plazo posterior que fijar.
  const importe = input.importe.toFixed(2);

  const detalle =
    `<ar:FECAEDetRequest>` +
    `<ar:Concepto>${CONCEPTO_SERVICIOS}</ar:Concepto>` +
    `<ar:DocTipo>${DOC_TIPO_CONSUMIDOR_FINAL}</ar:DocTipo>` +
    `<ar:DocNro>0</ar:DocNro>` +
    `<ar:CbteDesde>${input.cbteNro}</ar:CbteDesde>` +
    `<ar:CbteHasta>${input.cbteNro}</ar:CbteHasta>` +
    `<ar:CbteFch>${fecha}</ar:CbteFch>` +
    `<ar:ImpTotal>${importe}</ar:ImpTotal>` +
    `<ar:ImpTotConc>0.00</ar:ImpTotConc>` +
    `<ar:ImpNeto>${importe}</ar:ImpNeto>` +
    `<ar:ImpOpEx>0.00</ar:ImpOpEx>` +
    `<ar:ImpTrib>0.00</ar:ImpTrib>` +
    `<ar:ImpIVA>0.00</ar:ImpIVA>` +
    `<ar:FchServDesde>${fecha}</ar:FchServDesde>` +
    `<ar:FchServHasta>${fecha}</ar:FchServHasta>` +
    `<ar:FchVtoPago>${fecha}</ar:FchVtoPago>` +
    `<ar:MonId>PES</ar:MonId>` +
    `<ar:MonCotiz>1</ar:MonCotiz>` +
    `<ar:CondicionIVAReceptorId>${CONDICION_IVA_CONSUMIDOR_FINAL}</ar:CondicionIVAReceptorId>` +
    `</ar:FECAEDetRequest>`;

  const body =
    `<ar:FECAESolicitar>` +
    authBlock(ticket, config.cuit) +
    `<ar:FeCAEReq>` +
    `<ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${config.ptoVta}</ar:PtoVta>` +
    `<ar:CbteTipo>${CBTE_TIPO_FACTURA_C}</ar:CbteTipo></ar:FeCabReq>` +
    `<ar:FeDetReq>${detalle}</ar:FeDetReq>` +
    `</ar:FeCAEReq>` +
    `</ar:FECAESolicitar>`;

  const responseBody = await callWsfev1(
    config.environment,
    "http://ar.gov.afip.dif.FEV1/FECAESolicitar",
    body,
  );
  const result = (
    responseBody as {
      FECAESolicitarResponse?: { FECAESolicitarResult?: Record<string, unknown> };
    }
  ).FECAESolicitarResponse?.FECAESolicitarResult;

  const headerErrors = errorsOf(result);
  if (headerErrors.length > 0) throw new ArcaError("FECAESolicitar falló.", headerErrors);

  const cabResultado = String(
    (result?.FeCabResp as { Resultado?: unknown })?.Resultado ?? "R",
  );

  const detResp = asArray<Record<string, unknown>>(
    (result?.FeDetResp as { FECAEDetResponse?: unknown })?.FECAEDetResponse as never,
  )[0];

  const observaciones = asArray<{ Code: unknown; Msg: unknown }>(
    (detResp?.Obs as { Observaciones?: unknown })?.Observaciones as never,
  ).map((o) => `${o.Code}: ${o.Msg}`);

  const detResultado = String(detResp?.Resultado ?? cabResultado);
  const resultado = detResultado === "A" ? "A" : "R";

  const caeVtoRaw = detResp?.CAEFchVto ? String(detResp.CAEFchVto) : null;

  return {
    resultado,
    cae: resultado === "A" ? String(detResp?.CAE ?? "") : null,
    caeVto: caeVtoRaw
      ? new Date(`${caeVtoRaw.slice(0, 4)}-${caeVtoRaw.slice(4, 6)}-${caeVtoRaw.slice(6, 8)}T00:00:00-03:00`)
      : null,
    observaciones,
  };
}
