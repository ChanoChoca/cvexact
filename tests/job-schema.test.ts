import { describe, expect, it } from "vitest";
import { jobAnalysisSchema } from "@/lib/schemas/job";

const baseAnalysis = {
  title: "Backend Engineer",
  language: "es",
  domain: "software engineering",
  relevance: "direct" as const,
  relevanceReason: "Direct match on stack and seniority.",
  requirements: [],
};

/**
 * `keywords` is never printed on the CV — it only helps ATS matching — so an
 * overlong list should be trimmed rather than fail the whole `generateObject`
 * call. Guards against the "Too big: expected array to have <=40 items" 502
 * seen when the model returns more than 40 keywords.
 */
describe("jobAnalysisSchema.keywords", () => {
  it("truncates more than 40 keywords instead of rejecting them", () => {
    const keywords = Array.from({ length: 45 }, (_, i) => `keyword-${i}`);

    const result = jobAnalysisSchema.parse({ ...baseAnalysis, keywords });

    expect(result.keywords).toHaveLength(40);
    expect(result.keywords).toEqual(keywords.slice(0, 40));
  });

  it("leaves 40 or fewer keywords untouched", () => {
    const keywords = ["Node.js", "TypeScript", "AWS"];

    const result = jobAnalysisSchema.parse({ ...baseAnalysis, keywords });

    expect(result.keywords).toEqual(keywords);
  });
});

/**
 * Analyses are re-parsed out of localStorage and out of four route bodies, so
 * every application saved before these fields existed still has to parse. An
 * old analysis simply has no subject to carry, and the email falls back to the
 * job title.
 */
describe("jobAnalysisSchema — posting's application instructions", () => {
  it("defaults the email subject and address to empty when absent", () => {
    const result = jobAnalysisSchema.parse(baseAnalysis);

    expect(result.emailSubject).toBe("");
    expect(result.applicationEmail).toBe("");
  });

  it("keeps the subject the posting demanded", () => {
    const result = jobAnalysisSchema.parse({
      ...baseAnalysis,
      emailSubject: "REF-2043 – Vendedor CABA",
      applicationEmail: "rrhh@example.com",
    });

    expect(result.emailSubject).toBe("REF-2043 – Vendedor CABA");
    expect(result.applicationEmail).toBe("rrhh@example.com");
  });
});
