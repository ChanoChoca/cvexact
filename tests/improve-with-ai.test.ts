import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * «Mejorar con IA», from the browser: what a model is sent of a line of a job (and what it is not), and that what it says back is put
 * right and checked before anyone is shown it. It is a proposal each time —nothing is cached— and a failure is a sentence, not a throw.
 */

const generate = vi.hoisted(() => vi.fn());
const profile = vi.hoisted(() => ({ name: "" }));

vi.mock("@/lib/api/client", () => ({
  ApiError: class ApiError extends Error {
    reason?: string;
  },
  callGenerator: generate,
}));
vi.mock("@/lib/onboarding/stores", () => ({ ensureOnboardingStoresHydrated: async () => {}, readCollection: () => ({}), writeCollection: () => {} }));
vi.mock("@/lib/storage/local", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/local")>();
  return { ...actual, loadStoredProfile: () => ({ contact: { fullName: { value: profile.name } } }) };
});

const improve = async (...args: Parameters<typeof import("@/lib/onboarding/ai").improveWithAi>) => (await import("@/lib/onboarding/ai")).improveWithAi(...args);

beforeEach(() => {
  generate.mockReset();
  profile.name = "";
});

describe("what is sent", () => {
  it("is the line and its kind, to the route that improves", async () => {
    generate.mockResolvedValue({ text: "Armo los informes semanales" });
    await improve("Armo los informes todas las semanas", "task");
    expect(generate.mock.calls[0]![0]).toBe("/api/generate/improve");
    expect(generate.mock.calls[0]![1]).toEqual({ text: "Armo los informes todas las semanas", kind: "task" });
    await improve("Un tablero de ventas", "project");
    expect(generate.mock.calls[1]![1]).toEqual({ text: "Un tablero de ventas", kind: "project" });
  });

  it("goes without who the person is, and what comes back has it put where it was", async () => {
    profile.name = "Lucía Pérez";
    generate.mockImplementation(async (_path: string, body: { text: string }) => ({ text: body.text.replace("Armo", "Preparo") }));
    const outcome = await improve("Armo los informes de Lucía Pérez para lucia@example.com cada semana", "task");
    expect(JSON.stringify(generate.mock.calls[0])).not.toMatch(/Lucía|lucia@example/);
    expect(JSON.stringify(generate.mock.calls[0])).toContain("[NOMBRE_1]");
    expect(outcome).toEqual({ ok: true, result: { text: "Preparo los informes de Lucía Pérez para lucia@example.com cada semana", same: false }, fromCache: false });
  });

  it("goes without the details the product does not use", async () => {
    generate.mockResolvedValue({ text: "Un tablero de ventas" });
    await improve("Un tablero de ventas\nEstado civil: casada\nDNI: 30.123.456", "project");
    expect(JSON.stringify(generate.mock.calls[0]![1])).not.toMatch(/casada|30\.123\.456/);
  });

  it("is given the signal, so that the person can stop waiting", async () => {
    generate.mockResolvedValue({ text: "Armo los informes semanales" });
    const controller = new AbortController();
    await improve("Armo los informes todas las semanas", "task", controller.signal);
    expect(generate.mock.calls[0]![2]).toBe(controller.signal);
  });
});

