import { describe, expect, it } from "vitest";
import { STEPS } from "@/lib/onboarding/flow";
import { STEP_PARAM, STEP_SLUG, searchWithStep } from "@/lib/onboarding/step-url";

/**
 * The step of the first-run flow, written in the address so that a measurement that only follows the address can tell
 * the steps apart. Only ever written: nothing here reads it back to decide where anyone is.
 */

describe("the step in the address", () => {
  it("has a word for every step the flow has, and one only", () => {
    expect(Object.keys(STEP_SLUG).sort()).toEqual([...STEPS].sort());
  });

  it("uses words an address can carry as they are, and no two steps share one", () => {
    const words = Object.values(STEP_SLUG);
    for (const word of words) expect(word).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
    expect(new Set(words).size).toBe(words.length);
  });

  it("names the guided profile as the address's own example does: ?paso=paso-a-paso", () => {
    expect(searchWithStep("", "steps")).toBe("?paso=paso-a-paso");
  });

  it("writes it where there was nothing", () => {
    expect(searchWithStep("", "start")).toBe(`?${STEP_PARAM}=inicio`);
  });

  it("leaves alone what the address already carried — a link that asked for a way in keeps asking for it", () => {
    expect(searchWithStep("?ruta=linkedin", "start")).toBe("?ruta=linkedin&paso=inicio");
    expect(searchWithStep("?ruta=scratch&otro=1", "steps")).toBe("?ruta=scratch&otro=1&paso=paso-a-paso");
  });

  it("replaces its own earlier word instead of piling them up", () => {
    expect(searchWithStep("?paso=paso-a-paso", "firstValue")).toBe("?paso=primer-valor");
    expect(searchWithStep("?ruta=scratch&paso=revision&x=1", "firstValue")).toBe("?ruta=scratch&paso=primer-valor&x=1");
  });

  it("is the same answer for a search with or without its question mark", () => {
    expect(searchWithStep("ruta=linkedin", "start")).toBe(searchWithStep("?ruta=linkedin", "start"));
  });
});
