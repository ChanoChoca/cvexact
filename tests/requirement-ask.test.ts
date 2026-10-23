import { describe, expect, it } from "vitest";
import { askMetric, chooseRequirementAsk, hasRoom, questionFor, type AskKind } from "@/lib/jobs/requirement-ask";
import { readRequirements } from "@/lib/jobs/requirements";
import { METRIC_NAMES } from "@/lib/metrics/counters";
import { ENGINE } from "@/lib/onboarding/config";
import { declineThings } from "@/lib/profile/declined";
import { emptyProfile, experienceSchema, type Profile } from "@/lib/schemas/profile";
import { emptyStoredProfile } from "@/lib/schemas/profile-v2";
import { NOW, STAMP } from "./helpers/profiles";

/**
 * The one question a posting puts: which, from what the offer asks and the profile says nothing about; and every case where it puts none.
 */

const DAY = 86_400_000;
const iso = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();
const ctx = (now: string = STAMP) => ({ now, newId: () => `c-${now}` });

const ask = (posting: string, options: { profile?: Profile; stored?: ReturnType<typeof emptyStoredProfile>; offered?: string[]; now?: Date } = {}) =>
  chooseRequirementAsk({
    requirements: readRequirements(posting),
    profile: options.profile ?? emptyProfile(),
    stored: options.stored ?? emptyStoredProfile(),
    ...(options.offered ? { offered: options.offered } : {}),
    now: options.now ?? NOW,
  });

const profileSaying = (patch: Partial<Profile>): Profile => ({ ...emptyProfile(), ...patch });

describe("which question is put", () => {
  const everything = [
    "Requisitos:",
    "- Experiencia en atención al público",
    "- Manejo de Excel",
    "- Disponibilidad full time",
    "- Matrícula de gasista vigente",
  ].join("\n");

  it("puts one, and the one most worth knowing: what they hold, then how they can work, then what they have used, then what they have done", () => {
    expect(ask(everything)).toMatchObject({ kind: "credential", type: "credential", thing: "Matrícula de gasista vigente" });
    expect(ask(everything.replace("\n- Matrícula de gasista vigente", ""))).toMatchObject({ kind: "availability", type: "condition" });
    expect(ask("Requisitos:\n- Experiencia en atención al público\n- Manejo de Excel")).toMatchObject({ kind: "tool", thing: "Excel" });
    expect(ask("Requisitos:\n- Experiencia en atención al público")).toMatchObject({ kind: "task", thing: "atención al público" });
  });

  it("puts the licence before the vehicle before the availability", () => {
    expect(ask("Requisitos:\n- Disponibilidad full time\n- Moto propia\n- Licencia de conducir B1")?.kind).toBe("license");
    expect(ask("Requisitos:\n- Disponibilidad full time\n- Moto propia")?.kind).toBe("vehicle");
  });

  it("puts what the offer calls indispensable before what it does not say, and then follows its order", () => {
    expect(ask("Requisitos:\n- Manejo de Excel\n- Manejo de Word (excluyente)")?.thing).toBe("Word");
    expect(ask("Requisitos:\n- Manejo de Excel\n- Manejo de Word")?.thing).toBe("Excel");
  });

  it("asks about one tool, even where the offer names three", () => {
    expect(ask("Requisitos:\n- Manejo de Photoshop, Illustrator e InDesign")).toMatchObject({ kind: "tool", thing: "Photoshop", fragment: "Manejo de Photoshop, Illustrator e InDesign" });
  });

  it("shows the offer's own line, as it says it", () => {
    expect(ask("Requisitos:\n- Licencia de conducir B1 (excluyente)")).toMatchObject({ fragment: "Licencia de conducir B1 (excluyente)", obligation: "required" });
  });

  it("names a licence and a vehicle by what they are, so that a «no» to one offer is a «no» to the next", () => {
    expect(ask("Requisitos:\n- Carnet de conducir")?.thing).toBe("Licencia de conducir");
    expect(ask("Requisitos:\n- Movilidad propia")?.thing).toBe("Vehículo propio");
  });
});

