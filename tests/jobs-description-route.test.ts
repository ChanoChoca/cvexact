import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import { resetRateLimitMemory } from "@/lib/rate-limit";

/**
 * `/api/jobs/[id]/description` — the full-text counterpart to the now
 * truncated `/api/jobs/feed` (see `tests/jobs-feed-route.test.ts`). Same
 * `drizzle-orm/pg-proxy` approach as that file: no real Postgres, just enough
 * SQL matching to stand in for one `select ... from "job_posting" where "id"
 * = $1 limit 1`.
 */

const LONG_DESCRIPTION = "Se busca desarrollador. ".repeat(50);

let rows: unknown[][] = [[LONG_DESCRIPTION]];

const db = drizzle(async (sql) => {
  if (sql.includes('from "job_posting"')) return { rows };
  return { rows: [] };
});

vi.mock("@/lib/db", async () => ({
  databaseConfigured: true,
  getDb: () => db,
  schema: await import("@/lib/db/schema"),
}));

beforeEach(() => {
  rows = [[LONG_DESCRIPTION]];
  resetRateLimitMemory();
  vi.resetModules();
});

function request(id: string) {
  return new Request(`http://localhost/api/jobs/${id}/description`, {
    headers: { "x-forwarded-for": "203.0.113.9" },
  });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/jobs/[id]/description", () => {
  it("returns the full, untruncated description for an existing posting", async () => {
    const { GET } = await import("@/app/api/jobs/[id]/description/route");
    const response = await GET(request("getonbrd:1"), ctx("getonbrd:1"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.description).toBe(LONG_DESCRIPTION);
    expect(body.description.length).toBeGreaterThan(700);
  });

  it("404s when the posting does not exist", async () => {
    rows = [];
    const { GET } = await import("@/app/api/jobs/[id]/description/route");
    const response = await GET(request("no-existe"), ctx("no-existe"));

    expect(response.status).toBe(404);
  });
});
