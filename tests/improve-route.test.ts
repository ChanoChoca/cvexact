import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

/**
 * `POST /api/generate/improve`: one line of a job, or the description of a project, goes to the person's model and comes back as a proposal.
 * Billed as `intake` like `split`, for any plan that can do that: this is help with the profile and not a document.
 */

const openRequest = vi.hoisted(() => vi.fn());
const failure = vi.hoisted(() => vi.fn());
const improveText = vi.hoisted(() => vi.fn());
const improveTexts = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/context", () => ({ openRequest, failure }));
vi.mock("@/lib/ai/pipeline", () => ({ improveText, improveTexts }));

const release = vi.fn();
const chain = { candidates: [], used: {}, failed: new Set(), switches: [] };
const opened = (tier: string) => ({ tier, chain, grant: { release } });
const post = (body: unknown) => new Request("http://localhost/api/generate/improve", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const route = async () => (await import("@/app/api/generate/improve/route")).POST;

beforeEach(() => {
  openRequest.mockReset();
  failure.mockReset();
  improveText.mockReset();
  improveTexts.mockReset();
  release.mockReset();
  failure.mockImplementation(() => NextResponse.json({ error: "falló" }, { status: 502 }));
});

describe("the route that improves a text", () => {
  it("gives back the text the model wrote, billed as intake, for any plan", async () => {
    for (const tier of ["byok", "pro", "credits"]) {
      openRequest.mockResolvedValue(opened(tier));
      improveText.mockResolvedValue({ text: "Armo los informes semanales" });
      release.mockClear();
      const request = post({ text: "Armo los informes todas las semanas", kind: "task" });
      const response = await (await route())(request);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ text: "Armo los informes semanales" });
      expect(openRequest).toHaveBeenLastCalledWith(request, "intake");
      expect(improveText).toHaveBeenLastCalledWith(chain, "Armo los informes todas las semanas", "task", expect.anything());
      expect(release).toHaveBeenCalledWith("success", expect.anything());
    }
  });

  it("takes the longer text of a project, and passes the kind on", async () => {
    openRequest.mockResolvedValue(opened("byok"));
    improveText.mockResolvedValue({ text: "x" });
    const description = "a".repeat(700);
    expect((await (await route())(post({ text: description, kind: "project" }))).status).toBe(200);
    expect(improveText).toHaveBeenCalledWith(chain, description, "project", expect.anything());
  });

  it("refuses what is not a text a field could hold, without spending a call", async () => {
    openRequest.mockResolvedValue(opened("byok"));
    const POST = await route();
    for (const body of [
      {},
      { text: "Armo informes" },
      { text: "", kind: "task" },
      { text: "Armo informes", kind: "other" },
      { text: 12, kind: "task" },
      // A line of a job holds 600 characters and a description 800: the text must be one its field could have held.
      { text: "a".repeat(601), kind: "task" },
      { text: "a".repeat(801), kind: "project" },
    ]) {
      release.mockClear();
      const response = await POST(post(body));
      expect(response.status, JSON.stringify(body).slice(0, 60)).toBe(400);
      expect(release).toHaveBeenCalledWith("failure");
    }
    expect(improveText).not.toHaveBeenCalled();
  });

  it("gives back the grant and lets the failure be told the way every route tells it", async () => {
    openRequest.mockResolvedValue(opened("byok"));
    improveText.mockRejectedValue(new Error("el modelo no contestó"));
    const response = await (await route())(post({ text: "Armo informes", kind: "task" }));
    expect(response.status).toBe(502);
    expect(failure).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith("failure");
  });

  it("stops where the request was refused before it began: no key, no quota", async () => {
    const refusal = NextResponse.json({ error: "Configurá tu key." }, { status: 403 });
    openRequest.mockResolvedValue(refusal);
    const response = await (await route())(post({ text: "Armo informes", kind: "task" }));
    expect(response).toBe(refusal);
    expect(improveText).not.toHaveBeenCalled();
  });
});

describe("the route that improves many texts at once", () => {
  const items = [
    { id: "0", kind: "task", text: "Armo los informes todas las semanas" },
    { id: "1", kind: "name", text: "ingles" },
    { id: "2", kind: "about", text: "a".repeat(1500) },
  ];

  it("gives back what the model wrote for them, in one use of the allowance, for any plan", async () => {
    for (const tier of ["byok", "pro", "credits"]) {
      openRequest.mockResolvedValue(opened(tier));
      improveTexts.mockResolvedValue({ items: [{ id: "1", text: "Inglés" }] });
      release.mockClear();
      const request = post({ items });
      const response = await (await route())(request);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ items: [{ id: "1", text: "Inglés" }] });
      expect(openRequest).toHaveBeenLastCalledWith(request, "intake");
      expect(improveTexts).toHaveBeenLastCalledWith(chain, items, expect.anything());
      expect(improveText).not.toHaveBeenCalled();
      expect(release).toHaveBeenCalledWith("success", expect.anything());
    }
  });

  it("refuses what is not a list a section could have sent, without spending a call", async () => {
    openRequest.mockResolvedValue(opened("byok"));
    const POST = await route();
    const item = { id: "0", kind: "task", text: "Armo informes" };
    for (const body of [
      { items: [] },
      { items: "Armo informes" },
      { items: [{ ...item, kind: "other" }] },
      { items: [{ ...item, text: "" }] },
      { items: [{ ...item, id: "" }] },
      { items: [{ ...item, id: "x".repeat(21) }] },
      // Each text must be one the field it came from could hold: a line of a job holds 600, a headline 160.
      { items: [{ ...item, text: "a".repeat(601) }] },
      { items: [{ id: "0", kind: "headline", text: "a".repeat(161) }] },
      // The answer is found by id.
      { items: [item, { ...item, text: "Otra cosa" }] },
      // Past what one call takes: the browser sends it as another call.
      { items: Array.from({ length: 41 }, (_, id) => ({ id: String(id), kind: "name", text: "a" })) },
      { items: Array.from({ length: 5 }, (_, id) => ({ id: String(id), kind: "about", text: "a".repeat(1700) })) },
    ]) {
      release.mockClear();
      const response = await POST(post(body));
      expect(response.status, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect(release).toHaveBeenCalledWith("failure");
    }
    expect(improveTexts).not.toHaveBeenCalled();
  });

  it("takes as many as one call can hold", async () => {
    openRequest.mockResolvedValue(opened("byok"));
    improveTexts.mockResolvedValue({ items: [] });
    const forty = Array.from({ length: 40 }, (_, id) => ({ id: String(id), kind: "name", text: "Excel" }));
    expect((await (await route())(post({ items: forty }))).status).toBe(200);
  });

  it("gives back the grant and lets the failure be told the way every route tells it", async () => {
    openRequest.mockResolvedValue(opened("byok"));
    improveTexts.mockRejectedValue(new Error("el modelo no contestó"));
    const response = await (await route())(post({ items }));
    expect(response.status).toBe(502);
    expect(failure).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith("failure");
  });
});
