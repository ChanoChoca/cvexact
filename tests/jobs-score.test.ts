import { describe, expect, it } from "vitest";
import { scoreJobAnalysis, scoreJobPosting, scoreMatch } from "@/lib/jobs/score";
import { requirementSchema, type JobAnalysis, type Requirement } from "@/lib/schemas/job";
import { backendProfile, buriedFrontendProfile, devProfile } from "./fixtures";

/**
 * The deterministic match score `/postular` and, later, the job feed show
 * before anything is sent to a model. Fixed `now` throughout — see
 * `tests/evidence.test.ts#statedYearsOfExperience` for why: `backendProfile`
 * reads as 2 years of experience and `devProfile` as 5 only at this date.
 */

const now = new Date(2026, 7, 11); // 2026-08-11 — matches evidence.test.ts

const req = (text: string, overrides: Partial<Requirement> = {}): Requirement =>
  requirementSchema.parse({ text, kind: "hard", ...overrides });

function analysis(overrides: Partial<JobAnalysis> = {}): JobAnalysis {
  return {
    title: "Puesto",
    company: "",
    location: "",
    workMode: "unknown",
    seniority: "unknown",
    language: "es",
    domain: "software",
    relevance: "direct",
    relevanceReason: "",
    requirements: [],
    responsibilities: [],
    priorities: [],
    keywords: [],
    embeddedQuestions: [],
    emailSubject: "",
    applicationEmail: "",
    ...overrides,
  };
}

describe("scoreJobAnalysis — keyword component", () => {
  it("scores higher for a posting whose named technologies the profile backs", () => {
    const strongMatch = scoreJobAnalysis(
      backendProfile,
      analysis({ keywords: ["PostgreSQL", "Docker", "Kubernetes", "AWS"] }),
      now,
    );
    const weakMatch = scoreJobAnalysis(
      backendProfile,
      analysis({ keywords: ["Ruby on Rails", "Elixir", "Cassandra", "Erlang"] }),
      now,
    );

    expect(strongMatch.score).toBeGreaterThan(weakMatch.score);
    expect(strongMatch.keywords.supported).toEqual(
      expect.arrayContaining(["PostgreSQL", "Docker", "Kubernetes", "AWS"]),
    );
    expect(weakMatch.keywords.fabricable.length).toBeGreaterThan(0);
  });

  it("does not penalise a posting with no named technologies at all", () => {
    const result = scoreJobAnalysis(
      devProfile,
      analysis({ keywords: ["trabajo en equipo", "proactividad"] }),
      now,
    );
    // Neither term is a hard term, so the keyword component has nothing to
    // judge and stays out of the score entirely rather than reading as zero.
    expect(result.keywords.supported).toEqual([]);
    expect(result.keywords.fabricable).toEqual([]);
  });
});

describe("scoreJobAnalysis — seniority fit", () => {
  it("reads as a match when the posting's band covers the candidate's years", () => {
    // devProfile carries ~5 years at `now` — squarely mid, and inside senior's
    // lower bound too.
    expect(scoreJobAnalysis(devProfile, analysis({ seniority: "mid" }), now).seniorityFit).toBe(
      "match",
    );
  });

  it("reads as under when the posting asks for more than the candidate has", () => {
    // backendProfile carries ~2 years — well short of a lead posting.
    expect(scoreJobAnalysis(backendProfile, analysis({ seniority: "lead" }), now).seniorityFit).toBe(
      "under",
    );
  });

  it("reads as over when the candidate has well more than the posting asks", () => {
    expect(
      scoreJobAnalysis(devProfile, analysis({ seniority: "intern" }), now).seniorityFit,
    ).toBe("over");
  });

  it("stays unknown rather than guessing when the posting states no seniority", () => {
    expect(
      scoreJobAnalysis(devProfile, analysis({ seniority: "unknown" }), now).seniorityFit,
    ).toBe("unknown");
  });
});

