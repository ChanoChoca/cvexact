import { describe, expect, it } from "vitest";
import { and } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { dedupGroupId } from "@/scripts/jobs/shared.mjs";
import { buildFeedConditions, dedupPartitionKeySql } from "@/lib/jobs/feed-query";
import { jobPosting } from "@/lib/db/schema";

const dialect = new PgDialect();
const render = (expr: Parameters<PgDialect["sqlToQuery"]>[0]) => dialect.sqlToQuery(expr).sql;

/**
 * `dedupGroupId` (written by every ingester) and `dedupPartitionKeySql` (read
 * by `/api/jobs/feed`, see `tests/jobs-feed-route.test.ts` for the collapsing
 * behaviour end to end) have to agree on one thing: when to fall back to
 * "this row is its own group" instead of grouping it with anything else.
 * These are the two places that decision is made — this file is what keeps
 * them from drifting apart silently.
 */

describe("dedupGroupId", () => {
  it("groups the same title and company, case- and accent-insensitively", () => {
    const a = dedupGroupId("Una Empresa", "Desarrollador Backend");
    const b = dedupGroupId("una empresa", "DESARROLLADOR BACKEND");
    expect(a).toBe(b);
    expect(a).not.toBe("");
  });

  it("does not group the same title across different companies", () => {
    const a = dedupGroupId("Empresa Uno", "Desarrollador Backend");
    const b = dedupGroupId("Empresa Dos", "Desarrollador Backend");
    expect(a).not.toBe(b);
  });

  it("returns '' — its own group of one — when there is no company to anchor on", () => {
    expect(dedupGroupId("", "Desarrollador Backend")).toBe("");
    expect(dedupGroupId("Una Empresa", "")).toBe("");
  });
});

describe("dedupPartitionKeySql", () => {
  it("builds a CASE expression falling back to id when dedup_group_id is empty", () => {
    const rendered = render(dedupPartitionKeySql(jobPosting));
    expect(rendered).toContain('"dedup_group_id"');
    expect(rendered.toLowerCase()).toContain("case when");
    expect(rendered).toContain('"id"');
  });
});

describe("buildFeedConditions", () => {
  it("stays a plain, empty array with no filters — the route treats that as no WHERE at all", () => {
    expect(buildFeedConditions(jobPosting, { page: 1, pageSize: 30 })).toHaveLength(0);
  });

  it("still requires country = AR for onsite alongside any other filter", () => {
    const conditions = buildFeedConditions(jobPosting, {
      page: 1,
      pageSize: 30,
      workMode: "onsite",
      q: "react",
    });
    // eq(work_mode), eq(country, "AR"), ilike(title)
    expect(conditions).toHaveLength(3);
    const rendered = render(and(...conditions)!);
    expect(rendered).toContain('"work_mode" = ');
    expect(rendered).toContain('"country" = ');
    expect(rendered).toContain('"title" ilike');
  });

  it("does not add country for remote", () => {
    const conditions = buildFeedConditions(jobPosting, { page: 1, pageSize: 30, workMode: "remote" });
    const rendered = render(and(...conditions)!);
    expect(rendered).not.toContain('"country"');
  });
});
