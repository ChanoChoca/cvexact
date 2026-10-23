import { describe, expect, it } from "vitest";
import { ENGINE } from "@/lib/onboarding/config";
import { activeDeclined, askedAgain, declineThings, declinedBy, declinedKey, declinedStanding, keepDeclined, lineNaming, vetoedSkills, withdrawDeclined, withdrawDeclinedFor } from "@/lib/profile/declined";
import { undoEntry } from "@/lib/profile/edit";
import { describeJoin, joinProfiles } from "@/lib/profile/join";
import { toPlainProfile } from "@/lib/profile/project";
import { forSync } from "@/lib/profile/sync";
import { METRIC_NAMES, recordInto, emptyMetrics } from "@/lib/metrics/counters";
import { certificationSchema, emptyStoredProfile, storedProfileSchema, type StoredProfile } from "@/lib/schemas/profile-v2";
import { NOW, STAMP, profileWith } from "./helpers/profiles";

/**
 * O3 (e5): a «no» is the person's word, kept with its day. «No lo tengo» said to what an offer asked for, and the veto of a skill that was
 * deduced, are kept in the profile, are not asked again in the next posting, and are asked once more — a single time — when a year has gone
 * by or a line written after them names the thing. Never part of what a generator reads.
 */

const DAY = 86_400_000;
const after = (days: number) => new Date(NOW.getTime() + days * DAY);
const iso = (days: number) => after(days).toISOString();
let counter = 0;
const ctx = (now: string = STAMP) => ({ now, newId: () => `d-${++counter}` });

const copy = (profile: StoredProfile): StoredProfile => storedProfileSchema.parse(structuredClone(profile));

describe("what a «no» is said to", () => {
  it("is one thing by its kind and its name, read the way a skill is", () => {
    expect(declinedKey("requirement", "SAP")).toBe(declinedKey("requirement", " sap "));
    expect(declinedKey("requirement", "Node.js")).toBe(declinedKey("requirement", "nodejs"));
    expect(declinedKey("requirement", "SAP")).not.toBe(declinedKey("inferred_skill", "SAP"));
  });
});

describe("saying no", () => {
  it("is each thing named, with today's date and the line of the offer that asked for it", () => {
    const profile = emptyStoredProfile();
    const kept = declineThings(profile, "requirement", ["SAP", " Tango "], { quote: "  Manejo de SAP y   Tango Gestión " }, ctx());
    expect(kept.map((entry) => entry.text)).toEqual(["SAP", "Tango"]);
    expect(profile.declined).toHaveLength(2);
    expect(profile.declined[0]).toEqual({ id: expect.any(String), kind: "requirement", text: "SAP", quote: "Manejo de SAP y Tango Gestión", at: STAMP });
    expect(profile.history.map((entry) => entry.op)).toEqual(["add", "add"]);
  });

  it("leaves out what is blank, and keeps a thing once", () => {
    const profile = emptyStoredProfile();
    declineThings(profile, "requirement", ["", "   ", "SAP", "sap"], {}, ctx());
    expect(profile.declined.map((entry) => entry.text)).toEqual(["SAP"]);
  });

  it("is dated again when it is said again, with the way it was before taken away, and is still one", () => {
    const profile = emptyStoredProfile();
    const [first] = declineThings(profile, "requirement", ["SAP"], {}, ctx(iso(0)));
    keepDeclined(profile, first!.id, ctx(iso(400)));
    withdrawDeclined(profile, first!.id, ctx(iso(401)));
    declineThings(profile, "requirement", ["SAP"], { quote: "Experiencia en SAP" }, ctx(iso(500)));
    expect(profile.declined).toEqual([{ id: first!.id, kind: "requirement", text: "SAP", quote: "Experiencia en SAP", at: iso(500) }]);
  });

  it("is a step in the history, which can be undone", () => {
    const profile = emptyStoredProfile();
    declineThings(profile, "inferred_skill", ["Excel avanzado"], {}, ctx());
    const undone = undoEntry(profile, profile.history[0]!.id);
    expect(undone.ok).toBe(true);
    if (undone.ok) expect(undone.profile.declined).toEqual([]);
  });
});

