import { describe, expect, it } from "vitest";
import { ENGINE, PRIORITY, WEIGHT } from "@/lib/onboarding/config";
import { answerFigure, answerHandled, answerNarrative, answerObjective, deferQuestion } from "@/lib/onboarding/answer";
import { addEntry, blankForm } from "@/lib/onboarding/entries";
import { NO_SESSION, alreadyKnown, detectGaps, eligibleGaps, figureFollowUp, followUpGaps, isAskable, nextQuestion, priorityOf, remainingThisSession, type Gap } from "@/lib/onboarding/gaps";
import { labelFor, questionFor } from "@/lib/onboarding/questions";
import { pendingItems } from "@/lib/onboarding/session";
import { factToBullet } from "@/lib/profile/project";
import { impactsOf, readsAsResult } from "@/lib/onboarding/results";
import { emptyStoredProfile, projectSchema, storedProfileSchema, type StoredProfile } from "@/lib/schemas/profile-v2";
import { NOW, STAMP, freshSession, fromSource, newId, profileWith, withJob, type JobSpec } from "./helpers/profiles";

const rules = (profile: StoredProfile) => detectGaps(profile, NOW).map((gap) => gap.rule);
const ids = (profile: StoredProfile) => detectGaps(profile, NOW).map((gap) => gap.id);

const CURRENT = { company: "Nubia Retail", role: "Analista de Marketing", from: { year: 2021, month: 3 }, to: "current" as const };

type Span = { year: number; month?: number };

/** A study as the forms make it, with every field the schema gives one — not a hand-written half of an entry. */
const addStudy = (profile: StoredProfile, spec: { what?: string; where?: string; from?: Span; to?: Span; current?: boolean } = {}) =>
  addEntry(
    profile,
    { ...blankForm("study"), what: spec.what ?? "Licenciatura", where: spec.where ?? "UBA", from: spec.from ?? {}, to: spec.to ?? {}, current: Boolean(spec.current) },
    { newId, now: STAMP },
  );

describe("the skeleton", () => {
  it("asks for what a job cannot go without: a start, a company, a role", () => {
    const profile = profileWith({ company: "Nubia", role: "Analista" }, { role: "Cajero", from: { year: 2020 } }, { company: "Delta", from: { year: 2019 } });
    const skeleton = detectGaps(profile, NOW).filter((gap) => gap.rule === "incomplete_skeleton");
    expect(skeleton.map((gap) => gap.payload.missing)).toEqual([["start"], ["company"], ["role"]]);
    expect(skeleton.every((gap) => gap.priority === "blocking")).toBe(true);
  });

  it("puts the skeleton before anything else, however much the rest would score", () => {
    const profile = profileWith(
      { ...CURRENT, facts: [{ text: "Llevo las campañas" }] },
      { company: "Vieja SA", role: "Asistente" }, // no start
    );
    const first = eligibleGaps(profile, freshSession(), NOW)[0]!;
    expect(first.rule).toBe("incomplete_skeleton");
  });

  it("does not count an empty entry as a job", () => {
    const profile = emptyStoredProfile();
    withJob(profile, {});
    expect(detectGaps(profile, NOW)).toEqual([]);
  });

  describe("one question for each field a job lacks", () => {
    // A job with only what was done in it: no start, no company, no role.
    const bare = () => profileWith({ facts: [{ text: "Armaba los pedidos del depósito" }] });
    const skeleton = (profile: StoredProfile) => detectGaps(profile, NOW).filter((found) => found.rule === "incomplete_skeleton");

    it("with an id of its own, so that putting one aside is about that one", () => {
      const profile = bare();
      const id = profile.experience[0]!.id;
      expect(skeleton(profile).map((found) => found.id)).toEqual([`incomplete_skeleton:${id}:start`, `incomplete_skeleton:${id}:company`, `incomplete_skeleton:${id}:role`]);
      expect(skeleton(profile).map((found) => found.payload.missing)).toEqual([["start"], ["company"], ["role"]]);
    });

    it("asked when, then where, then what: not in the order the ids sort in", () => {
      const asked = eligibleGaps(bare(), freshSession(), NOW).filter((found) => found.rule === "incomplete_skeleton");
      expect(asked.map((found) => (found.payload.missing as string[])[0])).toEqual(["start", "company", "role"]);
    });

    it("so that 'Dejarlo así' on the year leaves the company and the role to ask", () => {
      const profile = bare();
      const [start, company] = skeleton(profile);
      deferQuestion(profile, start!, "na", { now: STAMP, newId });
      const left = eligibleGaps(profile, freshSession(), NOW).filter((found) => found.rule === "incomplete_skeleton");
      expect(left.map((found) => (found.payload.missing as string[])[0])).toEqual(["company", "role"]);
      expect(isAskable(profile, start!.id, NOW)).toBe(false);
      expect(isAskable(profile, company!.id, NOW)).toBe(true);
    });

    it("and asks nothing of a field the job has: a job with a year and a company is asked only its role", () => {
      const profile = profileWith({ company: "Kiosco Sur", from: { year: 2020 }, facts: [{ text: "Atendía la caja" }] });
      expect(skeleton(profile).map((found) => found.payload.missing)).toEqual([["role"]]);
    });

    it("and a profile that set the whole skeleton of a job aside under the old id still has all three set aside", () => {
      const profile = bare();
      const job = profile.experience[0]!;
      const stored = JSON.parse(JSON.stringify(profile));
      stored.pending = [
        { questionId: `incomplete_skeleton:${job.id}`, ruleId: "incomplete_skeleton", entityId: job.id, state: "na", count: 2, at: STAMP },
        { questionId: "practical:all", ruleId: "practical", state: "later", count: 1, at: STAMP },
      ];
      const read = storedProfileSchema.parse(stored);
      expect(read.pending.map((entry) => entry.questionId)).toEqual([
        `incomplete_skeleton:${job.id}:start`,
        `incomplete_skeleton:${job.id}:company`,
        `incomplete_skeleton:${job.id}:role`,
        "practical:all",
      ]);
      // What was said of the old one stands for each: the state, how many times, and when.
      expect(read.pending.slice(0, 3).every((entry) => entry.state === "na" && entry.count === 2 && entry.at === STAMP && entry.entityId === job.id)).toBe(true);
      expect(eligibleGaps(read, freshSession(), NOW).filter((found) => found.rule === "incomplete_skeleton")).toEqual([]);
      // Read again, nothing changes: the new ids are not the old one.
      expect(storedProfileSchema.parse(read).pending).toEqual(read.pending);
    });
  });
});

describe("what someone did", () => {
  it("asks what a job was when it has nothing under it", () => {
    expect(rules(profileWith(CURRENT))).toContain("no_content");
    expect(rules(profileWith(CURRENT))).not.toContain("no_achievements");
  });

  it("asks what improved when there is content and no achievement", () => {
    const profile = profileWith({ ...CURRENT, facts: [{ text: "Llevo las campañas" }] });
    expect(rules(profile)).toContain("no_achievements");
    expect(rules(profile)).not.toContain("no_content");
  });

  it("stops asking once there is an achievement", () => {
    const profile = profileWith({ ...CURRENT, facts: [{ text: "Llevo las campañas" }, { kind: "achievement", text: "Rehíce las campañas" }] });
    expect(rules(profile)).not.toContain("no_achievements");
  });

  it("does not take tools for something done", () => {
    const profile = profileWith({ ...CURRENT, facts: [{ kind: "tool", text: "Excel" }] });
    expect(rules(profile)).toContain("no_content");
  });

  it("asks for the figure of an achievement that has none", () => {
    const profile = profileWith({ ...CURRENT, facts: [{ kind: "achievement", text: "Rehíce las campañas y subió la conversión" }] });
    const found = detectGaps(profile, NOW).find((gap) => gap.rule === "achievement_no_figure");
    expect(found?.id).toBe(`achievement_no_figure:${profile.experience[0]!.id}:${profile.experience[0]!.facts[0]!.id}`);
  });

  it("asks for the figure of an achievement that only names a year: when is not how much", () => {
    const profile = profileWith({ ...CURRENT, facts: [{ kind: "achievement", text: "Aumenté las ventas en 2022" }] });
    const found = detectGaps(profile, NOW).find((gap) => gap.rule === "achievement_no_figure");
    expect(found?.id).toBe(`achievement_no_figure:${profile.experience[0]!.id}:${profile.experience[0]!.facts[0]!.id}`);
    // And it is a question still worth asking when the profile is asked what it can ask: the year does not make it known.
    expect(alreadyKnown(found!, profile)).toBe(false);
    expect(eligibleGaps(profile, freshSession(), NOW).map((gap) => gap.rule)).toContain("achievement_no_figure");
  });

  it("does not, when the year comes with a quantity, or the number is one that counts", () => {
    const has = (text: string) => rules(profileWith({ ...CURRENT, facts: [{ kind: "achievement" as const, text }] }));
    expect(has("En 2022 subí las ventas un 20%")).not.toContain("achievement_no_figure");
    expect(has("En 2022 atendí 150 clientes")).not.toContain("achievement_no_figure");
    expect(has("Atendí 2000 clientes")).not.toContain("achievement_no_figure");
  });

  it("does not, when the figure is in the words, given as a metric, or answered 'no lo sé'", () => {
    const has = (over: object) => rules(profileWith({ ...CURRENT, facts: [{ kind: "achievement" as const, text: "Subí la conversión", ...over }] }));
    expect(has({ text: "Subí la conversión un 20%" })).not.toContain("achievement_no_figure");
    expect(has({ metric: { value: "20", unit: "%", approx: false } })).not.toContain("achievement_no_figure");
    expect(has({ metric: { unknown: true } })).not.toContain("achievement_no_figure");
    expect(has({})).toContain("achievement_no_figure");
  });
});

