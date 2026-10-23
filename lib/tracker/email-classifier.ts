import type { ApplicationStatus } from "./status";
import { normalizeForSearch } from "@/lib/text/normalize";

/**
 * El clasificador de la Fase 3 — sin LLM, dos señales en orden de
 * confianza: el dominio del remitente (alta) y regex multiidioma sobre
 * asunto y cuerpo (baja). Puro: no toca la base ni la red, para que sea
 * testeable sin un Worker de por medio. Ver `docs/tracker-email-fase3.md`
 * para el diseño completo y la advertencia de que las reglas de abajo son
 * hipótesis a validar contra datos reales, no hechos verificados — por eso
 * cada resultado trae `rawSender`/`rawSubject` para poder auditarlas.
 */

export type EmailCategory =
  | "confirmacion"
  | "entrevista"
  | "evaluacion"
  | "oferta"
  | "rechazo";

/** Por debajo de esto, `lib/tracker/email-ingest.ts` no cambia el estado
 *  solo — deja una nota proponiendo el cambio y pide confirmación manual. */
export const CLASSIFIER_CONFIDENCE_THRESHOLD = 0.6;

export type ClassificationResult =
  | { kind: "digest" }
  | { kind: "unclassified" }
  | { kind: "classified"; category: EmailCategory; confidence: number; matchedSender: boolean };

/** A qué estado mueve cada categoría — `confirmacion` no mueve nada: es
 *  exactamente lo que la fórmula de tasa de respuesta ya excluye como "no
 *  es una respuesta real" (ver `lib/tracker/metrics.ts`). */
export const CATEGORY_TO_STATUS: Partial<Record<EmailCategory, ApplicationStatus>> = {
  entrevista: "entrevista",
  evaluacion: "evaluacion",
  oferta: "oferta",
  rechazo: "rechazado",
};

/** event_type que deja cada categoría cuando la confianza alcanza para
 *  aplicar el cambio solo. */
export const CATEGORY_TO_EVENT_TYPE: Record<EmailCategory, string> = {
  confirmacion: "confirmacion",
  entrevista: "invitacion_entrevista",
  evaluacion: "evaluacion",
  oferta: "oferta",
  rechazo: "rechazo",
};

/**
 * Remitentes de ATS verificados — tabla del requerimiento. `domain` alcanza
 * con que aparezca en la parte del dominio del remitente (así
 * `notificaciones@mail.us.greenhouse-mail.io` también matchea
 * `greenhouse-mail.io`); `exact`, cuando hace falta el remitente completo
 * porque el dominio por sí solo es demasiado genérico (Workday: el tenant
 * varía por empresa, así que ahí no hay dominio fijo que matchear — queda
 * afuera de esta tabla a propósito, ver el comentario más abajo).
 */
const ATS_SENDER_DOMAINS: string[] = [
  "greenhouse.io",
  "greenhouse-mail.io",
  "hire.lever.co",
  "ashbyhq.com",
  "candidates.workablemail.com",
  "smartrecruiters.com",
  "recruitee.com",
  "teamtailor-mail.com",
  "bamboohr.com",
  "gupy.com.br",
  "computrabajo.com",
  "bumeran.com.ar",
  "zonajobs.com.ar",
  "getonbrd.com",
];

/**
 * Workday no tiene un dominio fijo — el remitente es
 * `<tenant>@myworkday.com`, y matchear sólo `myworkday.com` alcanza (el
 * subdominio/usuario varía, el dominio raíz no).
 */
const WORKDAY_DOMAIN = "myworkday.com";

function senderDomain(from: string): string {
  const at = from.lastIndexOf("@");
  return at === -1 ? "" : from.slice(at + 1).toLocaleLowerCase().trim().replace(/>$/, "");
}

/** `true` si el remitente es un ATS conocido — alta confianza, no dice qué
 *  categoría es, sólo que vale la pena mirar el resto. */
export function isKnownAtsSender(from: string): boolean {
  const domain = senderDomain(from);
  if (!domain) return false;
  if (domain === WORKDAY_DOMAIN || domain.endsWith(`.${WORKDAY_DOMAIN}`)) return true;
  return ATS_SENDER_DOMAINS.some((known) => domain === known || domain.endsWith(`.${known}`));
}