describe("taking it back", () => {
  it("keeps it, inert: nothing reads it, and a copy of the profile learns it was taken back", () => {
    const profile = emptyStoredProfile();
    const [entry] = declineThings(profile, "requirement", ["SAP"], {}, ctx());
    expect(withdrawDeclined(profile, entry!.id, ctx(iso(3)))).toBe(true);
    expect(profile.declined).toHaveLength(1);
    expect(profile.declined[0]!.withdrawnAt).toBe(iso(3));
    expect(activeDeclined(profile)).toEqual([]);
    expect(declinedBy(profile, "requirement", "SAP")).toBeUndefined();
    expect(withdrawDeclined(profile, entry!.id, ctx(iso(4)))).toBe(false);
    expect(withdrawDeclined(profile, "nobody", ctx())).toBe(false);
  });

  it("is what saying they did use it does, by name, for each thing they claim", () => {
    const profile = emptyStoredProfile();
    declineThings(profile, "requirement", ["SAP", "Tango"], {}, ctx());
    declineThings(profile, "inferred_skill", ["SAP"], {}, ctx());
    expect(withdrawDeclinedFor(profile, "requirement", ["sap", "Nada"], ctx(iso(1)))).toBe(1);
    expect(activeDeclined(profile).map((entry) => `${entry.kind}:${entry.text}`)).toEqual(["requirement:Tango", "inferred_skill:SAP"]);
  });

  it("can be undone with the history, like any edit", () => {
    const profile = emptyStoredProfile();
    const [entry] = declineThings(profile, "requirement", ["SAP"], {}, ctx(iso(0)));
    withdrawDeclined(profile, entry!.id, ctx(iso(10)));
    const undone = undoEntry(profile, profile.history.at(-1)!.id);
    expect(undone.ok).toBe(true);
    if (undone.ok) expect(activeDeclined(undone.profile).map((e) => e.text)).toEqual(["SAP"]);
  });
});

describe("asked once more", () => {
  it("a requirement, after a year, once — and never a vetoed skill, which the same lines would deduce again", () => {
    const profile = emptyStoredProfile();
    const [requirement] = declineThings(profile, "requirement", ["SAP"], {}, ctx(iso(0)));
    const [skill] = declineThings(profile, "inferred_skill", ["Excel avanzado"], {}, ctx(iso(0)));
    expect(askedAgain(requirement!, after(ENGINE.currency.declinedDays - 1))).toBe(false);
    expect(askedAgain(requirement!, after(ENGINE.currency.declinedDays))).toBe(true);
    expect(askedAgain(skill!, after(2000))).toBe(false);
  });

  it("is not asked a third time: answering the second ends it", () => {
    const profile = emptyStoredProfile();
    const [entry] = declineThings(profile, "requirement", ["SAP"], {}, ctx(iso(0)));
    expect(keepDeclined(profile, entry!.id, ctx(iso(400)))).toBe(true);
    expect(profile.declined[0]).toMatchObject({ at: iso(0), offeredAgainAt: iso(400) });
    expect(askedAgain(profile.declined[0]!, after(2000))).toBe(false);
    // Said once more, it is not a second step in the history.
    const steps = profile.history.length;
    expect(keepDeclined(profile, entry!.id, ctx(iso(401)))).toBe(true);
    expect(profile.history).toHaveLength(steps);
  });

  it("is not asked of one that was taken back", () => {
    const profile = emptyStoredProfile();
    const [entry] = declineThings(profile, "requirement", ["SAP"], {}, ctx(iso(0)));
    withdrawDeclined(profile, entry!.id, ctx(iso(5)));
    expect(askedAgain(profile.declined[0]!, after(2000))).toBe(false);
    expect(keepDeclined(profile, entry!.id, ctx(iso(6)))).toBe(false);
  });
});

