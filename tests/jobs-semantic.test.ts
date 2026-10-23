import { describe, expect, it } from "vitest";
import { blendScores, cosine, postingText, profileText } from "@/lib/jobs/semantic";
import { emptyProfile, type Profile } from "@/lib/schemas/profile";

function profile(overrides: Partial<Profile> = {}): Profile {
  return { ...emptyProfile(), ...overrides };
}

describe("profileText / postingText", () => {
  it("prefixes the profile as a query and a posting as a passage — e5's own convention", () => {
    expect(profileText(profile({ headline: "Backend developer" }))).toMatch(/^query: /);
    expect(postingText({ title: "Backend Engineer", tags: [], description: "" })).toMatch(
      /^passage: /,
    );
  });

  it("starts the query with what the person is after, before what their roles say: the sector they are leaving does not lead", () => {
    const text = profileText(
      profile({
        objective: "Diseño de producto",
        headline: "Analista de marketing",
        experience: [{ id: "e1", company: "Nubia", role: "Analista de marketing", city: "", country: "", start: "", end: "", current: false, bullets: [], tags: [], employmentType: "", workMode: "", note: "", achievements: [], transferable: [] }],
      }),
    );
    expect(text.indexOf("Diseño de producto")).toBeGreaterThan(-1);
    expect(text.indexOf("Diseño de producto")).toBeLessThan(text.indexOf("Analista de marketing"));
  });

  it("is what it was for a profile with no objective", () => {
    expect(profileText(profile({ headline: "Backend developer" }))).toBe("query: Backend developer");
  });

  it("caps how much of a posting's description gets embedded", () => {
    const long = "x".repeat(2000);
    const text = postingText({ title: "Role", tags: [], description: long });
    expect(text.length).toBeLessThan(1000);
  });
});

describe("cosine", () => {
  it("is 1 for identical vectors and 0 for orthogonal ones", () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("returns 0 rather than NaN for a zero vector", () => {
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

describe("blendScores", () => {
  it("leaves lexical scores untouched when similarities barely spread — no real signal to add", () => {
    const lexical = [80, 40, 60];
    const similarities = [0.81, 0.8, 0.805]; // e5's usual tight clustering
    expect(blendScores(lexical, similarities)).toEqual(lexical);
  });

  it("pulls the score toward the normalized similarity once the spread is real", () => {
    const lexical = [50, 50];
    const similarities = [0.9, 0.6]; // spread well past the threshold
    const [high, low] = blendScores(lexical, similarities);
    expect(high).toBeGreaterThan(low);
    // Both started equal on the lexical side — the entire gap is the semantic component.
    expect(high).toBeGreaterThan(50);
    expect(low).toBeLessThan(50);
  });

  it("returns the lexical scores unchanged on a length mismatch or empty input", () => {
    expect(blendScores([50, 60], [0.9])).toEqual([50, 60]);
    expect(blendScores([], [])).toEqual([]);
  });
});
