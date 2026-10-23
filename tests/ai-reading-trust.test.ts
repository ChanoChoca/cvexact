import { beforeEach, describe, expect, it, vi } from "vitest";
import { ENGINE } from "@/lib/onboarding/config";
import { jobsAgree, studiesAgree, trustAgreeing } from "@/lib/parse/agree";
import { parseDocument } from "@/lib/parse";
import type { ParsedDocument } from "@/lib/parse/types";
import type { Extraction } from "@/lib/ai/prompts/extract";

/**
 * M14: the rule that would trust two readers that agree is written, tested and off.
 */

const generate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/client", () => ({ ApiError: class ApiError extends Error {}, callGenerator: generate }));
vi.mock("@/lib/onboarding/stores", () => ({
  ensureOnboardingStoresHydrated: async () => {},
  readCollection: () => ({}),
  writeCollection: () => {},
}));

const CV = `Ana Ruiz
ana@example.com

EXPERIENCIA
Café Martínez
Barista
2020 - 2023
Atención de la barra y cierre de caja.

Librería Cálamo
Vendedora
2017 - 2019
Atención al público.

FORMACIÓN
Universidad de Buenos Aires
Licenciatura en Administración
2015 - 2019`;

const quoted = (value: string, quote = value) => ({ value, quote });

const extraction = (overrides: Partial<Extraction> = {}): Extraction =>
  ({
    contact: { fullName: quoted("Ana Ruiz"), links: [] },
    experience: [
      { kind: "job", company: quoted("Café Martínez"), role: quoted("Barista"), city: null, country: null, start: quoted("2020", "2020 - 2023"), end: quoted("2023", "2020 - 2023"), facts: [quoted("Atención de la barra y cierre de caja.")] },
      // Not what the patterns read: the model put the wrong year, which a quote can still contain.
      { kind: "job", company: quoted("Librería Cálamo"), role: quoted("Vendedora"), city: null, country: null, start: quoted("2019", "2017 - 2019"), end: quoted("2019", "2017 - 2019"), facts: [quoted("Atención al público.")] },
    ],
    education: [{ institution: quoted("Universidad de Buenos Aires"), degree: quoted("Licenciatura en Administración"), city: null, country: null, start: quoted("2015", "2015 - 2019"), end: quoted("2019", "2015 - 2019"), honors: null }],
    certifications: [],
    languages: [],
    skills: [],
    projects: [],
    unassigned: [],
    ...overrides,
  }) as unknown as Extraction;

describe("two readers that agree", () => {
  const patterns = parseDocument({ text: CV })!;

  it("agree on a block with the same company, role and dates, in any case and with any accents", () => {
    const [café] = patterns.experience;
    expect(jobsAgree({ ...café!, company: quoted("CAFÉ MARTINEZ"), role: quoted("barista") }, patterns.experience)).toBe(true);
    expect(studiesAgree(patterns.education[0]!, patterns.education)).toBe(true);
  });

  it("do not when a date differs, or the company is another, or there is nothing to compare", () => {
    const [café] = patterns.experience;
    expect(jobsAgree({ ...café!, start: quoted("2019") as never }, patterns.experience)).toBe(false);
    expect(jobsAgree({ ...café!, company: quoted("Otra empresa") }, patterns.experience)).toBe(false);
    expect(jobsAgree({ ...café!, company: undefined }, patterns.experience)).toBe(false);
    expect(jobsAgree(café!, [])).toBe(false);
  });

  it("rate high the blocks both read the same, and leave the others as they were", () => {
    const ai: ParsedDocument = { ...parseDocument({ text: CV })!, via: "ai" };
    ai.experience = ai.experience.map((job, index) => ({ ...job, confidence: "medium", doubts: [], ...(index === 1 ? { start: { value: { year: 2016 }, quote: "2016" } } : {}) }));
    ai.education = ai.education.map((entry) => ({ ...entry, confidence: "medium" }));
    const trusted = trustAgreeing(ai, patterns);
    expect(trusted.experience.map((job) => job.confidence)).toEqual(["high", "medium"]);
    expect(trusted.education.map((entry) => entry.confidence)).toEqual(["high"]);
    // No second reading, no agreement.
    expect(trustAgreeing(ai, null)).toBe(ai);
  });
});

describe("the rule, in the reading with a model", () => {
  beforeEach(() => {
    generate.mockReset();
    generate.mockResolvedValue(extraction());
  });

  it("is off: every block a model read stays medium, whoever agrees", () => {
    expect(ENGINE.aiReading.trustAgreement).toBe(false);
  });

  it("changes nothing while it is off", async () => {
    const { extractWithAi } = await import("@/lib/onboarding/ai");
    const outcome = await extractWithAi(CV, "cv");
    expect(outcome.ok && [...outcome.result.experience, ...outcome.result.education].every((block) => block.confidence === "medium")).toBe(true);
  });

  it("rates high what the patterns read the same way when it is turned on, and not what they read differently", async () => {
    const settings = ENGINE.aiReading as { trustAgreement: boolean };
    settings.trustAgreement = true;
    try {
      const { extractWithAi } = await import("@/lib/onboarding/ai");
      const outcome = await extractWithAi(CV.replace("Ana Ruiz", "Ana Ruiz Pérez"), "cv");
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      const byCompany = Object.fromEntries(outcome.result.experience.map((job) => [job.company?.value, job.confidence]));
      expect(byCompany["Café Martínez"]).toBe("high");
      expect(byCompany["Librería Cálamo"]).toBe("medium");
      expect(outcome.result.education[0]!.confidence).toBe("high");
    } finally {
      settings.trustAgreement = false;
    }
  });
});
