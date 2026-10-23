import type { Application } from "@/lib/storage/local";
import { normalizeForFingerprint, normalizeText } from "@/lib/text/normalize";

/**
 * Qué CV generado en este navegador corresponde a un aviso del buscador,
 * para que "Ya me postulé" pueda vincularlo solo. Puro y sin red: compara
 * contra lo que `useApplications()` ya tiene en memoria.
 *
 * Empresa y puesto normalizados de la misma forma que `company_norm` en
 * `lib/db/schema.ts` (minúsculas, sólo alfanumérico) — "Mercado Libre" y
 * "MercadoLibre S.A." tienen que emparejar. El título no exige coincidencia
 * exacta: alcanza con que la mayoría de las palabras de uno estén en el
 * otro, porque el aviso y lo que el usuario tipeó al generar rara vez son
 * carácter por carácter la misma cadena ("Backend Engineer (Node.js)" vs
 * "Backend Engineer").
 */

function words(value: string): Set<string> {
  return new Set(normalizeText(value).split(/\s+/).filter((w) => w.length > 2));
}

function titleOverlap(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared += 1;
  return shared / Math.min(wa.size, wb.size);
}

const TITLE_OVERLAP_THRESHOLD = 0.6;

export function findLocalCvMatches(
  applications: Application[],
  job: { title: string; company: string },
): Application[] {
  const jobCompany = normalizeForFingerprint(job.company);
  if (!jobCompany) return [];

  return applications.filter((app) => {
    if (!app.cv || !app.analysis) return false;
    if (normalizeForFingerprint(app.analysis.company) !== jobCompany) return false;
    return titleOverlap(app.analysis.title, job.title) >= TITLE_OVERLAP_THRESHOLD;
  });
}
