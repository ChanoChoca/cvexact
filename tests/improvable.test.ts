import { describe, expect, it } from "vitest";
import { addEntry, blankForm } from "@/lib/onboarding/entries";
import { addCertification, addLanguage, addSkill } from "@/lib/profile/entities";
import { improvablesOf, type Improvable, type ImproveSectionName } from "@/lib/profile/improvable";
import { IMPROVE_MANY_LIMIT } from "@/lib/ai/prompts/improve";
import type { StoredProfile } from "@/lib/schemas/profile-v2";
import { STAMP, newId, profileWith, withJob, withStudy } from "./helpers/profiles";

/**
 * What «Mejorar con IA» asks of in each section of the profile, and how what comes back is written. Pure: it reads the profile and says what to write, and
 * these tests write it into a copy to see that it lands where it should.
 */

const ctx = { newId, now: STAMP };
const of = (profile: StoredProfile, section: ImproveSectionName) => improvablesOf(profile, section);
const kinds = (items: Improvable[]) => items.map((item) => [item.kind, item.text]);
/** Writes an improved text into a copy of the profile, as the screen does. */
function applied(profile: StoredProfile, item: Improvable, improved: string): StoredProfile {
  const draft = structuredClone(profile);
  for (const write of item.writes(improved)) write.change(draft);
  return draft;
}

describe("experience", () => {
  const profile = () =>
    profileWith(
      { company: "Nubia Retail", role: "Analista", from: { year: 2021 }, to: "current", facts: [{ text: "Armo los pedidos" }, { kind: "tool", text: "Excel" }, { kind: "achievement", text: "Bajé los faltantes" }] },
      { company: "Kiosco Sur", role: "Cajera", from: { year: 2018 }, to: { year: 2020 }, facts: [{ text: "Atendía al público" }] },
    );

  it("asks of every task, the most recent job first, and not of a tool", () => {
    const items = of(profile(), "experience");
    expect(kinds(items)).toEqual([
      ["task", "Armo los pedidos"],
      ["task", "Bajé los faltantes"],
      ["task", "Atendía al público"],
    ]);
    expect(items.map((item) => item.label)).toEqual(["Analista · Nubia Retail", "Analista · Nubia Retail", "Cajera · Kiosco Sur"]);
    expect(new Set(items.map((item) => item.id)).size).toBe(3);
  });

  it("leaves out a task, and a job, that the CVs do not use", () => {
    const stored = profile();
    stored.experience[0]!.facts[0]!.excluded = true;
    stored.experience[1]!.excluded = true;
    expect(kinds(of(stored, "experience"))).toEqual([["task", "Bajé los faltantes"]]);
  });

  it("leaves out an empty task and one that its field could not hold again", () => {
    const stored = profile();
    stored.experience[0]!.facts[0]!.text = "   ";
    stored.experience[0]!.facts[2]!.text = "a".repeat(IMPROVE_MANY_LIMIT.task + 1);
    expect(of(stored, "experience")).toHaveLength(1);
  });

  it("writes the new words through the task, which is then an edit of the person's with its original kept", () => {
    const stored = profile();
    const [first] = of(stored, "experience");
    const draft = applied(stored, first!, "Armo los pedidos del depósito");
    const fact = draft.experience[0]!.facts[0]!;
    expect(fact).toMatchObject({ text: "Armo los pedidos del depósito", status: "edited", original: "Armo los pedidos" });
    expect(first!.writes("x")).toHaveLength(1);
    expect(first!.writes("x")[0]!.path).toEqual(["experience", stored.experience[0]!.id, "facts", fact.id]);
  });
});