/** Regex multiidioma (es/en/pt) por categoría — ver la tabla del
 *  requerimiento. Cada una es una alternancia simple, sin acentos exigidos
 *  (el texto se normaliza antes de matchear). */
const CATEGORY_KEYWORDS: Record<EmailCategory, RegExp> = {
  rechazo:
    /unfortunately|not moving forward|we.ve decided|no continuara|no fue seleccionad|lamentamos|en esta oportunidad|infelizmente|nao seguiremos/i,
  entrevista:
    /\binterview\b|entrevista|schedule a call|agendar|disponibilidad|coordinar una llamada|agendamento/i,
  evaluacion: /assessment|technical test|challenge|prueba tecnica|evaluacion|desafio|teste/i,
  oferta: /\boffer\b|oferta|propuesta laboral|we.d like to offer|proposta/i,
  confirmacion:
    /application received|hemos recibido|gracias por postularte|recebemos sua candidatura/i,
};

/** Orden en el que se prueban las categorías cuando el texto podría matchear
 *  más de una — un rechazo casi siempre menciona también la postulación
 *  original ("gracias por tu interés, lamentablemente..."), así que rechazo
 *  se prueba antes que confirmación para no perder la señal más fuerte. */
const CATEGORY_PRIORITY: EmailCategory[] = ["rechazo", "oferta", "entrevista", "evaluacion", "confirmacion"];

function normalize(text: string): string {
  return normalizeForSearch(text);
}

function matchCategory(text: string): EmailCategory | null {
  const normalized = normalize(text);
  for (const category of CATEGORY_PRIORITY) {
    if (CATEGORY_KEYWORDS[category].test(normalized)) return category;
  }
  return null;
}

/**
 * Filtro anti-ruido: un digest de avisos ("20 ofertas que podrían
 * interesarte") no es un correo de estado sobre una postulación puntual.
 * Heurística, no una ciencia exacta — ver la advertencia del requerimiento:
 * varias ofertas mencionadas a la vez, o un asunto genérico de resumen.
 */
function looksLikeDigest(subject: string, bodyText: string): boolean {
  const normalizedSubject = normalize(subject);
  if (/\b\d{1,3}\s+(avisos|ofertas|empleos|jobs|vagas)\b/.test(normalizedSubject)) return true;
  if (/nuevos avisos|ofertas para vos|jobs for you|vagas para voce|resumen semanal|weekly digest/.test(normalizedSubject)) {
    return true;
  }
  // Un cuerpo con muchos links de "ver aviso"/"apply now" repetidos es la
  // otra huella de un digest — un correo de estado real habla de un solo
  // puesto y no repite la misma frase de "postulate" varias veces.
  const applyMentions = (normalize(bodyText).match(/\b(postulate|apply now|ver aviso|view job)\b/g) ?? []).length;
  return applyMentions >= 3;
}

export function classifyEmail(input: { from: string; subject: string; bodyText: string }): ClassificationResult {
  if (looksLikeDigest(input.subject, input.bodyText)) return { kind: "digest" };

  const matchedSender = isKnownAtsSender(input.from);
  // Asunto y cuerpo combinados, no probados por separado: un correo que
  // agradece la postulación en el asunto ("Gracias por postularte") y recién
  // en el cuerpo dice que no siguió adelante tiene que ganar como rechazo, no
  // quedarse en confirmación por haber mirado el asunto solo.
  const category = matchCategory(`${input.subject}\n${input.bodyText}`);

  if (!category) {
    return matchedSender
      ? { kind: "classified", category: "confirmacion", confidence: 0.5, matchedSender: true }
      : { kind: "unclassified" };
  }

  // Base por keyword sola, más un empujón si además viene de un ATS
  // conocido — las dos señales de acuerdo es lo que cruza el umbral casi
  // siempre; la keyword sola, en un correo de un dominio desconocido, se
  // queda corta a propósito.
  const confidence = Math.min(1, (matchedSender ? 0.55 : 0.35) + (matchedSender ? 0.35 : 0));

  return { kind: "classified", category, confidence, matchedSender };
}
