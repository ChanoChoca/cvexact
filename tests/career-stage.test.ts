import { describe, expect, it } from "vitest";
import { careerStage, stageOrder } from "@/lib/cv/stage";
import { toPlainProfile } from "@/lib/profile/project";
import { cvDocumentSchema } from "@/lib/schemas/cv";
import { profileSchema } from "@/lib/schemas/profile";
import { emptyStoredProfile } from "@/lib/schemas/profile-v2";

/**
 * What a reader meets first depends on how far into a career the person is. The stage is what they declared, and when they did not,
 * what the dates and the posting show; the order that follows is applied in code, not asked of the model (AUDITORIA_CV.md DAT-4, REN-2).
 */

const NOW = new Date(2026, 9, 21); // October 2026

const job = (start: string, end = "", extra: Record<string, unknown> = {}) => ({ id: start + end, company: "Pagaluz SA", role: "Desarrollador", start, end, current: end === "", bullets: ["Hice A."], tags: [], ...extra });
const study = (extra: Record<string, unknown> = {}) => ({ id: "u", institution: "UTS", degree: "Licenciatura en Sistemas", start: "2022", end: "2027", status: "in_progress", ...extra });
const person = (extra: Record<string, unknown>) => profileSchema.parse({ fullName: "Ana", ...extra });
const posting = (seniority: "intern" | "junior" | "mid" | "senior" | "unknown" = "mid") => ({ seniority });

describe("careerStage", () => {
  it("is early for someone with under two years of work who studies now", () => {
    expect(careerStage(person({ experience: [job("Marzo 2025")], education: [study()] }), posting(), NOW)).toBe("early");
  });

  it("is early for someone who finished studying within two years, and not for one who finished before", () => {
    const done = (end: string) => person({ experience: [job("Enero 2026")], education: [study({ status: "completed", end })] });
    expect(careerStage(done("2025"), posting(), NOW)).toBe("early");
    expect(careerStage(done("2019"), posting(), NOW)).toBe("established");
  });

  it("is established with two years of work or more, whatever they study", () => {
    expect(careerStage(person({ experience: [job("Marzo 2023")], education: [study()] }), posting(), NOW)).toBe("established");
  });

  it("counts overlapping jobs once", () => {
    const profile = person({ experience: [job("Marzo 2025", "Octubre 2026"), job("Abril 2025", "Septiembre 2026")], education: [study()] });
    expect(careerStage(profile, posting(), NOW)).toBe("early");
  });

  it("is early for an intern or junior posting with under two years of work, and not for a mid one", () => {
    const profile = person({ experience: [job("Marzo 2025")] });
    expect(careerStage(profile, posting("junior"), NOW)).toBe("early");
    expect(careerStage(profile, posting("intern"), NOW)).toBe("early");
    expect(careerStage(profile, posting("mid"), NOW)).toBe("established");
  });

  it("is not early for a junior posting when the person has the years", () => {
    expect(careerStage(person({ experience: [job("Enero 2020")] }), posting("junior"), NOW)).toBe("established");
  });

  it("does not take a job with no readable dates for no work at all", () => {
    const profile = person({ experience: [job("hace mucho", "hace poco"), job("Marzo 2025")], education: [study()] });
    expect(careerStage(profile, posting("junior"), NOW)).toBe("established");
  });

  it("ignores the blank row an «Agregar trabajo» leaves", () => {
    const profile = person({ experience: [job("Marzo 2025"), { id: "blank", company: "", role: "", bullets: [], tags: [] }], education: [study()] });
    expect(careerStage(profile, posting(), NOW)).toBe("early");
  });

  it("is early with no work at all and a study in progress", () => {
    expect(careerStage(person({ education: [study()] }), posting(), NOW)).toBe("early");
  });

  it("is established for a profile with nothing that says otherwise", () => {
    expect(careerStage(person({}), posting(), NOW)).toBe("established");
  });

  describe("what the person declared", () => {
    const veteran = { experience: [job("Enero 2012")] };
    const beginner = { experience: [job("Marzo 2026")], education: [study()] };

    it("goes first: a student is early and someone experienced is established, whatever the dates say", () => {
      expect(careerStage(person({ ...veteran, situation: "student" }), posting(), NOW)).toBe("early");
      expect(careerStage(person({ ...beginner, situation: "experienced" }), posting(), NOW)).toBe("established");
    });

    it("says nothing about how much work, when it is a pause or a change of field: the dates decide", () => {
      for (const situation of ["break", "switch"]) {
        expect(careerStage(person({ ...veteran, situation }), posting(), NOW), situation).toBe("established");
        expect(careerStage(person({ ...beginner, situation }), posting(), NOW), situation).toBe("early");
      }
    });

    it("reaches the generator: the stored profile's declared situation is in the plain one, and only when there is one", () => {
      const stored = emptyStoredProfile();
      expect("situation" in toPlainProfile(stored)).toBe(false);
      stored.onboarding.situation = "student";
      expect(toPlainProfile(stored).situation).toBe("student");
    });

    it("is dropped when it is not one of the four", () => {
      expect(person({ situation: "wizard" }).situation).toBeUndefined();
    });
  });
});

describe("stageOrder", () => {
  const sections = [
    { kind: "bullets", title: "SKILLS ADICIONALES", bullets: ["Uno.", "Dos."] },
    { kind: "pairs", title: "IDIOMAS", items: [{ label: "Inglés", value: "B2" }] },
    { kind: "activities", title: "ACTIVIDADES", items: [{ ref: "O1", text: "Presido el club." }] },
    { kind: "experience", title: "EXPERIENCIA", items: [{ company: "Pagaluz SA", role: "Dev", location: "", dateRange: "2025", bullets: ["Hice A."] }] },
    { kind: "projects", title: "PROYECTOS", items: [{ ref: "P1", name: "Turnero", description: "", url: "" }] },
    { kind: "education", title: "EDUCACIÓN", items: [{ institution: "UTS", degree: "Lic.", location: "", date: "2022 – 2027 (en curso)", honors: "" }] },
  ];
  const cv = cvDocumentSchema.parse({ language: "es", header: { fullName: "Ana", location: "" }, summary: "Resumen.", sections, coverage: { requirements: [], omitted: [] } });
  const order = (stage: "early" | "established") => stageOrder(cv, stage).sections.map((section) => section.kind);

  it("puts the studies and the projects first for someone starting, then the work and the activities", () => {
    expect(order("early")).toEqual(["education", "projects", "experience", "activities", "bullets", "pairs"]);
  });

  it("puts the work first for everyone else, with the pairs last as always", () => {
    expect(order("established")).toEqual(["experience", "education", "projects", "activities", "bullets", "pairs"]);
  });

  it("leaves a CV that is already in order as it is", () => {
    const placed = stageOrder(cv, "early");
    expect(stageOrder(placed, "early")).toBe(placed);
  });

  it("keeps the order of two sections of one kind", () => {
    const skills = cv.sections.find((section) => section.kind === "bullets")!;
    const work = cv.sections.find((section) => section.kind === "experience")!;
    const twice = { ...cv, sections: [skills, { ...skills, title: "OTRA" }, work] };
    expect(stageOrder(twice, "established").sections.map((section) => section.title)).toEqual(["EXPERIENCIA PROFESIONAL", "SKILLS ADICIONALES", "OTRA"]);
  });
});
