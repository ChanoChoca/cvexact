import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { databaseConfigured, getDb, schema } from "@/lib/db";
import { enforceRateLimit } from "@/lib/api/guards";

export const runtime = "nodejs";

/**
 * The full, untruncated `description` for one posting — public, no session,
 * same as `/api/jobs/feed`. Split out so the bulk feed can send only an
 * excerpt (`FEED_DESCRIPTION_CHARS`, `lib/jobs/feed-query.ts`) while
 * `JobsList.tsx`'s `postular()` can still prefill the CV wizard with the
 * whole aviso, fetched on the one click that actually needs it.
 *
 * Narrower than the feed's rate limit on purpose: a real visitor calls this
 * at most once per click, so the budget only has to be generous for that —
 * scraping the whole catalog this way costs one request per posting instead
 * of one `GET` for all of them.
 */

const RATE_LIMIT = { window: 60, max: 20 };

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/jobs/[id]/description">,
) {
  const limited = await enforceRateLimit("jobs-description", request.headers, RATE_LIMIT);
  if (limited) return limited;

  if (!databaseConfigured) {
    return NextResponse.json({ error: "Aviso no encontrado." }, { status: 404 });
  }

  const { id } = await ctx.params;
  const [row] = await getDb()
    .select({ description: schema.jobPosting.description })
    .from(schema.jobPosting)
    .where(eq(schema.jobPosting.id, id))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "Aviso no encontrado." }, { status: 404 });
  }

  return NextResponse.json({ description: row.description });
}