describe("a line that names it", () => {
  const withSkill = (name: string, at: string) => {
    const profile = emptyStoredProfile();
    profile.skills.push({ id: `s-${++counter}`, name: { value: name, status: "confirmed", source: { kind: "manual", at } }, experienceIds: [] });
    return profile;
  };

  it("is one that came in after the «no», of any kind: a task, a skill, a course, a project, a degree", () => {
    const profile = profileWith({ company: "Nubia", role: "Analista", from: { year: 2022 }, to: "current", facts: [{ text: "Armo reportes en SAP todos los meses" }] });
    profile.experience[0]!.facts[0]!.source = { kind: "manual", at: iso(30) };
    expect(lineNaming(profile, "SAP", iso(0))).toBe("Armo reportes en SAP todos los meses");
    expect(lineNaming(profile, "SAP", iso(60))).toBeNull();

    expect(lineNaming(withSkill("SAP", iso(30)), "SAP", iso(0))).toBe("SAP");
    const course = emptyStoredProfile();
    course.certifications.push(certificationSchema.parse({ id: "c1", name: { value: "Curso de SAP básico", status: "confirmed", source: { kind: "manual", at: iso(30) } } }));
    expect(lineNaming(course, "SAP", iso(0))).toBe("Curso de SAP básico");
  });

  it("is not a line that came before it, one with no day, or one that only looks like it", () => {
    expect(lineNaming(withSkill("SAP", iso(-5)), "SAP", iso(0))).toBeNull();
    expect(lineNaming(withSkill("SAP", ""), "SAP", iso(0))).toBeNull();
    expect(lineNaming(withSkill("Go-to-market", iso(30)), "Go", iso(0))).toBeNull();
  });

  it("is quoted back short", () => {
    const profile = profileWith({ company: "Nubia", role: "Analista", from: { year: 2022 }, to: "current", facts: [{ text: `Trabajo con SAP ${"y un montón de cosas más ".repeat(20)}` }] });
    profile.experience[0]!.facts[0]!.source = { kind: "manual", at: iso(30) };
    const line = lineNaming(profile, "SAP", iso(0))!;
    expect(line.length).toBeLessThanOrEqual(140);
    expect(line.endsWith("…")).toBe(true);
  });

  it("decides where a «no» stands: quiet, asked once more by the year, or asked once more with the line", () => {
    const profile = withSkill("Otra cosa", iso(30));
    const [entry] = declineThings(profile, "requirement", ["SAP"], {}, ctx(iso(0)));
    expect(declinedStanding(profile, entry!, after(100))).toEqual({ state: "quiet" });
    expect(declinedStanding(profile, entry!, after(400))).toEqual({ state: "again" });

    profile.skills.push({ id: "s-sap", name: { value: "SAP", status: "confirmed", source: { kind: "manual", at: iso(40) } }, experienceIds: [] });
    // The line comes before the year: it is said, quoting it — and over the year, the line is what is said.
    expect(declinedStanding(profile, entry!, after(100))).toEqual({ state: "named", line: "SAP" });
    expect(declinedStanding(profile, entry!, after(400))).toEqual({ state: "named", line: "SAP" });

    keepDeclined(profile, entry!.id, ctx(iso(101)));
    expect(declinedStanding(profile, profile.declined[0]!, after(400))).toEqual({ state: "quiet" });
  });

  it("is never one for a «no» that was taken back", () => {
    const profile = withSkill("SAP", iso(30));
    const [entry] = declineThings(profile, "requirement", ["SAP"], {}, ctx(iso(0)));
    withdrawDeclined(profile, entry!.id, ctx(iso(31)));
    expect(declinedStanding(profile, profile.declined[0]!, after(400))).toEqual({ state: "quiet" });
  });
});

describe("what a generation is told", () => {
  it("is the skills vetoed in every posting, by name, and nothing of what was said no to in an offer", () => {
    const profile = emptyStoredProfile();
    declineThings(profile, "inferred_skill", ["Excel avanzado", "Liderazgo"], {}, ctx());
    declineThings(profile, "requirement", ["SAP"], { quote: "Manejo de SAP" }, ctx());
    expect(vetoedSkills(profile)).toEqual(["Excel avanzado", "Liderazgo"]);
    withdrawDeclinedFor(profile, "inferred_skill", ["Liderazgo"], ctx(iso(1)));
    expect(vetoedSkills(profile)).toEqual(["Excel avanzado"]);
  });

  it("is not in the plain profile: no generator, no reader of a document, reads a «no»", () => {
    const profile = profileWith({ company: "Nubia", role: "Analista", from: { year: 2022 }, to: "current", facts: [{ text: "Armo informes" }] });
    declineThings(profile, "requirement", ["SAP"], { quote: "Manejo de SAP y Tango" }, ctx());
    declineThings(profile, "inferred_skill", ["Excel avanzado"], {}, ctx());
    const plain = JSON.stringify(toPlainProfile(profile));
    for (const absent of ["SAP", "Tango", "Excel avanzado", "declined"]) expect(plain, absent).not.toContain(absent);
  });
});

describe("a profile and its «no»", () => {
  it("is as it was for a profile from before it, and the list is kept whole through a copy and a sync", () => {
    const old = JSON.parse(JSON.stringify(emptyStoredProfile())) as Record<string, unknown>;
    delete old.declined;
    expect(storedProfileSchema.parse(old).declined).toEqual([]);

    const profile = emptyStoredProfile();
    declineThings(profile, "requirement", ["SAP"], { quote: "Manejo de SAP" }, ctx());
    expect(forSync(profile).declined).toEqual(profile.declined);
    expect(storedProfileSchema.parse(JSON.parse(JSON.stringify(profile))).declined).toEqual(profile.declined);
  });

  it("lets go of what is not one, and keeps the rest: a bad entry never costs the profile", () => {
    const profile = emptyStoredProfile();
    declineThings(profile, "requirement", ["SAP"], {}, ctx());
    const raw = JSON.parse(JSON.stringify(profile)) as { declined: unknown[] };
    raw.declined.push({ id: "x", kind: "whatever", text: "algo", at: "2026-01-01" }, { id: "y", kind: "requirement", text: "   " }, "not an entry", null);
    const parsed = storedProfileSchema.parse(raw);
    expect(parsed.declined.map((entry) => entry.text)).toEqual(["SAP"]);
  });

  it("lets go of a day or a mark that is not one, and keeps the «no»", () => {
    const raw = JSON.parse(JSON.stringify(emptyStoredProfile())) as { declined: unknown[] };
    raw.declined.push({ id: "z", kind: "requirement", text: "SAP", at: "2026-01-01T00:00:00.000Z", offeredAgainAt: 7, withdrawnAt: { no: true } });
    const [entry] = storedProfileSchema.parse(raw).declined;
    expect(entry).toMatchObject({ text: "SAP" });
    expect(entry!.offeredAgainAt).toBeUndefined();
    expect(entry!.withdrawnAt).toBeUndefined();
  });
});

