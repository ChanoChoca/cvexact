import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredProfile } from "@/lib/schemas/profile-v2";
import { installBrowser, uninstallBrowser } from "./helpers/browser-storage";
import { profileWith } from "./helpers/profiles";

/**
 * Taking back the last answer from a screen that was handed it (U20): the close of a stretch of questions and the page of an application, where the loop that
 * asked is gone and so is the card that said what it did. «Deshacer» gives the profile back as it was, with the revision counting up, and — when the answer
 * took words out of a box — the words back in it.
 */

const JOB_A = { company: "Nubia Retail", role: "Analista", from: { year: 2021, month: 3 }, to: "current" as const, facts: [{ text: "Armo los pedidos del local" }] };
const JOB_B = { company: "Grupo Lumen", role: "Asistente", from: { year: 2018, month: 9 }, to: { year: 2021, month: 1 }, facts: [{ text: "Atendía clientes" }] };

let api: typeof import("@/lib/storage/local");
let lastAnswer: typeof import("@/lib/onboarding/last-answer");
let resume: typeof import("@/lib/onboarding/resume");

beforeEach(async () => {
  installBrowser({ indexedDB: true });
  vi.resetModules();
  api = await import("@/lib/storage/local");
  lastAnswer = await import("@/lib/onboarding/last-answer");
  resume = await import("@/lib/onboarding/resume");
});

afterEach(() => {
  uninstallBrowser();
  vi.resetModules();
});

const jobs = () => api.loadStoredProfile().experience.map((job) => job.company.value);

describe("«Deshacer» of the last answer", () => {
  it("gives the profile back as it was before, and says it as a newer save and not as a step back in time", () => {
    api.saveStoredProfile(profileWith(JOB_A));
    const before: StoredProfile = structuredClone(api.loadStoredProfile());
    // What the answer did: another job in the profile.
    api.updateStoredProfile((draft) => {
      draft.experience.push(profileWith(JOB_B).experience[0]!);
    });
    expect(jobs()).toEqual(["Nubia Retail", "Grupo Lumen"]);
    const revAfterAnswer = api.loadStoredProfile().rev;

    lastAnswer.undoLastAnswer({ before });

    expect(jobs()).toEqual(["Nubia Retail"]);
    expect(api.loadStoredProfile().rev).toBeGreaterThan(revAfterAnswer);
  });

  it("puts the words an answer took out of a box back in it, to be written again", () => {
    api.saveStoredProfile(profileWith(JOB_A));
    const before: StoredProfile = structuredClone(api.loadStoredProfile());
    api.updateStoredProfile((draft) => void draft.experience[0]!.facts.push(profileWith(JOB_B).experience[0]!.facts[0]!));

    lastAnswer.restoreProfile(before, { key: "no_content:e1", text: "Armo los pedidos y los entrego" });

    expect(api.loadStoredProfile().experience[0]!.facts).toHaveLength(1);
    expect(resume.draftFor(api.loadStoredProfile(), "no_content:e1")).toBe("Armo los pedidos y los entrego");
  });

  it("is only the profile: nothing else of what the person has is touched", () => {
    api.saveStoredProfile(profileWith(JOB_A));
    const before: StoredProfile = structuredClone(api.loadStoredProfile());
    window.localStorage.setItem("cvexact.settings.v1", JSON.stringify({ entries: [] }));
    lastAnswer.undoLastAnswer({ before });
    expect(window.localStorage.getItem("cvexact.settings.v1")).toBe(JSON.stringify({ entries: [] }));
  });
});