describe("scoreJobAnalysis — location fit", () => {
  it("is always remote-compatible regardless of where the candidate lives", () => {
    expect(
      scoreJobAnalysis(
        devProfile,
        analysis({ workMode: "remote", location: "Berlin, Alemania" }),
        now,
      ).locationFit,
    ).toBe("remote");
  });

  it("matches when the posting names the candidate's own city", () => {
    // devProfile lives in Rosario, Argentina.
    expect(
      scoreJobAnalysis(devProfile, analysis({ workMode: "onsite", location: "Rosario" }), now)
        .locationFit,
    ).toBe("same_place");
  });

  it("falls back to relocatable when the profile says so", () => {
    // buriedFrontendProfile's practical.willingToRelocate is true; devProfile's
    // is false — see tests/fixtures.ts.
    expect(
      scoreJobAnalysis(
        buriedFrontendProfile,
        analysis({ workMode: "onsite", location: "Bariloche" }),
        now,
      ).locationFit,
    ).toBe("relocatable");
  });

  it("is a mismatch when the profile will not relocate and the place differs", () => {
    // backendProfile's practical.willingToRelocate defaults to false.
    expect(
      scoreJobAnalysis(
        backendProfile,
        analysis({ workMode: "onsite", location: "Ciudad de México" }),
        now,
      ).locationFit,
    ).toBe("mismatch");
  });

  it("stays unknown when the posting states no location", () => {
    expect(
      scoreJobAnalysis(devProfile, analysis({ workMode: "onsite", location: "" }), now)
        .locationFit,
    ).toBe("unknown");
  });
});

describe("scoreJobAnalysis — language fit", () => {
  it("matches when the profile states the posting's language", () => {
    // Both fixtures list Español.
    expect(scoreJobAnalysis(devProfile, analysis({ language: "es" }), now).languageFit).toBe(true);
  });

  it("does not ask a profile to declare Spanish for a posting in Spanish: it is the language it is read in", () => {
    const noLanguages = { ...devProfile, languages: [] };
    const result = scoreJobAnalysis(noLanguages, analysis({ language: "es" }), now);
    expect(result.languageFit).toBe(true);
    // Nor does it weigh less than the same posting for a profile that lists it.
    expect(result.score).toBe(scoreJobAnalysis(devProfile, analysis({ language: "es" }), now).score);
  });

  it("is false, not null, when the profile never states the posting's language", () => {
    const noEnglish = { ...devProfile, languages: [{ id: "l1", name: "Español", level: "Nativo" }] };
    expect(scoreJobAnalysis(noEnglish, analysis({ language: "en" }), now).languageFit).toBe(false);
  });

  it("stays null for a language the app has no name for", () => {
    expect(scoreJobAnalysis(devProfile, analysis({ language: "de" }), now).languageFit).toBeNull();
  });
});

describe("scoreJobAnalysis — blocking exclusions", () => {
  it("carries the same excluding-requirement warning preflight.ts computes", () => {
    const result = scoreJobAnalysis(
      devProfile,
      analysis({
        requirements: [req("Experiencia previa como mozo en restaurante", { excluding: true })],
      }),
      now,
    );
    expect(result.blocking).toHaveLength(1);
    expect(result.blocking[0]!.requirement).toContain("mozo");
  });

  it("is empty for a raw listing that was never analyzed", () => {
    const result = scoreMatch(
      devProfile,
      {
        keywords: [],
        seniority: "unknown",
        workMode: "unknown",
        location: "",
        language: "es",
      },
      now,
    );
    expect(result.blocking).toEqual([]);
  });
});

describe("scoreJobAnalysis — overall score", () => {
  it("stays within 0 and 100", () => {
    const best = scoreJobAnalysis(
      devProfile,
      analysis({
        keywords: ["React", "TypeScript", "Git"],
        seniority: "mid",
        workMode: "remote",
        language: "es",
      }),
      now,
    );
    const worst = scoreJobAnalysis(
      devProfile,
      analysis({
        keywords: ["Rust", "Erlang", "Cassandra"],
        seniority: "lead",
        workMode: "onsite",
        location: "Oslo",
        language: "de",
      }),
      now,
    );

    for (const result of [best, worst]) {
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    }
    expect(best.score).toBeGreaterThan(worst.score);
  });

  it("returns a neutral midpoint rather than a fabricated number when nothing is legible", () => {
    const result = scoreMatch(
      devProfile,
      { keywords: [], seniority: "unknown", workMode: "unknown", location: "", language: "xx" },
      now,
    );
    expect(result.score).toBe(50);
  });
});

