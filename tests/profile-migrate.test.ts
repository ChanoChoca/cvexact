import { describe, expect, it } from "vitest";
import { profileSchema, type Profile } from "@/lib/schemas/profile";
import { storedProfileSchema, isBlankProfile } from "@/lib/schemas/profile-v2";
import { migrateV1 } from "@/lib/profile/migrate";
import { parseAnyProfile } from "@/lib/profile/parse";
import { toPlainProfile } from "@/lib/profile/project";
import { backendProfile, buriedFrontendProfile, devProfile, fullstackProfile } from "./fixtures";

/**
 * The migration's whole contract is that it loses nothing and invents nothing:
 * projecting a migrated profile back to the plain shape gives the profile it
 * started from. Held here against every real profile the suite already has, and
 * against the awkward shapes real profiles turn out to have (duplicated bullets,
 * dates nobody can parse, a role marked current with an end date still typed).
 */

const NOW = "2026-09-21T12:00:00.000Z";

const profiles: Array<[string, Profile]> = [
  ["backend", backendProfile],
  ["dev", devProfile],
  ["fullstack", fullstackProfile],
  ["buried frontend", buriedFrontendProfile],
  ["empty", profileSchema.parse({})],
];

describe("migrateV1", () => {
  it.each(profiles)("projects back to the same profile: %s", (_name, profile) => {
    expect(toPlainProfile(migrateV1(profile, { now: NOW }))).toEqual(profile);
  });

  it("produces a profile the stored schema accepts as it is", () => {
    for (const [, profile] of profiles) {
      const stored = migrateV1(profile, { now: NOW });
      expect(storedProfileSchema.parse(stored)).toEqual(stored);
    }
  });

  it("is deterministic: the same profile migrates to the same ids", () => {
    expect(migrateV1(devProfile, { now: NOW })).toEqual(migrateV1(devProfile, { now: NOW }));
  });

  it("marks every existing value as confirmed and from before provenance", () => {
    const stored = migrateV1(devProfile, { now: NOW });
    expect(stored.contact.fullName).toMatchObject({
      value: "Juan Pérez",
      status: "confirmed",
      source: { kind: "legacy" },
    });
    const job = stored.experience[0]!;
    expect(job.facts.length).toBeGreaterThan(0);
    for (const fact of job.facts) {
      expect(fact.status).toBe("confirmed");
      expect(fact.source.kind).toBe("legacy");
    }
  });

  it("gives an empty value no source, since nobody said it", () => {
    const stored = migrateV1(devProfile, { now: NOW });
    expect(stored.contact.email.source).toBeDefined();
    const blank = migrateV1(profileSchema.parse({}), { now: NOW });
    expect(blank.contact.fullName).toEqual({ value: "", status: "confirmed" });
  });

  it("turns bullets into responsibilities and tags into tools, without deciding a bullet is an achievement", () => {
    const stored = migrateV1(devProfile, { now: NOW });
    const facts = stored.experience[0]!.facts;
    expect(facts.filter((f) => f.kind === "responsibility")).toHaveLength(3);
    expect(facts.filter((f) => f.kind === "tool").map((f) => f.text)).toEqual([
      "React",
      "TypeScript",
      "Git",
    ]);
    expect(facts.some((f) => f.kind === "achievement")).toBe(false);
  });

  describe("dates", () => {
    const withDates = (start: string, end: string, current = false) =>
      profileSchema.parse({
        experience: [{ id: "e1", company: "X", role: "Y", start, end, current }],
      });

    it("keeps the precision the text had: a year stays a year", () => {
      const job = migrateV1(withDates("2019", "Marzo 2021"), { now: NOW }).experience[0]!;
      expect(job.start.value).toEqual({ year: 2019, raw: "2019" });
      expect(job.end.value).toEqual({ year: 2021, month: 3, raw: "Marzo 2021" });
    });

    it("never invents a month", () => {
      const job = migrateV1(withDates("2019", ""), { now: NOW }).experience[0]!;
      expect(job.start.value.month).toBeUndefined();
    });

    it("keeps a date it cannot read as the text it was", () => {
      const job = migrateV1(withDates("Verano 2019", "hace poco"), { now: NOW }).experience[0]!;
      expect(job.start.value).toEqual({ raw: "Verano 2019" });
      expect(toPlainProfile(migrateV1(withDates("Verano 2019", "hace poco"))).experience[0]!.start).toBe(
        "Verano 2019",
      );
    });

    it("takes `current` from the checkbox only, even with a stale end date typed", () => {
      const back = toPlainProfile(migrateV1(withDates("Mayo 2024", "Agosto 2024", true)));
      expect(back.experience[0]).toMatchObject({ end: "Agosto 2024", current: true });
    });

    it("does not read the word 'Presente' as the checkbox", () => {
      const back = toPlainProfile(migrateV1(withDates("Mayo 2024", "Presente", false)));
      expect(back.experience[0]).toMatchObject({ end: "Presente", current: false });
    });
  });

  describe("bullets", () => {
    it("keeps duplicated bullets apart, with distinct ids", () => {
      const profile = profileSchema.parse({
        experience: [{ id: "e1", company: "X", role: "Y", bullets: ["Igual", "Igual", "Otra"] }],
      });
      const facts = migrateV1(profile, { now: NOW }).experience[0]!.facts;
      expect(new Set(facts.map((f) => f.id)).size).toBe(3);
      expect(toPlainProfile(migrateV1(profile)).experience[0]!.bullets).toEqual(["Igual", "Igual", "Otra"]);
    });

    it("ignores a retired metrics assistant record instead of failing to migrate", () => {
      // The field is gone from `experienceSchema`, but a profile from before it
      // was retired can still have it in storage; `profileSchema.parse` drops
      // the unknown key rather than rejecting the whole profile, the same
      // tolerance every other retired field gets here.
      const profile = profileSchema.parse({
        experience: [
          {
            id: "e1",
            company: "X",
            role: "Y",
            bullets: ["Atendí a 40 clientes por día"],
            metrics: [
              {
                text: "Atendí a 40 clientes por día",
                original: "Atendía clientes",
                answered: ["¿cuántos?"],
              },
            ],
          },
        ],
      });
      const fact = migrateV1(profile, { now: NOW }).experience[0]!.facts[0]!;
      expect(fact.text).toBe("Atendí a 40 clientes por día");
      expect(fact.original).toBeUndefined();
      expect(fact.metric).toBeUndefined();
    });
  });

  it("repairs repeated and empty ids so every entity can be addressed", () => {
    const profile = profileSchema.parse({
      experience: [
        { id: "e1", company: "A", role: "x" },
        { id: "e1", company: "B", role: "y" },
        { id: "", company: "C", role: "z" },
      ],
    });
    const ids = migrateV1(profile, { now: NOW }).experience.map((job) => job.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids.every(Boolean)).toBe(true);
  });

  it("links a skill to the roles that list it as a tool, and only those", () => {
    const profile = profileSchema.parse({
      skills: ["React", "Cocina"],
      experience: [
        { id: "e1", company: "A", role: "x", tags: ["React", "Git"] },
        { id: "e2", company: "B", role: "y", tags: ["React"] },
        { id: "e3", company: "C", role: "z", tags: [] },
      ],
    });
    const skills = migrateV1(profile, { now: NOW }).skills;
    expect(skills.find((s) => s.name.value === "React")?.experienceIds).toEqual(["e1", "e2"]);
    expect(skills.find((s) => s.name.value === "Cocina")?.experienceIds).toEqual([]);
  });

  it("reads a level as written and only recognises what is unmistakable", () => {
    const profile = profileSchema.parse({
      languages: [
        { id: "l1", name: "Inglés", level: "b2" },
        { id: "l2", name: "Español", level: "Nativo" },
        { id: "l3", name: "Francés", level: "Avanzado" },
        { id: "l4", name: "Alemán", level: "" },
      ],
    });
    const levels = migrateV1(profile, { now: NOW }).languages.map((l) => l.level.value);
    expect(levels[0]).toEqual({ cefr: "B2", raw: "b2" });
    expect(levels[1]).toEqual({ cefr: "native", raw: "Nativo" });
    expect(levels[2]).toEqual({ raw: "Avanzado" });
    expect(levels[3]).toEqual({});
  });

  describe("first-run", () => {
    it("does not send someone who already has a profile back through setup", () => {
      const stored = migrateV1(devProfile, { now: NOW });
      expect(stored.onboarding.done).toBe(true);
      expect(stored.onboarding.step).toBe("done");
    });

    it("leaves an empty profile at the start", () => {
      const stored = migrateV1(profileSchema.parse({}), { now: NOW });
      expect(isBlankProfile(stored)).toBe(true);
      expect(stored.onboarding.done).toBe(false);
    });
  });
});

describe("parseAnyProfile", () => {
  it("reads a plain profile by migrating it", () => {
    const stored = parseAnyProfile(devProfile, { now: NOW });
    expect(stored?.version).toBe(2);
    expect(stored?.contact.fullName.value).toBe("Juan Pérez");
  });

  it("reads a stored profile as it is", () => {
    const stored = migrateV1(devProfile, { now: NOW });
    expect(parseAnyProfile(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
  });

  it("is idempotent: a profile read twice is the same profile", () => {
    const once = parseAnyProfile(devProfile, { now: NOW })!;
    expect(parseAnyProfile(once)).toEqual(once);
  });

  it("refuses a version it does not know instead of reading it as an empty profile", () => {
    expect(parseAnyProfile({ version: 3, contact: {} })).toBeNull();
  });

  it("refuses things that are not profiles", () => {
    expect(parseAnyProfile(null)).toBeNull();
    expect(parseAnyProfile("perfil")).toBeNull();
    expect(parseAnyProfile([])).toBeNull();
  });

  it("refuses a v1 profile that does not parse rather than emptying it", () => {
    expect(parseAnyProfile({ version: 1, experience: "no es una lista" })).toBeNull();
  });
});
