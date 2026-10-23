/**
 * A qué postulación corresponde un correo, entre las abiertas del usuario —
 * el clasificador (`email-classifier.ts`) dice de qué se trata, esto dice
 * de cuál. Puro: recibe candidatos ya traídos por
 * `lib/tracker/email-ingest.ts`, no toca la base.
 *
 * Heurística deliberadamente simple, y con un límite honesto: si el nombre
 * de la empresa no aparece en ningún lado del correo (remitente, asunto o
 * cuerpo), no hay match — y si aparece en más de una postulación abierta a
 * la vez, tampoco, porque no hay forma de saber a cuál se refiere. Los dos
 * casos se tratan igual en `email-ingest.ts`: no se aplica nada, el correo
 * se descarta después de haber sido leído en memoria, nunca se inventa un
 * link a la fuerza. No hay tabla para "correos sin emparejar" en el schema
 * de la Fase 3 — ver docs/tracker-email-fase3.md — así que ese es el límite
 * real de esta versión, no una simplificación de paso.
 */

import { normalizeForFingerprint } from "@/lib/text/normalize";

export type EmailMatchCandidate = { id: string; company: string | null };

/** Mínimo de caracteres para que un nombre de empresa cuente como señal —
 *  por debajo de esto ("Go", "3M") aparecería como falso positivo en casi
 *  cualquier texto. */
const MIN_COMPANY_LENGTH = 3;

export function matchApplicationForEmail(
  candidates: EmailMatchCandidate[],
  input: { from: string; subject: string; bodyText: string },
): EmailMatchCandidate[] {
  const haystack = normalizeForFingerprint(`${input.from} ${input.subject} ${input.bodyText}`);

  return candidates.filter((c) => {
    const company = normalizeForFingerprint(c.company ?? "");
    if (company.length < MIN_COMPANY_LENGTH) return false;
    return haystack.includes(company);
  });
}
