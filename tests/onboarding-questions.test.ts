import { describe, expect, it } from "vitest";
import { detectGaps, type Gap, type Signals } from "@/lib/onboarding/gaps";
import { ACHIEVEMENT_TYPES, achievementTypesFor, labelFor, questionFor, type Question } from "@/lib/onboarding/questions";
import { WEIGHT } from "@/lib/onboarding/config";
import { captureNote } from "@/lib/profile/capture";
import { addSkill } from "@/lib/profile/entities";
import { certificationSchema, emptyStoredProfile, projectSchema } from "@/lib/schemas/profile-v2";
import { NOW, STAMP, fromSource, newId, profileWith, withStudy } from "./helpers/profiles";

const CURRENT = { company: "Nubia Retail", role: "Responsable de marketing", from: { year: 2021, month: 3 }, to: "current" as const };
const PAST = { company: "Grupo Lumen", role: "Asistente", from: { year: 2018, month: 9 }, to: { year: 2021, month: 2 } };

const gap = (profile: ReturnType<typeof profileWith>, rule: string, match?: (g: Gap) => boolean) =>
  detectGaps(profile, NOW).find((found) => found.rule === rule && (!match || match(found)))!;
const ask = (profile: ReturnType<typeof profileWith>, rule: string, match?: (g: Gap) => boolean): Question => questionFor(gap(profile, rule, match), profile);