describe("a result already in the person's words", () => {
  // A real CV's one job, as imported: every line stored as a duty, since nothing in a document says which is which.
  const FLASH_PAGE = [
    "Gestioné repositorios Git con flujos colaborativos, utilizando ramas, pull requests y automatizaciones CI/CD.",
    "Desarrollé soluciones full-stack escalables, incluyendo 2 plataformas de comercio electrónico y aplicaciones web empresariales.",
    "Implementé autenticación y autorización con JWT, OAuth2 y control de acceso basado en roles.",
    "Optimicé 300 consultas SQL en PostgreSQL y Redis, reduciendo el tiempo de respuesta en un 40%.",
    "Construí arquitecturas frontend con SSR, SSG e ISR, generando 15 páginas estáticas y mejorando el SEO y la velocidad.",
    "Implementé testing automatizado, mejorando la confiabilidad de los despliegues y reduciendo regresiones.",
    "Administré un servidor Linux, gestionando servicios, procesos, logs, Nginx, SSL/TLS y firewall.",
  ];

  it("reads a result in the forms a CV reports one, in Spanish and in English, in any line of work", () => {
    for (const text of [
      "Optimicé 300 consultas SQL, reduciendo el tiempo de respuesta en un 40%",
      "Aumenté las ventas del local",
      "Reduje el ausentismo del turno noche",
      "Superé los objetivos de venta del trimestre",
      "Logramos bajar el tiempo de espera en la guardia",
      "Implementé un tablero, mejorando la coordinación con los choferes",
      "Reducción de la merma en la cocina",
      "Conseguí tres clientes nuevos para la agencia",
      "95% de satisfacción en las encuestas",
      "Increased repeat customers by redesigning the loyalty program",
      "Rebuilt the onboarding, resulting in faster hires",
    ]) {
      expect(readsAsResult(text), text).toBe(true);
    }
  });

  it("does not read one in a duty, a goal, or an everyday word that only looks like a result", () => {
    for (const text of [
      "Administré un servidor Linux, gestionando servicios y logs",
      "Trabajo bajo presión en temporada alta",
      "Brindé la mejor atención al cliente",
      "Atendía clientes en el mostrador",
      "Atención de cajas de ahorro y plazos fijos",
      "Participé en proyectos de mejora continua",
      "Definí el alcance de cada proyecto con el cliente",
      "Encargado de reducir costos de logística",
      "Liquidé sueldos y aumentos salariales",
      "Subí los productos a la tienda online",
      "Desarrollé 2 plataformas de comercio electrónico",
    ]) {
      expect(readsAsResult(text), text).toBe(false);
    }
  });

  it("reads which kind of change a result tells, in the words of any line of work", () => {
    expect(FLASH_PAGE.filter(readsAsResult).map(impactsOf)).toEqual([["time"], ["time"], ["time"]]);
    for (const [text, kinds] of [
      ["Aumenté las ventas del local un 20%", ["sales"]],
      ["Superé los objetivos de venta del trimestre", ["sales"]],
      ["Conseguí tres clientes nuevos para la agencia", ["sales"]],
      ["Reducción de la merma en la cocina", ["costs"]],
      ["Generé un ahorro de USD 20.000 anuales renegociando contratos", ["costs"]],
      ["Logramos bajar el tiempo de espera en la guardia", ["time"]],
      ["Reduje los reclamos de los pacientes a la mitad", ["time"]],
      ["Lancé una línea de viandas, aumentando la facturación un 15%", ["sales", "launch"]],
      ["Puse en marcha la nueva sucursal de Rosario, superando el objetivo", ["launch"]],
      ["Automaticé el circuito de pagos, reduciendo los tiempos de cierre", ["time", "process"]],
      ["Implementé un tablero, mejorando la coordinación con los choferes", ["process"]],
      ["Increased repeat customers by redesigning the loyalty program", ["sales"]],
      ["Reduced cloud spend by 30%", ["costs"]],
      ["Rebuilt the onboarding, resulting in faster hires", ["time"]],
      // Looked after, and kept safe: the kinds for work whose result is not a figure of the business.
      ["Subí la satisfacción de los pacientes al 95%", ["service"]],
      ["Mejoré la calidad de la atención al paciente", ["service"]],
      ["Conseguí 200 reseñas positivas en Google", ["service"]],
      ["Reduje los accidentes laborales un 40%", ["quality"]],
      ["Aprobé las auditorías de higiene y seguridad sin observaciones", ["quality"]],
      ["Aumenté la satisfacción del cliente y la calidad del producto", ["service", "quality"]],
      // The errors are in the quality, not the other way round: the term that describes another counts for that one.
      ["Reduje los errores de calidad en la línea", ["time"]],
      ["Improved patient satisfaction and workplace safety", ["service", "quality"]],
    ] as const) {
      expect(impactsOf(text), text).toEqual(kinds);
    }
  });

  it("does not count a kind a line only seems to tell", () => {
    for (const [text, kinds] of [
      // The errors are in the invoicing: they are errors, not sales.
      ["Reduje los errores de facturación un 30%", ["time"]],
      ["Mejoré el proceso de ventas, aumentando la conversión", ["sales", "process"]],
      // A place, a refresh rate, a deposit, a saving of hours.
      ["Mejoré la atención en el punto de venta, aumentando la satisfacción", ["service"]],
      ["Implementé un tablero en tiempo real, mejorando la coordinación", ["process"]],
      ["Aumenté la cartera de plazos fijos un 12%", []],
      ["Ahorré 10 horas semanales al equipo automatizando reportes", ["process"]],
      // "For the first time" saved no time.
      ["Achieved profitability for the first time", ["sales"]],
      // A change none of the kinds names.
      ["Reduje el ausentismo del turno noche", []],
      // Grades and appraisals are words for other things; a kind is only told by words that read one way.
      ["Mejoré las calificaciones de mis alumnos un 15%", []],
      ["Subí las valoraciones de las propiedades un 8%", []],
    ] as const) {
      expect(impactsOf(text), text).toEqual(kinds);
    }
  });

  it("does not ask what improved when a line already says it, and asks for the figure only where it is missing", () => {
    const profile = profileWith({ ...CURRENT, company: "Flash Page", facts: FLASH_PAGE.map((text) => ({ text })) });
    const job = profile.experience[0]!;
    expect(rules(profile)).not.toContain("no_achievements");
    const figures = detectGaps(profile, NOW).filter((gap) => gap.rule === "achievement_no_figure");
    // The 40% and the 15 are in the words; "…y reduciendo regresiones" has no number yet.
    expect(figures.map((gap) => gap.payload.factId)).toEqual([job.facts[5]!.id]);
    expect(questionFor(figures[0]!, profile).control).toMatchObject({ kind: "figure", quote: FLASH_PAGE[5] });
  });

  it("asks what else improved, showing the results it read and which kinds of change they already tell", () => {
    const profile = profileWith({ ...CURRENT, company: "Flash Page", facts: FLASH_PAGE.map((text) => ({ text })) });
    const job = profile.experience[0]!;
    const results = [3, 4, 5].map((index) => job.facts[index]!);
    const found = detectGaps(profile, NOW).find((gap) => gap.rule === "more_achievements")!;
    expect(found).toMatchObject({ id: `more_achievements:${job.id}`, priority: "medium", payload: { covered: ["time"], factIds: results.map((fact) => fact.id) } });
    expect(questionFor(found, profile)).toMatchObject({
      text: "Además de lo que ya contaste, ¿hubo algo más que mejorara gracias a tu trabajo en Flash Page?",
      control: { kind: "achievement-types", covered: ["time"], known: results.map((fact) => ({ id: fact.id, text: fact.text })) },
    });
  });

  it("asks for the figure a result lacks first, and what else improved after it", () => {
    const profile = profileWith({ ...CURRENT, company: "Flash Page", facts: FLASH_PAGE.map((text) => ({ text })) });
    const asked = eligibleGaps(profile, freshSession(), NOW).map((gap) => gap.rule);
    expect(asked).not.toContain("no_achievements");
    expect(asked.indexOf("achievement_no_figure")).toBeGreaterThanOrEqual(0);
    expect(asked.indexOf("achievement_no_figure")).toBeLessThan(asked.indexOf("more_achievements"));
  });

  it("does not ask what else improved when the results already tell every kind of change", () => {
    const facts = [
      { text: "Aumenté las ventas del local un 20%" },
      { text: "Reduje la merma un 15%, bajando los tiempos de reposición" },
      { text: "Lancé la tienda online, automatizando el proceso de pedidos y superando el objetivo" },
    ];
    // The ones a business measures are not all of them: the care and the safety of a place are kinds too.
    expect(rules(profileWith({ ...CURRENT, facts }))).toContain("more_achievements");
    const all = profileWith({
      ...CURRENT,
      facts: [...facts, { text: "Subí la satisfacción de los clientes al 95%" }, { text: "Reduje los accidentes del taller a la mitad" }],
    });
    expect(rules(all)).not.toContain("more_achievements");
  });

  it("does not ask it again once the person went through the kinds for that job: told one, or said there was nothing", () => {
    const withResult = () => profileWith({ ...CURRENT, facts: [{ text: "Aumenté las ventas del local un 20%" }] });

    const told = withResult();
    const job = told.experience[0]!;
    const found = detectGaps(told, NOW).find((gap) => gap.rule === "more_achievements")!;
    // What an answer to it leaves: an achievement that carries the question's id.
    job.facts.push({ id: "told", kind: "achievement", text: "Armé el circuito de cambios", source: { kind: "answer", questionId: `${found.id}:process`, at: STAMP }, status: "confirmed" });
    expect(rules(told)).not.toContain("more_achievements");
    expect(alreadyKnown(found, told)).toBe(true);

    // Told from "¿Hubo algo que mejorara…?", back when the job had no result yet: the same list, already seen.
    const before = withResult();
    before.experience[0]!.facts.push({ id: "before", kind: "achievement", text: "Bajamos las devoluciones", source: { kind: "answer", questionId: `no_achievements:${before.experience[0]!.id}:time`, at: STAMP }, status: "confirmed" });
    expect(rules(before)).not.toContain("more_achievements");

    for (const rule of ["no_achievements", "more_achievements"]) {
      const declined = withResult();
      const id = declined.experience[0]!.id;
      declined.pending.push({ questionId: `${rule}:${id}`, ruleId: rule, entityId: id, state: "na", count: 1, at: STAMP });
      expect(rules(declined), rule).not.toContain("more_achievements");
    }

    // Skipping it is not having answered it.
    const skipped = withResult();
    const skippedId = skipped.experience[0]!.id;
    skipped.pending.push({ questionId: `more_achievements:${skippedId}`, ruleId: "more_achievements", entityId: skippedId, state: "skipped", count: 1, at: STAMP });
    expect(rules(skipped)).toContain("more_achievements");
  });

  it("knows the answer is already there, even for a question found before the line said it", () => {
    const profile = profileWith({ ...CURRENT, facts: [{ text: "Llevo las campañas" }] });
    const found = detectGaps(profile, NOW).find((gap) => gap.rule === "no_achievements")!;
    expect(alreadyKnown(found, profile)).toBe(false);
    profile.experience[0]!.facts[0]!.text = "Llevo las campañas y aumenté las ventas del local";
    expect(alreadyKnown(found, profile)).toBe(true);
  });

  it("asks right away for the figure of the first duty typed that already tells a result, and leaves the others to wait their turn", () => {
    const profile = profileWith({ ...CURRENT, facts: [{ text: "Reduje los tiempos de entrega" }, { text: "Mejoré la atención en el local" }, { text: "Atiendo el mostrador" }] });
    const [first, second, third] = profile.experience[0]!.facts;
    expect(rules(profile).filter((rule) => rule === "achievement_no_figure")).toHaveLength(2);
    // The first line that reports a result jumps the queue: it is the person's own sign of what the job did, and it is on screen.
    expect(followUpGaps(profile, [first!], NOW).map((found) => found.payload.factId)).toEqual([first!.id]);
    // Several in one answer: only the first. Queued here, each would jump every limit.
    expect(followUpGaps(profile, [first!, second!, third!], NOW).map((found) => found.payload.factId)).toEqual([first!.id]);
    // The ones that do not tell a result never do.
    expect(followUpGaps(profile, [third!], NOW)).toEqual([]);
  });

  it("still asks for the figure of every achievement told, and for the first duty besides, when both come in one answer", () => {
    const profile = profileWith({
      ...CURRENT,
      facts: [{ kind: "achievement", text: "Subí las ventas" }, { kind: "achievement", text: "Bajé los costos" }, { text: "Reduje los tiempos de entrega" }, { text: "Mejoré la atención en el local" }],
    });
    const told = profile.experience[0]!.facts;
    expect(followUpGaps(profile, told, NOW).map((found) => found.payload.factId).sort()).toEqual([told[0]!.id, told[1]!.id, told[2]!.id].sort());
  });

  it("does not ask the figure of a duty twice: once it has one, it is no follow-up", () => {
    const profile = profileWith({ ...CURRENT, facts: [{ text: "Reduje los tiempos de entrega", metric: { value: "30", unit: "%", approx: false } }] });
    expect(followUpGaps(profile, [profile.experience[0]!.facts[0]!], NOW)).toEqual([]);
  });
});

describe("people in charge", () => {
  it("is asked for a role that says it", () => {
    expect(rules(profileWith({ ...CURRENT, role: "Gerente de ventas", facts: [{ text: "Armo el plan" }] }))).toContain("scope_unknown");
    expect(rules(profileWith({ ...CURRENT, role: "Analista", facts: [{ text: "Armo el plan" }] }))).not.toContain("scope_unknown");
  });

  it("is not asked when the person already said a team", () => {
    const said = profileWith({ ...CURRENT, role: "Jefe de tienda", facts: [{ text: "Coordino un equipo de cinco personas" }] });
    expect(rules(said)).not.toContain("scope_unknown");
    expect(alreadyKnown({ id: "x", rule: "scope_unknown", priority: "medium", experienceId: said.experience[0]!.id, payload: {} }, said)).toBe(true);
  });

  it("is not answered by coordinating an agency: those are not people in charge", () => {
    const profile = profileWith({ ...CURRENT, role: "Responsable de marketing", facts: [{ text: "Coordino a la agencia que nos hace el contenido" }] });
    expect(rules(profile)).toContain("scope_unknown");
  });

  it("is asked of a relevant job when the objective is a management role", () => {
    const profile = profileWith({ ...CURRENT, role: "Analista de marketing digital", facts: [{ text: "Llevo las campañas de marketing" }] });
    expect(rules(profile)).not.toContain("scope_unknown");
    profile.objective = { value: "Responsable de marketing digital", status: "confirmed" };
    expect(rules(profile)).toContain("scope_unknown");
  });

  it("is not asked of an assistant or an intern only because someone wants to become a manager", () => {
    for (const role of ["Asistente de marketing", "Prácticas de Marketing", "Marketing intern", "Auxiliar de marketing digital"]) {
      const profile = profileWith({ ...CURRENT, role, facts: [{ text: "Llevo las campañas de marketing" }] });
      profile.objective = { value: "Responsable de marketing digital", status: "confirmed" };
      expect(rules(profile), role).not.toContain("scope_unknown");
    }
  });

  it("is still asked of a role that says it leads, junior words or not in the rest of the title", () => {
    const profile = profileWith({ ...CURRENT, role: "Coordinador de becarios", facts: [{ text: "Armo el plan" }] });
    expect(rules(profile)).toContain("scope_unknown");
  });
});

