import { and, desc, eq, ilike, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import type { jobPosting } from "@/lib/db/schema";

/**
 * Parses `/api/jobs/feed`'s query string, and builds the SQL pieces its route
 * assembles a query from. Pulled out of the route file on purpose — every
 * `route.ts` in this app exports only the handlers Next.js recognises (`GET`,
 * `runtime`, …), never a helper alongside them, so anything worth
 * unit-testing here has to live in `lib/` instead. See
 * `app/api/jobs/feed/route.ts`, the only caller.
 *
 * The type import from `lib/db/schema` is erased at build time — nothing
 * runtime-shaped crosses into the client bundle that reads `JobPosting` and
 * `FeedResponse` below, only the column types Drizzle already infers.
 */

/**
 * One row of `job_posting`, as the client actually receives it.
 *
 * Not `typeof jobPosting.$inferSelect` verbatim: Drizzle types `publishedAt`
 * and `fetchedAt` as `Date`, which is what a query in the same process gets
 * back — but this crosses `NextResponse.json()` first, and `JSON.stringify`
 * turns a `Date` into an ISO string with no way back without a reviver
 * neither side runs. `Date | null` here would be a lie the type checker
 * believes and every caller finds out is false at runtime.
 */
export type JobPosting = Omit<typeof jobPosting.$inferSelect, "publishedAt" | "fetchedAt"> & {
  publishedAt: string | null;
  fetchedAt: string;
  /**
   * How many rows share this listing's `dedupGroupId` (including itself) —
   * `1` for a listing no other source also posted. `/api/jobs/feed` computes
   * it as part of the same collapsing query rather than a second round trip;
   * see `dedupPartitionKeySql`. `JobsList.tsx` uses it to show "también en N
   * portales" next to the source badge.
   */
  dupes: number;
};

export type FeedResponse = {
  jobs: JobPosting[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export const FEED_PAGE_SIZE = 30;
export const FEED_MAX_PAGE_SIZE = 60;

/**
 * How much of a posting's description the public feed sends, in full-text
 * republication terms (see `app/api/jobs/feed/route.ts`'s header comment and
 * B6 #6 of la auditoría legal interna) — an excerpt, not the whole aviso.
 * Kept ≥ `semantic.ts`'s own `DESCRIPTION_CHARS` (600) so this truncation
 * never cuts into what the semantic embedder already used; the lexical
 * scorer (`lib/jobs/score.ts`) can lose a term that only appears further in,
 * an accepted trade-off. The full text still exists — it just moves to
 * `app/api/jobs/[id]/description/route.ts`, fetched only when a visitor
 * actually clicks "Postular".
 */
export const FEED_DESCRIPTION_CHARS = 700;

export function truncateDescription(description: string): string {
  return description.length > FEED_DESCRIPTION_CHARS
    ? description.slice(0, FEED_DESCRIPTION_CHARS)
    : description;
}

export type FeedQuery = {
  page: number;
  pageSize: number;
  source?: string;
  workMode?: string;
  seniority?: string;
  q?: string;
};

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  // `Number(null)` is `0`, not `NaN` — without this guard, an absent param
  // silently clamped to the floor instead of falling back to the default.
  if (raw === null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function optionalParam(url: URL, name: string): string | undefined {
  return url.searchParams.get(name)?.trim() || undefined;
}

export function parseFeedQuery(url: URL): FeedQuery {
  return {
    page: clampInt(url.searchParams.get("page"), 1, 1, 10_000),
    pageSize: clampInt(url.searchParams.get("pageSize"), FEED_PAGE_SIZE, 1, FEED_MAX_PAGE_SIZE),
    source: optionalParam(url, "source"),
    workMode: optionalParam(url, "workMode"),
    seniority: optionalParam(url, "seniority"),
    q: optionalParam(url, "q"),
  };
}

type JobPostingTable = typeof jobPosting;

/**
 * The `where` conditions `/api/jobs/feed` filters on, given a parsed
 * `FeedQuery`. Moved out of the route for the same reason `parseFeedQuery`
 * is: `tests/jobs-feed-route.test.ts` can only inspect the SQL a mocked
 * `pg-proxy` driver receives, never call this directly, so the one thing
 * worth unit-testing in isolation — that `onsite`/`hybrid` always add the
 * `country = "AR"` condition, and nothing else does — lives here as a plain
 * function over `and`/`eq`/`ilike`, no database involved.
 */
export function buildFeedConditions(table: JobPostingTable, query: FeedQuery): SQL[] {
  const conditions: SQL[] = [];
  if (query.source) conditions.push(eq(table.source, query.source));
  if (query.workMode) conditions.push(eq(table.workMode, query.workMode));
  // Presencial e híbrido exigen estar en el país — algo que ninguna otra
  // condición de acá garantiza. Este producto es exclusivamente para
  // Argentina (términos, cláusula 2), así que se exige `country = "AR"`, no
  // el país del perfil del usuario (la ruta no lee sesión ni perfil). Ver el
  // comentario de `country` en `lib/db/schema.ts` para el bug concreto que
  // esto existe para no repetir.
  if (query.workMode === "onsite" || query.workMode === "hybrid") {
    conditions.push(eq(table.country, "AR"));
  }
  if (query.seniority) conditions.push(eq(table.seniority, query.seniority));
  // A plain substring match on the title only, not the description — a
  // keyword search over the full HTML would surface postings that mention a
  // word once in passing over ones whose actual role is named by it.
  if (query.q) conditions.push(ilike(table.title, `%${query.q}%`));
  return conditions;
}

export function feedWhere(table: JobPostingTable, query: FeedQuery): SQL | undefined {
  const conditions = buildFeedConditions(table, query);
  return conditions.length > 0 ? and(...conditions) : undefined;
}

/**
 * The key rows with the same role posted through more than one source share
 * — `dedup_group_id` when the ingester could compute one (it had a company
 * to anchor it on), the row's own `id` otherwise, so a company-less listing
 * groups only with itself instead of with every other company-less listing.
 * `/api/jobs/feed` partitions its `row_number()`/`count()` window functions
 * by this, collapsing the feed to one representative row per group — see the
 * table comment on `jobPosting.dedupGroupId` in `lib/db/schema.ts`.
 */
export function dedupPartitionKeySql(table: JobPostingTable) {
  return sql`case when ${table.dedupGroupId} = '' then ${table.id} else ${table.dedupGroupId} end`;
}

/**
 * The feed's `ORDER BY`, over the `collapsed` CTE: newest first, and — when
 * the visitor's country is known — listings whose `country` matches it ahead
 * of everything else, so the order holds across pages and not just inside
 * the 30 rows one page happens to carry. `country` is only ever `"AR"` or
 * `""` today (see the column's comment in `lib/db/schema.ts`), so for any
 * other visitor this is a no-op rather than a demotion of anyone.
 */
export function feedOrderBy(
  collapsed: Record<"country" | "publishedAt" | "fetchedAt", SQLWrapper>,
  country: string | null,
): SQL[] {
  const byDate = [desc(collapsed.publishedAt), desc(collapsed.fetchedAt)];
  return country ? [sql`(${collapsed.country} = ${country}) desc`, ...byDate] : byDate;
}
