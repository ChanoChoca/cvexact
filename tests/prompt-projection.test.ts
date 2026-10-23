import { describe, expect, it } from "vitest";
import { serializeProfile } from "@/lib/ai/prompts/shared";
import { verifyCV } from "@/lib/ai/verify";
import { cvDocumentSchema } from "@/lib/schemas/cv";
import { profileSchema } from "@/lib/schemas/profile";

/**
 * What the generators were never told, and now are: what kind of job it was and how it was done, when a study began, and how each
 * line was told. A profile that says none of it reads exactly as it did.
 */

const job = (extra: Record<string, unknown> = {}) => ({
  id: "e1",
  company: "Nubia Retail",
  role: "Analista",
  start: "Marzo 2021",
  end: "Agosto 2024",
  bullets: ["Subí las ventas — 20 %", "Armo los informes", "Coordino al equipo"],
  tags: [],
  ...extra,
});
const read = (experience: Record<string, unknown>, education: Array<Record<string, unknown>> = []) => serializeProfile(profileSchema.parse({ fullName: "Ana", experience: [experience], education }));

describe("what kind of job it was", () => {
  it("is said after the period, when a source said it", () => {
    expect(read(job({ employmentType: "internship", workMode: "remote" }))).toContain("[Marzo 2021 – Agosto 2024] · internship, remote");
    expect(read(job({ employmentType: "full_time" }))).toContain("[Marzo 2021 – Agosto 2024] · full-time\n");
    expect(read(job({ workMode: "hybrid" }))).toContain("· hybrid");
  });

  it("is not said when nobody said it, or when it is «other»: the line reads as it always did", () => {
    expect(read(job())).toContain("- Analista @ Nubia Retail [Marzo 2021 – Agosto 2024]\n");
    expect(read(job({ employmentType: "other" }))).toContain("- Analista @ Nubia Retail [Marzo 2021 – Agosto 2024]\n");
  });
});

describe("how each line was told", () => {
  it("is tagged on the line, with one sentence above the roles that says what the tags mean", () => {
    const text = read(job({ achievements: ["Subí las ventas — 20 %"], transferable: ["Armo los informes", "Subí las ventas — 20 %"] }));
    expect(text).toContain("b1 [result, transferable] Subí las ventas — 20 %");
    expect(text).toContain("b2 [transferable] Armo los informes");
    expect(text).toContain("b3 Coordino al equipo");
    expect(text).toContain("A bullet tagged [result] is an outcome the candidate reported");
  });

  it("is not said at all for a profile that has no such mark", () => {
    const text = read(job());
    expect(text).not.toContain("[result]");
    expect(text).not.toContain("tagged");
    expect(text).toContain("b1 Subí las ventas — 20 %");
  });

  it("goes after the count of matches, when the bullets are ranked", () => {
    const text = serializeProfile(profileSchema.parse({ fullName: "Ana", experience: [job({ achievements: ["Subí las ventas — 20 %"] })] }), { rankBullet: (bullet) => (bullet.startsWith("Subí") ? 2 : 0) });
    expect(text).toContain("b1 [2 matches] [result] Subí las ventas — 20 %");
  });
});

describe("when a study began", () => {
  const study = (extra: Record<string, unknown>) => ({ id: "d1", institution: "UNC", degree: "Licenciatura", end: "2024", ...extra });

  it("is said with its end, and a study still going says «present»", () => {
    expect(read(job(), [study({ start: "2020" })])).toContain("[2020 – 2024] status=completed");
    expect(read(job(), [study({ start: "2023", end: "", status: "in_progress" })])).toContain("[2023 – present] status=in_progress");
    expect(read(job(), [study({ start: "2023", end: "" })])).toContain("[2023 – ?]");
  });

  it("is not said when nobody gave it: the study reads as it did", () => {
    expect(read(job(), [study({})])).toContain("[2024] status=completed");
  });

  it("is a year the CV may use: a date that starts the study is not one the profile never had", () => {
    const profile = profileSchema.parse({
      fullName: "Ana",
      experience: [job()],
      education: [study({ start: "2019", end: "2023" })],
    });
    const cv = cvDocumentSchema.parse({
      language: "es",
      header: { fullName: "Ana", location: "", phone: "", email: "", links: [] },
      summary: "Analista.",
      sections: [
        { kind: "experience", title: "EXPERIENCIA PROFESIONAL", items: [{ company: "Nubia Retail", role: "Analista", location: "", dateRange: "Marzo 2021 – Agosto 2024", bullets: ["Armé los informes."] }] },
        { kind: "education", title: "EDUCACIÓN", items: [{ institution: "UNC", degree: "Licenciatura", location: "", date: "2019 – 2023", honors: "" }] },
      ],
      coverage: { requirements: [], omitted: [] },
    });
    const dates = verifyCV(cv, profile).filter((finding) => finding.detail.includes("usa el año"));
    expect(dates).toEqual([]);
  });
});
