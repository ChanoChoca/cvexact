import "server-only";

import forge from "node-forge";
import { XMLParser } from "fast-xml-parser";
import { WSAA_URLS, type FiscalConfig } from "./config";

/**
 * El ticket de acceso (TA) que WSAA emite, para presentar en cada llamada a
 * un servicio de negocio (acá, WSFEv1).
 *
 * Dura 12 horas exactas —confirmado contra el manual del WSAA—, así que se
 * cachea acá en memoria del proceso, por `service`, y se vuelve a pedir sólo
 * cuando falta menos del margen de seguridad para que expire. Pedir uno
 * nuevo mientras el anterior sigue vigente responde `coe.alreadyAuthenticated`
 * ("El CEE ya posee un TA válido para el acceso solicitado"), así que esta
 * caché no es una optimización: sin ella, la segunda llamada del día falla.
 */
export type Ticket = {
  token: string;
  sign: string;
  /** Cuándo deja de servir, según lo que WSAA mismo informó. */
  expirationTime: Date;
};

const cache = new Map<string, Ticket>();

/**
 * Margen antes de la expiración real para pedir un ticket nuevo.
 *
 * 10 minutos: más que el tiempo que tarda cualquier request de esta app, así
 * que un TA nunca expira a mitad de una llamada a WSFEv1, y menos que el
 * tiempo de retención de homologación (10 min) que haría que un pedido
 * anticipado de más chocara con `coe.alreadyAuthenticated` de todos modos.
 */
const REFRESH_MARGIN_MS = 10 * 60 * 1000;

/**
 * `uniqueId` como entero sin signo de 32 bits: WSAA no exige un algoritmo
 * particular, sólo que identifique el pedido junto con `generationTime`. Un
 * timestamp Unix en segundos entra holgado (desborda recién en 2106) y es
 * trivialmente único entre pedidos de este proceso.
 */
function uniqueId(now: Date): number {
  return Math.floor(now.getTime() / 1000);
}

/**
 * Formatea un instante como hora de Argentina con el offset fijo `-03:00`
 * que exige el WSAA — no como `Date#toISOString`, que da `Z` (UTC), ni como
 * `toLocaleString`, cuyo resultado depende del huso horario configurado en
 * el proceso que corre esto (un contenedor corre casi siempre en UTC).
 *
 * Argentina no observa horario de verano desde 2009: restar 3 horas fijas y
 * leer los getters UTC del resultado da la hora de pared correcta sin
 * depender de una base de datos de husos horarios.
 */
function formatArgentinaTimestamp(date: Date): string {
  const shifted = new Date(date.getTime() - 3 * 60 * 60 * 1000);
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return (
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` +
    `T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}` +
    `.${pad(shifted.getUTCMilliseconds(), 3)}-03:00`
  );
}

/**
 * El `LoginTicketRequest`, sin firmar.
 *
 * `expirationTime` a 10 minutos de `generationTime`: WSAA acepta hasta 24 h
 * de margen en cualquier dirección, pero un TRA de vida corta es el que
 * menos daño hace si alguna vez se filtra sin firmar — y 10 minutos sobran
 * para que la firma y el POST que siguen terminen.
 */
export function buildLoginTicketRequest(service: string, now: Date = new Date()): string {
  const generationTime = formatArgentinaTimestamp(now);
  const expirationTime = formatArgentinaTimestamp(new Date(now.getTime() + 10 * 60 * 1000));

  return (
    `<?xml version="1.0" encoding="UTF8"?>` +
    `<loginTicketRequest version="1.0">` +
    `<header>` +
    `<uniqueId>${uniqueId(now)}</uniqueId>` +
    `<generationTime>${generationTime}</generationTime>` +
    `<expirationTime>${expirationTime}</expirationTime>` +
    `</header>` +
    `<service>${service}</service>` +
    `</loginTicketRequest>`
  );
}

/**
 * Firma el TRA como CMS SignedData adjunto (`-nodetach` de OpenSSL: el
 * contenido va incluido, no separado), SHA-1 + RSA, con el certificado que
 * ARCA emitió para este servicio. El resultado es exactamente lo que el
 * parámetro `in0` de `loginCms` espera: base64, sin las líneas
 * `-----BEGIN/END CMS-----`.
 */
export function signTicketRequest(xml: string, certPem: string, keyPem: string): string {
  const certificate = forge.pki.certificateFromPem(certPem);
  const privateKey = forge.pki.privateKeyFromPem(keyPem);

  const signedData = forge.pkcs7.createSignedData();
  signedData.content = forge.util.createBuffer(xml, "utf8");
  signedData.addCertificate(certificate);
  signedData.addSigner({
    key: privateKey,
    certificate,
    digestAlgorithm: forge.pki.oids.sha1,
  });
  signedData.sign();

  const der = forge.asn1.toDer(signedData.toAsn1()).getBytes();
  return forge.util.encode64(der);
}

/**
 * Nombre real confirmado contra clientes WSAA en producción (PyAfipWs y
 * derivados) y no contra el WSDL propio, que este código no pudo descargar
 * en homologación real. Confirmar contra `${WSAA_URLS[environment]}?WSDL`
 * antes del primer pedido real — un espacio de nombres equivocado responde
 * un SOAP Fault de inmediato, así que el error es imposible de pasar por
 * alto, pero conviene no descubrirlo recién ahí.
 */
const WSAA_NAMESPACE = "http://wsaa.view.sua.dvadac.desein.afip.gov";

function buildLoginCmsEnvelope(cmsBase64: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ` +
    `xmlns:wsaa="${WSAA_NAMESPACE}">` +
    `<soapenv:Header/>` +
    `<soapenv:Body>` +
    `<wsaa:loginCms>` +
    `<wsaa:in0>${cmsBase64}</wsaa:in0>` +
    `</wsaa:loginCms>` +
    `</soapenv:Body>` +
    `</soapenv:Envelope>`
  );
}

