import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Extraction } from "@/lib/ai/prompts/extract";
import type { SplitResult } from "@/lib/ai/prompts/split";

/**
 * What a model is sent when it reads — a CV, a story, an answer — and what it is not: who the person is. And that what it says back is
 * put right before anything is checked, so a fact that names an address comes back with its address, and what comes of the contact is
 * read by the patterns and never by the model.
 */

const generate = vi.hoisted(() => vi.fn());
const store = vi.hoisted(() => new Map<string, Record<string, unknown>>());
const profile = vi.hoisted(() => ({ name: "" }));

vi.mock("@/lib/api/client", () => ({
  ApiError: class ApiError extends Error {
    reason?: string;
  },
  callGenerator: generate,
}));
vi.mock("@/lib/onboarding/stores", () => ({
  ensureOnboardingStoresHydrated: async () => {},
  readCollection: (name: string) => store.get(name) ?? {},
  writeCollection: (name: string, value: Record<string, unknown>) => void store.set(name, value),
}));
vi.mock("@/lib/storage/local", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/local")>();
  return { ...actual, loadStoredProfile: () => ({ contact: { fullName: { value: profile.name } } }) };
});

const CV = [
  "Lucía Pérez",
  "Analista de Marketing",
  "lucia.perez@example.com | +54 9 351 555-1234 | linkedin.com/in/perfil-ejemplo | Córdoba, Argentina",
  "",
  "EXPERIENCIA",
  "Nubia Retail",
  "Analista de Marketing",
  "2022 - 2024",
  "- Atendí los pedidos que llegaban a ventas@example.com todos los días.",
  "- Subí las ventas un 20 %.",
].join("\n");

const empty = (): Extraction =>
  ({ contact: { links: [] }, experience: [], education: [], certifications: [], languages: [], skills: [], projects: [], unassigned: [] }) as unknown as Extraction;

/** What a model answers to the text it was sent: a job, with the fact that names the address it was sent a mark for. */
const answerFor = (sent: string): Extraction => {
  const email = /\[CORREO_\d+\]/.exec(sent.split("\n").find((line) => line.includes("pedidos")) ?? "")![0];
  return {
    ...empty(),
    contact: {
      // What a model that ignored the instruction would say: the marks it was given, as if they were contact.
      fullName: { value: "[NOMBRE_1]", quote: "[NOMBRE_1]" },
      email: { value: "[CORREO_1]", quote: "[CORREO_1]" },
      phone: null,
      city: { value: "Córdoba", quote: "Córdoba, Argentina" },
      country: { value: "Argentina", quote: "Córdoba, Argentina" },
      headline: null,
      links: [],
    },
    experience: [
      {
        kind: "job",
        company: { value: "Nubia Retail", quote: "Nubia Retail" },
        role: { value: "Analista de Marketing", quote: "Analista de Marketing" },
        city: null,
        country: null,
        start: { value: "2022", quote: "2022" },
        end: { value: "2024", quote: "2024" },
        facts: [
          { value: `Atendí los pedidos que llegaban a ${email} todos los días.`, quote: `Atendí los pedidos que llegaban a ${email} todos los días.` },
          { value: "Subí las ventas un 20 %.", quote: "Subí las ventas un 20 %." },
        ],
      },
    ],
  } as unknown as Extraction;
};

