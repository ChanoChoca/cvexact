import { describe, expect, it } from "vitest";
import { ENGINE } from "@/lib/onboarding/config";
import { countLine, keyOf, repeatedRequirement, type SeenOffer } from "@/lib/jobs/repeated";
import { toPlainProfile } from "@/lib/profile/project";
import { declineThings } from "@/lib/profile/declined";
import { emptyStoredProfile, type StoredProfile } from "@/lib/schemas/profile-v2";
import { NOW, STAMP, withJob } from "./helpers/profiles";

/**
 * O10: what comes up in several of the offers the person analysed, asked once (`lib/jobs/repeated.ts`). The conditions are the ones of the report that
 * proposed it, each held on its own: how many of how many, within how long, from how many employers, and what is never a question.
 */

const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

/** An offer with its own lines under «Requisitos:», analysed `days` ago, posted by `company`. */
const offer = (id: string, days: number, company: string | undefined, ...lines: string[]): SeenOffer => ({
  id,
  createdAt: ago(days),
  jobText: [`Oferta ${id}`, "", "Requisitos:", ...lines.map((line) => `- ${line}`)].join("\n"),
  ...(company === undefined ? {} : { analysis: { company } }),
});

const profileOf = (stored: StoredProfile = emptyStoredProfile()) => ({ profile: toPlainProfile(stored), stored });
const ask = (offers: SeenOffer[], stored?: StoredProfile) => repeatedRequirement({ offers, ...profileOf(stored), now: NOW });

const EXCEL_THREE = [
  offer("a", 2, "Nubia Retail", "Manejo de Excel"),
  offer("b", 5, "Grupo Lumen", "Manejo de Excel (excluyente)"),
  offer("c", 9, "Casa Verde", "Manejo de Excel", "Buena presencia"),
];

describe("what repeats", () => {
  it("is a thing in 3 of the last offers, from 2 employers or more, and is asked as a count of what they saw", () => {
    const found = ask(EXCEL_THREE);
    expect(found).toMatchObject({ kind: "tool", type: "tool", thing: "Excel", key: "tool:excel", count: 3, of: 3 });
    expect(found!.question).toBe("¿Usaste Excel en algún trabajo, curso o proyecto?");
    // The line is the one of the most recent offer that says it, as that offer wrote it.
    expect(found!.fragment).toBe("Manejo de Excel");
    expect(countLine(found!)).toBe("Aparece en 3 de las últimas 3 ofertas que analizaste.");
  });

  it("says nothing of what it would do for them: the count is a count", () => {
    const line = countLine(ask(EXCEL_THREE)!);
    expect(line).not.toMatch(/chances|te falta|las empresas|%|para conseguir|necesit/i);
    expect(line).toMatch(/^Aparece en \d+ de las últimas \d+ ofertas que analizaste\.$/);
  });

  it("is nothing with two offers: three is the least that tells what repeats from what happened", () => {
    expect(ask(EXCEL_THREE.slice(0, 2))).toBeNull();
    expect(ask([])).toBeNull();
    expect(ENGINE.repeated).toEqual({ lastOffers: 10, withinDays: 90, minOffers: 3, minEmployers: 2 });
  });

  it("is nothing when it is one employer: a posting republished is not three", () => {
    const one = [offer("a", 2, "Nubia Retail", "Manejo de Excel"), offer("b", 5, "Nubia Retail S.A.", "Manejo de Excel"), offer("c", 9, "nubia retail", "Manejo de Excel")];
    expect(ask(one)).toBeNull();
  });

  it("counts an offer that names no employer as one employer more, never as several", () => {
    const unnamed = [offer("a", 2, undefined, "Manejo de Excel"), offer("b", 5, undefined, "Manejo de Excel"), offer("c", 9, undefined, "Manejo de Excel")];
    expect(ask(unnamed)).toBeNull();
    const mixed = [offer("a", 2, undefined, "Manejo de Excel"), offer("b", 5, undefined, "Manejo de Excel"), offer("c", 9, "Casa Verde", "Manejo de Excel")];
    expect(ask(mixed)).toMatchObject({ thing: "Excel", count: 3 });
  });

  it("is nothing when every offer calls it a nicety, and something when one does not", () => {
    const nice = [
      offer("a", 2, "Nubia Retail", "Manejo de Excel (deseable)"),
      offer("b", 5, "Grupo Lumen", "Se valora manejo de Excel"),
      offer("c", 9, "Casa Verde", "Manejo de Excel (valorable)"),
    ];
    expect(ask(nice)).toBeNull();
    expect(ask([...nice.slice(0, 2), offer("c", 9, "Casa Verde", "Manejo de Excel")])).toMatchObject({ thing: "Excel", count: 3 });
  });

  it("counts a posting once, however many times it was analysed, and a thing once in a posting that says it twice", () => {
    const again = [
      offer("a", 2, "Nubia Retail", "Manejo de Excel"),
      { ...offer("b", 3, "Grupo Lumen", "Manejo de Excel"), jobText: offer("a", 2, "Nubia Retail", "Manejo de Excel").jobText },
      offer("c", 5, "Casa Verde", "Manejo de Excel", "Excel avanzado"),
    ];
    expect(ask(again)).toBeNull();
  });
});