export class WsaaError extends Error {
  constructor(
    message: string,
    /** El código SOAP Fault de WSAA (`coe.alreadyAuthenticated`, `cms.bad`, etc.), si vino uno. */
    public readonly code?: string,
  ) {
    super(message);
    this.name = "WsaaError";
  }
}

/** Ejecuta `loginCms` y devuelve el `LoginTicketResponse` ya parseado. */
async function callLoginCms(url: string, cmsBase64: string): Promise<Ticket> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "text/xml; charset=utf-8",
      soapaction: "",
    },
    body: buildLoginCmsEnvelope(cmsBase64),
  });

  const body = await response.text();
  const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true });
  const parsed = parser.parse(body);

  const fault = parsed?.Envelope?.Body?.Fault;
  if (fault) {
    const detail = fault.detail?.exceptionInfo ?? fault.detail;
    throw new WsaaError(
      String(detail?.message ?? fault.faultstring ?? "WSAA rejected the login request."),
      detail?.code ? String(detail.code) : undefined,
    );
  }

  if (!response.ok) {
    throw new WsaaError(`WSAA respondió ${response.status}.`);
  }

  // `loginCmsReturn` trae el LoginTicketResponse como texto XML escapado
  // adentro de un string SOAP — hay que parsearlo una segunda vez.
  const inner = parsed?.Envelope?.Body?.loginCmsResponse?.loginCmsReturn;
  if (typeof inner !== "string") {
    throw new WsaaError("La respuesta de WSAA no trajo loginCmsReturn.");
  }
  const ticketResponse = parser.parse(inner);
  const credentials = ticketResponse?.loginTicketResponse?.credentials;
  const header = ticketResponse?.loginTicketResponse?.header;
  if (!credentials?.token || !credentials?.sign || !header?.expirationTime) {
    throw new WsaaError("El LoginTicketResponse de WSAA no trae credentials completas.");
  }

  return {
    token: String(credentials.token),
    sign: String(credentials.sign),
    expirationTime: new Date(String(header.expirationTime)),
  };
}

/**
 * Pide (o reusa) el ticket de acceso para un servicio de negocio.
 *
 * `service` es el nombre que espera WSAA — `"wsfe"` para facturación
 * electrónica, no `"wsfev1"`.
 */
export async function getTicket(service: string, config: FiscalConfig): Promise<Ticket> {
  const cacheKey = `${config.environment}|${service}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expirationTime.getTime() - REFRESH_MARGIN_MS > Date.now()) {
    return cached;
  }

  const xml = buildLoginTicketRequest(service);
  const cmsBase64 = signTicketRequest(xml, config.certPem, config.keyPem);
  const ticket = await callLoginCms(WSAA_URLS[config.environment], cmsBase64);

  cache.set(cacheKey, ticket);
  return ticket;
}

/** Sólo para tests: `getTicket` cachea entre llamadas dentro del mismo proceso. */
export function clearTicketCache(): void {
  cache.clear();
}
