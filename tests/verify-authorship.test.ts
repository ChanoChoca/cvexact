import { describe, expect, it } from "vitest";
import { authorship, cvGaps, gapCount, verifyCV } from "@/lib/ai/verify";
import { cvDocumentSchema } from "@/lib/schemas/cv";
import { profileSchema } from "@/lib/schemas/profile";

/**
 * Who did the work (VAL-2): a CV may say «lideré» of a job only where the profile says someone led it, and the summary only
 * where the profile says so anywhere. These are the edges of that rule; the rows of the audit are in verify-mutations.
 */

const job = (role: string, bullets: string[], company = "Pagaluz SA") => ({ id: company, company, role, start: "2020", end: "2022", bullets, tags: [] });
const profileOf = (...experience: ReturnType<typeof job>[]) => profileSchema.parse({ fullName: "Bruno Ficticio", experience });

function cvOf(bullets: string[], { company = "Pagaluz SA", role = "Desarrollador", language = "es", summary = "Desarrollador mobile." } = {}) {
  return cvDocumentSchema.parse({
    language,
    header: { fullName: "Bruno Ficticio", location: "" },
    summary,
    sections: [{ kind: "experience", title: "EXPERIENCE", items: [{ company, role, location: "", dateRange: "2020 – 2022", bullets }] }],
    coverage: { requirements: [], omitted: [] },
  });
}

const overclaimed = (cv: ReturnType<typeof cvOf>, profile: ReturnType<typeof profileOf>) => authorship(cv, profile).overclaimed.map((c) => c.line);

describe("authority the profile does not back", () => {
  const participated = profileOf(job("Desarrollador", ["Participé en el roadmap."]));

  it("flags the verb that climbs a level, with the line", () => {
    expect(overclaimed(cvOf(["Lideré el roadmap."]), participated)).toEqual(["Lideré el roadmap."]);
    expect(overclaimed(cvOf(["Dirigí el roadmap."]), participated)).toHaveLength(1);
    expect(overclaimed(cvOf(["Responsable de las entregas."]), participated)).toHaveLength(1);
  });

  it("flags the present tense of a job that is still going", () => {
    expect(overclaimed(cvOf(["Lidero el equipo de pagos."]), participated)).toHaveLength(1);
  });

  it("flags it in English, against a profile in Spanish", () => {
    expect(overclaimed(cvOf(["Led the roadmap."], { language: "en" }), participated)).toHaveLength(1);
    expect(overclaimed(cvOf(["Led the roadmap."], { language: "en" }), profileOf(job("Desarrollador", ["Responsable del roadmap."])))).toEqual([]);
  });

  it("is backed by a title that is the authority itself", () => {
    expect(overclaimed(cvOf(["Lideré el roadmap."]), profileOf(job("Líder Técnica", ["Armé el roadmap."])))).toEqual([]);
    expect(overclaimed(cvOf(["Led the roadmap."], { language: "en" }), profileOf(job("Tech Lead", ["Armé el roadmap."])))).toEqual([]);
  });

  it("is read per job: another job's authority does not back this one", () => {
    const two = profileOf(job("Desarrollador", ["Responsable del equipo."], "Otra SA"), job("Desarrollador", ["Participé en el roadmap."]));
    expect(overclaimed(cvOf(["Lideré el roadmap."]), two)).toHaveLength(1);
  });

  it("does not take «responsable» the adjective for the claim", () => {
    expect(overclaimed(cvOf(["Armé el roadmap con una mirada responsable y prolija."]), participated)).toEqual([]);
  });

  it("leaves a job the profile does not have to the checks that already name it", () => {
    expect(overclaimed(cvOf(["Lideré el roadmap."], { company: "Inventada SA" }), participated)).toEqual([]);
  });

  it("is a gap the retry counts, and an error the person reads, with the summary as its own case", () => {
    const cv = cvOf(["Lideré el roadmap."], { summary: "Desarrollador que lidera equipos." });
    expect(gapCount(cvGaps(cv, participated))).toBe(gapCount(cvGaps(cvOf(["Armé el roadmap."]), participated)) + 1);
    const errors = verifyCV(cv, participated).filter((f) => f.severity === "error" && f.detail.includes("lideraste"));
    expect(errors.map((f) => f.field)).toEqual(["sections[0].items[0]"]);
  });
});

describe("nuance the CV lost", () => {
  const participated = profileOf(job("Desarrollador", ["Participé en el roadmap.", "Armé el pipeline."]));
  const lost = (cv: ReturnType<typeof cvOf>) => authorship(cv, participated).lost.map((l) => l.where);

  it("warns when no line of the job keeps a «participé» and one is still about that task", () => {
    expect(lost(cvOf(["Definí el roadmap.", "Armé el pipeline."]))).toEqual(["Pagaluz SA"]);
  });

  it("does not when the task was left out: a line that is not there claims nothing", () => {
    expect(lost(cvOf(["Armé el pipeline de builds."]))).toEqual([]);
  });

  it("does not when one does, in either language", () => {
    expect(lost(cvOf(["Participé en el roadmap.", "Armé el pipeline."]))).toEqual([]);
    expect(lost(cvOf(["Participated in the roadmap."], { language: "en" }))).toEqual([]);
  });

  it("never makes it a gap: the retry is for what a CV overclaims, not for what it drops", () => {
    expect(gapCount(cvGaps(cvOf(["Definí el roadmap."]), participated))).toBe(0);
  });
});
