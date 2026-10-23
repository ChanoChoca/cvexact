import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import { resetRateLimitMemory } from "@/lib/rate-limit";
import { FEED_DESCRIPTION_CHARS } from "@/lib/jobs/feed-query";

/**
 * `/api/jobs/feed` end to end, minus a real Postgres. Two things worth
 * pinning here that nothing else catches without a live database: the
 * `SELECT count(*) ...` result actually gets destructured (a query builder
 * mistake here throws "Cannot destructure property 'total' of undefined",
 * not a type error — `tsc` cannot see it), and the route degrades to an
 * empty feed rather than a 500 when no database is configured at all,
 * matching `sync` and `billing/status`.
 *
 * The route runs everything through a `WITH "collapsed" AS (...)` CTE (see
 * `app/api/jobs/feed/route.ts`) so it can collapse listings the same role got
 * posted through more than one source into one result — every query below is
 * `with "collapsed" as (select ... from "job_posting" [where ...]) select ...
 * from "collapsed" where "rn" = $n [...]`, never a bare `select ... from
 * "job_posting"` any more.
 *
 * `drizzle-orm/pg-proxy` hands rows back as plain positional arrays, not
 * objects keyed by column name (see its `customResultMapper?: (rows:
 * unknown[][])` — the object shape a first attempt at this reached for reads
 * back as every column `undefined`, silently, because Zod never sees these
 * rows). The order below is the route's own explicit outer `select` list —
 * `job_posting`'s column order (`lib/db/schema.ts`) plus `dupes`, deliberately
 * *not* `rn` (the ranking column stays internal to the CTE — the outer query
 * never selects it, see `app/api/jobs/feed/route.ts`); if either order
 * changes, this has to change with it.
 */

const JOB_ROW = [
  "getonbrd:1",
  "getonbrd",
  "https://www.getonbrd.com/jobs/uno",
  "Desarrollador Backend",
  "Una Empresa",
  "",
  "AR",
  "remote",
  "unknown",
  "es",
  [],
  "<p>Buscamos</p>",
  null,
  null,
  null,
  "2026-08-30T00:00:00.000Z",
  "2026-08-31T00:00:00.000Z",
  true,
  "", // dedup_group_id — "" here means "its own group of one", not "ungrouped"
  1, // dupes
];

const captured: Array<{ sql: string; params: unknown[] }> = [];
/** How many times the rate-limit bucket's INSERT has fired, so repeated
 *  calls in the same test actually accumulate like a real counter would. */
let rateLimitCount = 0;

/** What the `job_posting`/`collapsed` queries answer with — mutable per test
 *  instead of a second `drizzle-orm/pg-proxy` instance, so every test still
 *  goes through the one rate-limit counter above. */
let jobRows: unknown[][] = [JOB_ROW, ["getonbrd:2", ...JOB_ROW.slice(1)]];
let totalRows = 2;

/** Extracts the CTE's own `where` clause — the one over `job_posting` — as
 *  opposed to the outer query's `where "rn" = $n`, which is present on every
 *  request regardless of filters and would otherwise make every assertion
 *  below trivially true. */
function cteBody(sql: string): string {
  return sql.slice(sql.indexOf('from "job_posting"'), sql.indexOf(") select"));
}

const db = drizzle(async (sql, params) => {
  captured.push({ sql, params });
  if (sql.includes('insert into "app_rate_limit"')) {
    rateLimitCount += 1;
    return { rows: [[rateLimitCount, Date.now()]] };
  }
  if (sql.includes("select count(*)")) return { rows: [[totalRows]] };
  if (sql.startsWith("with") && sql.includes('from "job_posting"')) {
    return { rows: jobRows };
  }
  return { rows: [] };
});

vi.mock("@/lib/db", async () => ({
  databaseConfigured: true,
  getDb: () => db,
  schema: await import("@/lib/db/schema"),
}));