describe("what each rule asks", () => {
  it("the skeleton, one thing at a time, when first, then where, then what", () => {
    const start = ask(profileWith({ company: "A", role: "x" }), "incomplete_skeleton");
    expect(start).toMatchObject({ text: "¿Cuándo empezaste en A?", control: { kind: "skeleton", field: "start" } });

    const company = ask(profileWith({ role: "Cajero", from: { year: 2020 } }), "incomplete_skeleton");
    expect(company).toMatchObject({ text: "¿En qué empresa o lugar fue lo de «Cajero»?", control: { kind: "skeleton", field: "company" } });

    const role = ask(profileWith({ company: "Kiosco Sur", from: { year: 2020 } }), "incomplete_skeleton");
    expect(role).toMatchObject({ text: "¿Qué puesto o tarea tenías en Kiosco Sur?", control: { kind: "skeleton", field: "role" } });
  });

  it("what they did, in the tense of the job: present for the current one, past for the rest", () => {
    expect(ask(profileWith(CURRENT), "no_content").text).toBe("¿De qué te encargás en Nubia Retail?");
    expect(ask(profileWith(PAST), "no_content").text).toBe("¿De qué te encargabas en Grupo Lumen?");
  });

  it("what they did, starting from what they already told about this job — and from nothing else", () => {
    const profile = profileWith(
      { company: "Kiosco del Centro", role: "Cajero", from: { year: 2022 }, to: "current" },
      { company: "Supermercado Sur", role: "Repositor", from: { year: 2019 }, to: { year: 2021 } },
    );
    profile.notes.push({
      id: "n1",
      text: "Trabajo en Kiosco del Centro y atiendo la caja todos los días. Antes fui repositor en Supermercado Sur y armaba los pedidos del depósito.",
      at: "",
    });
    const kiosco = ask(profile, "no_content", (found) => found.experienceId === profile.experience[0]!.id);
    expect(kiosco.control).toEqual({ kind: "narrative", initial: "Trabajo en Kiosco del Centro y atiendo la caja todos los días." });
    const sur = ask(profile, "no_content", (found) => found.experienceId === profile.experience[1]!.id);
    expect(sur.control).toEqual({ kind: "narrative", initial: "Antes fui repositor en Supermercado Sur y armaba los pedidos del depósito." });
    // The words of the question are the same either way: only the box has something in it.
    expect(kiosco.text).toBe("¿De qué te encargás en Kiosco del Centro?");
  });

  it("what they did, with an empty box when nothing they said names the job", () => {
    const profile = profileWith(PAST);
    expect(ask(profile, "no_content").control).toEqual({ kind: "narrative" });
    profile.notes.push({ id: "n1", text: "Me gusta trabajar con gente y aprender cosas nuevas todos los días.", at: "" });
    expect(ask(profile, "no_content").control).toEqual({ kind: "narrative" });
  });

  it("what improved, with the types as chips", () => {
    const question = ask(profileWith({ ...PAST, facts: [{ text: "Atendía clientes" }] }), "no_achievements");
    expect(question).toMatchObject({ text: "¿Hubo algo que mejorara gracias a tu trabajo en Grupo Lumen?", control: { kind: "achievement-types" } });
  });

  it("what else improved, below the results the job already tells, with the kinds they tell listed last", () => {
    const profile = profileWith({ ...PAST, facts: [{ text: "Atendía clientes" }, { text: "Reduje los reclamos del local a la mitad" }] });
    expect(ask(profile, "more_achievements")).toMatchObject({
      text: "Además de lo que ya contaste, ¿hubo algo más que mejorara gracias a tu trabajo en Grupo Lumen?",
      control: { kind: "achievement-types", covered: ["time"], known: [{ text: "Reduje los reclamos del local a la mitad" }] },
    });
    expect(achievementTypesFor(["time"]).map((type) => [type.value, type.told])).toEqual([
      ["sales", false],
      ["costs", false],
      ["launch", false],
      ["process", false],
      ["service", false],
      ["quality", false],
      ["time", true],
      ["other", false],
    ]);
    // With nothing told, the list is the one "¿Hubo algo que mejorara…?" always had.
    expect(achievementTypesFor([]).map((type) => type.value)).toEqual(ACHIEVEMENT_TYPES.map((type) => type.value));
  });

  it("the figure, carrying the achievement it is about", () => {
    const profile = profileWith({ ...PAST, facts: [{ kind: "achievement", text: "Subí las ventas" }] });
    const question = ask(profile, "achievement_no_figure");
    expect(question).toMatchObject({ text: "¿Tenés una cifra, aunque sea aproximada?", control: { kind: "figure", quote: "Subí las ventas" } });
    expect((question.control as { factId: string }).factId).toBe(profile.experience[0]!.facts[0]!.id);
  });

  it("people in charge, in the tense of the job", () => {
    const now = profileWith({ ...CURRENT, facts: [{ text: "Armo el plan" }] });
    expect(ask(now, "scope_unknown").text).toBe("¿Tenés personas a cargo?");
    const then = profileWith({ ...PAST, role: "Jefe de tienda", facts: [{ text: "Armaba el plan" }] });
    expect(ask(then, "scope_unknown").text).toBe("¿Tenías personas a cargo?");
  });

  it("the month, with the year it is about", () => {
    const question = ask(profileWith({ company: "A", role: "x", from: { year: 2023 }, to: { year: 2024 }, fromCv: true }), "imprecise_date", (g) => g.payload.which === "start");
    expect(question).toMatchObject({ text: "¿Te acordás en qué mes empezaste en A, en 2023?", control: { kind: "month", which: "start", year: 2023 } });
  });

  it("two jobs at once, naming both", () => {
    const question = ask(profileWith({ company: "A", role: "x", from: { year: 2019 }, to: { year: 2022 } }, { company: "B", role: "y", from: { year: 2020 }, to: { year: 2023 } }), "overlap");
    expect(question.text).toBe("¿Trabajaste en A y en B a la vez?");
    expect(question.experienceId).toBeUndefined();
  });

  it("the tools, as the ones they named", () => {
    const question = ask(profileWith({ ...CURRENT, facts: [{ text: "Llevo Google Ads y Meta" }] }), "loose_tool");
    expect(question).toMatchObject({ control: { kind: "tools", tools: ["Google Ads", "Meta"] } });
  });

  it("where a skill was used, offering the jobs by name", () => {
    const profile = profileWith(CURRENT, PAST);
    profile.skills.push({ id: "s1", name: { value: "SEO", status: "confirmed" }, experienceIds: [] });
    const question = ask(profile, "skill_unused");
    expect(question.text).toBe("¿Dónde usaste SEO?");
    expect(question.control).toMatchObject({ kind: "skill-uses", skillId: "s1", jobs: [{ label: "Nubia Retail" }, { label: "Grupo Lumen" }] });
  });

  it("the level of a language", () => {
    const profile = emptyStoredProfile();
    profile.languages.push({ id: "l1", name: { value: "Inglés", status: "confirmed" }, level: { value: {}, status: "confirmed" } });
    expect(ask(profile, "language_no_level")).toMatchObject({ text: "¿Qué nivel de Inglés tenés?", control: { kind: "level", languageId: "l1" } });
  });

  it("a stretch with nothing, in months and years", () => {
    const profile = profileWith(
      { company: "A", role: "x", from: { year: 2018, month: 1 }, to: { year: 2019, month: 1 } },
      { company: "B", role: "y", from: { year: 2020, month: 3 }, to: { year: 2021, month: 1 } },
    );
    expect(ask(profile, "career_gap").text).toBe("Entre enero de 2019 y marzo de 2020 no hay nada. ¿Querés agregar algo?");
  });

  it("for someone with no work yet, whether there is anything else worth listing", () => {
    const profile = emptyStoredProfile();
    profile.onboarding.route = "scratch";
    expect(ask(profile, "no_work_experience")).toMatchObject({ text: "¿Hiciste alguna práctica, proyecto o voluntariado?", control: { kind: "extra" } });
  });

  it("what kind of job they are after, starting from the titles they gave and never from an example", () => {
    const profile = profileWith(CURRENT, PAST);
    expect(ask(profile, "objective")).toMatchObject({
      text: "¿A qué tipo de puesto querés apuntar?",
      control: { kind: "objective", suggestions: ["Responsable de marketing", "Asistente"] },
    });
    expect(ask(profile, "objective").context).toBeUndefined();
  });

  it("what came after the last thing, from the date it ended and with a way out of its own", () => {
    const month = profileWith({ company: "A", role: "x", from: { year: 2019 }, to: { year: 2024, month: 3 } });
    expect(ask(month, "since_last")).toMatchObject({
      text: "Desde marzo de 2024 no hay nada cargado. ¿Hiciste algo que quieras agregar?",
      control: { kind: "gap-action", from: { year: 2024, month: 3 }, to: {}, decline: "Nada que agregar" },
    });
    // Only the year, when that is all it said: no month nobody wrote.
    const year = profileWith({ company: "A", role: "x", from: { year: 2019 }, to: { year: 2023 } });
    expect(ask(year, "since_last").text).toBe("Desde 2023 no hay nada cargado. ¿Hiciste algo que quieras agregar?");
  });
});