describe("joining two copies of what was said no to", () => {
  const base = () => profileWith({ company: "Nubia Retail", role: "Analista", from: { year: 2022 }, to: "current", facts: [{ text: "Armo los informes" }] });

  it("brings what only the account has, and says so", () => {
    const local = base();
    const account = copy(local);
    declineThings(account, "requirement", ["SAP"], {}, ctx());
    const { profile, added } = joinProfiles(local, account);
    expect(profile.declined.map((entry) => entry.text)).toEqual(["SAP"]);
    expect(added.declined).toBe(1);
    expect(describeJoin(added)).toBe("1 «no» anotado");
  });

  it("is one for each thing, the later word standing, and this browser's id", () => {
    const local = base();
    const [mine] = declineThings(local, "requirement", ["SAP"], {}, ctx(iso(0)));
    const account = copy(local);
    account.declined = [{ ...account.declined[0]!, id: "their-id", at: iso(0), offeredAgainAt: iso(400) }];
    // The account says the same, and only has the second asking answered: no later word, and this browser's stands.
    expect(joinProfiles(local, account).profile.declined).toEqual([mine]);

    // Said again on the account, later: that is what they think now.
    account.declined = [{ ...account.declined[0]!, at: iso(10), offeredAgainAt: undefined }];
    const joined = joinProfiles(local, account).profile.declined;
    expect(joined).toHaveLength(1);
    expect(joined[0]).toMatchObject({ id: mine!.id, at: iso(10) });
  });

  it("does not bring back one that was taken back here, and learns one that was taken back there", () => {
    const local = base();
    const [entry] = declineThings(local, "requirement", ["SAP"], {}, ctx(iso(0)));
    const account = copy(local);
    withdrawDeclined(local, entry!.id, ctx(iso(5)));
    expect(activeDeclined(joinProfiles(local, account).profile)).toEqual([]);

    const other = base();
    const [theirs] = declineThings(other, "requirement", ["Tango"], {}, ctx(iso(0)));
    const here = copy(other);
    withdrawDeclined(other, theirs!.id, ctx(iso(7)));
    expect(activeDeclined(joinProfiles(here, other).profile)).toEqual([]);
  });

  it("does not count a «no» the account already took back as something it added", () => {
    const local = base();
    const account = copy(local);
    const [entry] = declineThings(account, "requirement", ["SAP"], {}, ctx(iso(0)));
    withdrawDeclined(account, entry!.id, ctx(iso(2)));
    expect(joinProfiles(local, account).added.declined).toBe(0);
  });
});

describe("in the history, in words", () => {
  it("says the day it was said, said again, confirmed and taken back, for a requirement and for a skill", () => {
    const profile = emptyStoredProfile();
    const [sap] = declineThings(profile, "requirement", ["SAP"], {}, ctx(iso(0)));
    expect(profile.history.at(-1)).toMatchObject({ op: "add", path: ["declined", sap!.id] });
    keepDeclined(profile, sap!.id, ctx(iso(400)));
    expect(profile.history.at(-1)).toMatchObject({ op: "set", path: ["declined", sap!.id] });
    withdrawDeclined(profile, sap!.id, ctx(iso(500)));
    expect(profile.history.at(-1)).toMatchObject({ op: "set", path: ["declined", sap!.id] });
    declineThings(profile, "requirement", ["SAP"], {}, ctx(iso(900)));
    expect(profile.history.at(-1)).toMatchObject({ op: "set", path: ["declined", sap!.id] });

    declineThings(profile, "inferred_skill", ["Excel avanzado"], {}, ctx(iso(901)));
    expect(profile.history.at(-1)).toMatchObject({ op: "add" });
  });
});

describe("what is counted of it", () => {
  it("is three numbers, in the list of what the person can see", () => {
    for (const name of ["requirement_claimed", "requirement_declined", "inferred_skill_vetoed"] as const) {
      expect(METRIC_NAMES).toContain(name);
      expect(recordInto(emptyMetrics(), name, NOW).days["2026-09-21"]).toEqual({ [name]: 1 });
    }
  });
});