describe("two jobs at once", () => {
  const two = (a: object, b: object) => profileWith({ company: "A", role: "x", ...a }, { company: "B", role: "y", ...b });

  it("is asked when they overlap by more than a month", () => {
    const profile = two({ from: { year: 2019, month: 1 }, to: { year: 2021, month: 6 } }, { from: { year: 2021, month: 1 }, to: { year: 2022, month: 1 } });
    expect(rules(profile)).toContain("overlap");
    const found = detectGaps(profile, NOW).find((gap) => gap.rule === "overlap")!;
    expect(found.id).toBe(`overlap:${[...profile.experience.map((j) => j.id)].sort().join(":")}`);
  });

  it("is not asked for a month's overlap, for jobs that touch, or for years that only meet", () => {
    expect(rules(two({ from: { year: 2019, month: 1 }, to: { year: 2021, month: 3 } }, { from: { year: 2021, month: 2 }, to: { year: 2022, month: 1 } }))).not.toContain("overlap");
    expect(rules(two({ from: { year: 2019, month: 1 }, to: { year: 2021, month: 2 } }, { from: { year: 2021, month: 3 }, to: { year: 2022, month: 1 } }))).not.toContain("overlap");
    expect(rules(two({ from: { year: 2019 }, to: { year: 2021 } }, { from: { year: 2021 }, to: { year: 2023 } }))).not.toContain("overlap");
  });

  it("counts a job that is still going as lasting until now", () => {
    expect(rules(two({ from: { year: 2020 }, to: "current" }, { from: { year: 2023 }, to: { year: 2024 } }))).toContain("overlap");
  });

  it("reads a bare year as the middle of it: years that share a stretch overlap, years that only meet do not", () => {
    expect(rules(two({ from: { year: 2019 }, to: { year: 2022 } }, { from: { year: 2020 }, to: { year: 2023 } }))).toContain("overlap");
    expect(rules(two({ from: { year: 2019 }, to: { year: 2021 } }, { from: { year: 2021 }, to: { year: 2023 } }))).not.toContain("overlap");
  });

  it("says nothing when a date is missing", () => {
    expect(rules(two({ from: { year: 2020 } }, { from: { year: 2020 }, to: { year: 2021 } }))).not.toContain("overlap");
  });
});

describe("tools and skills", () => {
  it("offers the tools named in the person's own words that their skills do not list", () => {
    const profile = profileWith({ ...CURRENT, facts: [{ text: "Llevo las campañas de Google Ads y Meta" }] });
    const found = detectGaps(profile, NOW).find((gap) => gap.rule === "loose_tool")!;
    expect(found.payload.tools).toEqual(["Google Ads", "Meta"]);
  });

  it("leaves out what is already a skill, and what was turned down", () => {
    const profile = profileWith({ ...CURRENT, facts: [{ text: "Llevo las campañas de Google Ads y Meta" }] });
    profile.skills.push({ id: "s1", name: { value: "google ads", status: "confirmed" }, experienceIds: [] });
    expect(detectGaps(profile, NOW).find((gap) => gap.rule === "loose_tool")?.payload.tools).toEqual(["Meta"]);
    profile.pending.push({ questionId: "loose_tool:item:meta", ruleId: "loose_tool", entityId: "meta", state: "na", count: 1, at: STAMP });
    expect(rules(profile)).not.toContain("loose_tool");
  });

  it("does not offer a tool the skills already list under another spelling", () => {
    const profile = profileWith({ ...CURRENT, facts: [{ text: "Armé la API con Node.js y Postgres" }] });
    profile.skills.push({ id: "s1", name: { value: "NodeJS", status: "confirmed" }, experienceIds: [] });
    profile.skills.push({ id: "s2", name: { value: "PostgreSQL", status: "confirmed" }, experienceIds: [] });
    expect(rules(profile)).not.toContain("loose_tool");
  });

  it("does not offer a tool nobody named, however likely it is for the job", () => {
    const profile = profileWith({ ...CURRENT, role: "Desarrollador", facts: [{ text: "Armo las pantallas del panel" }] });
    expect(rules(profile)).not.toContain("loose_tool");
  });

  it("counts a tool typed as a tool", () => {
    const profile = profileWith({ ...CURRENT, facts: [{ kind: "tool", text: "Photoshop" }] });
    expect(detectGaps(profile, NOW).find((gap) => gap.rule === "loose_tool")?.payload.tools).toEqual(["Photoshop"]);
  });

  it("asks where a skill was used when no job says so", () => {
    const profile = profileWith(CURRENT);
    profile.skills.push({ id: "s1", name: { value: "SEO", status: "confirmed" }, experienceIds: [] });
    profile.skills.push({ id: "s2", name: { value: "SQL", status: "confirmed" }, experienceIds: [profile.experience[0]!.id] });
    expect(ids(profile).filter((id) => id.startsWith("skill_unused"))).toEqual(["skill_unused:s1"]);
  });

  it("does not ask where a skill was used when a job's own lines already name it", () => {
    const profile = profileWith({ ...CURRENT, facts: [{ text: "Optimicé las consultas en PostgreSQL" }, { text: "Armé la estrategia Go-to-market" }] });
    profile.skills.push({ id: "s1", name: { value: "Postgres", status: "confirmed" }, experienceIds: [] });
    profile.skills.push({ id: "s2", name: { value: "Go", status: "confirmed" }, experienceIds: [] });
    profile.skills.push({ id: "s3", name: { value: "Administración de sistemas", status: "confirmed" }, experienceIds: [] });
    expect(ids(profile).filter((id) => id.startsWith("skill_unused"))).toEqual(["skill_unused:s2", "skill_unused:s3"]);
  });

  it("asks nothing about skills when there are no jobs to place them in", () => {
    const profile = emptyStoredProfile();
    profile.skills.push({ id: "s1", name: { value: "SEO", status: "confirmed" }, experienceIds: [] });
    expect(rules(profile)).not.toContain("skill_unused");
  });
});

describe("languages, dates and stretches with nothing in them", () => {
  it("asks the level of a language that has none, and not of one that does", () => {
    const profile = emptyStoredProfile();
    profile.languages.push({ id: "l1", name: { value: "Inglés", status: "confirmed" }, level: { value: {}, status: "confirmed" } });
    profile.languages.push({ id: "l2", name: { value: "Francés", status: "confirmed" }, level: { value: { raw: "Básico" }, status: "confirmed" } });
    expect(ids(profile)).toEqual(["language_no_level:l1"]);
  });

  it("asks the month of a recent year-only date a document gave, but not of an old one or of a job still going", () => {
    const recent = profileWith({ company: "A", role: "x", from: { year: 2023 }, to: { year: 2024 }, fromCv: true });
    expect(ids(recent).filter((id) => id.startsWith("imprecise_date")).map((id) => id.split(":")[2])).toEqual(["start", "end"]);
    expect(rules(profileWith({ company: "A", role: "x", from: { year: 2010 }, to: { year: 2012 }, fromCv: true }))).not.toContain("imprecise_date");
    expect(ids(profileWith({ company: "A", role: "x", from: { year: 2023 }, to: "current", fromCv: true })).filter((id) => id.endsWith(":end"))).toEqual([]);
    expect(rules(profileWith({ company: "A", role: "x", from: { year: 2023, month: 3 }, to: { year: 2024, month: 1 }, fromCv: true }))).not.toContain("imprecise_date");
  });

  it("does not ask the month of a year the person chose themselves, with the month selector in front of them", () => {
    // They picked "Mes (no sé)" or typed only the year: asking again is asking them to say it twice.
    expect(rules(profileWith({ company: "A", role: "x", from: { year: 2023 }, to: { year: 2024 } }))).not.toContain("imprecise_date");
    // A document that gave the start by year and a person who then gave the end: each date has its own source.
    const mixed = profileWith({ company: "A", role: "x", from: { year: 2023 }, to: { year: 2024 }, fromCv: true });
    mixed.experience[0]!.end = { ...mixed.experience[0]!.end, source: { kind: "manual", at: STAMP } };
    expect(ids(mixed).filter((id) => id.startsWith("imprecise_date")).map((id) => id.split(":")[2])).toEqual(["start"]);
  });

  it("finds a stretch of more than six months with nothing, and not a shorter one", () => {
    const gap = profileWith({ company: "A", role: "x", from: { year: 2018, month: 1 }, to: { year: 2020, month: 1 } }, { company: "B", role: "y", from: { year: 2020, month: 10 }, to: { year: 2022, month: 1 } });
    expect(rules(gap)).toContain("career_gap");
    const short = profileWith({ company: "A", role: "x", from: { year: 2018, month: 1 }, to: { year: 2020, month: 1 } }, { company: "B", role: "y", from: { year: 2020, month: 6 }, to: { year: 2022, month: 1 } });
    expect(rules(short)).not.toContain("career_gap");
  });

  it("does not find a stretch a bare year could be hiding: a degree ended in 2017 and a job begun in February 2018", () => {
    const profile = profileWith({ company: "A", role: "x", from: { year: 2018, month: 2 }, to: { year: 2019, month: 1 } });
    addStudy(profile, { what: "Grado", where: "UV", from: { year: 2013 }, to: { year: 2017 } });
    expect(rules(profile)).not.toContain("career_gap");
  });

  it("does find one that no reading of the years can close, and names the years, not months nobody wrote", () => {
    const profile = profileWith({ company: "A", role: "x", from: { year: 2015 }, to: { year: 2016 } }, { company: "B", role: "y", from: { year: 2019 }, to: { year: 2021 } });
    const found = detectGaps(profile, NOW).find((gap) => gap.rule === "career_gap")!;
    expect(found.payload).toMatchObject({ from: { year: 2016 }, to: { year: 2019 } });
    expect((found.payload.from as object)).not.toHaveProperty("month");
    expect(questionFor(found, profile).text).toBe("Entre 2016 y 2019 no hay nada. ¿Querés agregar algo?");
  });

  it("counts studies as something, and needs at least two entries to talk of a gap", () => {
    const profile = profileWith({ company: "A", role: "x", from: { year: 2018, month: 1 }, to: { year: 2020, month: 1 } });
    expect(rules(profile)).not.toContain("career_gap");
    addStudy(profile, { what: "Lic.", where: "UBA", from: { year: 2020, month: 2 }, to: { year: 2020, month: 12 } });
    expect(rules(profile)).not.toContain("career_gap");
  });

  it("does not ask about a stretch from more than ten years ago", () => {
    const profile = profileWith({ company: "A", role: "x", from: { year: 2001, month: 1 }, to: { year: 2003, month: 1 } }, { company: "B", role: "y", from: { year: 2005, month: 1 }, to: { year: 2007, month: 1 } });
    expect(rules(profile)).not.toContain("career_gap");
  });

  it("asks a student with no work whether there is anything else to list, once", () => {
    const profile = emptyStoredProfile();
    profile.onboarding.route = "scratch";
    profile.onboarding.situation = "student";
    // Work first, and then — as a second, lighter question — a course or a license.
    expect(rules(profile)).toEqual(["no_work_experience", "no_certifications"]);
    profile.projects.push({ id: "p", name: { value: "Turnos", status: "confirmed" }, description: { value: "", status: "confirmed" }, url: { value: "", status: "confirmed" }, tags: { value: [], status: "confirmed" } });
    expect(rules(profile)).not.toContain("no_work_experience");
  });
});

describe("a CV that came out short (UI-4)", () => {
  const working = () => profileWith(CURRENT);

  it("asks whoever has a job whether there is anything else to list, when the page they are on says it is short — and not otherwise", () => {
    expect(rules(working())).not.toContain("no_work_experience");
    const asked = detectGaps(working(), NOW, { thin: true }).find((gap) => gap.rule === "no_work_experience");
    expect(asked).toMatchObject({ id: "no_work_experience:all" });
    expect(questionFor(asked!, working())).toMatchObject({ text: "¿Hiciste alguna práctica, proyecto o voluntariado?", control: { kind: "extra" } });
  });

  it("is eligible by that rule alone, and once it is answered it is not asked again, short CV or not", () => {
    const profile = working();
    const only = new Set(["no_work_experience"] as const);
    const eligible = () => eligibleGaps(profile, freshSession(), NOW, { rules: only, signals: { thin: true } }).map((gap) => gap.id);
    expect(eligible()).toEqual(["no_work_experience:all"]);
    answerHandled(profile, detectGaps(profile, NOW, { thin: true }).find((gap) => gap.rule === "no_work_experience")!);
    expect(eligible()).toEqual([]);
  });
});