describe("what a question says about the job it is about", () => {
  it("says which one, and that it is the current one", () => {
    expect(ask(profileWith(CURRENT), "no_content").context).toBe("Sobre Nubia Retail · puesto actual");
    expect(ask(profileWith(PAST), "no_content").context).toBe("Sobre Grupo Lumen");
  });

  it("names a job by its role when it has no company", () => {
    expect(ask(profileWith({ role: "Freelance", from: { year: 2022 } }), "no_content").context).toBe("Sobre Freelance");
  });

  it("says nothing about a job when the question is not about one", () => {
    const profile = emptyStoredProfile();
    profile.languages.push({ id: "l1", name: { value: "Inglés", status: "confirmed" }, level: { value: {}, status: "confirmed" } });
    expect(ask(profile, "language_no_level").context).toBeUndefined();
  });

  describe("when two jobs are at the same company", () => {
    type Span = { year: number; month?: number };
    const acme = (role: string, from: Span, to: Span | "current", company = "Acme") => ({ company, role, from, to });
    const contextOfJob = (profile: ReturnType<typeof profileWith>, index: number) =>
      ask(profile, "no_content", (found) => found.experienceId === profile.experience[index]!.id).context;

    it("tells them apart by role, so 'Sobre Acme' never names both", () => {
      const profile = profileWith(acme("Analista", { year: 2018, month: 9 }, { year: 2020, month: 12 }), acme("Gerente", { year: 2021, month: 1 }, "current"));
      expect(contextOfJob(profile, 0)).toBe("Sobre Acme · Analista");
      expect(contextOfJob(profile, 1)).toBe("Sobre Acme · Gerente · puesto actual");
    });

    it("reads a company written two ways as one company", () => {
      const profile = profileWith(acme("Analista", { year: 2018 }, { year: 2020 }, "Acme S.A."), acme("Gerente", { year: 2021 }, "current"));
      expect(contextOfJob(profile, 0)).toBe("Sobre Acme S.A. · Analista");
      expect(contextOfJob(profile, 1)).toBe("Sobre Acme · Gerente · puesto actual");
    });

    it("adds the years when even the role repeats", () => {
      const profile = profileWith(acme("Analista", { year: 2018, month: 9 }, { year: 2019, month: 2 }), acme("Analista", { year: 2020, month: 1 }, { year: 2021, month: 1 }));
      expect(contextOfJob(profile, 0)).toBe("Sobre Acme · Analista (Septiembre 2018 – Febrero 2019)");
      expect(contextOfJob(profile, 1)).toBe("Sobre Acme · Analista (Enero 2020 – Enero 2021)");
    });

    it("leaves jobs at different companies with their plain names", () => {
      const profile = profileWith(CURRENT, PAST);
      expect(contextOfJob(profile, 0)).toBe("Sobre Nubia Retail · puesto actual");
      expect(contextOfJob(profile, 1)).toBe("Sobre Grupo Lumen");
    });

    it("says which is which in the list of jobs a skill can have been used in", () => {
      const profile = profileWith(acme("Analista", { year: 2018 }, { year: 2020 }), acme("Gerente", { year: 2021 }, "current"));
      profile.skills.push({ id: "s1", name: { value: "SEO", status: "confirmed" }, experienceIds: [] });
      const { control } = ask(profile, "skill_unused");
      expect(control).toMatchObject({ kind: "skill-uses", jobs: [{ label: "Acme · Analista" }, { label: "Acme · Gerente" }] });
    });

    it("says which is which when asking whether two of them were at once", () => {
      const profile = profileWith(acme("Analista", { year: 2020, month: 1 }, { year: 2021, month: 6 }), acme("Gerente", { year: 2021, month: 1 }, "current"));
      expect(ask(profile, "overlap").text).toBe("¿Trabajaste en Acme · Analista y en Acme · Gerente a la vez?");
    });
  });
});

