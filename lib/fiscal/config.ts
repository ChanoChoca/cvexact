import "server-only";

/**
 * Configuración del emisor ante ARCA (ex AFIP), para facturar electrónicamente
 * cada venta — obligatorio por RG desde el 1/7/2026 para todo monotributista,
 * sin piso de monto.
 *
 * Mismo criterio que `lib/legal/operator.ts`: variables de entorno y no
 * constantes, porque son datos que cambian sin que cambie el código —un CUIT,
 * una rotación de certificado, un cambio de punto de venta— y porque así el
 * repo no lleva ni el certificado ni la clave privada del titular.
 */

const CUIT_PATTERN = /^\d{11}$/;

export type FiscalConfig = {
  /** El CUIT del emisor, sin guiones. */
  cuit: string;
  /** Punto de venta Web Services autorizado en ARCA (no el de un talonario papel). */
  ptoVta: number;
  /** El certificado X.509 que ARCA emitió para este servicio, en PEM. */
  certPem: string;
  /** La clave privada del par que generó el CSR, en PEM. */
  keyPem: string;
  /** "homologacion" | "produccion". Decide las URLs de WSAA y WSFEv1. */
  environment: "homologacion" | "produccion";
};

/**
 * `undefined` cuando falta cualquier variable — a diferencia de
 * `lib/legal/operator.ts`, acá no hay un valor "pendiente de carga" que
 * mostrar: sin esto no hay con qué firmar nada, así que `ensureInvoice`
 * simplemente no hace nada (ver su propio comentario) en vez de fallar cada
 * generación de factura contra una config a medias.
 */
export function fiscalConfig(): FiscalConfig | undefined {
  const cuit = process.env.FISCAL_CUIT?.trim();
  const ptoVtaRaw = process.env.FISCAL_PTO_VTA?.trim();
  // Un PEM tiene saltos de línea reales; un Secret cargado como variable de
  // entorno de un solo renglón suele traerlos escapados (`\n` literal, dos
  // caracteres) en vez de reales. Aceptar los dos formatos evita el error
  // más común de este tipo de configuración: un PEM que se ve bien en el
  // manifiesto y falla al parsear porque nunca tuvo saltos de línea de verdad.
  const certPem = process.env.FISCAL_CERT_PEM?.replace(/\\n/g, "\n");
  const keyPem = process.env.FISCAL_KEY_PEM?.replace(/\\n/g, "\n");
  const environment = process.env.FISCAL_ENVIRONMENT?.trim();

  if (!cuit || !ptoVtaRaw || !certPem || !keyPem) return undefined;
  if (!CUIT_PATTERN.test(cuit)) {
    console.error("[fiscal] FISCAL_CUIT debe tener 11 dígitos, sin guiones.");
    return undefined;
  }

  const ptoVta = Number(ptoVtaRaw);
  if (!Number.isInteger(ptoVta) || ptoVta <= 0) {
    console.error("[fiscal] FISCAL_PTO_VTA debe ser un entero positivo.");
    return undefined;
  }

  return {
    cuit,
    ptoVta,
    certPem,
    keyPem,
    // Homologación por defecto: facturar de más en producción sin querer es
    // el error que no se puede deshacer; quedarse en homologación de más
    // sólo retrasa el primer comprobante real.
    environment: environment === "produccion" ? "produccion" : "homologacion",
  };
}

export function fiscalConfigured(): boolean {
  return fiscalConfig() !== undefined;
}

/** 11 = Factura C. Los otros tipos de la misma clase (12=ND, 13=NC) no se usan hoy. */
export const CBTE_TIPO_FACTURA_C = 11;

/**
 * Servicios (no productos): lo que se vende es acceso al Servicio, no un bien
 * físico. Concepto=2 exige `FchServDesde`/`FchServHasta`/`FchVtoPago` en el
 * request — ver `lib/fiscal/wsfev1.ts`.
 */
export const CONCEPTO_SERVICIOS = 2;

/** Consumidor Final, sin excepción: ningún precio de este producto se acerca
 *  al piso de identificación obligatoria de la RG 5866/2026 ($10.000.000). */
export const DOC_TIPO_CONSUMIDOR_FINAL = 99;

/**
 * Condición frente al IVA del receptor: Consumidor Final.
 *
 * Campo nuevo de la v4.0 del servicio (17/03/2025), opcional mientras la
 * RG 5616 no termine de entrar en vigencia. Se manda igual porque no cuesta
 * nada y evita un cambio de código el día que pase a ser obligatorio.
 * Verificar contra `FEParamGetCondicionIvaReceptor` antes de ir a producción
 * — 5 es el valor documentado para "Consumidor Final" al momento de escribir
 * esto, pero es la única pieza de esta configuración que conviene confirmar
 * contra el WSDL real en vez de contra un manual.
 */
export const CONDICION_IVA_CONSUMIDOR_FINAL = 5;

export const WSAA_URLS = {
  homologacion: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
  produccion: "https://wsaa.afip.gov.ar/ws/services/LoginCms",
} as const;

export const WSFEV1_URLS = {
  homologacion: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
  produccion: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
} as const;