describe("since the last thing that ended", () => {
  const since = (profile: StoredProfile) => detectGaps(profile, NOW).find((gap) => gap.rule === "since_last");

  it("asks what came after, when the last job ended long ago, and names the date as it was written", () => {
    const year = since(profileWith({ company: "A", role: "x", from: { year: 2019 }, to: { year: 2023 } }))!;
    expect(year.payload).toMatchObject({ from: { year: 2023 } });
    expect(year.payload.from).not.toHaveProperty("month");
    const month = since(profileWith({ company: "A", role: "x", from: { year: 2019 }, to: { year: 2024, month: 3 } }))!;
    expect(month.payload).toMatchObject({ from: { year: 2024, month: 3 } });
  });

  it("is a medium question, so it counts against the session's budget", () => {
    expect(since(profileWith({ company: "A", role: "x", from: { year: 2019 }, to: { year: 2023 } }))).toMatchObject({ priority: "medium" });
  });

  it("waits for more than six months, measured from the latest the end could be", () => {
    const end = (to: { year: number; month?: number }) => profileWith({ company: "A", role: "x", from: { year: 2020 }, to });
    // Now is September 2026: an end in March is six months back, in February seven.
    expect(since(end({ year: 2026, month: 3 }))).toBeUndefined();
    expect(since(end({ year: 2026, month: 2 }))).toBeDefined();
    // A bare year this year could be December: it is not known to be over.
    expect(since(end({ year: 2026 }))).toBeUndefined();
    expect(since(end({ year: 2025 }))).toBeDefined();
  });

  it("does not ask of someone who is somewhere now: a job going on, or one with a start and no end", () => {
    expect(since(profileWith({ ...CURRENT }))).toBeUndefined();
    expect(since(profileWith({ company: "A", role: "x", from: { year: 2019 }, to: { year: 2021 } }, { ...CURRENT }))).toBeUndefined();
    expect(since(profileWith({ company: "A", role: "x", from: { year: 2019 } }))).toBeUndefined();
    // One job that says nothing about its end is enough to keep quiet about all of them.
    expect(since(profileWith({ company: "A", role: "x", from: { year: 2015 }, to: { year: 2018 } }, { company: "B", role: "y", from: { year: 2019 } }))).toBeUndefined();
  });

  it("counts the studies, and takes the latest end of everything", () => {
    const profile = profileWith({ company: "A", role: "x", from: { year: 2016 }, to: { year: 2020 } });
    addStudy(profile, { from: { year: 2018 }, to: { year: 2022 } });
    expect(since(profile)!.payload).toMatchObject({ from: { year: 2022 } });
  });

  it("does not ask of someone studying now, or with a study begun and never closed", () => {
    const now = profileWith({ company: "A", role: "x", from: { year: 2016 }, to: { year: 2020 } });
    addStudy(now, { from: { year: 2024 }, current: true });
    expect(since(now)).toBeUndefined();
    const open = profileWith({ company: "A", role: "x", from: { year: 2016 }, to: { year: 2020 } });
    addStudy(open, { from: { year: 2024 } });
    expect(since(open)).toBeUndefined();
  });

  it("has nothing to measure from when nothing says when it ended", () => {
    expect(since(emptyStoredProfile())).toBeUndefined();
    const onlyAStart = emptyStoredProfile();
    addStudy(onlyAStart, {});
    expect(since(onlyAStart)).toBeUndefined();
  });

  it("is the same question for the same last end, and another once something newer is added", () => {
    const profile = profileWith({ company: "A", role: "x", from: { year: 2019 }, to: { year: 2023 } });
    expect(since(profile)!.id).toBe(since(structuredClone(profile))!.id);
    const before = since(profile)!.id;
    withJob(profile, { company: "B", role: "y", from: { year: 2023 }, to: { year: 2024 } });
    expect(since(profile)!.id).not.toBe(before);
  });

  it("stays put once turned down for good", () => {
    const profile = profileWith({ company: "A", role: "x", from: { year: 2019 }, to: { year: 2023 } });
    deferQuestion(profile, since(profile)!, "na", { now: STAMP, newId });
    expect(eligibleGaps(profile, freshSession(), NOW).map((gap) => gap.rule)).not.toContain("since_last");
  });
});

describe("what kind of job they are after", () => {
  const RECENT = { company: "B", role: "b", from: { year: 2023, month: 1 }, to: { year: 2024, month: 6 } };
  const ANCIENT = { company: "C", role: "c", from: { year: 2005 }, to: { year: 2008 } };
  const objectiveGap = (profile: StoredProfile) => detectGaps(profile, NOW).find((gap) => gap.rule === "objective");

  it("is asked when there is something for it to decide between: two jobs that both have more to say", () => {
    const gap = objectiveGap(profileWith(CURRENT, RECENT))!;
    expect(gap).toMatchObject({ id: "objective", priority: "medium" });
    expect(gap.experienceId).toBeUndefined();
  });

  it("is not asked with one job: nothing yet to choose between", () => {
    expect(objectiveGap(profileWith(CURRENT))).toBeUndefined();
  });

  it("does not count a job the profile would not ask about anyway", () => {
    expect(objectiveGap(profileWith(CURRENT, ANCIENT))).toBeUndefined();
  });

  it("does not count a job with nothing left to ask", () => {
    const done = { ...RECENT, facts: [{ kind: "achievement" as const, text: "Subí las ventas", metric: { value: "20", unit: "%", approx: false } }, { text: "Llevo las campañas" }] };
    expect(objectiveGap(profileWith(CURRENT, done))).toBeUndefined();
  });

  it("is asked of someone changing sector even with a single job: it is what their whole session leads with", () => {
    const profile = profileWith(CURRENT);
    profile.onboarding.situation = "switch";
    expect(objectiveGap(profile)).toBeDefined();
    const nobody = emptyStoredProfile();
    nobody.onboarding.situation = "switch";
    expect(objectiveGap(nobody)).toBeUndefined();
  });

  it("is not asked once it is answered, or turned down for good", () => {
    const answered = profileWith(CURRENT, RECENT);
    answerObjective(answered, "Gerente de ventas", { now: STAMP, newId });
    expect(objectiveGap(answered)).toBeUndefined();
    const declined = profileWith(CURRENT, RECENT);
    deferQuestion(declined, objectiveGap(declined)!, "na", { now: STAMP, newId });
    expect(eligibleGaps(declined, freshSession(), NOW).map((gap) => gap.rule)).not.toContain("objective");
  });

  it("comes before the questions it orders", () => {
    const profile = profileWith(CURRENT, RECENT);
    expect(eligibleGaps(profile, freshSession(), NOW)[0]!.rule).toBe("objective");
    expect(nextQuestion(profile, freshSession(), NOW)).toMatchObject({ kind: "gap", gap: { rule: "objective" } });
  });

  it("still comes after the skeleton, which is what makes a job a job", () => {
    const profile = profileWith(CURRENT, RECENT, { company: "A", role: "x" });
    expect(eligibleGaps(profile, freshSession(), NOW)[0]!.rule).toBe("incomplete_skeleton");
  });

  it("counts against the session like any other question, and leaves what it decided in the profile", () => {
    const profile = profileWith(CURRENT, RECENT);
    const found = objectiveGap(profile)!;
    answerObjective(profile, "  Gerente de ventas ", { now: STAMP, newId }, found);
    // Filling in what was empty is not an edit: it is what the person said, credited to their answer.
    expect(profile.objective).toMatchObject({ value: "Gerente de ventas", status: "confirmed", source: { kind: "answer" } });
    expect(profile.onboarding.askedThisSession).toBe(1);
    expect(profile.pending.some((entry) => entry.questionId === "objective")).toBe(false);
  });

  it("turning it down counts too, and is remembered so it is not asked twice", () => {
    const profile = profileWith(CURRENT, RECENT);
    deferQuestion(profile, objectiveGap(profile)!, "na", { now: STAMP, newId });
    expect(profile.onboarding.askedThisSession).toBe(1);
    expect(profile.pending).toContainEqual(expect.objectContaining({ questionId: "objective", ruleId: "objective", state: "na" }));
    expect(profile.objective.value).toBe("");
  });

  it("typed straight into the profile, it counts for nothing: only a question of the session is counted", () => {
    const profile = profileWith(CURRENT, RECENT);
    answerObjective(profile, "Gerente de ventas", { now: STAMP, newId });
    expect(profile.onboarding.askedThisSession).toBe(0);
  });
});

describe("how much each matters", () => {
  const gapFor = (profile: StoredProfile, rule: string, jobIndex = 0): Gap =>
    detectGaps(profile, NOW).find((gap) => gap.rule === rule && (gap.experienceId === undefined || gap.experienceId === profile.experience[jobIndex]!.id))!;

  it("asks about the current job before one that ended", () => {
    const profile = profileWith({ ...CURRENT }, { company: "Vieja", role: "Asistente", from: { year: 2018, month: 1 }, to: { year: 2021, month: 1 } });
    const now = gapFor(profile, "no_content", 0);
    const old = gapFor(profile, "no_content", 1);
    expect(priorityOf(now, profile, NOW)).toBeGreaterThan(priorityOf(old, profile, NOW));
    // Recency: 1, then 0.8 within three years, 0.5 within seven, 0.2 beyond.
    expect(priorityOf(old, profile, NOW) / priorityOf(now, profile, NOW)).toBeCloseTo(0.5, 5);
  });

  it("weighs what is relevant to the objective more", () => {
    const profile = profileWith(
      { company: "A", role: "Analista de marketing", from: { year: 2021, month: 1 }, to: "current" },
      { company: "B", role: "Cajero", from: { year: 2021, month: 1 }, to: "current" },
    );
    const without = priorityOf(gapFor(profile, "no_content", 0), profile, NOW);
    profile.objective = { value: "Responsable de marketing", status: "confirmed" };
    expect(priorityOf(gapFor(profile, "no_content", 0), profile, NOW)).toBeCloseTo(without * ENGINE.relevance.match, 5);
    expect(priorityOf(gapFor(profile, "no_content", 1), profile, NOW)).toBeCloseTo(without, 5);
  });

  it("asks about being in charge sooner when the objective is to be in charge", () => {
    const profile = profileWith({ ...CURRENT, role: "Analista de marketing", facts: [{ text: "Llevo las campañas de marketing" }] });
    profile.objective = { value: "Responsable de marketing digital", status: "confirmed" };
    const found = gapFor(profile, "scope_unknown");
    expect(priorityOf(found, profile, NOW)).toBeCloseTo(5 * ENGINE.relevance.scopeForManagement, 5);
  });

  it("makes a kind of question less likely after the person skipped some of it, to a floor", () => {
    const profile = profileWith(CURRENT);
    const found = gapFor(profile, "no_content");
    const base = priorityOf(found, profile, NOW);
    profile.fatigue.no_content = { skipped: 2, unknown: 0 };
    expect(priorityOf(found, profile, NOW)).toBeCloseTo(base * (1 - 2 * ENGINE.fatigue.perSkip), 5);
    profile.fatigue.no_content = { skipped: 50, unknown: 0 };
    expect(priorityOf(found, profile, NOW)).toBeCloseTo(base * ENGINE.fatigue.floor, 5);
  });

  it("weighs a question that was skipped less than one never asked", () => {
    const profile = profileWith(CURRENT);
    const found = gapFor(profile, "no_content");
    const base = priorityOf(found, profile, NOW);
    profile.pending.push({ questionId: found.id, ruleId: "no_content", state: "skipped", count: 1, at: STAMP });
    expect(priorityOf(found, profile, NOW)).toBeCloseTo(base * ENGINE.skippedFactor, 5);
  });
});

describe("compact: a phone's screen makes one-tap questions worth more", () => {
  const gapFor = (profile: StoredProfile, rule: string): Gap => detectGaps(profile, NOW).find((found) => found.rule === rule)!;

  it("leaves a narrative rule's score untouched", () => {
    const profile = profileWith(CURRENT);
    const found = gapFor(profile, "no_content");
    expect(priorityOf(found, profile, NOW, { compact: true })).toBe(priorityOf(found, profile, NOW));
  });

  it("multiplies a one-tap rule's score by the configured boost, only when asked for", () => {
    const profile = emptyStoredProfile();
    profile.languages.push({ id: "l1", name: { value: "Inglés", status: "confirmed" }, level: { value: {}, status: "confirmed" } });
    const found = gapFor(profile, "language_no_level");
    const base = priorityOf(found, profile, NOW);
    expect(priorityOf(found, profile, NOW, { compact: false })).toBe(base);
    expect(priorityOf(found, profile, NOW, { compact: true })).toBeCloseTo(base * ENGINE.compactBoost, 5);
  });

  it("can put a one-tap question ahead of one it would otherwise lose to", () => {
    const profile = profileWith(CURRENT); // no facts yet under the current job: "no_content" outweighs a language
    profile.languages.push({ id: "l1", name: { value: "Inglés", status: "confirmed" }, level: { value: {}, status: "confirmed" } });
    expect(eligibleGaps(profile, freshSession(), NOW)[0]!.rule).toBe("no_content");
    expect(eligibleGaps(profile, freshSession(), NOW, { compact: true })[0]!.rule).toBe("language_no_level");
  });

  it("does not put «¿Seguís en…?» first on a phone: one tap to say yes, and screens and a box of text to say anything else (U18)", () => {
    const profile = profileWith({ ...CURRENT, facts: [{ text: "Armo los pedidos del depósito" }] });
    // Nobody has looked at it for months: everything of the job is as old as that.
    fromSource(profile.experience[0]!, { kind: "manual", at: "2025-01-10T12:00:00.000Z" });
    const found = gapFor(profile, "current_job_review");
    expect(found).toBeDefined();
    expect(priorityOf(found, profile, NOW, { compact: true })).toBe(priorityOf(found, profile, NOW));
  });

  it("never lets that reordering admit a third quick question past maxQuick", () => {
    const profile = profileWith(CURRENT);
    profile.languages.push({ id: "l1", name: { value: "Inglés", status: "confirmed" }, level: { value: {}, status: "confirmed" } });
    profile.languages.push({ id: "l2", name: { value: "Francés", status: "confirmed" }, level: { value: {}, status: "confirmed" } });
    const spent = { ...freshSession(), askedQuick: ENGINE.session.maxQuick };
    // Boosted, both languages still rank ahead of the job's own question...
    expect(eligibleGaps(profile, spent, NOW, { compact: true })[0]!.rule).toBe("language_no_level");
    // ...but the quick budget is already spent, so the loop falls through past them to it instead.
    const next = nextQuestion(profile, spent, NOW, { compact: true });
    expect(next.kind === "gap" ? next.gap.rule : next.kind).toBe("no_content");
  });
});

