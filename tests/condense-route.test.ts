import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

/**
 * `POST /api/generate/condense`: the one route that rewrites lines a person has
 * already read, and the one that only runs with their own key.
 */

const openRequest = vi.hoisted(() => vi.fn());
const failure = vi.hoisted(() => vi.fn());
const generate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/context", () => ({ openRequest, failure }));
vi.mock("@/lib/ai/pipeline", () => ({ generate }));

const release = vi.fn();
const opened = (tier: string) => ({
  tier,
  chain: { candidates: [], used: {}, failed: new Set(), switches: [] },
  grant: { release },
});

const ITEM = {
  id: "s0.i0.b1",
  text: "Preparé los informes mensuales de ventas para la dirección comercial del equipo.",
  maxChars: 66,
  hint: "long-line" as const,
};

const post = (body: unknown) =>
  new Request("http://localhost/api/generate/condense", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

async function route() {
  return (await import("@/app/api/generate/condense/route")).POST;
}

beforeEach(() => {
  openRequest.mockReset();
  failure.mockReset();
  generate.mockReset();
  release.mockReset();
  failure.mockImplementation(() => NextResponse.json({ error: "falló" }, { status: 502 }));
});

describe("the route that shortens a CV", () => {
  it("shortens only with a key of their own", async () => {
    for (const tier of ["pro", "credits", "free"]) {
      openRequest.mockResolvedValue(opened(tier));
      release.mockClear();
      const response = await (await route())(post({ language: "es", items: [ITEM] }));

      expect(response.status).toBe(403);
      expect((await response.json()).reason).toBe("byok_required");
      expect(generate).not.toHaveBeenCalled();
      expect(release).toHaveBeenCalledWith("failure");
    }
  });

  it("asks once, with no repair: a retouch nobody asked for is not worth a second provider", async () => {
    openRequest.mockResolvedValue(opened("byok"));
    generate.mockResolvedValue({ rewrites: [{ id: ITEM.id, text: "Preparé los informes de ventas de dirección." }] });

    const response = await (await route())(post({ language: "es", items: [ITEM] }));

    expect(response.status).toBe(200);
    expect(generate).toHaveBeenCalledTimes(1);
    const options = generate.mock.calls[0]![0] as Record<string, unknown>;
    expect(options.maxGenerations).toBe(1);
    expect(options.allowShortenRepair).toBe(false);
    expect(options.schemaName).toBe("CondenseCv");
    expect((options.prompt as string)).toContain(ITEM.text);
    // The action it was opened as: zero cost, and the one the route declares.
    expect(openRequest.mock.calls[0]![1]).toBe("condense");
  });

  it("closes the answer: an id nobody asked about, a line over its ceiling, a duplicate", async () => {
    openRequest.mockResolvedValue(opened("byok"));
    generate.mockResolvedValue({
      rewrites: [
        { id: ITEM.id, text: "Preparé los informes de ventas de la dirección." },
        { id: ITEM.id, text: "Otro intento para la misma línea." },
        { id: "s9.i9.b9", text: "Una línea que nadie pidió." },
        { id: "s0.i0.b2", text: "x".repeat(200) },
      ],
    });

    const response = await (await route())(post({ language: "es", items: [ITEM, { ...ITEM, id: "s0.i0.b2", maxChars: 40 }] }));

    expect(await response.json()).toEqual({
      rewrites: [{ id: ITEM.id, text: "Preparé los informes de ventas de la dirección." }],
    });
  });

  it("refuses a body that is not a list of lines, without spending a call", async () => {
    openRequest.mockResolvedValue(opened("byok"));
    const POST = await route();

    for (const body of [
      { items: [ITEM] },
      { language: "es", items: [] },
      { language: "es", items: [{ ...ITEM, maxChars: 5 }] },
      { language: "es", items: [{ ...ITEM, hint: "cualquiera" }] },
      { language: "es", items: [ITEM, ITEM] },
      { language: "es", items: Array.from({ length: 13 }, (_, index) => ({ ...ITEM, id: `s0.i0.b${index}` })) },
    ]) {
      release.mockClear();
      const response = await POST(post(body));
      expect(response.status).toBe(400);
      expect(release).toHaveBeenCalledWith("failure");
    }
    expect(generate).not.toHaveBeenCalled();
  });

  it("lets a failure be told the way every route tells it, and gives the grant back", async () => {
    openRequest.mockResolvedValue(opened("byok"));
    generate.mockRejectedValue(new Error("Ese modelo no está disponible."));

    const response = await (await route())(post({ language: "es", items: [ITEM] }));

    expect(response.status).toBe(502);
    expect(failure).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith("failure");
  });

  it("stops where the request was refused before it began: no key, no quota", async () => {
    const refusal = NextResponse.json({ error: "Configurá tu key." }, { status: 403 });
    openRequest.mockResolvedValue(refusal);

    const response = await (await route())(post({ language: "es", items: [ITEM] }));

    expect(response).toBe(refusal);
    expect(generate).not.toHaveBeenCalled();
  });
});