describe("what comes back", () => {
  it("is the proposal, when it says the same thing", async () => {
    generate.mockResolvedValue({ text: "Armo los informes semanales" });
    expect(await improve("Armo los informes todas las semanas", "task")).toEqual({ ok: true, result: { text: "Armo los informes semanales", same: false }, fromCache: false });
  });

  it("says when there is nothing to propose", async () => {
    generate.mockResolvedValue({ text: "Armo los informes todas las semanas" });
    expect(await improve("Armo los informes todas las semanas", "task")).toMatchObject({ ok: true, result: { same: true } });
  });

  it("is nothing at all when it brings a figure the line did not state, and the sentence says which", async () => {
    generate.mockResolvedValue({ text: "Armo los informes semanales y subí las ventas un 40%" });
    const outcome = await improve("Armo los informes todas las semanas", "task");
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.message).toContain("40%");
  });

  it("is nothing at all when there is no text in the reply", async () => {
    generate.mockResolvedValue({});
    expect((await improve("Armo los informes todas las semanas", "task")).ok).toBe(false);
    generate.mockResolvedValue(null);
    expect((await improve("Armo los informes todas las semanas", "task")).ok).toBe(false);
  });

  it("asks every time: asking again is asking for another proposal", async () => {
    generate.mockResolvedValue({ text: "Armo los informes semanales" });
    await improve("Armo los informes todas las semanas", "task");
    await improve("Armo los informes todas las semanas", "task");
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("says it could not, and does not throw, when the call fails", async () => {
    generate.mockRejectedValue(new Error("sin red"));
    const outcome = await improve("Armo los informes todas las semanas", "task");
    expect(outcome).toMatchObject({ ok: false });
    expect(!outcome.ok && outcome.message).toMatch(/IA/);
  });
});

const improveMany = async (...args: Parameters<typeof import("@/lib/onboarding/ai").improveManyWithAi>) => (await import("@/lib/onboarding/ai")).improveManyWithAi(...args);

/** A model that answers every text of the call with what `change` makes of it, by the place it was sent in. */
const answering = (change: (text: string, kind: string) => string) =>
  generate.mockImplementation(async (_path: string, body: { items: Array<{ id: string; kind: string; text: string }> }) => ({
    items: body.items.map((item) => ({ id: item.id, text: change(item.text, item.kind) })),
  }));

describe("many texts at once", () => {
  const items = [
    { id: "fact:a", kind: "task" as const, text: "Armo los informes todas las semanas" },
    { id: "skill:b", kind: "name" as const, text: "ingles" },
    { id: "legacy:about", kind: "about" as const, text: "Soy analista de datos" },
  ];

  it("is one call to the route that improves, with each text and its kind, and a place and not a path", async () => {
    answering((text) => text);
    await improveMany(items);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0]![0]).toBe("/api/generate/improve");
    expect(generate.mock.calls[0]![1]).toEqual({
      items: [
        { id: "0", kind: "task", text: "Armo los informes todas las semanas" },
        { id: "1", kind: "name", text: "ingles" },
        { id: "2", kind: "about", text: "Soy analista de datos" },
      ],
    });
  });

  it("gives back what changes, by the id it was given, and nothing for what comes back the same", async () => {
    answering((text, kind) => (kind === "name" ? "Inglés" : kind === "task" ? "Armo los informes semanales" : text));
    expect(await improveMany(items)).toEqual({
      ok: true,
      result: [
        { id: "fact:a", text: "Armo los informes semanales" },
        { id: "skill:b", text: "Inglés" },
      ],
      fromCache: false,
    });
  });

  it("goes without who the person is, text by text, and what comes back has it put where it was", async () => {
    profile.name = "Lucía Pérez";
    answering((text) => text.replace("Armo", "Preparo"));
    const outcome = await improveMany([
      { id: "a", kind: "task", text: "Armo los informes de Lucía Pérez para lucia@example.com" },
      { id: "b", kind: "about", text: "Armo los tableros. Escribime a lucia@example.com" },
    ]);
    expect(JSON.stringify(generate.mock.calls[0])).not.toMatch(/Lucía|lucia@acme/);
    expect(JSON.stringify(generate.mock.calls[0])).toContain("[NOMBRE_1]");
    expect(JSON.stringify(generate.mock.calls[0])).toContain("[CORREO_1]");
    expect(outcome).toMatchObject({
      ok: true,
      result: [
        { id: "a", text: "Preparo los informes de Lucía Pérez para lucia@example.com" },
        { id: "b", text: "Preparo los tableros. Escribime a lucia@example.com" },
      ],
    });
  });

  it("goes without the details the product does not use", async () => {
    answering((text) => text);
    await improveMany([{ id: "a", kind: "about", text: "Soy analista de datos\nEstado civil: casada\nDNI: 30.123.456" }]);
    expect(JSON.stringify(generate.mock.calls[0]![1])).not.toMatch(/casada|30\.123\.456/);
  });

  it("throws out, text by text, what brings a figure the text did not state — and keeps the rest", async () => {
    answering((text, kind) => (kind === "task" ? `${text} y subí las ventas un 40%` : kind === "name" ? "Inglés" : text));
    expect(await improveMany(items)).toEqual({ ok: true, result: [{ id: "skill:b", text: "Inglés" }], fromCache: false });
  });

  it("says why, with the sentence of the first, when everything it proposed was thrown out", async () => {
    answering((text) => `${text} (2019)`);
    const outcome = await improveMany([items[0]!]);
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.message).toContain("2019");
  });

  it("is an empty list, and not an error, when the model had nothing to change", async () => {
    answering((text) => text);
    expect(await improveMany(items)).toEqual({ ok: true, result: [], fromCache: false });
  });

  it("ignores an answer for a place nobody sent, or without a text", async () => {
    generate.mockResolvedValue({ items: [{ id: "7", text: "Otra cosa" }, { id: "x", text: "Otra" }, { id: "0" }, { id: "1", text: "Inglés" }, null] });
    expect(await improveMany(items)).toEqual({ ok: true, result: [{ id: "skill:b", text: "Inglés" }], fromCache: false });
  });

  it("leaves a text alone when marking its details would make it not fit its field", async () => {
    answering((text) => text);
    const email = "a@x.test";
    const long = `${email} ${"x".repeat(160 - email.length - 1)}`;
    await improveMany([{ id: "h", kind: "headline", text: long }, { id: "i", kind: "name", text: "ingles" }]);
    expect(generate.mock.calls[0]![1]).toEqual({ items: [{ id: "0", kind: "name", text: "ingles" }] });
  });

  it("goes in as many calls as it takes, in order, at 40 texts or 8000 characters a call", async () => {
    answering((text) => text.toUpperCase());
    const many = Array.from({ length: 85 }, (_, n) => ({ id: `n${n}`, kind: "name" as const, text: `habilidad ${n}` }));
    const outcome = await improveMany(many);
    expect(generate.mock.calls.map((call) => call[1].items.length)).toEqual([40, 40, 5]);
    expect(outcome.ok && outcome.result).toHaveLength(85);
    expect(outcome.ok && outcome.result[84]).toEqual({ id: "n84", text: "HABILIDAD 84" });

    generate.mockClear();
    const long = Array.from({ length: 6 }, (_, n) => ({ id: `l${n}`, kind: "about" as const, text: `${n}`.repeat(1500) }));
    await improveMany(long);
    expect(generate.mock.calls.map((call) => call[1].items.length)).toEqual([5, 1]);
  });

  it("is given the signal, so that the person can stop waiting", async () => {
    answering((text) => text);
    const controller = new AbortController();
    await improveMany(items, controller.signal);
    expect(generate.mock.calls[0]![2]).toBe(controller.signal);
  });

  it("says it could not, and does not throw, when a call fails — and does not go on to the next", async () => {
    generate.mockRejectedValue(new Error("sin red"));
    const many = Array.from({ length: 50 }, (_, n) => ({ id: `n${n}`, kind: "name" as const, text: `habilidad ${n}` }));
    const outcome = await improveMany(many);
    expect(outcome).toMatchObject({ ok: false });
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