describe("what can be asked now", () => {
  it("never asks what the person said no to for good", () => {
    const profile = profileWith(CURRENT);
    const found = detectGaps(profile, NOW).find((gap) => gap.rule === "no_content")!;
    profile.pending.push({ questionId: found.id, ruleId: "no_content", state: "na", count: 1, at: STAMP });
    expect(eligibleGaps(profile, freshSession(), NOW).map((gap) => gap.id)).not.toContain(found.id);
  });

  it("holds 'más tarde' for the next session", () => {
    const profile = profileWith(CURRENT);
    const found = detectGaps(profile, NOW).find((gap) => gap.rule === "no_content")!;
    const at = "2026-09-21T13:00:00.000Z";
    profile.pending.push({ questionId: found.id, ruleId: "no_content", state: "later", count: 1, at });
    const sameSession = { ...freshSession(), startedAt: "2026-09-21T12:00:00.000Z" };
    expect(eligibleGaps(profile, sameSession, NOW).map((gap) => gap.id)).not.toContain(found.id);
    const nextSession = { ...freshSession(), startedAt: "2026-09-22T09:00:00.000Z" };
    expect(eligibleGaps(profile, nextSession, NOW).map((gap) => gap.id)).toContain(found.id);
  });

  it("does not immediately re-ask a 'saltar' in the same session, but does in the next one, at a lower priority", () => {
    const profile = profileWith(CURRENT);
    const found = detectGaps(profile, NOW).find((gap) => gap.rule === "no_content")!;
    const at = "2026-09-21T13:00:00.000Z";
    profile.pending.push({ questionId: found.id, ruleId: "no_content", state: "skipped", count: 1, at });
    const sameSession = { ...freshSession(), startedAt: "2026-09-21T12:00:00.000Z" };
    expect(eligibleGaps(profile, sameSession, NOW).map((gap) => gap.id)).not.toContain(found.id);
    const nextSession = { ...freshSession(), startedAt: "2026-09-22T09:00:00.000Z" };
    const backIn = eligibleGaps(profile, nextSession, NOW);
    expect(backIn.map((gap) => gap.id)).toContain(found.id);
    expect(priorityOf(found, profile, NOW)).toBeCloseTo(priorityOf(found, profileWith(CURRENT), NOW) * ENGINE.skippedFactor, 5);
  });

  it("leaves jobs that ended more than seven years ago as a skeleton", () => {
    const profile = profileWith(CURRENT, { company: "Vieja", role: "Asistente", from: { year: 2010, month: 1 }, to: { year: 2015, month: 1 } });
    const jobIds = eligibleGaps(profile, freshSession(), NOW).map((gap) => gap.experienceId);
    expect(jobIds).not.toContain(profile.experience[1]!.id);
    expect(jobIds).toContain(profile.experience[0]!.id);
  });

  it("still asks an old job for its start, if it has none", () => {
    const profile = profileWith(CURRENT, { company: "Vieja", role: "Asistente", to: { year: 2015 } });
    expect(eligibleGaps(profile, freshSession(), NOW).some((gap) => gap.rule === "incomplete_skeleton" && gap.experienceId === profile.experience[1]!.id)).toBe(true);
  });

  it("deepens only the current job and the one or two next, in a session", () => {
    // All four ended within seven years, so all four are candidates; only the three most recent are deepened.
    const profile = profileWith(
      CURRENT,
      { company: "B", role: "b", from: { year: 2023, month: 1 }, to: { year: 2025, month: 1 } },
      { company: "C", role: "c", from: { year: 2020, month: 1 }, to: { year: 2022, month: 1 } },
      { company: "D", role: "d", from: { year: 2019, month: 1 }, to: { year: 2020, month: 6 } },
    );
    const deepened = new Set(eligibleGaps(profile, freshSession(), NOW).filter((gap) => gap.rule === "no_content").map((gap) => gap.experienceId));
    expect(deepened.size).toBe(ENGINE.session.deepenJobs);
    expect(deepened.has(profile.experience[3]!.id)).toBe(false);
  });

  it("gives a fourth recent job its turn once the top three by score are missing nothing", () => {
    // A job with an achievement and its figure is missing nothing — all it has
    // left is "¿algo más?" — so scoring above a fourth job with nothing under it
    // should not be enough to keep occupying a slot.
    const done = (facts = true) => ({
      role: "Analista",
      facts: facts ? [{ kind: "achievement" as const, text: "Subí las ventas un 12%", metric: { value: "12", unit: "%", approx: false } }] : [],
    });
    const profile = profileWith(
      { ...CURRENT, ...done() },
      { ...done(), company: "B", from: { year: 2023, month: 1 }, to: { year: 2025, month: 1 } },
      { ...done(), company: "C", from: { year: 2020, month: 1 }, to: { year: 2022, month: 1 } },
      { ...done(false), company: "D", from: { year: 2019, month: 1 }, to: { year: 2020, month: 6 } },
    );
    const fourth = profile.experience[3]!.id;
    expect(eligibleGaps(profile, freshSession(), NOW).some((gap) => gap.experienceId === fourth)).toBe(true);
  });

  it("puts a job that only has more to add after the jobs still missing something — except the current one", () => {
    const told = { role: "Analista", facts: [{ text: "Aumenté las ventas del local un 20%" }] };
    const bare = (company: string, from: number) => ({ company, role: "Asistente", from: { year: from, month: 1 }, to: { year: from + 1, month: 1 } });

    const past = profileWith({ ...told, company: "A", from: { year: 2024, month: 1 }, to: { year: 2025, month: 6 } }, bare("B", 2022), bare("C", 2021), bare("D", 2020));
    const asked = new Set(eligibleGaps(past, freshSession(), NOW).map((gap) => gap.experienceId));
    // A scores highest, but B, C and D have nothing under them yet.
    expect(asked.has(past.experience[0]!.id)).toBe(false);
    expect(past.experience.slice(1).every((job) => asked.has(job.id))).toBe(true);

    const current = profileWith({ ...told, ...CURRENT }, bare("B", 2022), bare("C", 2021), bare("D", 2020));
    expect(eligibleGaps(current, freshSession(), NOW).some((gap) => gap.rule === "more_achievements" && gap.experienceId === current.experience[0]!.id)).toBe(true);
  });

  it("still puts the current job first when three more relevant, similarly recent ones would otherwise outscore it", () => {
    const profile = profileWith(
      { ...CURRENT, role: "Analista" }, // current (score 1), but not what the objective names
      { company: "B", role: "Gerente de ventas", from: { year: 2024, month: 1 }, to: { year: 2025, month: 1 } }, // 0.8 × 1.5 = 1.2
      { company: "C", role: "Gerente de ventas", from: { year: 2023, month: 6 }, to: { year: 2024, month: 6 } },
      { company: "D", role: "Gerente de ventas", from: { year: 2023, month: 1 }, to: { year: 2024, month: 1 } },
    );
    profile.objective = { value: "Gerente de ventas", status: "confirmed" };
    const deepened = new Set(eligibleGaps(profile, freshSession(), NOW).filter((gap) => gap.rule === "no_content").map((gap) => gap.experienceId));
    expect(deepened.size).toBe(ENGINE.session.deepenJobs);
    expect(deepened.has(profile.experience[0]!.id)).toBe(true); // the current job, despite scoring lowest on paper
  });

  it("asks at most three things about one job in a session", () => {
    const profile = profileWith({ ...CURRENT, role: "Gerente", facts: [{ kind: "achievement", text: "Subí la conversión" }, { text: "Llevo las campañas" }] });
    const session = { ...freshSession(), askedByExperience: { [profile.experience[0]!.id]: ENGINE.session.maxPerExperience } };
    expect(eligibleGaps(profile, session, NOW).filter((gap) => gap.experienceId === profile.experience[0]!.id)).toEqual([]);
  });

  it("stops asking for figures about old jobs after two 'no lo sé', and not about the current one", () => {
    const profile = profileWith(
      { ...CURRENT, facts: [{ kind: "achievement", text: "Subí la conversión" }] },
      { company: "B", role: "b", from: { year: 2021, month: 1 }, to: { year: 2022, month: 6 }, facts: [{ kind: "achievement", text: "Bajé costos" }] },
    );
    const figures = () => eligibleGaps(profile, freshSession(), NOW).filter((gap) => gap.rule === "achievement_no_figure").map((gap) => gap.experienceId);
    expect(figures()).toHaveLength(2);
    profile.fatigue.achievement_no_figure = { skipped: 0, unknown: ENGINE.figureUnknownStopAfter };
    expect(figures()).toEqual([profile.experience[0]!.id]);
  });

  it("stops asking for figures about every job once the person says there are none in their work, the current one too", () => {
    const profile = profileWith(
      { ...CURRENT, facts: [{ kind: "achievement", text: "Subí la conversión" }] },
      { company: "B", role: "b", from: { year: 2023, month: 1 }, to: { year: 2025, month: 1 }, facts: [{ kind: "achievement", text: "Bajé costos" }] },
    );
    const figures = () => eligibleGaps(profile, freshSession(), NOW).filter((gap) => gap.rule === "achievement_no_figure");
    expect(figures()).toHaveLength(2);
    profile.fatigue.achievement_no_figure = { skipped: 0, unknown: 0, off: true };
    expect(figures()).toEqual([]);
    // The rest of the questions about those jobs are asked as before.
    expect(eligibleGaps(profile, freshSession(), NOW).some((gap) => gap.rule === "more_achievements")).toBe(true);
    // And not as a follow-up on an achievement just told, which is where the next figure would have come from.
    const told = profile.experience[0]!.facts[0]!;
    expect(figureFollowUp(profile, told, NOW)).toBeUndefined();
    expect(followUpGaps(profile, [told], NOW)).toEqual([]);
  });

  it("does not ask what the answer already says", () => {
    const profile = profileWith({ ...CURRENT, role: "Jefa de área", facts: [{ text: "Dirijo un equipo de cuatro personas" }] });
    expect(eligibleGaps(profile, freshSession(), NOW).some((gap) => gap.rule === "scope_unknown")).toBe(false);
  });

  it("always asks in the same order for the same profile", () => {
    const profile = profileWith(CURRENT, { company: "B", role: "b", from: { year: 2019, month: 1 }, to: { year: 2021, month: 1 } });
    expect(eligibleGaps(profile, freshSession(), NOW).map((gap) => gap.id)).toEqual(eligibleGaps(structuredClone(profile), freshSession(), NOW).map((gap) => gap.id));
  });
});

describe("nextQuestion and the session's budget", () => {
  // A manager with one achievement and a tool named: deepening questions, and one quick one.
  const busy = () => profileWith(
    { ...CURRENT, role: "Gerente", facts: [{ kind: "achievement", text: "Subí la conversión" }, { text: "Llevo Google Ads" }] },
    { company: "B", role: "b", from: { year: 2019, month: 1 }, to: { year: 2021, month: 1 } },
  );
  const spent = { ...freshSession(), askedThisSession: ENGINE.session.maxQuestions };

  it("gives the next question while there is budget", () => {
    expect(nextQuestion(busy(), freshSession(), NOW).kind).toBe("gap");
  });

  it("says the budget is spent, not that there is nothing left", () => {
    const next = nextQuestion(busy(), { ...spent, askedQuick: ENGINE.session.maxQuick }, NOW);
    expect(next).toMatchObject({ kind: "budget" });
    expect((next as { remaining: number }).remaining).toBeGreaterThan(0);
  });

  it("still asks a one-tap question after the deepening budget is spent, up to their own limit", () => {
    const first = nextQuestion(busy(), spent, NOW);
    expect(first).toMatchObject({ kind: "gap", gap: { priority: "low" } });
    expect(nextQuestion(busy(), { ...spent, askedQuick: ENGINE.session.maxQuick }, NOW).kind).toBe("budget");
  });

  it("does not count the skeleton against either budget", () => {
    const profile = profileWith({ company: "A", role: "x" });
    const next = nextQuestion(profile, { ...spent, askedQuick: ENGINE.session.maxQuick }, NOW);
    expect(next).toMatchObject({ kind: "gap", gap: { rule: "incomplete_skeleton" } });
  });

  it("says there is nothing when there is nothing", () => {
    expect(nextQuestion(emptyStoredProfile(), freshSession(), NOW)).toEqual({ kind: "none" });
  });
});