describe("how far back, and how many", () => {
  it("looks 90 days back and no further", () => {
    const old = [offer("a", 2, "Nubia Retail", "Manejo de Excel"), offer("b", 80, "Grupo Lumen", "Manejo de Excel"), offer("c", 95, "Casa Verde", "Manejo de Excel")];
    expect(ask(old)).toBeNull();
    expect(ask([...old.slice(0, 2), offer("c", 89, "Casa Verde", "Manejo de Excel")])).toMatchObject({ count: 3 });
  });

  it("looks at the last 10, newest first, and says out of how many it looked", () => {
    const quiet = Array.from({ length: 8 }, (_, index) => offer(`q${index}`, 3 + index, `Empresa ${index}`, "Buena presencia"));
    // Three offers that ask for it, but the oldest two are the 11th and the 12th: out of the window.
    const found = ask([...quiet, offer("x", 20, "Nubia Retail", "Manejo de Excel"), offer("y", 21, "Grupo Lumen", "Manejo de Excel"), offer("z", 22, "Casa Verde", "Manejo de Excel")]);
    expect(found).toBeNull();
    const inside = ask([...quiet.slice(0, 7), offer("x", 2, "Nubia Retail", "Manejo de Excel"), offer("y", 4, "Grupo Lumen", "Manejo de Excel"), offer("z", 6, "Casa Verde", "Manejo de Excel")]);
    expect(inside).toMatchObject({ count: 3, of: 10 });
    expect(countLine(inside!)).toBe("Aparece en 3 de las últimas 10 ofertas que analizaste.");
  });

  it("ignores an offer that says it was analysed tomorrow, or on no day", () => {
    const odd = [...EXCEL_THREE.slice(0, 2), { ...offer("c", 9, "Casa Verde", "Manejo de Excel"), createdAt: "no es una fecha" }];
    expect(ask(odd)).toBeNull();
    expect(ask([...EXCEL_THREE.slice(0, 2), { ...offer("c", 9, "Casa Verde", "Manejo de Excel"), createdAt: new Date(NOW.getTime() + 3 * DAY).toISOString() }])).toBeNull();
  });
});