describe("a CV read with a model", () => {
  beforeEach(() => {
    generate.mockReset();
    store.clear();
    profile.name = "";
    generate.mockImplementation(async (_path: string, body: { text: string }) => answerFor(body.text));
  });

  it("sends the text without the name, the email, the phone or the links of the person, and with what is read", async () => {
    const { extractWithAi } = await import("@/lib/onboarding/ai");
    await extractWithAi(CV, "cv");
    const body = generate.mock.calls[0]![1] as { text: string; kind: string };
    for (const secret of ["Lucía Pérez", "lucia.perez", "example.com", "351 555", "linkedin", "ventas@"]) expect(body.text, secret).not.toContain(secret);
    expect(body.text.split("\n")).toHaveLength(CV.split("\n").length);
    expect(body.text.split("\n")[0]).toBe("[NOMBRE_1]");
    expect(body.text.split("\n")[2]).toBe("[CORREO_1] | [TELEFONO_1] | [ENLACE_1] | Córdoba, Argentina");
    for (const kept of ["Analista de Marketing", "Córdoba, Argentina", "Nubia Retail", "2022 - 2024", "un 20 %"]) expect(body.text).toContain(kept);
  });

  it("is checked against the text as it was given: what the model says of an address comes back with the address", async () => {
    const { extractWithAi } = await import("@/lib/onboarding/ai");
    const outcome = await extractWithAi(CV, "cv");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const [job] = outcome.result.experience;
    expect(job!.facts.map((fact) => fact.value)).toEqual(["Atendí los pedidos que llegaban a ventas@example.com todos los días.", "Subí las ventas un 20 %."]);
    // The kept copy is the document, with what is struck out struck out and nothing masked.
    expect(outcome.result.lines).toEqual(CV.split("\n"));
  });

  it("reads who the person is by the patterns, and never from what the model says of it", async () => {
    const { extractWithAi } = await import("@/lib/onboarding/ai");
    const outcome = await extractWithAi(CV, "cv");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const { contact } = outcome.result;
    expect(contact.fullName?.value).toBe("Lucía Pérez");
    expect(contact.email?.value).toBe("lucia.perez@example.com");
    expect(contact.phone?.value).toBe("+54 9 351 555-1234");
    expect(contact.links.map((link) => link.value.url)).toContain("linkedin.com/in/perfil-ejemplo");
    // And what only a reading of the text can say of where they live and what they do is the model's.
    expect(contact.city?.value).toBe("Córdoba");
    expect(contact.country?.value).toBe("Argentina");
  });

  it("drops a quote whose mark the model did not copy as it was, like any quote that is not in the text", async () => {
    generate.mockImplementation(async (_path: string, body: { text: string }) => {
      const read = answerFor(body.text);
      read.experience[0]!.facts[0] = { value: "Atendí los pedidos de [CORREO_9] todos los días.", quote: "Atendí los pedidos de [CORREO_9] todos los días." };
      return read;
    });
    const { extractWithAi } = await import("@/lib/onboarding/ai");
    const outcome = await extractWithAi(CV, "cv");
    expect(outcome.ok && outcome.result.experience[0]!.facts.map((fact) => fact.value)).toEqual(["Subí las ventas un 20 %."]);
  });

  it("asks once for the same text, whatever the marks stood for", async () => {
    const { extractWithAi } = await import("@/lib/onboarding/ai");
    await extractWithAi(CV, "cv");
    const again = await extractWithAi(CV.replace("lucia.perez@example.com", "otra@example.com"), "cv");
    expect(generate).toHaveBeenCalledTimes(1);
    expect(again.ok && again.fromCache).toBe(true);
  });
});

describe("what someone says in their own words", () => {
  beforeEach(() => {
    generate.mockReset();
    store.clear();
    profile.name = "Lucía Pérez";
  });

  it("goes without the name the profile has, in any case, and without an address, but with what is said", async () => {
    generate.mockResolvedValue(empty());
    const story = "Soy LUCÍA PÉREZ y trabajé cinco años en Nubia Retail armando los pedidos del local. Escribime a lucia@example.com.";
    const { extractWithAi } = await import("@/lib/onboarding/ai");
    await extractWithAi(story, "dump");
    const body = generate.mock.calls[0]![1] as { text: string };
    expect(body.text).toBe("Soy [NOMBRE_1] y trabajé cinco años en Nubia Retail armando los pedidos del local. Escribime a [CORREO_1].");
  });

  it("does not read a name, an email or a phone from a story: it is theirs already, and no model was sent it", async () => {
    generate.mockResolvedValue({ ...empty(), contact: { fullName: { value: "[NOMBRE_1]", quote: "[NOMBRE_1]" }, links: [] } });
    const { extractWithAi } = await import("@/lib/onboarding/ai");
    const outcome = await extractWithAi("Soy Lucía Pérez y trabajé cinco años en Nubia Retail armando los pedidos del local.", "dump");
    expect(outcome.ok && outcome.result.contact.fullName).toBeUndefined();
  });

  it("splits an answer without who they are, and what comes back is a run of what they said", async () => {
    const answer = "Armo los informes para lucia@example.com todas las semanas y llevo las campañas de Meta y Google Ads.";
    generate.mockImplementation(async (_path: string, body: { answer: string }) => ({
      pieces: [body.answer.split(" y llevo")[0]!, `llevo${body.answer.split(" y llevo")[1]!}`] satisfies SplitResult["pieces"],
    }));
    const { splitWithAi } = await import("@/lib/onboarding/ai");
    const outcome = await splitWithAi(answer);
    expect(JSON.stringify(generate.mock.calls[0])).not.toContain("lucia@example.com");
    expect(outcome.ok && outcome.result).toEqual(["Armo los informes para lucia@example.com todas las semanas", "llevo las campañas de Meta y Google Ads."]);
  });

  it("chooses a follow-up without who they are", async () => {
    generate.mockResolvedValue({ choice: "none" });
    const { chooseFollowUpWithAi } = await import("@/lib/onboarding/ai");
    await chooseFollowUpWithAi("Soy Lucía Pérez, armo informes; mi mail es lucia@example.com", [{ id: "tools", about: "tools used" }]);
    const sent = JSON.stringify(generate.mock.calls[0]);
    expect(sent).not.toMatch(/Lucía|lucia@acme/);
    expect(sent).toContain("[NOMBRE_1]");
  });
});