describe("what to ask right after an answer", () => {
  it("asks the figure of an achievement just told, ahead of anything else", () => {
    const profile = profileWith({ ...CURRENT, facts: [{ kind: "achievement", text: "Rehíce las campañas y subió la conversión" }, { kind: "achievement", text: "Bajé el costo un 15%" }] });
    const [told, withFigure] = profile.experience[0]!.facts;
    const follow = followUpGaps(profile, [told!, withFigure!], NOW);
    expect(follow.map((gap) => gap.rule)).toEqual(["achievement_no_figure"]);
    expect(follow[0]!.payload.factId).toBe(told!.id);
  });

  it("offers the tools they just named while their words are on screen", () => {
    const profile = profileWith({ ...CURRENT, facts: [{ text: "Llevo Google Ads" }, { text: "Preparo informes" }] });
    const [withTool, without] = profile.experience[0]!.facts;
    expect(followUpGaps(profile, [withTool!], NOW).map((gap) => gap.rule)).toEqual(["loose_tool"]);
    expect(followUpGaps(profile, [without!], NOW)).toEqual([]);
  });

  it("does not offer a tool that was named earlier, in something not just told", () => {
    const profile = profileWith({ ...CURRENT, facts: [{ text: "Llevo Google Ads" }, { text: "Preparo informes" }] });
    const [, later] = profile.experience[0]!.facts;
    expect(followUpGaps(profile, [later!], NOW)).toEqual([]);
  });

  it("does not follow up what was turned down", () => {
    const profile = profileWith({ ...CURRENT, facts: [{ text: "Llevo Google Ads" }] });
    profile.pending.push({ questionId: "loose_tool:all", ruleId: "loose_tool", state: "na", count: 1, at: STAMP });
    expect(followUpGaps(profile, profile.experience[0]!.facts, NOW)).toEqual([]);
  });

  it("does not follow up what was just skipped or put off, within the same session", () => {
    const profile = profileWith({ ...CURRENT, facts: [{ text: "Llevo Google Ads" }] });
    profile.pending.push({ questionId: "loose_tool:all", ruleId: "loose_tool", state: "skipped", count: 1, at: STAMP });
    expect(followUpGaps(profile, profile.experience[0]!.facts, NOW, freshSession())).toEqual([]);
    // With no session given (the default), it is not held back — matching every prior call site.
    expect(followUpGaps(profile, profile.experience[0]!.facts, NOW).map((gap) => gap.rule)).toEqual(["loose_tool"]);
  });

  it("does not ask for a figure about an old job once figures have stopped being asked", () => {
    const profile = profileWith({ company: "A", role: "x", from: { year: 2021, month: 1 }, to: { year: 2022, month: 1 }, facts: [{ kind: "achievement", text: "Subí las ventas" }] });
    expect(followUpGaps(profile, profile.experience[0]!.facts, NOW).map((gap) => gap.rule)).toEqual(["achievement_no_figure"]);
    profile.fatigue.achievement_no_figure = { skipped: 0, unknown: ENGINE.figureUnknownStopAfter };
    expect(followUpGaps(profile, profile.experience[0]!.facts, NOW)).toEqual([]);
  });

  it("has nothing to follow up when nothing was said", () => {
    expect(followUpGaps(profileWith(CURRENT), [], NOW)).toEqual([]);
  });

  it("gives the achievements cycle only the figure of the fact just told, never a tools offer in its place", () => {
    const profile = profileWith({
      ...CURRENT,
      facts: [
        { kind: "achievement", text: "Bajé un 20% el tiempo de carga con Hotjar" },
        { kind: "achievement", text: "Rehíce las campañas en Hotjar y subió la conversión" },
      ],
    });
    const [withFigure, withoutFigure] = profile.experience[0]!.facts;
    // The trap: a figure already in the words, and a tool the skills do not list.
    // The first follow-up is the tools offer, which a figure card could never save.
    expect(followUpGaps(profile, [withFigure!], NOW).map((gap) => gap.rule)).toEqual(["loose_tool"]);
    expect(figureFollowUp(profile, withFigure!, NOW)).toBeUndefined();
    expect(figureFollowUp(profile, withoutFigure!, NOW)?.payload.factId).toBe(withoutFigure!.id);
  });
});

void newId;

describe("questions about one job", () => {
  const two = () =>
    profileWith(
      { company: "Nubia Retail", role: "Analista", from: { year: 2021, month: 3 }, to: "current" },
      { company: "Agencia Faro", role: "Prácticas", from: { year: 2014, month: 2 }, to: { year: 2014, month: 7 } },
    );

  it("asks only about the job named", () => {
    const profile = two();
    const faro = profile.experience[1]!;
    const asked = eligibleGaps(profile, freshSession(), NOW, { only: faro.id });
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((gap) => gap.experienceId === faro.id)).toBe(true);
  });

  it("goes deep into it even when it is old enough to be left as a skeleton", () => {
    const profile = two();
    const faro = profile.experience[1]!;
    expect(eligibleGaps(profile, freshSession(), NOW).some((gap) => gap.experienceId === faro.id)).toBe(false);
    expect(eligibleGaps(profile, freshSession(), NOW, { only: faro.id }).some((gap) => gap.rule === "no_content")).toBe(true);
  });

  it("still holds a job to its three questions a session", () => {
    const profile = two();
    const faro = profile.experience[1]!;
    const spent = { ...freshSession(), askedByExperience: { [faro.id]: ENGINE.session.maxPerExperience } };
    expect(eligibleGaps(profile, spent, NOW, { only: faro.id })).toEqual([]);
  });

  it("gives a new session nothing asked and nothing put off", () => {
    expect(NO_SESSION).toEqual({ askedThisSession: 0, askedQuick: 0, askedByExperience: {}, startedAt: "" });
  });

  it("still asks a gap skipped or put off earlier in this very session — arriving at 'Falta un logro' is choosing to answer it now", () => {
    const profile = two();
    const faro = profile.experience[1]!;
    const found = detectGaps(profile, NOW).find((gap) => gap.experienceId === faro.id)!;
    const sameSession = { ...freshSession(), startedAt: "2026-09-21T12:00:00.000Z" };
    profile.pending.push({ questionId: found.id, ruleId: found.rule, entityId: faro.id, state: "skipped", count: 1, at: "2026-09-21T13:00:00.000Z" });
    expect(eligibleGaps(profile, sameSession, NOW).map((gap) => gap.id)).not.toContain(found.id);
    expect(eligibleGaps(profile, sameSession, NOW, { only: faro.id }).map((gap) => gap.id)).toContain(found.id);
  });

  it("still never asks one turned down for good with 'no aplica', even by name", () => {
    const profile = two();
    const faro = profile.experience[1]!;
    const found = detectGaps(profile, NOW).find((gap) => gap.experienceId === faro.id)!;
    profile.pending.push({ questionId: found.id, ruleId: found.rule, entityId: faro.id, state: "na", count: 1, at: STAMP });
    expect(eligibleGaps(profile, freshSession(), NOW, { only: faro.id }).map((gap) => gap.id)).not.toContain(found.id);
  });
});

describe("how many questions are left today", () => {
  // Five results with no figure: more to ask about one job than a session asks about any one.
  const RESULTS = ["Subí las ventas", "Bajé los costos", "Reduje los tiempos", "Lancé un producto", "Mejoré el proceso"];
  const withResults = (company: string) => ({ ...CURRENT, company, facts: RESULTS.map((text) => ({ kind: "achievement" as const, text })) });
  /** The practical facts are one more quick question for anyone with a job; the counts below are of the rest, so it is already said. */
  const practicalSaid = (profile: StoredProfile): StoredProfile => {
    profile.legacy.practical = { value: { availability: "Tiempo completo", driverLicense: "", ownVehicle: false, willingToRelocate: false, workEligibility: "" }, status: "confirmed" };
    return profile;
  };

  it("is the one question there is, when there is one", () => {
    expect(remainingThisSession(practicalSaid(profileWith(CURRENT)), freshSession(), NOW)).toBe(1);
  });

  it("counts the practical question among the one-tap ones, which is why it can be the last", () => {
    // The job's own question, and the practical one: two, the second of them within the quick limit.
    expect(remainingThisSession(profileWith(CURRENT), freshSession(), NOW)).toBe(2);
    const spent = { ...freshSession(), askedQuick: ENGINE.session.maxQuick };
    expect(remainingThisSession(profileWith(CURRENT), spent, NOW)).toBe(1);
  });

  it("is nothing when there is nothing to ask", () => {
    expect(remainingThisSession(emptyStoredProfile(), freshSession(), NOW)).toBe(0);
  });

  it("holds one job to what a session asks about any one", () => {
    const profile = practicalSaid(profileWith(withResults("A")));
    expect(remainingThisSession(profile, freshSession(), NOW)).toBe(ENGINE.session.maxPerExperience);
    const asked = { ...freshSession(), askedByExperience: { [profile.experience[0]!.id]: 2 } };
    expect(remainingThisSession(profile, asked, NOW)).toBe(ENGINE.session.maxPerExperience - 2);
  });

  it("holds all of it to the session's budget", () => {
    const profile = practicalSaid(profileWith(withResults("A"), withResults("B")));
    expect(remainingThisSession(profile, freshSession(), NOW)).toBe(ENGINE.session.maxQuestions);
    expect(remainingThisSession(profile, { ...freshSession(), askedThisSession: ENGINE.session.maxQuestions - 2 }, NOW)).toBe(2);
    expect(remainingThisSession(profile, { ...freshSession(), askedThisSession: ENGINE.session.maxQuestions }, NOW)).toBe(0);
  });

  it("holds the one-tap ones to theirs, apart", () => {
    const profile = emptyStoredProfile();
    for (const name of ["Inglés", "Francés", "Alemán"]) {
      profile.languages.push({ id: `l-${name}`, name: { value: name, status: "confirmed" }, level: { value: {}, status: "confirmed" } });
    }
    expect(remainingThisSession(profile, freshSession(), NOW)).toBe(ENGINE.session.maxQuick);
    expect(remainingThisSession(profile, { ...freshSession(), askedQuick: ENGINE.session.maxQuick - 1 }, NOW)).toBe(1);
  });

  it("counts the skeleton outside every budget", () => {
    const profile = profileWith({ company: "A", role: "x" });
    const spent = { ...freshSession(), askedThisSession: ENGINE.session.maxQuestions, askedQuick: ENGINE.session.maxQuick };
    expect(remainingThisSession(profile, spent, NOW)).toBe(1);
  });

  it("agrees with nextQuestion about whether there is anything left", () => {
    for (const profile of [profileWith(CURRENT), profileWith(withResults("A")), emptyStoredProfile()]) {
      const spent = { ...freshSession(), askedThisSession: ENGINE.session.maxQuestions, askedQuick: ENGINE.session.maxQuick };
      for (const session of [freshSession(), spent]) {
        expect(remainingThisSession(profile, session, NOW) > 0).toBe(nextQuestion(profile, session, NOW).kind === "gap");
      }
    }
  });
});

describe("asking for one question by name", () => {
  const ctx = { now: STAMP, newId };

  it("can be asked when it is still a gap", () => {
    const profile = profileWith(CURRENT);
    expect(isAskable(profile, `no_content:${profile.experience[0]!.id}`, NOW)).toBe(true);
  });

  it("cannot be asked when there is no such gap: it was answered, or it never existed", () => {
    const profile = profileWith({ ...CURRENT, facts: [{ text: "Llevo las campañas" }] });
    expect(isAskable(profile, `no_content:${profile.experience[0]!.id}`, NOW)).toBe(false);
    expect(isAskable(profile, "no_content:nobody", NOW)).toBe(false);
  });

  it("can be asked after 'ahora no' or 'más tarde': asking for it is choosing to answer it now", () => {
    const profile = profileWith(CURRENT);
    const found = detectGaps(profile, NOW).find((gap) => gap.rule === "no_content")!;
    deferQuestion(profile, found, "skipped", ctx);
    expect(isAskable(profile, found.id, NOW)).toBe(true);
    deferQuestion(profile, found, "later", ctx);
    expect(isAskable(profile, found.id, NOW)).toBe(true);
  });

  it("cannot be asked once turned down for good", () => {
    const profile = profileWith(CURRENT);
    const found = detectGaps(profile, NOW).find((gap) => gap.rule === "no_content")!;
    deferQuestion(profile, found, "na", ctx);
    expect(isAskable(profile, found.id, NOW)).toBe(false);
  });
});