describe("the questions about a project and about how someone can work", () => {
  const withProject = (name: string) => {
    const profile = emptyStoredProfile();
    profile.projects.push(projectSchema.parse({ id: "p1", name: { value: name, status: "confirmed" } }));
    return profile;
  };

  it("what was done in a project, with its name, and the shape of an answer without an example", () => {
    const question = ask(withProject("Tienda online"), "project_no_description");
    expect(question).toMatchObject({
      context: "Sobre Tienda online · proyecto",
      text: "¿Qué hiciste en «Tienda online» y con qué?",
      control: { kind: "project", projectId: "p1" },
    });
    expect(question.hint).toBe("Escribilo o dictalo, sin preocuparte por la redacción. Pensá: qué parte hiciste vos, para quién y con qué.");
  });

  it("is about the project even when its name fills a line: the question names it in part", () => {
    const long = "Plataforma de gestión de turnos y recordatorios por mensaje para consultorios de la zona norte";
    const question = ask(withProject(long), "project_no_description");
    expect(question.text.length).toBeLessThan(100);
    expect(question.text).toMatch(/^¿Qué hiciste en «Plataforma de gestión de turnos y recordatorios por mensaje/);
    expect(question.text).toMatch(/…» y con qué\?$/);
  });

  it("how someone can work: one card, optional from the first word, with nothing to copy", () => {
    const profile = profileWith(CURRENT);
    const question = ask(profile, "practical");
    expect(question).toMatchObject({ text: "¿Querés dejar anotado lo práctico para trabajar?", control: { kind: "practical" } });
    expect(question.hint).toMatch(/nada es obligatorio/);
    expect(question.hint).not.toMatch(/por ejemplo|p\. ?ej|ej\.:|«/i);
    expect(question.experienceId).toBeUndefined();
  });

  it("the skeleton has a line for each field, so a list of what was put off does not say 'Datos de X' three times", () => {
    const profile = profileWith({ company: "", role: "Cajero", facts: [{ text: "Atendía la caja" }] });
    const lines = detectGaps(profile, NOW)
      .filter((found) => found.rule === "incomplete_skeleton")
      .map((found) => labelFor(found, profile));
    expect(lines).toEqual(["Cuándo empezaste en Cajero", "En qué empresa o lugar fue lo de Cajero"]);
    const nameless = profileWith({ company: "Kiosco Sur", from: { year: 2020 } });
    expect(labelFor(gap(nameless, "incomplete_skeleton"), nameless)).toBe("Qué puesto tenías en Kiosco Sur");
  });

  it("have their own lines in a list", () => {
    const projects = withProject("Tienda online");
    expect(labelFor(gap(projects, "project_no_description"), projects)).toBe("Qué hiciste en Tienda online");
    expect(labelFor(gap(profileWith(CURRENT), "practical"), profileWith(CURRENT))).toBe("Lo práctico para trabajar");
  });
});

