import "server-only";

import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { parseAnyProfile } from "@/lib/profile/parse";
import { toPlainProfile } from "@/lib/profile/project";

/**
 * Reordena los candidatos a título de una publicación de LinkedIn
 * (`site-rules/linkedin-post.ts`) según la experiencia que el usuario ya
 * tiene cargada en su perfil — la idea del propio usuario ("elegir de forma
 * automática el puesto que tenga más experiencia"), sin ningún modelo: sólo
 * comparación de texto plano contra `experience[].role`/`.tags`
 * (`lib/schemas/profile.ts`).
 *
 * Sólo tiene efecto si alguna vez hizo "Subir" (`POST /api/sync`) — `profile`
 * no existe para cuentas que sólo usan el tracker o la extensión, y ahí esto
 * es un no-op silencioso, nunca un error.
 */

const STOPWORDS = new Set([
  "de",
  "del",
  "la",
  "el",
  "los",
  "las",
  "un",
  "una",
  "unos",
  "unas",
  "y",
  "en",
  "con",
  "para",
  "the",
  "of",
  "and",
  "for",
  "with",
  "a",
  "an",
]);

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function tokenize(text: string): string[] {
  return normalize(text)
    .split(/[^a-z0-9+#]+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

export type ExperienceSignal = { role: string; tags: string[] };

/** Puro — separado de la consulta a la base para poder probarlo sin DB. El
 *  puntaje es el máximo solape de tokens contra cualquiera de las
 *  experiencias, no la suma: alcanza con que un candidato calce bien con UNA
 *  entrada del historial, no con el perfil entero. */
export function scoreTitleCandidate(candidate: string, experience: ExperienceSignal[]): number {
  const candidateTokens = tokenize(candidate);
  if (candidateTokens.length === 0) return 0;
  let best = 0;
  for (const entry of experience) {
    const entryTokens = new Set([...tokenize(entry.role), ...entry.tags.flatMap(tokenize)]);
    const overlap = candidateTokens.filter((token) => entryTokens.has(token)).length;
    if (overlap > best) best = overlap;
  }
  return best;
}

/**
 * Orden estable por puntaje descendente. Sin experiencia cargada, o con
 * todos los candidatos en cero (ningún solape real con nada de su
 * trayectoria), el orden de entrada queda intacto — nunca reordena a partir
 * de una señal que no existe.
 */
export function rankTitleCandidates(candidates: string[], experience: ExperienceSignal[]): string[] {
  if (experience.length === 0) return candidates;
  return candidates
    .map((candidate, index) => ({ candidate, index, score: scoreTitleCandidate(candidate, experience) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.candidate);
}

/**
 * Lee `experience` del perfil del usuario, si existe. Nunca tira: una fila
 * ausente o un jsonb que no valida contra `profileSchema` (perfil viejo,
 * corrupto) se lee como "sin señal", no como un error que tumbe la captura.
 */
export async function getExperienceSignal(userId: string): Promise<ExperienceSignal[]> {
  const [row] = await getDb()
    .select({ data: schema.profile.data })
    .from(schema.profile)
    .where(eq(schema.profile.userId, userId))
    .limit(1);
  if (!row) return [];

  // La fila puede estar en el formato de antes de la procedencia o en el actual.
  const stored = parseAnyProfile(row.data);
  if (!stored) return [];

  return toPlainProfile(stored).experience.map((entry) => ({ role: entry.role, tags: entry.tags }));
}