describe("the practical facts", () => {
  const withProject = (profile: StoredProfile, description = "Un sitio para un club") => {
    profile.projects.push(projectSchema.parse({ id: "p1", name: { value: "Sitio del club", status: "confirmed" }, description: { value: description, status: "confirmed" } }));
    return profile;
  };

  it("are asked once there is something to attach them to: a job, a study or a project", () => {
    expect(rules(profileWith(CURRENT))).toContain("practical");
    expect(rules(emptyStoredProfile())).not.toContain("practical");

    const studying = emptyStoredProfile();
    addStudy(studying);
    expect(rules(studying)).toContain("practical");
    expect(rules(withProject(emptyStoredProfile()))).toContain("practical");
  });

  it("are asked once, as one question, whoever's profile it is", () => {
    const found = detectGaps(profileWith(CURRENT), NOW).filter((gap) => gap.rule === "practical");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ id: "practical:all", priority: "low" });
    expect(found[0]!.experienceId).toBeUndefined();
  });

  it("are not asked once anything about them is said, however it got there", () => {
    for (const said of [{ availability: "Tiempo completo" }, { driverLicense: "B1" }, { workEligibility: "Ciudadanía" }, { ownVehicle: true }, { willingToRelocate: true }]) {
      const profile = profileWith(CURRENT);
      profile.legacy.practical = { value: { availability: "", driverLicense: "", workEligibility: "", ownVehicle: false, willingToRelocate: false, ...said }, status: "confirmed" };
      expect(rules(profile), JSON.stringify(said)).not.toContain("practical");
    }
  });

  it("are the lowest of the quick questions, and never get ahead of what a job is missing", () => {
    const quick = Object.keys(PRIORITY).filter((rule) => PRIORITY[rule as keyof typeof PRIORITY] === "low" && rule !== "practical");
    for (const rule of quick) expect(WEIGHT.practical, rule).toBeLessThan(WEIGHT[rule as keyof typeof WEIGHT]);

    const profile = profileWith(CURRENT);
    profile.languages.push({ id: "l1", name: { value: "Inglés", status: "confirmed" }, level: { value: {}, status: "confirmed" } });
    expect(eligibleGaps(profile, freshSession(), NOW).map((gap) => gap.rule)).toEqual(["no_content", "language_no_level", "practical"]);
  });

  it("are not made likelier by a phone: a card with five fields is not one tap", () => {
    const profile = profileWith(CURRENT);
    const found = detectGaps(profile, NOW).find((gap) => gap.rule === "practical")!;
    expect(priorityOf(found, profile, NOW, { compact: true })).toBe(priorityOf(found, profile, NOW, { compact: false }));
  });

  it("count against the quick limit, so they are the last thing a session gives room to", () => {
    const profile = profileWith(CURRENT);
    const next = (askedQuick: number) => nextQuestion({ ...profile }, { ...freshSession(), askedThisSession: ENGINE.session.maxQuestions, askedQuick }, NOW);
    expect(next(0)).toMatchObject({ kind: "gap", gap: { rule: "practical" } });
    expect(next(ENGINE.session.maxQuick).kind).toBe("budget");
  });

  it("are not asked inside a question loop about one job", () => {
    const profile = profileWith(CURRENT);
    expect(eligibleGaps(profile, freshSession(), NOW, { only: profile.experience[0]!.id }).map((gap) => gap.rule)).not.toContain("practical");
  });

  it("are never asked again once turned down, and wait for the next session once put off", () => {
    const ctx = { now: STAMP, newId };
    const profile = profileWith(CURRENT);
    const found = () => detectGaps(profile, NOW).find((gap) => gap.rule === "practical")!;

    deferQuestion(profile, found(), "skipped", ctx);
    const nextSession = { ...freshSession(), startedAt: new Date(NOW.getTime() + 3_600_000).toISOString() };
    expect(eligibleGaps(profile, freshSession(), NOW).map((gap) => gap.rule)).not.toContain("practical");
    expect(eligibleGaps(profile, nextSession, NOW).map((gap) => gap.rule)).toContain("practical");

    deferQuestion(profile, found(), "na", ctx);
    expect(eligibleGaps(profile, freshSession(), NOW).map((gap) => gap.rule)).not.toContain("practical");
    expect(isAskable(profile, "practical:all", NOW)).toBe(false);
  });
});

describe("a project nobody has said anything about", () => {
  const project = (name: string, description: string) =>
    projectSchema.parse({ id: `p-${name}`, name: { value: name, status: "confirmed" }, description: { value: description, status: "confirmed" } });

  it("is asked about when its name is all there is", () => {
    const profile = emptyStoredProfile();
    profile.projects.push(project("Tienda online", ""));
    const found = detectGaps(profile, NOW).find((gap) => gap.rule === "project_no_description")!;
    expect(found).toMatchObject({ id: "project_no_description:p-Tienda online", priority: "medium", payload: { projectId: "p-Tienda online" } });
  });

  it("is not, once it says what it is, or when it has no name", () => {
    const profile = emptyStoredProfile();
    profile.projects.push(project("Tienda online", "Una tienda para un negocio de barrio"), project("", ""));
    expect(rules(profile)).not.toContain("project_no_description");
  });

  it("is asked once for each, and each by its own id", () => {
    const profile = emptyStoredProfile();
    profile.projects.push(project("Tienda online", ""), project("App de turnos", ""));
    expect(detectGaps(profile, NOW).filter((gap) => gap.rule === "project_no_description").map((gap) => gap.id)).toEqual([
      "project_no_description:p-Tienda online",
      "project_no_description:p-App de turnos",
    ]);
  });

  it("is worth more to someone with no job than to someone who has one, for whom it is behind what a job is missing", () => {
    const alone = emptyStoredProfile();
    alone.projects.push(project("Tienda online", ""));
    const found = detectGaps(alone, NOW).find((gap) => gap.rule === "project_no_description")!;
    expect(priorityOf(found, alone, NOW)).toBe(WEIGHT.project_no_description * ENGINE.relevance.projectIsTheWork);

    const working = profileWith(CURRENT);
    working.projects.push(project("Tienda online", ""));
    expect(priorityOf(found, working, NOW)).toBe(WEIGHT.project_no_description);
    expect(eligibleGaps(working, freshSession(), NOW).map((gap) => gap.rule).slice(0, 2)).toEqual(["no_content", "project_no_description"]);
  });

  it("comes first when it is what the profile has: the question that makes a profile useful without a job", () => {
    const alone = emptyStoredProfile();
    alone.onboarding.situation = "student";
    alone.projects.push(project("Tienda online", ""));
    expect(eligibleGaps(alone, freshSession(), NOW)[0]).toMatchObject({ rule: "project_no_description" });
  });

  it("can be asked for by name, and is not asked inside a question loop about one job", () => {
    const profile = profileWith(CURRENT);
    profile.projects.push(project("Tienda online", ""));
    expect(isAskable(profile, "project_no_description:p-Tienda online", NOW)).toBe(true);
    expect(eligibleGaps(profile, freshSession(), NOW, { only: profile.experience[0]!.id }).map((gap) => gap.rule)).not.toContain("project_no_description");
  });

  it("counts against the session like any question that is not about a job, and against no job's limit", () => {
    const profile = emptyStoredProfile();
    profile.projects.push(project("Tienda online", ""));
    // The practical question is a quick one and has its own limit: spent too, so it is the project's that is left.
    const session = { ...freshSession(), askedThisSession: ENGINE.session.maxQuestions, askedQuick: ENGINE.session.maxQuick };
    expect(nextQuestion(profile, session, NOW).kind).toBe("budget");
    expect(nextQuestion(profile, { ...session, askedThisSession: 0 }, NOW)).toMatchObject({ kind: "gap", gap: { rule: "project_no_description" } });
  });
});

describe("a line that says much and not how much", () => {
  const vague = (facts: Array<{ text: string; kind?: "responsibility" | "achievement"; metric?: { value: string; unit: string; approx: boolean } }>, job: JobSpec = CURRENT) => profileWith({ ...job, facts });

  it("asks how much, about the words as written, for a duty that says «muchos clientes» and has no number", () => {
    const profile = vague([{ text: "Atendía a muchos clientes" }]);
    const found = detectGaps(profile, NOW).filter((entry) => entry.rule === "vague_scale");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ priority: "medium", experienceId: profile.experience[0]!.id, payload: { factId: profile.experience[0]!.facts[0]!.id, phrase: "muchos clientes", flavor: "count" } });
    expect(found[0]!.id).toBe(`vague_scale:${profile.experience[0]!.id}:${profile.experience[0]!.facts[0]!.id}`);
  });

  it("weighs just under the figure of a result and above what a job only adds", () => {
    expect(WEIGHT.vague_scale).toBeLessThan(WEIGHT.achievement_no_figure);
    expect(WEIGHT.vague_scale).toBeGreaterThan(WEIGHT.more_achievements);
    expect(PRIORITY.vague_scale).toBe("medium");
  });

  it("does not ask when the line already has a number, or was given one, or says a stretch of time", () => {
    expect(rules(vague([{ text: "Atendía a muchos clientes, unos 40 por día" }]))).not.toContain("vague_scale");
    expect(rules(vague([{ text: "Atendía a muchos clientes", metric: { value: "150", unit: "clientes", approx: true } }]))).not.toContain("vague_scale");
    expect(rules(vague([{ text: "Trabajé varios años en el local" }]))).not.toContain("vague_scale");
    expect(rules(vague([{ text: "Muchas gracias a todo el equipo" }]))).not.toContain("vague_scale");
  });

  it("does not ask twice about a line that reports a result: that one is the figure of an achievement", () => {
    const profile = vague([{ kind: "achievement", text: "Atendí a muchos clientes nuevos" }, { text: "Aumenté la venta atendiendo a muchos clientes" }]);
    expect(rules(profile).filter((rule) => rule === "vague_scale")).toEqual([]);
    expect(rules(profile).filter((rule) => rule === "achievement_no_figure")).toHaveLength(2);
  });

  it("asks once for each line that says it", () => {
    const profile = vague([{ text: "Atendía a muchos clientes" }, { text: "Cargaba pedidos a diario" }, { text: "Armo los pedidos del local" }]);
    const found = detectGaps(profile, NOW).filter((entry) => entry.rule === "vague_scale");
    expect(found.map((entry) => entry.payload.flavor)).toEqual(["count", "frequency"]);
  });

  it("knows the answer is already there once the line has a number, or a figure was given", () => {
    const profile = vague([{ text: "Atendía a muchos clientes" }]);
    const found = detectGaps(profile, NOW).find((entry) => entry.rule === "vague_scale")!;
    expect(alreadyKnown(found, profile)).toBe(false);
    profile.experience[0]!.facts[0]!.metric = { value: "40", unit: "clientes por día", approx: true };
    expect(alreadyKnown(found, profile)).toBe(true);
    profile.experience[0]!.facts[0]!.metric = undefined;
    profile.experience[0]!.facts[0]!.text = "Atendía a muchos clientes: 40 por día";
    expect(alreadyKnown(found, profile)).toBe(true);
  });

  it("is a job's own, held to its budget, and goes after what the job is missing", () => {
    const profile = vague([{ text: "Atendía a muchos clientes" }]);
    // The job tells no result, and that comes first: «¿Hubo algo que mejorara…?», then what else was done (a job told in
    // one line), and the quantity of the line last.
    const asked = (candidate: StoredProfile) => eligibleGaps(candidate, freshSession(), NOW).map((entry) => entry.rule).filter((rule) => rule !== "practical");
    expect(asked(profile)).toEqual(["no_achievements", "thin_content", "vague_scale"]);
    const spent = { ...freshSession(), askedByExperience: { [profile.experience[0]!.id]: ENGINE.session.maxPerExperience } };
    expect(eligibleGaps(profile, spent, NOW).map((entry) => entry.rule)).not.toContain("vague_scale");
  });

  it("is not asked about an old job, which stays a skeleton", () => {
    const old = vague([{ text: "Atendía a muchos clientes" }], { company: "Vieja SA", role: "Cajero", from: { year: 2008, month: 1 }, to: { year: 2012, month: 1 } });
    expect(eligibleGaps(old, freshSession(), NOW).map((entry) => entry.rule)).not.toContain("vague_scale");
  });

  it("stops where the figures of results stop: «En mi trabajo no se miden cifras», and «no lo sé» twice for a job that ended a while ago", () => {
    const profile = vague([{ text: "Atendía a muchos clientes" }]);
    expect(eligibleGaps(profile, freshSession(), NOW).map((entry) => entry.rule)).toContain("vague_scale");
    profile.fatigue.achievement_no_figure = { skipped: 0, unknown: 0, off: true };
    expect(eligibleGaps(profile, freshSession(), NOW).map((entry) => entry.rule)).not.toContain("vague_scale");

    const past = vague([{ text: "Atendía a muchos clientes" }], { company: "Grupo Lumen", role: "Asistente", from: { year: 2019, month: 1 }, to: { year: 2023, month: 3 } });
    expect(eligibleGaps(past, freshSession(), NOW).map((entry) => entry.rule)).toContain("vague_scale");
    past.fatigue.achievement_no_figure = { skipped: 0, unknown: ENGINE.figureUnknownStopAfter };
    expect(eligibleGaps(past, freshSession(), NOW).map((entry) => entry.rule)).not.toContain("vague_scale");
  });

  it("is asked in the words of the quantity, with the shape of the answer and the same control as a figure", () => {
    const profile = vague([{ text: "Atendía a muchos clientes" }, { text: "Cargaba pedidos a diario" }]);
    const [count, frequency] = detectGaps(profile, NOW).filter((entry) => entry.rule === "vague_scale").map((entry) => questionFor(entry, profile));
    expect(count).toMatchObject({
      text: "Dijiste «muchos clientes»: ¿qué cantidad, más o menos?",
      control: { kind: "figure", quote: "Atendía a muchos clientes" },
    });
    expect(count!.hint).toBe("Con su unidad, si es por período: 40 por día, 150 por mes. Una cifra aproximada vale.");
    expect(frequency!.text).toBe("Dijiste «a diario»: ¿qué cantidad por día, más o menos?");
  });

  it("keeps the answer as the line's figure, and the line's words untouched", () => {
    const profile = vague([{ text: "Atendía a muchos clientes" }]);
    const found = detectGaps(profile, NOW).find((entry) => entry.rule === "vague_scale")!;
    const fact = profile.experience[0]!.facts[0]!;
    expect(answerFigure(profile, found, fact.id, { kind: "exact", value: "150", unit: "clientes por mes", approx: true })).toBe(true);
    expect(fact.text).toBe("Atendía a muchos clientes");
    expect(fact.metric).toEqual({ value: "150", unit: "clientes por mes", approx: true });
    expect(factToBullet(fact)).toBe("Atendía a muchos clientes — aprox. 150 clientes por mes");
    expect(rules(profile)).not.toContain("vague_scale");
  });

  it("is a number to add if it turns up when the person does not know it", () => {
    const profile = vague([{ text: "Atendía a muchos clientes" }]);
    const found = detectGaps(profile, NOW).find((entry) => entry.rule === "vague_scale")!;
    const fact = profile.experience[0]!.facts[0]!;
    answerFigure(profile, found, fact.id, { kind: "unknown" });
    expect(rules(profile)).not.toContain("vague_scale");
    expect(pendingItems(profile, NOW)).toContainEqual(expect.objectContaining({ kind: "figure", factId: fact.id, label: "La cifra de «Atendía a muchos clientes»" }));
  });

  it("is a line in a list with the same words as the figure of a result", () => {
    const profile = vague([{ text: "Atendía a muchos clientes" }]);
    const found = detectGaps(profile, NOW).find((entry) => entry.rule === "vague_scale")!;
    expect(labelFor(found, profile)).toBe("La cifra de «Atendía a muchos clientes»");
  });
});