describe("the kinds of change the question about achievements offers", () => {
  it("are few enough to take in at a glance, and include the ones that are not about a business", () => {
    const values = ACHIEVEMENT_TYPES.map((type) => type.value);
    expect(values).toEqual(["sales", "costs", "time", "launch", "process", "service", "quality", "other"]);
    // Seven to choose from and the way out: past this, a list stops being read.
    expect(ACHIEVEMENT_TYPES.length).toBeLessThanOrEqual(8);
  });

  it("each finishes 'Contame lo …' without a stop in the middle", () => {
    for (const type of ACHIEVEMENT_TYPES) {
      expect(`Contame lo ${type.follow}: ¿qué hiciste y qué pasó?`, type.value).toMatch(/^Contame lo (?:de|del) [^:.]+: ¿qué hiciste y qué pasó\?$/);
    }
  });

  it("put the ones already told after the rest, and 'otra cosa' last, whatever is told", () => {
    const types = achievementTypesFor(["service", "sales"]);
    expect(types.map((type) => type.value)).toEqual(["costs", "time", "launch", "process", "quality", "sales", "service", "other"]);
    expect(types.filter((type) => type.told).map((type) => type.value)).toEqual(["sales", "service"]);
  });
});

describe("the words", () => {
  const everything = () => {
    const profile = profileWith(
      { company: "Nubia Retail", role: "Responsable de marketing", from: { year: 2021, month: 9 }, to: "current", facts: [{ kind: "achievement", text: "Subí las ventas" }, { text: "Llevo Google Ads" }, { text: "Atendía a muchos clientes" }] },
      // One line, and a recent job: told in too few words.
      { company: "B", role: "b", from: { year: 2023 }, to: { year: 2024 }, fromCv: true, facts: [{ text: "Atención al público" }] },
      { company: "C", role: "c", from: { year: 2019, month: 1 }, to: { year: 2020, month: 6 }, facts: [{ text: "Atendía clientes" }] },
      { company: "D", role: "d", from: { year: 2020, month: 1 }, to: { year: 2020, month: 12 } },
      { role: "e", from: { year: 2020 } },
    );
    profile.skills.push({ id: "s1", name: { value: "SEO", status: "confirmed" }, experienceIds: [] });
    // Initials that are also something else: asked whether they are the whole name (UI-2).
    profile.skills.push({ id: "s2", name: { value: "RN", status: "confirmed" }, experienceIds: [] });
    profile.languages.push({ id: "l1", name: { value: "Inglés", status: "confirmed" }, level: { value: {}, status: "confirmed" } });
    profile.projects.push(projectSchema.parse({ id: "p1", name: { value: "Tienda online", status: "confirmed" } }));
    // A carnet that lapses next month, and what they said about how they can work, said at the start of the year: the two dates to settle.
    profile.certifications.push(
      certificationSchema.parse({ id: "c1", name: { value: "Carnet de manipulación de alimentos", status: "confirmed" }, expires: { value: { year: 2026, month: 10 }, status: "confirmed" } }),
    );
    profile.legacy.practical = { value: { availability: "Tiempo completo", driverLicense: "", ownVehicle: false, willingToRelocate: false, workEligibility: "" }, status: "confirmed", source: { kind: "answer", at: "2026-01-01T00:00:00.000Z" } };
    // And the job that is going on, last looked at at the start of the year: asked whether it still is.
    fromSource(profile.experience[0]!, { kind: "manual", at: "2026-01-01T00:00:00.000Z" });
    return profile;
  };

  // What `everything()` cannot show, having a job going on: a CV that stops in the past.
  const stale = () => {
    const profile = profileWith({ company: "Grupo Lumen", role: "Asistente", from: { year: 2018, month: 9 }, to: { year: 2022, month: 3 } });
    // A note they wrote down that names the one job, and a skill that nothing has backed since it ended: the two questions that exist only when asked to (O15, O17).
    captureNote(profile, "En Grupo Lumen aprendí a cerrar la caja del día", "capture", { now: STAMP, newId });
    addSkill(profile, "Excel", { now: "2005-01-01T00:00:00.000Z", newId }, profile.experience[0]!.id);
    return profile;
  };
  // What neither can show, having work: someone with none, and a study that ended last year — what the rules for a person without a job ask.
  const student = () => {
    const profile = emptyStoredProfile();
    profile.onboarding.situation = "student";
    withStudy(profile, { degree: "Licenciatura en Administración", institution: "Universidad Nacional", from: { year: 2021 }, to: { year: 2025 } });
    return profile;
  };
  // And someone changing sector, who said what to: the one question that asks which lines carry over.
  const switching = () => {
    const profile = profileWith({ company: "Nubia Retail", role: "Analista", from: { year: 2022 }, to: "current", facts: [{ text: "Armo los informes de campañas" }, { text: "Coordino con el equipo de diseño" }] });
    profile.onboarding.situation = "switch";
    profile.objective = { value: "Diseño de producto", status: "confirmed" };
    return profile;
  };
  // And a stay of under a year, with three skills nobody has said how well they know: the two questions that ask for a line of the CV and for a mark.
  const brief = () => {
    const profile = profileWith({ company: "Tiendix", role: "Desarrollador", from: { year: 2025, month: 4 }, to: { year: 2025, month: 6 }, facts: [{ text: "Armé el catálogo" }] });
    for (const name of ["React", "Docker", "SQL"]) addSkill(profile, name, { now: STAMP, newId }, profile.experience[0]!.id);
    return profile;
  };
  const both = () => [everything(), stale(), student(), switching(), brief()];
  // The rules that exist only when a caller says they may — the one about the person's search, which needs the offers (O10), the one about what they wrote down (O15)
  // and the one about a skill nothing has backed (O17) — are told so here.
  const SIGNALS: Signals = {
    capture: true,
    stale: true,
    repeated: { kind: "tool", type: "tool", thing: "Excel", key: "tool:excel", fragment: "Manejo de Excel", question: "¿Usaste Excel en algún trabajo, curso o proyecto?", count: 3, of: 10, obligation: "unstated" },
  };

  it("cover every rule, so none is left without its words", () => {
    const rules = new Set(both().flatMap((profile) => detectGaps(profile, NOW, SIGNALS).map((found) => found.rule)));
    for (const rule of Object.keys(WEIGHT)) expect(rules.has(rule as never), rule).toBe(true);
  });

  it("are in voseo, in the second person singular, never tuteo", () => {
    const texts = both().flatMap((profile) =>
      detectGaps(profile, NOW, SIGNALS).map((found) => {
        const q = questionFor(found, profile);
        return `${q.text} ${q.hint ?? ""}`;
      }),
    );
    for (const text of texts) {
      expect(text).not.toMatch(/\b(tienes|tenías tú|quieres|puedes|recuerdas|escríbelo|díctalo|elige|cuéntame|hiciste tú)\b/i);
    }
  });

  it("never give an example of content, only the shape of an answer", () => {
    for (const profile of both()) {
      for (const found of detectGaps(profile, NOW, SIGNALS)) {
        const hint = questionFor(found, profile).hint ?? "";
        expect(hint).not.toMatch(/por ejemplo|p\. ?ej|ej\.:|«/i);
      }
    }
  });

  it("are the same for the same profile", () => {
    const texts = () => {
      const profile = everything();
      return detectGaps(profile, NOW).map((found) => questionFor(found, profile).text);
    };
    expect(texts().length).toBeGreaterThan(8);
    expect(texts()).toEqual(texts());
  });
});