describe("scoreJobPosting", () => {
  const now = new Date(2026, 7, 11); // matches the rest of this file

  function posting(overrides: Partial<Parameters<typeof scoreJobPosting>[1]> = {}) {
    return {
      id: "getonbrd:1",
      source: "getonbrd",
      url: "https://www.getonbrd.com/jobs/uno",
      title: "Desarrollador Backend",
      company: "Una Empresa",
      location: "",
      workMode: "remote",
      seniority: "unknown",
      language: "es",
      tags: ["PostgreSQL", "Docker"],
      description: "Buscamos experiencia con Kubernetes y AWS.",
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      publishedAt: "2026-08-01T00:00:00.000Z",
      fetchedAt: "2026-08-11T00:00:00.000Z",
      canPrefill: true,
      ...overrides,
    };
  }

  it("reads named technologies out of the tags and the description, not just the title", () => {
    const result = scoreJobPosting(backendProfile, posting(), now);
    // backendProfile's bullets/tags name PostgreSQL, Redis, Docker, Kubernetes,
    // AWS — see tests/fixtures.ts — so all four terms this posting carries
    // should read as supported, not fabricable.
    expect(result.keywords.supported).toEqual(
      expect.arrayContaining(["PostgreSQL", "Docker", "Kubernetes", "AWS"]),
    );
    expect(result.keywords.fabricable).toEqual([]);
  });

  it("never reports a blocking exclusion — a raw listing has no requirements to check", () => {
    expect(scoreJobPosting(devProfile, posting(), now).blocking).toEqual([]);
  });

  it("falls back to unknown rather than trusting an unrecognised workMode/seniority value", () => {
    const result = scoreJobPosting(
      devProfile,
      posting({ workMode: "made_up", seniority: "made_up" } as never),
      now,
    );
    expect(result.locationFit).toBe("unknown");
    expect(result.seniorityFit).toBe("unknown");
  });
});

describe("the objective, against a posting", () => {
  const now2 = new Date(2026, 7, 11);
  // On site, far from the profile: so that the score is not already at the top, where a bonus has nowhere to go.
  const posting = (title: string, tags: string[] = []) => ({
    title,
    tags,
    description: "Buscamos a alguien para sumarse al equipo.",
    seniority: "unknown",
    workMode: "onsite",
    location: "Tokio, Japón",
    language: "es",
  });
  const withObjective = (objective: string) => ({ ...devProfile, objective });

  it("moves a posting up when its title says what the person is after", () => {
    const without = scoreJobPosting(devProfile, posting("Analista de marketing digital"), now2);
    const match = scoreJobPosting(withObjective("Analista de marketing digital"), posting("Analista de marketing digital"), now2);
    expect(match.score).toBeGreaterThan(without.score);
    expect(match.objectiveFit).toBe("match");
  });

  it("does not take from a posting whose title shares no word with the objective: it may say it in another language", () => {
    const without = scoreJobPosting(devProfile, posting("Data Analyst"), now2);
    const unrelated = scoreJobPosting(withObjective("Diseño de producto"), posting("Data Analyst"), now2);
    expect(unrelated.score).toBe(without.score);
    expect(unrelated.objectiveFit).toBe("mismatch");
  });

  it("puts a posting for the new field above one for the field being left, for the same profile", () => {
    const profile = withObjective("Diseño de producto");
    const toward = scoreJobPosting(profile, posting("Diseñador de producto"), now2);
    const away = scoreJobPosting(profile, posting("Analista de marketing"), now2);
    expect(toward.score).toBeGreaterThan(away.score);
  });

  it("is nothing for a profile with no objective: the score is what it always was", () => {
    const result = scoreJobPosting(devProfile, posting("Desarrollador Backend"), now2);
    expect(result.objectiveFit).toBe("unknown");
  });

  it("reaches the score of an analysed posting too, by its title and the terms it names", () => {
    const result = scoreJobAnalysis(withObjective("Analista de datos"), analysis({ title: "Analista de datos senior", keywords: ["SQL"] }), now2);
    expect(result.objectiveFit).toBe("match");
    expect(scoreJobAnalysis(withObjective("Analista de datos"), analysis({ title: "Chef ejecutivo" }), now2).objectiveFit).toBe("mismatch");
  });
});

describe("what /postular says about a posting that is not what the person is after", () => {
  const now3 = new Date(2026, 7, 11);

  it("says so, with the objective in the person's own words, and that the CV is made from the posting either way", async () => {
    const { fitNotes } = await import("@/components/wizard/panels");
    const result = scoreJobAnalysis({ ...devProfile, objective: "Diseño de producto" }, analysis({ title: "Chef ejecutivo" }), now3);
    const notes = fitNotes(result, "Diseño de producto");
    expect(notes).toContain("Tu objetivo dice «Diseño de producto» y este puesto apunta a otra cosa: si te postulás igual, el CV se arma con lo que pide el aviso.");
  });

  it("says nothing when the posting is what they are after, or when they said nothing", async () => {
    const { fitNotes } = await import("@/components/wizard/panels");
    const match = scoreJobAnalysis({ ...devProfile, objective: "Chef" }, analysis({ title: "Chef ejecutivo" }), now3);
    expect(fitNotes(match, "Chef").some((note) => note.includes("Tu objetivo"))).toBe(false);
    const none = scoreJobAnalysis(devProfile, analysis({ title: "Chef ejecutivo" }), now3);
    expect(fitNotes(none, "").some((note) => note.includes("Tu objetivo"))).toBe(false);
  });
});
