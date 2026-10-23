import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeStorage, installBrowser, uninstallBrowser } from "./helpers/browser-storage";
import { NOW } from "./helpers/profiles";

/**
 * What the person left «solo en este CV» (O11): kept in this browser, for each application, so that the card does not ask again — and nothing else about the
 * application or the profile is written for it.
 */

afterEach(() => {
  uninstallBrowser();
  vi.resetModules();
});

async function store(local = new FakeStorage()) {
  vi.resetModules();
  installBrowser({ local });
  return { local, ...(await import("@/lib/storage/corrections-settled")), ...(await import("@/lib/storage/local")) };
}

describe("what was left in a CV", () => {
  it("is remembered for that application and for no other", async () => {
    const { settleCorrection, settledCorrections } = await store();
    expect([...settledCorrections("a")]).toEqual([]);
    settleCorrection("a", "tool:tableau", NOW);
    settleCorrection("a", "credential:meta", NOW);
    settleCorrection("a", "tool:tableau", NOW);
    expect([...settledCorrections("a")]).toEqual(["tool:tableau", "credential:meta"]);
    expect([...settledCorrections("b")]).toEqual([]);
  });

  it("keeps the last 200 applications and 60 changes of each, forgetting the oldest first", async () => {
    const { settleCorrection, settledCorrections } = await store();
    for (let index = 0; index < 205; index += 1) settleCorrection(`app-${index}`, "tool:x", new Date(NOW.getTime() + index * 1000));
    expect(settledCorrections("app-0").size).toBe(0);
    expect(settledCorrections("app-4").size).toBe(0);
    expect(settledCorrections("app-5").size).toBe(1);
    expect(settledCorrections("app-204").size).toBe(1);
    for (let index = 0; index < 70; index += 1) settleCorrection("many", `tool:${index}`, new Date(NOW.getTime() + 999_000 + index));
    const kept = [...settledCorrections("many")];
    expect(kept).toHaveLength(60);
    expect(kept[0]).toBe("tool:10");
    expect(kept.at(-1)).toBe("tool:69");
  });

  it("survives what a browser keeps wrong, and writes nothing else", async () => {
    const { local, settledCorrections, CORRECTIONS_SETTLED_KEY } = await store();
    local.setItem(CORRECTIONS_SETTLED_KEY, "{no es un json");
    expect(() => settledCorrections("a")).not.toThrow();
    expect(settledCorrections("a").size).toBe(0);
    local.setItem(CORRECTIONS_SETTLED_KEY, JSON.stringify({ a: { keys: ["tool:x", 3, null], at: "2026-10-01T00:00:00.000Z" }, b: "mal", c: { keys: "no", at: 5 } }));
    expect([...settledCorrections("a")]).toEqual(["tool:x"]);
    expect(settledCorrections("b").size).toBe(0);
    expect(settledCorrections("c").size).toBe(0);
  });

  it("is forgotten with the rest when the data of this browser is cleared", async () => {
    const { local, settleCorrection, clearBrowserData, CORRECTIONS_SETTLED_KEY } = await store();
    settleCorrection("a", "tool:x", NOW);
    expect(local.getItem(CORRECTIONS_SETTLED_KEY)).not.toBeNull();
    await clearBrowserData();
    expect(local.getItem(CORRECTIONS_SETTLED_KEY)).toBeNull();
  });
});
