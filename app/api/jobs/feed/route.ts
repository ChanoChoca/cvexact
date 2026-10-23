import { NextResponse } from "next/server";
import { count, eq, getTableColumns, sql } from "drizzle-orm";
import { databaseConfigured, getDb, schema } from "@/lib/db";
import { enforceRateLimit } from "@/lib/api/guards";
import { clientCountry } from "@/lib/client-country";
import {
  FEED_PAGE_SIZE,
  dedupPartitionKeySql,
  feedOrderBy,
  feedWhere,
  parseFeedQuery,
  truncateDescription,
} from "@/lib/jobs/feed-query";

export const runtime = "nodejs";

/**
 * The public job feed — `/empleos` reads it, then scores and
 * sorts every page client-side against `useProfile()` with
 * `lib/jobs/score.ts`. The one thing it personalises is the listing order,
 * by the country Cloudflare reports for the request (`lib/client-country.ts`)
 * — nothing about the visitor is stored. It never reads a session or a
 * profile: that split
 * is what lets the privacy policy keep saying the profile never leaves the
 * browser without the user syncing it, and what makes this route safe to
 * cache and to call signed out. See the comment on `jobPosting` in
 * `lib/db/schema.ts` for the fuller reasoning.
 *
 * The writers are `scripts/ingest-jobs.mjs`, `scripts/ingest-jooble.mjs` and
 * `scripts/ingest-ats.mjs`, on their own CronJobs — this route never fetches
 * a source itself, so a slow or down job board never shows up as a slow
 * request here. It also collapses listings the same role got posted through
 * more than one source into one result — see `dedupPartitionKeySql`.
 *
 * `description` goes out truncated to `FEED_DESCRIPTION_CHARS`, not in full —
 * see that constant's comment in `lib/jobs/feed-query.ts`. Client-side
 * scoring (`JobsList.tsx`, both the lexical score and the semantic embedder)
 * reads straight off this response, so the excerpt has to be long enough for
 * that to still work; the semantic side already only embedded the first 600
 * characters anyway. The one thing that still needs the whole aviso —
 * `postular()` prefilling the CV wizard — fetches it separately, on click,
 * from `app/api/jobs/[id]/description/route.ts`.
 *
 * This is a mitigation, not a full close, of B6 #6 of the audit legal
 * (la auditoría legal interna): a scraper can no longer pull every posting's
 * full text in one `GET` here, but the per-posting route above is still
 * public. The `x-cvexact-client` check below is not authentication either
 * (trivial to fake with curl) — it just gives the app's own frontend the
 * normal allowance and everything else a much tighter one.
 */

export async function GET(request: Request) {
  // Unauthenticated and cheap per request — one indexed query — but still a
  // request anyone on the internet can fire without a session, so it gets
  // the same treatment `models` and `sync` get in lib/api/context.ts and
  // app/api/sync/route.ts. `useJobsFeed.ts` sends `x-cvexact-client: web` on
  // every request the real UI makes; anything without it (a scraper pulling
  // every page back to back, most likely) gets a much narrower budget.
  const isWebClient = request.headers.get("x-cvexact-client") === "web";
  const limited = await enforceRateLimit(
    "jobs-feed",
    request.headers,
    isWebClient ? { window: 60, max: 60 } : { window: 60, max: 5 },
  );
  if (limited) return limited;

  // No database is a supported deployment (BYOK-only, see lib/db/index.ts) —
  // an empty feed rather than a 500, the same choice `sync` and `billing`
  // make for the same reason.
  if (!databaseConfigured) {
    return NextResponse.json({
      jobs: [],
      page: 1,
      pageSize: FEED_PAGE_SIZE,
      total: 0,
      totalPages: 0,
    });
  }

  const query = parseFeedQuery(new URL(request.url));
  const { page, pageSize } = query;

  const table = schema.jobPosting;
  const where = feedWhere(table, query);
  const dedupKey = dedupPartitionKeySql(table);

  const db = getDb();

  // Collapses listings for the same role posted through more than one
  // source (`getonbrd:x` and `jooble:y` sharing a `dedupGroupId`) into one
  // result — see the comment on `jobPosting.dedupGroupId` in
  // `lib/db/schema.ts`. `rn = 1` keeps the newest row of each group as the
  // representative; `dupes` is how many rows (including itself) share that
  // group, so the UI can say "también en N portales". A plain `DISTINCT ON`
  // does not work here: it forces the `ORDER BY` to start with the grouping
  // column, which is not the order the feed wants (newest first).
  const collapsed = db.$with("collapsed").as(
    db
      .select({
        ...getTableColumns(table),
        rn: sql<number>`row_number() over (
          partition by ${dedupKey}
          order by ${table.publishedAt} desc nulls last, ${table.fetchedAt} desc
        )`.as("rn"),
        dupes: sql<number>`count(*) over (partition by ${dedupKey})`.as("dupes"),
      })
      .from(table)
      .where(where),
  );

  // Every group appears exactly once with `rn = 1` in the unlimited
  // `collapsed` set, so counting those rows is the distinct-group count —
  // no separate `count(distinct ...)` query needed.
  const [{ total }] = await db
    .with(collapsed)
    .select({ total: count() })
    .from(collapsed)
    .where(eq(collapsed.rn, 1));

  // Selected explicitly rather than `.select()` (all columns): `collapsed`
  // also carries `rn`, the ranking column that picked the representative row
  // — internal to this query, never meant to reach the response. `dupes`
  // does belong in the response — `JobsList.tsx` reads it to show "también
  // en N portales" — so this mirrors `jobPosting`'s own columns (see
  // `lib/db/schema.ts`) plus that one extra.
  const jobs = await db
    .with(collapsed)
    .select({
      id: collapsed.id,
      source: collapsed.source,
      url: collapsed.url,
      title: collapsed.title,
      company: collapsed.company,
      location: collapsed.location,
      country: collapsed.country,
      workMode: collapsed.workMode,
      seniority: collapsed.seniority,
      language: collapsed.language,
      tags: collapsed.tags,
      description: collapsed.description,
      salaryMin: collapsed.salaryMin,
      salaryMax: collapsed.salaryMax,
      salaryCurrency: collapsed.salaryCurrency,
      publishedAt: collapsed.publishedAt,
      fetchedAt: collapsed.fetchedAt,
      canPrefill: collapsed.canPrefill,
      dedupGroupId: collapsed.dedupGroupId,
      dupes: collapsed.dupes,
    })
    .from(collapsed)
    .where(eq(collapsed.rn, 1))
    // Newest posting first; a listing without a readable publish date (some
    // sources don't state one) sorts last rather than first, which is the
    // Postgres default for NULLS in a DESC order.
    .orderBy(...feedOrderBy(collapsed, clientCountry(request.headers)))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  // The order now depends on the visitor's country (`CF-IPCountry`), so this
  // must never be served from a shared cache to someone in another one.
  return NextResponse.json({
    jobs: jobs.map((job) => ({ ...job, description: truncateDescription(job.description) })),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  }, { headers: { "cache-control": "private", vary: "CF-IPCountry" } });
}
