import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { FOLLOW_UP_SYSTEM, NO_FOLLOW_UP, buildFollowUpPrompt, followUpSchema } from "@/lib/ai/prompts/followup";
import { MIN_CHOICES, followUpChoices } from "@/lib/onboarding/followup-choice";
import { NOW, STAMP, freshSession, profileWith } from "./helpers/profiles";

/**
 * M28, an experiment: after an answer, the person's own model picks which of a few fixed questions follows, or none. It writes
 * nothing, and it cannot make a question appear that the engine would not have asked.
 */

const generate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/client", () => ({ ApiError: class ApiError extends Error {}, callGenerator: generate }));
vi.mock("@/lib/onboarding/stores", () => ({ ensureOnboardingStoresHydrated: async () => {}, readCollection: () => ({}), writeCollection: () => {} }));

const job = () =>
  profileWith({
    company: "Nubia Retail",
    role: "Analista",
    from: { year: 2023 },
    to: "current",
    facts: [{ text: "Atiendo a muchos clientes" }, { kind: "achievement", text: "Reduje los tiempos de entrega" }, { text: "Armo informes con Excel y Power BI" }],
  });

describe("the choice, as a closed answer", () => {
  it("is one of the ids it was given, or none, and nothing else", () => {
    const schema = followUpSchema(["a:1", "b:2"]);
    expect(schema.parse({ choice: "a:1" })).toEqual({ choice: "a:1" });
    expect(schema.parse({ choice: NO_FOLLOW_UP })).toEqual({ choice: "none" });
    expect(schema.safeParse({ choice: "c:3" }).success).toBe(false);
    expect(schema.safeParse({ choice: "Dijiste muchos clientes: ¿cuántos?" }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it("asks the model to choose and not to write, and gives it the answer and the list", () => {
    expect(FOLLOW_UP_SYSTEM).toMatch(/choosing, not writing/);
    expect(FOLLOW_UP_SYSTEM).toMatch(/never write a question/);
    const prompt = buildFollowUpPrompt("Atiendo a muchos clientes", [{ id: "q1", about: "Ask how many." }, { id: "q2", about: "Ask which tool." }]);
    expect(prompt).toContain("Atiendo a muchos clientes");
    expect(prompt).toContain("- q1: Ask how many.");
    expect(prompt).toContain("- q2: Ask which tool.");
  });
});

describe("what the model may choose among", () => {
  it("is the engine's own kinds of question about that job, each described by a line of ours", () => {
    const profile = job();
    const choices = followUpChoices(profile, profile.experience[0]!.id, freshSession(), NOW);
    expect(choices.map((choice) => choice.gap.rule).sort()).toEqual(["achievement_no_figure", "more_achievements", "vague_scale"]);
    expect(choices.find((choice) => choice.gap.rule === "achievement_no_figure")!.about).toMatch(/Ask for a figure/);
    expect(choices.length).toBeGreaterThanOrEqual(MIN_CHOICES);
  });

  it("tells the model nothing of the profile: not the company, not the role, not a word the person said", () => {
    const profile = job();
    const told = JSON.stringify(followUpChoices(profile, profile.experience[0]!.id, freshSession(), NOW).map(({ id, about }) => ({ id, about })));
    for (const private_ of ["Nubia", "Retail", "Analista", "Atiendo a", "tiempos de entrega", "Excel", "Power BI"]) expect(told).not.toContain(private_);
  });

  it("offers one of each kind: two figures to ask for are one choice, and the engine's order says which", () => {
    const profile = job();
    profile.experience[0]!.facts.push({ id: "extra-1", kind: "achievement", text: "Armé el tablero de ventas", source: { kind: "manual", at: STAMP }, status: "confirmed" });
    const [first] = profile.experience;
    const kinds = followUpChoices(profile, first!.id, freshSession(), NOW).map((choice) => choice.gap.rule);
    expect(kinds.filter((rule) => rule === "achievement_no_figure")).toHaveLength(1);
  });

  it("leaves out what is skipped (already queued), and never another job's", () => {
    const profile = job();
    const [first] = profile.experience;
    const all = followUpChoices(profile, first!.id, freshSession(), NOW);
    const without = followUpChoices(profile, first!.id, freshSession(), NOW, new Set([all[0]!.id]));
    expect(without.map((choice) => choice.id)).not.toContain(all[0]!.id);
    expect(followUpChoices(profile, "another-job", freshSession(), NOW)).toEqual([]);
  });

  it("does not offer a question the person turned down for good: the choice is of order, not of whether", () => {
    const profile = job();
    const [first] = profile.experience;
    const all = followUpChoices(profile, first!.id, freshSession(), NOW);
    profile.pending.push({ questionId: all[0]!.id, ruleId: all[0]!.gap.rule, entityId: first!.id, state: "na", count: 1, at: NOW.toISOString() });
    expect(followUpChoices(profile, first!.id, freshSession(), NOW).map((choice) => choice.id)).not.toContain(all[0]!.id);
  });
});

describe("chooseFollowUpWithAi", () => {
  const options = [{ id: "q1", about: "Ask how many." }, { id: "q2", about: "Ask which tool." }];
  beforeEach(() => {
    generate.mockReset();
  });

  it("gives back the id the model chose, after sending what was answered and the list", async () => {
    generate.mockResolvedValue({ choice: "q2" });
    const { chooseFollowUpWithAi } = await import("@/lib/onboarding/ai");
    const outcome = await chooseFollowUpWithAi("Armo informes todas las semanas", options);
    expect(outcome).toEqual({ ok: true, result: "q2", fromCache: false });
    expect(generate.mock.calls[0]![0]).toBe("/api/generate/followup");
    expect(generate.mock.calls[0]![1]).toEqual({ answer: "Armo informes todas las semanas", options });
  });

  it("takes an id that was not on the list, and none, for no choice", async () => {
    const { chooseFollowUpWithAi } = await import("@/lib/onboarding/ai");
    generate.mockResolvedValue({ choice: "invented" });
    expect(await chooseFollowUpWithAi("Armo informes todas las semanas", options)).toMatchObject({ ok: true, result: null });
    generate.mockResolvedValue({ choice: "none" });
    expect(await chooseFollowUpWithAi("Armo informes todas las semanas", options)).toMatchObject({ ok: true, result: null });
  });

  it("does not send the details the product does not use", async () => {
    generate.mockResolvedValue({ choice: "none" });
    const { chooseFollowUpWithAi } = await import("@/lib/onboarding/ai");
    await chooseFollowUpWithAi("Armo informes todas las semanas\nEstado civil: casada\nDNI: 30.123.456", options);
    expect(JSON.stringify(generate.mock.calls[0]![1])).not.toMatch(/casada|30\.123\.456/);
  });

  it("says it could not, and lets the engine go on, when the call fails", async () => {
    generate.mockRejectedValue(new Error("sin red"));
    const { chooseFollowUpWithAi } = await import("@/lib/onboarding/ai");
    const outcome = await chooseFollowUpWithAi("Armo informes todas las semanas", options);
    expect(outcome.ok).toBe(false);
  });
});

describe("the route", () => {
  const openRequest = vi.hoisted(() => vi.fn());
  const failure = vi.hoisted(() => vi.fn());
  const chooseFollowUp = vi.hoisted(() => vi.fn());
  vi.mock("@/lib/api/context", () => ({ openRequest, failure }));
  vi.mock("@/lib/ai/followup", () => ({ chooseFollowUp }));

  const release = vi.fn();
  const opened = (tier: string) => ({ tier, chain: { candidates: [], used: {}, failed: new Set(), switches: [] }, grant: { release } });
  const body = { answer: "Armo informes todas las semanas", options: [{ id: "q1", about: "Ask how many." }, { id: "q2", about: "Ask which tool." }] };
  const post = (payload: unknown) => new Request("http://localhost/api/generate/followup", { method: "POST", body: JSON.stringify(payload), headers: { "content-type": "application/json" } });
  const route = async () => (await import("@/app/api/generate/followup/route")).POST;

  beforeEach(() => {
    openRequest.mockReset();
    failure.mockReset();
    chooseFollowUp.mockReset();
    release.mockReset();
    failure.mockImplementation(() => NextResponse.json({ error: "falló" }, { status: 502 }));
  });

  it("answers with the id the model chose, for someone with a key of their own", async () => {
    openRequest.mockResolvedValue(opened("byok"));
    chooseFollowUp.mockResolvedValue("q1");
    const response = await (await route())(post(body));
    expect(await response.json()).toEqual({ choice: "q1" });
    expect(release).toHaveBeenCalledWith("success", expect.anything());
  });

  it("answers none for anything that was not on the list, whatever the model said", async () => {
    openRequest.mockResolvedValue(opened("byok"));
    chooseFollowUp.mockResolvedValue("q9");
    expect(await (await (await route())(post(body))).json()).toEqual({ choice: "none" });
  });

  it("does not run for a paid plan: it would be sending their words to our provider", async () => {
    openRequest.mockResolvedValue(opened("pro"));
    const response = await (await route())(post(body));
    expect(response.status).toBe(403);
    expect((await response.json()).reason).toBe("byok_required");
    expect(chooseFollowUp).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith("failure");
  });

  it("refuses a request that is not a list of at least two different questions and an answer", async () => {
    openRequest.mockResolvedValue(opened("byok"));
    const POST = await route();
    for (const payload of [
      { ...body, options: [body.options[0]] },
      { ...body, options: [body.options[0], body.options[0]] },
      { ...body, answer: "corto" },
      { answer: body.answer },
    ]) {
      expect((await POST(post(payload))).status).toBe(400);
    }
    expect(chooseFollowUp).not.toHaveBeenCalled();
  });
});