describe("what is not asked", () => {
  it("does not ask what the offer calls a nicety, nor a trait, nor age or looks or schooling or languages", () => {
    expect(ask("Requisitos:\n- Manejo de Excel (deseable)\n- Proactividad y buen trato\n- Mayor de 21 años\n- Buena presencia\n- Secundario completo\n- Inglés avanzado")).toBeNull();
  });

  it("does not ask what has no place in a profile: the zone, travel, one's own tools", () => {
    expect(ask("Requisitos:\n- Residir en zona sur\n- Disponibilidad para viajar\n- Herramientas propias")).toBeNull();
  });

  it("does not ask about a posting that asks for nothing it can read", () => {
    expect(ask("Somos una empresa joven con ganas de crecer.")).toBeNull();
    expect(ask("")).toBeNull();
  });

  it("does not ask what the profile already says", () => {
    const posting = "Requisitos:\n- Manejo de Excel\n- Licencia de conducir B1\n- Moto propia\n- Disponibilidad full time\n- Permiso de trabajo vigente";
    expect(ask(posting, { profile: profileSaying({ skills: ["Excel"] }) })?.kind).toBe("license");
    expect(ask(posting, { profile: profileSaying({ skills: ["Excel"], practical: { ...emptyProfile().practical, driverLicense: "B1" } }) })?.kind).toBe("vehicle");
    expect(ask(posting, { profile: profileSaying({ skills: ["Excel"], practical: { ...emptyProfile().practical, driverLicense: "B1", ownVehicle: true } }) })?.kind).toBe("availability");
    expect(ask(posting, { profile: profileSaying({ skills: ["Excel"], practical: { ...emptyProfile().practical, driverLicense: "B1", ownVehicle: true, availability: "Full time" } }) })?.kind).toBe("documents");
    expect(
      ask(posting, {
        profile: profileSaying({ skills: ["Excel"], practical: { driverLicense: "B1", ownVehicle: true, availability: "Full time", workEligibility: "DNI argentino", willingToRelocate: false } }),
      }),
    ).toBeNull();
  });

  it("reads a profile that says it in other words as saying it", () => {
    const profile = profileSaying({
      experience: [experienceSchema.parse({ id: "e1", company: "Rappi", role: "Repartidor", start: "2022", current: true, bullets: ["Entregas en moto por Palermo"] })],
      certifications: [{ id: "c1", name: "Carnet de manipulación de alimentos", issuer: "", date: "" }],
    });
    // «Reparto» is what «Repartidor» does; the carnet is in the certifications.
    expect(ask("Requisitos:\n- Experiencia en reparto\n- Carnet de manipulación de alimentos vigente", { profile })).toBeNull();
  });

  it("does not ask what was said no to — until a year has gone by, and then once", () => {
    const posting = "Requisitos:\n- Manejo de Excel";
    const stored = emptyStoredProfile();
    declineThings(stored, "requirement", ["Excel"], { quote: "Manejo de Excel" }, ctx(iso(0)));
    expect(ask(posting, { stored, now: new Date(NOW.getTime() + 30 * DAY) })).toBeNull();

    const second = ask(posting, { stored, now: new Date(NOW.getTime() + 400 * DAY) });
    expect(second).toMatchObject({ kind: "tool", thing: "Excel", again: iso(0) });

    // The second asking was answered: it is the last.
    stored.declined[0]!.offeredAgainAt = iso(401);
    expect(ask(posting, { stored, now: new Date(NOW.getTime() + 800 * DAY) })).toBeNull();
  });

  it("does not ask what the person took back, as if it had been said no to", () => {
    const stored = emptyStoredProfile();
    declineThings(stored, "requirement", ["Excel"], {}, ctx(iso(0)));
    stored.declined[0]!.withdrawnAt = iso(5);
    expect(ask("Requisitos:\n- Manejo de Excel", { stored, now: new Date(NOW.getTime() + 30 * DAY) })?.thing).toBe("Excel");
  });

  it("does not ask a tool in two places: the panel below is already offering it", () => {
    expect(ask("Requisitos:\n- Manejo de Excel y Word", { offered: ["excel"] })?.thing).toBe("Word");
    expect(ask("Requisitos:\n- Manejo de Excel", { offered: ["Excel"] })).toBeNull();
  });

  it("does not ask when the session has no room", () => {
    const stored = emptyStoredProfile();
    expect(hasRoom(stored)).toBe(true);
    stored.onboarding.askedThisSession = ENGINE.session.maxQuestions - 1;
    expect(ask("Requisitos:\n- Manejo de Excel", { stored })?.thing).toBe("Excel");
    stored.onboarding.askedThisSession = ENGINE.session.maxQuestions;
    expect(hasRoom(stored)).toBe(false);
    expect(ask("Requisitos:\n- Manejo de Excel", { stored })).toBeNull();
  });
});

describe("how it is asked", () => {
  const kinds: AskKind[] = ["tool", "task", "credential", "license", "vehicle", "availability", "documents"];

  it("in fixed words, in voseo, naming the thing where there is one and quoting nothing of what the market wants", () => {
    expect(questionFor("tool", "SAP")).toBe("¿Usaste SAP en algún trabajo, curso o proyecto?");
    expect(questionFor("task", "atención al público")).toBe("¿Lo hiciste en algún trabajo, curso o proyecto?");
    expect(questionFor("credential", "matrícula")).toBe("¿Tenés esa credencial?");
    expect(questionFor("license", "x")).toBe("¿Tenés licencia de conducir?");
    expect(questionFor("vehicle", "x")).toBe("¿Tenés vehículo propio?");
    expect(questionFor("availability", "x")).toBe("¿Tenés esa disponibilidad?");
    expect(questionFor("documents", "x")).toBe("¿Tenés la documentación al día?");
    for (const kind of kinds) {
      const text = questionFor(kind, "Excel");
      expect(text, kind).toMatch(/^¿.*\?$/);
      expect(text, kind).not.toMatch(/chances|empresas|atrás|necesit|deber|falta/i);
    }
  });

  it("counts what was asked and what was said under twelve counters of its own", () => {
    const names = (["tool", "task", "condition", "credential"] as const).flatMap((type) => (["done", "no", "later"] as const).map((outcome) => askMetric(type, outcome)));
    expect(names).toHaveLength(12);
    for (const name of names) expect(METRIC_NAMES).toContain(name);
  });

  it("is the same question for the same posting and the same profile", () => {
    const posting = "Requisitos:\n- Manejo de Excel\n- Matrícula de gasista";
    expect(ask(posting)).toEqual(ask(posting));
  });
});