describe("education", () => {
  const profile = () => {
    const stored = profileWith();
    const study = withStudy(stored, { degree: "tecnicatura en programacion", institution: "UTN", highlights: ["Tesis sobre logística", "Promedio 8"] });
    study.honors = { value: "Diploma de honor", status: "confirmed" };
    withStudy(stored, { degree: "", institution: "Escuela 5" });
    return stored;
  };

  it("asks of the degree, what it was honoured with and what stands out, as one text of lines — and of nothing a study does not have", () => {
    const items = of(profile(), "education");
    expect(kinds(items)).toEqual([
      ["name", "tecnicatura en programacion"],
      ["points", "Diploma de honor"],
      ["points", "Tesis sobre logística\nPromedio 8"],
    ]);
    expect(items.map((item) => item.label)).toEqual(["Título · UTN", "Menciones · tecnicatura en programacion · UTN", "Destacados · tecnicatura en programacion · UTN"]);
  });

  it("never asks of the name of the school", () => {
    expect(JSON.stringify(of(profile(), "education"))).not.toContain("Escuela 5");
    expect(of(profile(), "education").every((item) => item.text !== "UTN")).toBe(true);
  });

  it("writes a degree and an honour into their field, and the points as a list, one to a line, trimmed", () => {
    const stored = profile();
    const [degree, honors, points] = of(stored, "education");
    expect(applied(stored, degree!, "Tecnicatura en Programación").education[0]!.degree).toMatchObject({ value: "Tecnicatura en Programación", status: "edited" });
    expect(applied(stored, honors!, "Diploma de honor 2020").education[0]!.honors.value).toBe("Diploma de honor 2020");
    expect(applied(stored, points!, "  Tesis sobre logística \n\nPromedio: 8  ").education[0]!.highlights.value).toEqual(["Tesis sobre logística", "Promedio: 8"]);
  });

  it("cuts a point at the length a point of a study can have", () => {
    const stored = profile();
    const points = of(stored, "education")[2]!;
    expect(applied(stored, points, "a".repeat(400)).education[0]!.highlights.value[0]).toHaveLength(300);
  });
});

describe("skills, languages and certifications", () => {
  const profile = () => {
    const stored = profileWith({ company: "Nubia Retail", role: "Analista", from: { year: 2021 }, to: "current", facts: [{ kind: "tool", text: "JS" }, { kind: "tool", text: "Excel" }] });
    addSkill(stored, "js", ctx, stored.experience[0]!.id);
    addSkill(stored, "pyhton", ctx);
    addLanguage(stored, "ingles", "B2", ctx);
    addCertification(stored, { name: "curso de excel", issuer: "UTN" }, ctx);
    const gone = addCertification(stored, { name: "Matrícula vieja" }, ctx)!;
    gone.excluded = true;
    return stored;
  };

  it("asks of the name of each, and of nothing else of them: not the issuer, not the level", () => {
    const items = of(profile(), "skills");
    expect(kinds(items)).toEqual([
      ["name", "js"],
      ["name", "pyhton"],
      ["name", "ingles"],
      ["name", "curso de excel"],
    ]);
    expect(items.map((item) => item.label)).toEqual(["Habilidad", "Habilidad", "Idioma", "Certificación"]);
    expect(JSON.stringify(items)).not.toContain("UTN");
  });

  it("writes the new name into the skill, the language and the certification", () => {
    const stored = profile();
    const [, python, english, course] = of(stored, "skills");
    expect(applied(stored, python!, "Python").skills[1]!.name.value).toBe("Python");
    expect(applied(stored, english!, "Inglés").languages[0]!.name.value).toBe("Inglés");
    expect(applied(stored, english!, "Inglés").languages[0]!.level.value).toEqual(stored.languages[0]!.level.value);
    expect(applied(stored, course!, "Curso de Excel").certifications[0]!.name.value).toBe("Curso de Excel");
  });

  it("renames, with a skill, the tool of a job that the job counts as the same thing — or the job would list it twice", () => {
    const stored = profile();
    const [js] = of(stored, "skills");
    const draft = applied(stored, js!, "JavaScript");
    expect(draft.skills[0]!.name.value).toBe("JavaScript");
    const tools = draft.experience[0]!.facts.filter((fact) => fact.kind === "tool").map((fact) => fact.text);
    expect(tools).toEqual(["JavaScript", "Excel"]);
    expect(js!.writes("JavaScript")).toHaveLength(2);
  });

  it("does not touch the tools when only the way it is written changes: they are the same thing already", () => {
    const stored = profile();
    const [js] = of(stored, "skills");
    expect(js!.writes("JS")).toHaveLength(1);
  });

  it("does not take a name that would leave two skills of one name, or two languages", () => {
    const stored = profile();
    addSkill(stored, "JavaScript", ctx);
    addLanguage(stored, "Francés", undefined, ctx);
    const items = of(stored, "skills");
    const js = items.find((item) => item.text === "js")!;
    expect(js.allows("JavaScript")).toBe(false);
    expect(js.allows("JavaScript.")).toBe(false);
    expect(js.allows("Java Script Pro")).toBe(true);
    expect(js.allows("JS")).toBe(true);
    const english = items.find((item) => item.text === "ingles")!;
    expect(english.allows("Frances")).toBe(false);
    expect(english.allows("English")).toBe(true);
    // Its own name, written well, is not a second language.
    expect(english.allows("Inglés")).toBe(true);
  });
});