beforeEach(() => {
  captured.length = 0;
  rateLimitCount = 0;
  jobRows = [JOB_ROW, ["getonbrd:2", ...JOB_ROW.slice(1)]];
  totalRows = 2;
  resetRateLimitMemory();
  vi.resetModules();
});

/**
 * Defaults to the header `useJobsFeed.ts` sends on every real request, so
 * every test other than the two about the header itself exercises the same
 * path an actual visitor does — see the "sin `x-cvexact-client`" describe
 * block below for the narrower budget a request without it gets.
 */
function request(query = "") {
  return new Request(`http://localhost/api/jobs/feed${query}`, {
    headers: { "x-forwarded-for": "203.0.113.9", "x-cvexact-client": "web" },
  });
}

/** Same as `request()`, minus the header the real UI always sends. */
function requestWithoutWebHeader(query = "") {
  return new Request(`http://localhost/api/jobs/feed${query}`, {
    headers: { "x-forwarded-for": "203.0.113.9" },
  });
}

function lastSelect() {
  return captured.find((c) => c.sql.startsWith("with") && c.sql.includes('from "job_posting"'));
}

describe("GET /api/jobs/feed", () => {
  it("returns the page, total and jobs the database reports", async () => {
    const { GET } = await import("@/app/api/jobs/feed/route");
    const response = await GET(request());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(2);
    expect(body.page).toBe(1);
    expect(body.jobs).toHaveLength(2);
    expect(body.jobs[0].source).toBe("getonbrd");
    expect(body.jobs[0].title).toBe("Desarrollador Backend");
    // The internal ranking column never leaks into the response — it exists
    // only to pick the representative row, not to describe the listing.
    expect(body.jobs[0].rn).toBeUndefined();
    expect(body.jobs[0].dupes).toBe(1);
  });

  it("emits a title-only ilike filter for `q`, not one over the description", async () => {
    const { GET } = await import("@/app/api/jobs/feed/route");
    await GET(request("?q=react"));

    const whereClause = cteBody(lastSelect()!.sql);
    expect(whereClause).toContain('"title" ilike');
    expect(whereClause).not.toContain('"description" ilike');
  });

  it("requires country = AR when workMode is onsite, whatever the row's own work_mode says", async () => {
    const { GET } = await import("@/app/api/jobs/feed/route");
    await GET(request("?workMode=onsite"));

    const select = lastSelect();
    const whereClause = cteBody(select!.sql);
    expect(whereClause).toContain('"work_mode" = ');
    expect(whereClause).toContain('"country" = ');
    expect(select?.params).toContain("AR");
  });

  it("requires country = AR when workMode is hybrid too", async () => {
    const { GET } = await import("@/app/api/jobs/feed/route");
    await GET(request("?workMode=hybrid"));

    const whereClause = cteBody(lastSelect()!.sql);
    expect(whereClause).toContain('"country" = ');
  });

  it("does not filter by country when workMode is remote or unset", async () => {
    const { GET } = await import("@/app/api/jobs/feed/route");
    await GET(request("?workMode=remote"));

    const remoteWhere = cteBody(lastSelect()!.sql);
    expect(remoteWhere).not.toContain('"country" = ');

    captured.length = 0;
    await GET(request());
    const unfiltered = cteBody(lastSelect()!.sql);
    expect(unfiltered).not.toContain("where");
  });

  it("collapses listings the same role got posted through more than one source into one result", async () => {
    const grouped = [...JOB_ROW];
    grouped[18] = "desarrollador backend|una empresa"; // dedup_group_id
    grouped[19] = 2; // dupes — this row and one other share the group
    jobRows = [grouped];
    totalRows = 1;

    const { GET } = await import("@/app/api/jobs/feed/route");
    const response = await GET(request());
    const body = await response.json();

    expect(body.total).toBe(1);
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0].dupes).toBe(2);
  });

  it("rate-limits after enough requests", async () => {
    const { GET } = await import("@/app/api/jobs/feed/route");

    let lastStatus = 200;
    for (let i = 0; i < 61; i += 1) {
      lastStatus = (await GET(request())).status;
    }
    expect(lastStatus).toBe(429);
  });

  it("truncates a long description to FEED_DESCRIPTION_CHARS (B6 #6 mitigation)", async () => {
    jobRows = [[...JOB_ROW.slice(0, 11), "<p>" + "x".repeat(2000) + "</p>", ...JOB_ROW.slice(12)]];
    totalRows = 1;

    const { GET } = await import("@/app/api/jobs/feed/route");
    const body = await (await GET(request())).json();
    expect(body.jobs[0].description).toHaveLength(FEED_DESCRIPTION_CHARS);
  });
});