describe("a gap as a line in a list", () => {
  it("says what it is about, in a few words", () => {
    const profile = profileWith({ ...PAST, facts: [{ kind: "achievement", text: "Subí las ventas" }] });
    expect(labelFor(gap(profile, "achievement_no_figure"), profile)).toBe("La cifra de «Subí las ventas»");
    const bare = profileWith(PAST);
    expect(labelFor(gap(bare, "no_content"), bare)).toBe("Qué hacías en Grupo Lumen");
    const told = profileWith({ ...PAST, facts: [{ text: "Reduje los reclamos del local a la mitad" }] });
    expect(labelFor(gap(told, "more_achievements"), told)).toBe("Qué más mejoró con tu trabajo en Grupo Lumen");
  });

  it("says what kind of job they are after in the words of a list, with no job in it", () => {
    const profile = profileWith(CURRENT, PAST);
    expect(labelFor(gap(profile, "objective"), profile)).toBe("A qué tipo de puesto querés apuntar");
  });

  it("says the year, or the month and year, that what came after the last thing counts from", () => {
    const profile = profileWith({ company: "A", role: "x", from: { year: 2019 }, to: { year: 2024, month: 3 } });
    expect(labelFor(gap(profile, "since_last"), profile)).toBe("Lo que hiciste desde marzo de 2024");
  });

  it("names two jobs at one company by role, so a list does not repeat the same words", () => {
    const profile = profileWith(
      { company: "Acme", role: "Analista", from: { year: 2018 }, to: { year: 2020 } },
      { company: "Acme", role: "Gerente", from: { year: 2021 }, to: "current" },
    );
    expect(labelFor(gap(profile, "no_content", (found) => found.experienceId === profile.experience[0]!.id), profile)).toBe("Qué hacías en Acme · Analista");
    expect(labelFor(gap(profile, "no_content", (found) => found.experienceId === profile.experience[1]!.id), profile)).toBe("Qué hacías en Acme · Gerente");
  });

  it("is short even when what it is about is long", () => {
    const profile = profileWith({ ...PAST, facts: [{ kind: "achievement", text: "Rehíce la estructura de todas las campañas de búsqueda y subió la conversión de la tienda online" }] });
    expect(labelFor(gap(profile, "achievement_no_figure"), profile).length).toBeLessThan(70);
  });
});
