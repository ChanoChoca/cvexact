import "server-only";

import { and, eq, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { normalizeForFingerprint } from "@/lib/text/normalize";

/**
 * "¿Ya tengo esto guardado?" — nunca bloquea, sólo avisa. El umbral es sobre
 * `company_norm` (la misma normalización que ya existe como columna
 * generada: minúsculas, sólo alfanumérico) y, si hay coincidencia de
 * empresa, además sobre el título — dos postulaciones a la misma empresa con
 * títulos que no se parecen en nada son, la mayoría de las veces, dos
 * puestos distintos, no una repetida.
 */

export type DuplicateCandidate = {
  id: string;
  jobTitle: string | null;
  company: string | null;
  status: string;
  createdAt: Date;
  companySimilarity: number;
  titleSimilarity: number;
};

const COMPANY_THRESHOLD = 0.5;
const TITLE_THRESHOLD = 0.35;

/**
 * Candidatos a duplicado para `{ company, jobTitle }`, del mismo usuario.
 * `excludeId` para cuando se está editando una fila existente en vez de
 * creando una nueva — no tiene sentido que una postulación se marque a sí
 * misma como su propio duplicado.
 */
export async function findDuplicates(
  userId: string,
  input: { company: string; jobTitle: string },
  excludeId?: string,
): Promise<DuplicateCandidate[]> {
  const companyNorm = normalizeForFingerprint(input.company);
  if (!companyNorm) return [];

  const companySimilarity = sql<number>`similarity(${schema.application.companyNorm}, ${companyNorm})`;
  const titleSimilarity = sql<number>`similarity(coalesce(${schema.application.jobTitle}, ''), ${input.jobTitle})`;

  const rows = await getDb()
    .select({
      id: schema.application.id,
      jobTitle: schema.application.jobTitle,
      company: schema.application.company,
      status: schema.application.status,
      createdAt: schema.application.createdAt,
      companySimilarity,
      titleSimilarity,
    })
    .from(schema.application)
    .where(
      and(
        eq(schema.application.userId, userId),
        excludeId ? ne(schema.application.id, excludeId) : undefined,
        sql`${companySimilarity} >= ${COMPANY_THRESHOLD}`,
        sql`${titleSimilarity} >= ${TITLE_THRESHOLD}`,
      ),
    )
    .orderBy(sql`${companySimilarity} + ${titleSimilarity} desc`)
    .limit(5);

  return rows;
}