describe("GET /api/jobs/feed ordering by visitor country", () => {
  /** The paginated select (the only one with a `limit`), not the count. */
  const pageQuery = () => captured.find((c) => c.sql.startsWith("with") && c.sql.includes("limit"))!;
  const orderClause = (sql: string) => sql.slice(sql.lastIndexOf("order by"));

  it("puts the visitor's country first when Cloudflare reports one", async () => {
    process.env.CLIENT_IP_HEADERS = "cf-connecting-ip";
    try {
      const { GET } = await import("@/app/api/jobs/feed/route");
      const response = await GET(
        new Request("http://localhost/api/jobs/feed", {
          headers: { "cf-connecting-ip": "203.0.113.9", "cf-ipcountry": "AR", "x-cvexact-client": "web" },
        }),
      );
      const order = orderClause(pageQuery().sql);
      expect(order).toMatch(/^order by \("collapsed"\."country" = \$\d+\) desc, /);
      expect(pageQuery().params).toContain("AR");
      expect(response.headers.get("vary")).toBe("CF-IPCountry");
      expect(response.headers.get("cache-control")).toBe("private");
    } finally {
      delete process.env.CLIENT_IP_HEADERS;
    }
  });

  it("keeps the plain newest-first order when the header is not trusted", async () => {
    const { GET } = await import("@/app/api/jobs/feed/route");
    await GET(
      new Request("http://localhost/api/jobs/feed", {
        headers: { "x-forwarded-for": "203.0.113.9", "cf-ipcountry": "AR", "x-cvexact-client": "web" },
      }),
    );
    expect(orderClause(pageQuery().sql)).not.toContain('"country"');
  });
});

describe("GET /api/jobs/feed without x-cvexact-client", () => {
  /**
   * `useJobsFeed.ts` sends `x-cvexact-client: web` on every request the real
   * UI makes (see its comment) — this is what anything else gets, most
   * likely a scraper pulling every page back to back. Not authentication
   * (trivial to fake with curl): just a narrower budget for traffic that
   * did not bother to look like the app's own frontend.
   */
  it("rate-limits much sooner than a request carrying the header", async () => {
    const { GET } = await import("@/app/api/jobs/feed/route");

    let lastStatus = 200;
    for (let i = 0; i < 6; i += 1) {
      lastStatus = (await GET(requestWithoutWebHeader())).status;
    }
    expect(lastStatus).toBe(429);
  });

  it("truncates the description the same way as a web-header request", async () => {
    const { GET } = await import("@/app/api/jobs/feed/route");
    const body = await (await GET(requestWithoutWebHeader())).json();
    // Short to begin with, so this only confirms truncation doesn't add
    // anything odd for a description already under the limit.
    expect(body.jobs[0].description).toBe("<p>Buscamos</p>");
  });
});

describe("GET /api/jobs/feed without a database", () => {
  it("returns an empty feed instead of failing", async () => {
    vi.doMock("@/lib/db", async () => ({
      databaseConfigured: false,
      getDb: () => db,
      schema: await import("@/lib/db/schema"),
    }));
    const { GET } = await import("@/app/api/jobs/feed/route");

    const response = await GET(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ jobs: [], page: 1, pageSize: 30, total: 0, totalPages: 0 });
  });
});