describe("a job told in too few words", () => {
  const thin = (facts: Array<{ text: string; kind?: "responsibility" | "achievement" | "tool" }>, job: Partial<JobSpec> = {}) => profileWith({ ...CURRENT, ...job, facts });
  const found = (profile: StoredProfile) => detectGaps(profile, NOW).filter((entry) => entry.rule === "thin_content");

  it("asks what else was done in a recent job told in one line", () => {
    const profile = thin([{ text: "Atención al público" }]);
    expect(found(profile)).toHaveLength(1);
    expect(found(profile)[0]).toMatchObject({ id: `thin_content:${profile.experience[0]!.id}`, priority: "medium", experienceId: profile.experience[0]!.id });
    expect(WEIGHT.thin_content).toBeGreaterThan(WEIGHT.more_achievements);
    expect(WEIGHT.thin_content).toBeLessThan(WEIGHT.no_achievements);
  });

  it("asks it too of lines that are each shorter than five words, however many", () => {
    expect(found(thin([{ text: "Atención al público" }, { text: "Caja y arqueo" }, { text: "Reposición" }]))).toHaveLength(1);
  });

  it("does not ask it of a job told in lines long enough to read", () => {
    expect(found(thin([{ text: "Atendía a los clientes del local en el mostrador" }, { text: "Hacía el cierre de caja y el arqueo cada día" }]))).toEqual([]);
    expect(found(thin([{ text: "Atención al público" }, { text: "Hacía el cierre de caja y el arqueo cada día" }]))).toEqual([]);
  });

  it("does not ask it of a job that tells a result: that is what a CV leans on", () => {
    expect(found(thin([{ kind: "achievement", text: "Subí las ventas" }]))).toEqual([]);
    expect(found(thin([{ text: "Atención al público" }, { text: "Reduje los tiempos de entrega" }]))).toEqual([]);
  });

  it("is not for a job with nothing under it (that is «¿De qué te encargabas?»), and the tools beside a line are not lines", () => {
    expect(found(thin([]))).toEqual([]);
    expect(rules(thin([]))).toContain("no_content");
    expect(found(thin([{ kind: "tool", text: "Excel" }, { text: "Atención al público" }]))).toHaveLength(1);
  });

  it("is for a job that is going on or ended a few years ago, and not for an old one", () => {
    expect(found(thin([{ text: "Atención al público" }], { to: "current" }))).toHaveLength(1);
    expect(found(thin([{ text: "Atención al público" }], { from: { year: 2023, month: 1 }, to: { year: 2025, month: 6 } }))).toHaveLength(1);
    expect(found(thin([{ text: "Atención al público" }], { from: { year: 2015, month: 1 }, to: { year: 2019, month: 6 } }))).toEqual([]);
  });

  it("is not asked again once the person answered it, even if what they said is short", () => {
    const profile = thin([{ text: "Atención al público" }]);
    const ask = found(profile)[0]!;
    answerNarrative(profile, ask, profile.experience[0]!.id, "Caja", {}, { newId, now: STAMP });
    expect(profile.experience[0]!.facts.map((fact) => fact.text)).toEqual(["Atención al público", "Caja"]);
    expect(found(profile)).toEqual([]);
  });

  it("credits what is said to the question that asked it, and counts it once", () => {
    const profile = thin([{ text: "Atención al público" }]);
    const ask = found(profile)[0]!;
    const created = answerNarrative(profile, ask, profile.experience[0]!.id, "Cierre de caja. Arqueo diario.", {}, { newId, now: STAMP });
    expect(created).toHaveLength(2);
    expect(created.every((fact) => fact.source.kind === "answer" && fact.source.questionId === ask.id)).toBe(true);
    expect(profile.onboarding.askedThisSession).toBe(1);
  });

  it("is asked in the words of the line, or of «lo que ya contaste» when there are several, in the tense of the job", () => {
    const one = thin([{ text: "Atención al público" }]);
    expect(questionFor(found(one)[0]!, one)).toMatchObject({ text: "Además de «Atención al público», ¿qué más hacés en Nubia Retail?", control: { kind: "narrative" } });
    const past = thin([{ text: "Atención al público" }], { to: { year: 2025, month: 6 } });
    expect(questionFor(found(past)[0]!, past).text).toBe("Además de «Atención al público», ¿qué más hacías en Nubia Retail?");
    const several = thin([{ text: "Atención al público" }, { text: "Caja y arqueo" }]);
    expect(questionFor(found(several)[0]!, several).text).toBe("Además de lo que ya contaste, ¿qué más hacés en Nubia Retail?");
  });

  it("starts from what the person said at the start about this job and has not made a task of yet, never from what is a task already", () => {
    const profile = thin([{ text: "Atención al público" }]);
    profile.notes.push({ id: "n1", text: "Trabajé en Nubia Retail y atendía al público. En Nubia Retail también hacía el cierre de caja.", source: { kind: "manual", at: STAMP } } as never);
    const question = questionFor(found(profile)[0]!, profile);
    expect(question.control).toMatchObject({ kind: "narrative", initial: expect.stringContaining("cierre de caja") });
    expect(question.hint).toContain("Escribilo o dictalo");
  });

  it("goes after what the job is missing and before what it only adds to", () => {
    const profile = thin([{ text: "Atención al público" }]);
    expect(eligibleGaps(profile, freshSession(), NOW).map((entry) => entry.rule).filter((rule) => rule !== "practical")).toEqual(["no_achievements", "thin_content"]);
  });

  it("is not asked in the session where the person just told the job in answer to «¿De qué te encargabas?»", () => {
    const profile = profileWith({ ...CURRENT, facts: [] });
    const ask = detectGaps(profile, NOW).find((entry) => entry.rule === "no_content")!;
    answerNarrative(profile, ask, profile.experience[0]!.id, "Atención al público", {}, { newId, now: STAMP });
    // Same session: what they had to say about the job was just said.
    expect(eligibleGaps(profile, freshSession(), NOW).map((entry) => entry.rule)).not.toContain("thin_content");
    // A later one: now it is a thin job like any other.
    const later = { ...freshSession(), startedAt: new Date(NOW.getTime() + 86_400_000).toISOString() };
    expect(eligibleGaps(profile, later, NOW).map((entry) => entry.rule)).toContain("thin_content");
  });

  it("is turned down for good by «No aplica»", () => {
    const profile = thin([{ text: "Atención al público" }]);
    deferQuestion(profile, found(profile)[0]!, "na", { newId, now: STAMP });
    expect(eligibleGaps(profile, freshSession(), NOW).map((entry) => entry.rule)).not.toContain("thin_content");
  });

  it("is a line in a list", () => {
    const profile = thin([{ text: "Atención al público" }]);
    expect(labelFor(found(profile)[0]!, profile)).toBe("Qué más hacías en Nubia Retail");
  });
});

describe("a course or a license, for someone with no work yet", () => {
  const nothing = (situation: "student" | "first_job" | "experienced" | undefined = "student") => {
    const profile = profileWith();
    if (situation) profile.onboarding.situation = situation as never;
    return profile;
  };

  it("is asked once of a student with no job and nothing listed", () => {
    const found = detectGaps(nothing(), NOW).find((entry) => entry.rule === "no_certifications");
    expect(found).toMatchObject({ id: "no_certifications:all", priority: "medium" });
  });

  it("is asked of whoever started from scratch with no job, whatever their situation", () => {
    const profile = nothing(undefined);
    profile.onboarding.route = "scratch";
    expect(rules(profile)).toContain("no_certifications");
  });

  it("is not asked of someone who has a job, or who already listed one", () => {
    const withJob = profileWith({ ...CURRENT, facts: [{ text: "Armo los pedidos del local" }] });
    withJob.onboarding.situation = "student";
    expect(rules(withJob)).not.toContain("no_certifications");

    const listed = nothing();
    addEntry(listed, { ...blankForm("certification"), what: "Curso de Excel" }, { newId, now: STAMP });
    expect(rules(listed)).not.toContain("no_certifications");
  });

  it("is not asked of someone who did not start from scratch and is not a student", () => {
    expect(rules(nothing("experienced"))).not.toContain("no_certifications");
  });

  it("comes after the question about work, and weighs less than it", () => {
    expect(WEIGHT.no_certifications).toBeLessThan(WEIGHT.no_work_experience);
    const order = eligibleGaps(nothing(), freshSession(), NOW).map((entry) => entry.rule);
    expect(order.indexOf("no_work_experience")).toBeLessThan(order.indexOf("no_certifications"));
  });

  it("is turned down for good by «Ninguno», which settles it as «No aplica» does", () => {
    const profile = nothing();
    const found = detectGaps(profile, NOW).find((entry) => entry.rule === "no_certifications")!;
    deferQuestion(profile, found, "na", { newId, now: STAMP });
    expect(eligibleGaps(profile, freshSession(), NOW).map((entry) => entry.rule)).not.toContain("no_certifications");
  });

  it("is asked in the words of a person with a course or a license, and adds only that: a course or a certificate", () => {
    const profile = nothing();
    const found = detectGaps(profile, NOW).find((entry) => entry.rule === "no_certifications")!;
    expect(questionFor(found, profile)).toMatchObject({
      text: "¿Hiciste algún curso o tenés alguna licencia?",
      hint: "Cualquier cosa cuenta: un curso, un taller, una licencia o una credencial.",
      control: { kind: "extra", kinds: ["certification"], decline: "Ninguno" },
    });
    expect(labelFor(found, profile)).toBe("Cursos o licencias");
  });

  it("does not change the question about work: it still adds a practice, a project or volunteering", () => {
    const profile = nothing();
    const found = detectGaps(profile, NOW).find((entry) => entry.rule === "no_work_experience")!;
    expect(questionFor(found, profile).control).toEqual({ kind: "extra" });
  });
});
