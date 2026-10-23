import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearDraft, loadDraft, sameShape, saveDraft } from "@/lib/onboarding/drafts";
import { FORM_DRAFTS_KEY, clearBrowserData } from "@/lib/storage/local";
import { FakeStorage, installBrowser, uninstallBrowser } from "./helpers/browser-storage";

/**
 * What was half written in a small form is kept, by name, for the next few minutes: a reload or a phone that went
 * to another app does not take it. The tests hold the three things that make that safe to leave on every keystroke:
 * it comes back as it was, it goes when it is done with, and it can never be the thing that fills the room.
 */

let local: FakeStorage;
beforeEach(() => {
  ({ local } = installBrowser());
});
afterEach(() => uninstallBrowser());

const NOW = new Date("2026-10-03T12:00:00.000Z");
const later = (days: number) => new Date(NOW.getTime() + days * 86_400_000);

describe("a draft", () => {
  it("comes back as it was, whatever it holds", () => {
    saveDraft("edit:experience:j1", { form: { role: "Analista", start: { year: 2021, month: 3 }, current: true } }, NOW);
    expect(loadDraft("edit:experience:j1", NOW)).toEqual({ form: { role: "Analista", start: { year: 2021, month: 3 }, current: true } });
  });

  it("is told apart by its name: a card's form is not another card's", () => {
    saveDraft("edit:experience:j1", "uno", NOW);
    saveDraft("edit:experience:j2", "dos", NOW);
    expect(loadDraft("edit:experience:j1", NOW)).toBe("uno");
    expect(loadDraft("edit:experience:j2", NOW)).toBe("dos");
    expect(loadDraft("edit:experience:j3", NOW)).toBeNull();
  });

  it("goes when it is done with, and only that one", () => {
    saveDraft("a", "uno", NOW);
    saveDraft("b", "dos", NOW);
    clearDraft("a");
    expect(loadDraft("a", NOW)).toBeNull();
    expect(loadDraft("b", NOW)).toBe("dos");
    // Clearing what is not there writes nothing.
    const writes = local.writes.get(FORM_DRAFTS_KEY);
    clearDraft("a");
    expect(local.writes.get(FORM_DRAFTS_KEY)).toBe(writes);
  });

  it("is for the next few minutes and not a month from now: after a week it is not there", () => {
    saveDraft("a", "uno", NOW);
    expect(loadDraft("a", later(6))).toBe("uno");
    expect(loadDraft("a", later(8))).toBeNull();
  });

  it("takes the old ones with it when something is written", () => {
    saveDraft("old", "viejo", NOW);
    saveDraft("new", "nuevo", later(9));
    expect(JSON.parse(local.getItem(FORM_DRAFTS_KEY)!)).not.toHaveProperty("old");
  });

  it("is not kept when it is too big to be a half-written form", () => {
    saveDraft("big", "x".repeat(60_001), NOW);
    expect(loadDraft("big", NOW)).toBeNull();
    expect(local.getItem(FORM_DRAFTS_KEY)).toBeNull();
  });

  it("cannot grow without limit: past a total, the oldest go first and the one just written stays", () => {
    for (let i = 0; i < 6; i++) saveDraft(`d${i}`, "x".repeat(40_000), new Date(NOW.getTime() + i * 60_000));
    const kept = JSON.parse(local.getItem(FORM_DRAFTS_KEY)!) as Record<string, unknown>;
    expect(Object.keys(kept).length).toBeLessThan(6);
    expect(kept).toHaveProperty("d5");
    expect(kept).not.toHaveProperty("d0");
  });

  it("does not stop the screen when the browser refuses the write", () => {
    uninstallBrowser();
    ({ local } = installBrowser({ local: new FakeStorage(10) }));
    expect(() => saveDraft("a", "una frase más larga que el espacio que hay", NOW)).not.toThrow();
  });

  it("reads a store that is not what it should be as empty", () => {
    local.setItem(FORM_DRAFTS_KEY, "esto no es json");
    expect(loadDraft("a", NOW)).toBeNull();
    local.setItem(FORM_DRAFTS_KEY, JSON.stringify(["no", "un", "objeto"]));
    expect(loadDraft("a", NOW)).toBeNull();
  });
});

describe("clearing this browser", () => {
  it("takes the drafts with the rest: they are the person's words", async () => {
    saveDraft("a", "lo que escribí", NOW);
    expect(local.getItem(FORM_DRAFTS_KEY)).not.toBeNull();
    await clearBrowserData();
    expect(local.getItem(FORM_DRAFTS_KEY)).toBeNull();
  });
});

describe("a draft from before the form changed", () => {
  const sample = { role: "Analista", start: { year: 2021 }, current: false, employmentType: undefined };

  it("is a draft of this form when it has what the form has, of the kinds the form has", () => {
    expect(sameShape(sample, { role: "Gerente", start: {}, current: true })).toBe(true);
    // An optional field nobody filled in is not in what JSON kept.
    expect(sameShape(sample, { role: "Gerente", start: { year: 2020 }, current: false, employmentType: "full_time" })).toBe(true);
  });

  it("is not, when a field is missing or came in as another kind of thing", () => {
    expect(sameShape(sample, { role: "Gerente", start: {} })).toBe(false);
    expect(sameShape(sample, { role: 42, start: {}, current: false })).toBe(false);
    expect(sameShape(sample, { role: "Gerente", start: "2020", current: false })).toBe(false);
  });

  it("is not, when it is not a thing with fields at all", () => {
    for (const draft of [null, undefined, "texto", 7, ["role", "start", "current"]]) expect(sameShape(sample, draft), String(draft)).toBe(false);
  });
});