describe("projects", () => {
  const profile = () => {
    const stored = profileWith();
    for (const [name, description] of [["Tablero", "Un tablero de ventas"], ["Sin descripción", ""], ["Largo", "a".repeat(IMPROVE_MANY_LIMIT.project + 1)]]) {
      const id = addEntry(stored, { ...blankForm("project"), what: name! }, ctx)!;
      stored.projects.find((project) => project.id === id)!.description = { value: description!, status: "confirmed" };
    }
    return stored;
  };

  it("asks of the description of each project that has one the field could hold, labelled with its name", () => {
    const items = of(profile(), "projects");
    expect(kinds(items)).toEqual([["project", "Un tablero de ventas"]]);
    expect(items[0]!.label).toBe("Tablero");
  });

  it("writes it back into the description", () => {
    const stored = profile();
    expect(applied(stored, of(stored, "projects")[0]!, "Un tablero de ventas para el equipo").projects[0]!.description).toMatchObject({ value: "Un tablero de ventas para el equipo", status: "edited" });
  });
});

describe("sobre vos y otros datos", () => {
  const profile = () => {
    const stored = profileWith();
    stored.legacy.headline = { value: "Analista de datos", status: "confirmed" };
    stored.legacy.about = { value: "Soy analista. Me gusta ordenar datos.", status: "confirmed" };
    stored.legacy.extras = { value: ["Voluntariado en un comedor", "  ", "Ajedrez"], status: "confirmed" };
    return stored;
  };

  it("asks of the headline, of what they say about themselves and of the loose lines, as one text", () => {
    expect(kinds(of(profile(), "other"))).toEqual([
      ["headline", "Analista de datos"],
      ["about", "Soy analista. Me gusta ordenar datos."],
      ["points", "Voluntariado en un comedor\nAjedrez"],
    ]);
  });

  it("asks of nothing that is empty, and of nothing when there is nothing", () => {
    expect(of(profileWith(), "other")).toEqual([]);
    const stored = profile();
    stored.legacy.about = { value: "   ", status: "confirmed" };
    expect(of(stored, "other").map((item) => item.kind)).toEqual(["headline", "points"]);
  });

  it("writes each into its place: the lines as a list", () => {
    const stored = profile();
    const [headline, about, extras] = of(stored, "other");
    expect(applied(stored, headline!, "Analista de datos y reportes").legacy.headline.value).toBe("Analista de datos y reportes");
    expect(applied(stored, about!, "Soy analista y ordeno datos.").legacy.about.value).toBe("Soy analista y ordeno datos.");
    expect(applied(stored, extras!, "Voluntariado en un comedor barrial\nAjedrez").legacy.extras.value).toEqual(["Voluntariado en un comedor barrial", "Ajedrez"]);
  });
});

describe("a profile with nothing in it", () => {
  it("has nothing to improve in any section, so no button is drawn", () => {
    const empty = profileWith();
    for (const section of ["experience", "education", "skills", "projects", "other"] as const) expect(of(empty, section), section).toEqual([]);
  });

  it("keeps a job that has no facts out of the list", () => {
    const stored = profileWith();
    withJob(stored, { company: "Kiosco Sur", role: "Cajera", from: { year: 2018 } });
    expect(of(stored, "experience")).toEqual([]);
  });
});
