import { describe, expect, it } from "vitest";
import {
  FEED_DESCRIPTION_CHARS,
  FEED_MAX_PAGE_SIZE,
  FEED_PAGE_SIZE,
  parseFeedQuery,
  truncateDescription,
} from "@/lib/jobs/feed-query";

/**
 * Pure query-string parsing for `/api/jobs/feed` — pulled out of the route
 * (see that module's comment for why) precisely so it can be tested without
 * a database.
 */

describe("parseFeedQuery", () => {
  it("defaults page and pageSize when the query string is empty", () => {
    expect(parseFeedQuery(new URL("http://x/api/jobs/feed"))).toEqual({
      page: 1,
      pageSize: FEED_PAGE_SIZE,
    });
  });

  it("reads page and pageSize when both are present", () => {
    const result = parseFeedQuery(new URL("http://x/api/jobs/feed?page=3&pageSize=10"));
    expect(result.page).toBe(3);
    expect(result.pageSize).toBe(10);
  });

  it("clamps a pageSize above the ceiling instead of honouring it", () => {
    expect(parseFeedQuery(new URL("http://x/api/jobs/feed?pageSize=9999")).pageSize).toBe(
      FEED_MAX_PAGE_SIZE,
    );
  });

  it("clamps page and pageSize below 1 up to 1", () => {
    const result = parseFeedQuery(new URL("http://x/api/jobs/feed?page=-5&pageSize=0"));
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(1);
  });

  it("falls back to the default on a non-numeric page or pageSize", () => {
    const result = parseFeedQuery(new URL("http://x/api/jobs/feed?page=abc&pageSize=xyz"));
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(FEED_PAGE_SIZE);
  });

  it("reads the filters, trimmed, and omits each one when absent or blank", () => {
    const result = parseFeedQuery(
      new URL("http://x/api/jobs/feed?source=getonbrd&workMode=remote&seniority=mid&q=%20react%20"),
    );
    expect(result.source).toBe("getonbrd");
    expect(result.workMode).toBe("remote");
    expect(result.seniority).toBe("mid");
    expect(result.q).toBe("react");
  });

  it("omits a filter left out of the query string", () => {
    const result = parseFeedQuery(new URL("http://x/api/jobs/feed?q="));
    expect(result.source).toBeUndefined();
    expect(result.workMode).toBeUndefined();
    expect(result.seniority).toBeUndefined();
    expect(result.q).toBeUndefined();
  });
});

describe("truncateDescription", () => {
  it("leaves a description at or under the limit untouched", () => {
    const short = "a".repeat(FEED_DESCRIPTION_CHARS);
    expect(truncateDescription(short)).toBe(short);
    expect(truncateDescription("short")).toBe("short");
  });

  it("cuts a longer description down to exactly the limit", () => {
    const long = "a".repeat(FEED_DESCRIPTION_CHARS + 500);
    const result = truncateDescription(long);
    expect(result).toHaveLength(FEED_DESCRIPTION_CHARS);
    expect(result).toBe(long.slice(0, FEED_DESCRIPTION_CHARS));
  });
});