describe("what is never asked", () => {
  it("a trait, however many offers say it", () => {
    const traits = ["a", "b", "c", "d"].map((id, index) => offer(id, index + 1, `Empresa ${id}`, "Proactividad y buena presencia", "Capacidad de trabajar en equipo"));
    expect(ask(traits)).toBeNull();
  });

  it("what the profile already says", () => {
    const stored = emptyStoredProfile();
    withJob(stored, { company: "Acme", role: "Analista", from: { year: 2020 }, to: "current", facts: [{ text: "Armé los informes mensuales en Excel" }] });
    expect(ask(EXCEL_THREE, stored)).toBeNull();
  });

  it("what they said no to, until a year has gone by, and then once, with the day they said it", () => {
    const stored = emptyStoredProfile();
    declineThings(stored, "requirement", ["Excel"], { quote: "Manejo de Excel" }, { newId: () => "d1", now: ago(100) });
    expect(ask(EXCEL_THREE, stored)).toBeNull();
    const later = emptyStoredProfile();
    declineThings(later, "requirement", ["Excel"], { quote: "Manejo de Excel" }, { newId: () => "d1", now: ago(400) });
    expect(ask(EXCEL_THREE, later)).toMatchObject({ thing: "Excel", again: ago(400) });
  });
});

describe("which one, when there are several", () => {
  const offers = [
    offer("a", 1, "Nubia Retail", "Manejo de Excel", "Libreta sanitaria"),
    offer("b", 2, "Grupo Lumen", "Manejo de Excel", "Libreta sanitaria vigente"),
    offer("c", 3, "Casa Verde", "Manejo de Excel", "Libreta sanitaria"),
    offer("d", 4, "Verde Sur", "Manejo de Excel"),
  ];

  it("the one in most of the offers", () => {
    expect(ask(offers)).toMatchObject({ kind: "tool", thing: "Excel", count: 4 });
  });

  it("of those in as many, the one worth knowing first: what they hold before what they have used", () => {
    expect(ask(offers.slice(0, 3))).toMatchObject({ kind: "credential", count: 3 });
    expect(ask(offers.slice(0, 3))!.question).toBe("¿Tenés esa credencial?");
  });

  it("only one, never the list", () => {
    expect(Array.isArray(ask(offers))).toBe(false);
  });
});

describe("what two offers say in other words is one thing", () => {
  it("a tool by its name — the reader gives it as the glossary does, so «MS Excel» is read as «Excel» —, a task or a credential by the words that carry it, a condition by what it is", () => {
    expect(keyOf({ kind: "tool", thing: "Excel" })).toBe(keyOf({ kind: "tool", thing: "excel" }));
    expect(keyOf({ kind: "credential", thing: "Carnet de manipulación de alimentos" })).toBe(keyOf({ kind: "credential", thing: "carnet de manipulador de alimentos" }));
    expect(keyOf({ kind: "task", thing: "atención al público" })).not.toBe(keyOf({ kind: "task", thing: "manejo de caja" }));
    expect(keyOf({ kind: "license", thing: "Licencia de conducir" })).toBe("license");
    expect(keyOf({ kind: "availability", thing: "disponibilidad full time" })).toBe(keyOf({ kind: "availability", thing: "disponibilidad horaria" }));
  });

  it("«MS Excel», «Microsoft Excel avanzado» and «Excel» are three offers that ask for one tool", () => {
    const found = ask([offer("a", 1, "Nubia Retail", "Manejo de MS Excel"), offer("b", 2, "Grupo Lumen", "Microsoft Excel avanzado"), offer("c", 3, "Casa Verde", "Excel")]);
    expect(found).toMatchObject({ kind: "tool", thing: "Excel", key: "tool:excel", count: 3 });
  });

  it("a licence in three offers that word it three ways is one question: «¿Tenés licencia de conducir?»", () => {
    const found = ask([
      offer("a", 1, "Nubia Retail", "Licencia de conducir B1 (excluyente)"),
      offer("b", 2, "Grupo Lumen", "Carnet de conducir"),
      offer("c", 3, "Casa Verde", "Registro de conducir vigente"),
    ]);
    expect(found).toMatchObject({ kind: "license", type: "condition", thing: "Licencia de conducir", count: 3 });
    expect(found!.question).toBe("¿Tenés licencia de conducir?");
  });
});

describe("the date it was built for", () => {
  it("uses the fixed «now» of the tests for everything: the fixtures say when they were written", () => {
    expect(STAMP).toBe(NOW.toISOString());
  });
});
