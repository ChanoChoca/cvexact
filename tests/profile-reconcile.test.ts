import { describe, expect, it } from "vitest";
import { profileSchema, type Profile } from "@/lib/schemas/profile";
import { emptyStoredProfile, type StoredProfile } from "@/lib/schemas/profile-v2";
import { migrateV1 } from "@/lib/profile/migrate";
import { toPlainProfile } from "@/lib/profile/project";
import { reconcileFromPlain } from "@/lib/profile/reconcile";
import { getAt, restoreArchived, undoEntry, undoLast } from "@/lib/profile/edit";
import { backendProfile, devProfile, fullstackProfile } from "./fixtures";

/**
 * `reconcileFromPlain` is what keeps every editor and importer that still speaks
 * the plain profile working on top of the stored one. Its contract is two
 * sentences — the projection of the result is what was asked for, and asking for
 * what is already there changes nothing — and the last test holds both against
 * hundreds of random edits, because the bugs in code like this are in the
 * combinations nobody wrote a case for.
 */

const T0 = "2026-09-21T12:00:00.000Z";
const T1 = "2026-09-21T13:00:00.000Z";

function ids() {
  let n = 0;
  return () => `id-${++n}`;
}

const migrated = (profile: Profile): StoredProfile => migrateV1(profile, { now: T0 });

const edit = (
  prev: StoredProfile,
  change: (draft: Profile) => void,
  options: { now?: string; origin?: "manual" | "cv" | "answer" } = {},
) => {
  const next = structuredClone(toPlainProfile(prev));
  change(next);
  return reconcileFromPlain(prev, profileSchema.parse(next), { now: T1, newId: ids(), ...options });
};

describe("reconcileFromPlain", () => {
  it("returns the very same profile when nothing changed", () => {
    const stored = migrated(devProfile);
    expect(reconcileFromPlain(stored, toPlainProfile(stored))).toBe(stored);
  });

  it.each([
    ["backend", backendProfile],
    ["dev", devProfile],
    ["fullstack", fullstackProfile],
  ])("builds a whole profile from nothing and projects it back: %s", (_name, profile) => {
    const stored = reconcileFromPlain(emptyStoredProfile(), profile, { now: T1, newId: ids() });
    expect(toPlainProfile(stored)).toEqual(profile);
  });

  describe("values", () => {
    it("marks an edited value as edited, keeps its origin and remembers the original", () => {
      const before = migrated(devProfile);
      const after = edit(before, (p) => {
        p.city = "Córdoba";
      });
      expect(after.contact.city).toMatchObject({
        value: "Córdoba",
        status: "edited",
        original: "Rosario",
        source: { kind: "legacy" },
      });
    });

    it("never overwrites the first original with a later edit", () => {
      let stored = migrated(devProfile);
      stored = edit(stored, (p) => void (p.city = "Córdoba"));
      stored = edit(stored, (p) => void (p.city = "Mendoza"));
      expect(stored.contact.city.original).toBe("Rosario");
    });

    it("credits a value typed into an empty field to whoever gave it, as confirmed", () => {
      const before = migrated(profileSchema.parse({ fullName: "Ana" }));
      const after = edit(before, (p) => void (p.phone = "+54 11 5555 0000"), { origin: "answer" });
      expect(after.contact.phone).toMatchObject({
        value: "+54 11 5555 0000",
        status: "confirmed",
        source: { kind: "answer", at: T1 },
      });
      expect(after.contact.phone.original).toBeUndefined();
    });

    it("leaves what was not touched exactly as it was, provenance included", () => {
      const before = migrated(devProfile);
      const after = edit(before, (p) => void (p.city = "Córdoba"));
      expect(after.contact.fullName).toEqual(before.contact.fullName);
      expect(after.experience[0]).toEqual(before.experience[0]);
    });

    it("bumps nothing itself: rev and updatedAt are the store's", () => {
      const before = migrated(devProfile);
      const after = edit(before, (p) => void (p.city = "Córdoba"));
      expect(after.rev).toBe(before.rev);
      expect(after.updatedAt).toBe(before.updatedAt);
    });
  });

  describe("bullets", () => {
    const withBullets = (bullets: string[]) =>
      migrated(
        profileSchema.parse({
          experience: [{ id: "e1", company: "X", role: "Y", bullets, tags: ["React", "Git"] }],
        }),
      );
    const facts = (stored: StoredProfile) => stored.experience[0]!.facts;

    it("keeps the identity of a line the user reworded", () => {
      const before = withBullets(["Atendía clientes en el mostrador", "Cerraba la caja"]);
      const after = edit(before, (p) => {
        p.experience[0]!.bullets[0] = "Atendía a los clientes en el mostrador principal";
      });
      const reworded = facts(after).find((f) => f.id === facts(before)[0]!.id)!;
      expect(reworded).toMatchObject({
        text: "Atendía a los clientes en el mostrador principal",
        status: "edited",
        original: "Atendía clientes en el mostrador",
      });
    });

    it("reads a line rewritten in place as an edit of it, however different it now is", async () => {
      const before = withBullets(["Atendía clientes en el mostrador", "Cerraba la caja"]);
      const after = edit(before, (p) => {
        p.experience[0]!.bullets[0] = "Programé un sistema de reservas en Python";
      });
      const rewritten = facts(after).find((f) => f.id === facts(before)[0]!.id)!;
      expect(rewritten).toMatchObject({
        text: "Programé un sistema de reservas en Python",
        status: "edited",
        original: "Atendía clientes en el mostrador",
      });
      expect(after.archive).toHaveLength(0);
    });

    it("does not archive the fragments a line passes through while being retyped", () => {
      let stored = withBullets(["Atendía clientes en el mostrador"]);
      for (const fragment of ["D", "Di", "Dis", "Diseñé un sistema"]) {
        stored = edit(stored, (p) => void (p.experience[0]!.bullets[0] = fragment));
      }
      expect(facts(stored).filter((f) => f.kind !== "tool")).toHaveLength(1);
      expect(stored.archive).toHaveLength(0);
      expect(facts(stored)[0]).toMatchObject({ text: "Diseñé un sistema", original: "Atendía clientes en el mostrador" });
    });

    it("treats a line replaced by something unrelated, while the count changes, as new, and archives the old ones", () => {
      const before = withBullets(["Atendía clientes en el mostrador", "Cerraba la caja"]);
      const after = edit(before, (p) => {
        p.experience[0]!.bullets = ["Programé un sistema de reservas en Python"];
      });
      expect(facts(after).filter((f) => f.kind !== "tool").map((f) => f.text)).toEqual([
        "Programé un sistema de reservas en Python",
      ]);
      expect(after.archive.map((a) => a.label).sort()).toEqual([
        "Atendía clientes en el mostrador",
        "Cerraba la caja",
      ]);
    });

    it("leaves no trace of a blank line added and removed again", () => {
      const before = withBullets(["Cerraba la caja"]);
      const added = edit(before, (p) => void p.experience[0]!.bullets.push(""));
      expect(added.history).toHaveLength(0);
      const removed = edit(added, (p) => void p.experience[0]!.bullets.pop());
      expect(removed.archive).toHaveLength(0);
      expect(removed.history).toHaveLength(0);
    });

    it("counts a blank line that gets filled in as a new statement, not an edit", () => {
      const before = withBullets(["Cerraba la caja"]);
      const added = edit(before, (p) => void p.experience[0]!.bullets.push(""));
      const filled = edit(added, (p) => void (p.experience[0]!.bullets[1] = "Capacité a dos personas"));
      const fact = facts(filled).find((f) => f.text === "Capacité a dos personas")!;
      expect(fact.status).toBe("confirmed");
      expect(fact.original).toBeUndefined();
      expect(filled.history.some((h) => h.op === "add" && h.label === "Capacité a dos personas")).toBe(true);
    });

    it("credits a new line to the origin of the write, as confirmed, and calls it a responsibility", () => {
      const before = withBullets(["Cerraba la caja"]);
      const after = edit(
        before,
        (p) => void p.experience[0]!.bullets.push("Capacité a dos personas nuevas"),
        { origin: "cv" },
      );
      const added = facts(after).find((f) => f.text === "Capacité a dos personas nuevas")!;
      expect(added).toMatchObject({ kind: "responsibility", status: "confirmed", source: { kind: "cv" } });
    });

    it("keeps duplicated lines apart", () => {
      const before = withBullets(["Igual", "Igual"]);
      const after = edit(before, (p) => void p.experience[0]!.bullets.pop());
      expect(toPlainProfile(after).experience[0]!.bullets).toEqual(["Igual"]);
      expect(after.archive).toHaveLength(1);
    });

    it("follows a reorder without recording an edit", () => {
      const before = withBullets(["Primera tarea larga", "Segunda tarea distinta"]);
      const after = edit(before, (p) => p.experience[0]!.bullets.reverse());
      expect(toPlainProfile(after).experience[0]!.bullets).toEqual([
        "Segunda tarea distinta",
        "Primera tarea larga",
      ]);
      expect(facts(after).every((f) => f.status === "confirmed")).toBe(true);
      expect(after.history).toHaveLength(0);
    });

    it("keeps tools as tools, and separate from the bullets", () => {
      const before = withBullets(["Cerraba la caja"]);
      const after = edit(before, (p) => void p.experience[0]!.tags.push("Excel"));
      expect(facts(after).filter((f) => f.kind === "tool").map((f) => f.text)).toEqual([
        "React",
        "Git",
        "Excel",
      ]);
    });

    it("does not fold a metric into the text when the line is edited with its suffix on", () => {
      const before = withBullets(["Subí la conversión de la tienda"]);
      const withMetric = structuredClone(before);
      withMetric.experience[0]!.facts[0]!.metric = { value: "20-25", unit: "%", approx: true };
      const shown = toPlainProfile(withMetric).experience[0]!.bullets[0]!;
      expect(shown).toBe("Subí la conversión de la tienda — aprox. 20–25 %");

      const after = edit(withMetric, (p) => {
        p.experience[0]!.bullets[0] = `Subí bastante la conversión de la tienda${shown.slice(shown.indexOf(" — "))}`;
      });
      const fact = facts(after)[0]!;
      expect(fact.text).toBe("Subí bastante la conversión de la tienda");
      expect(fact.metric).toEqual({ value: "20-25", unit: "%", approx: true });
      expect(toPlainProfile(after).experience[0]!.bullets[0]).toBe(
        "Subí bastante la conversión de la tienda — aprox. 20–25 %",
      );
    });
  });

  describe("dates", () => {
    const job = (start: string, end: string, current: boolean) =>
      migrated(
        profileSchema.parse({ experience: [{ id: "e1", company: "X", role: "Y", start, end, current }] }),
      );

    it("reads a typed date and keeps its precision", () => {
      const after = edit(job("", "", true), (p) => void (p.experience[0]!.start = "ene. 2019"));
      expect(after.experience[0]!.start.value).toEqual({ year: 2019, month: 1, raw: "ene. 2019" });
      const yearOnly = edit(job("", "", true), (p) => void (p.experience[0]!.start = "2019"));
      expect(yearOnly.experience[0]!.start.value).toEqual({ year: 2019, raw: "2019" });
    });

    it("takes `current` from the checkbox and nothing else", () => {
      const after = edit(job("Mayo 2024", "", false), (p) => {
        p.experience[0]!.end = "Presente";
      });
      expect(toPlainProfile(after).experience[0]).toMatchObject({ end: "Presente", current: false });

      const ticked = edit(job("Mayo 2024", "Agosto 2024", false), (p) => void (p.experience[0]!.current = true));
      expect(ticked.experience[0]!.end.value).toMatchObject({ raw: "Agosto 2024", current: true });
      expect(toPlainProfile(ticked).experience[0]).toMatchObject({ end: "Agosto 2024", current: true });
    });
  });

  describe("skills", () => {
    it("keeps a renamed skill's id and the roles it is linked to", () => {
      const before = migrated(
        profileSchema.parse({
          skills: ["React"],
          experience: [{ id: "e1", company: "A", role: "x", tags: ["React"] }],
        }),
      );
      const after = edit(before, (p) => void (p.skills[0] = "React Native"));
      expect(after.skills[0]).toMatchObject({ id: before.skills[0]!.id, experienceIds: ["e1"] });
      expect(after.skills[0]!.name).toMatchObject({ value: "React Native", status: "edited", original: "React" });
    });
  });

  describe("the objective", () => {
    it("is edited from the plain profile like any text: kept as the person's own, with what it was", () => {
      const before = migrated(devProfile);
      const after = edit(before, (p) => void (p.objective = "Analista de datos"));
      expect(after.objective).toMatchObject({ value: "Analista de datos", status: "confirmed" });
      expect(toPlainProfile(after).objective).toBe("Analista de datos");
      const again = edit(after, (p) => void (p.objective = "Diseño de producto"));
      expect(again.objective).toMatchObject({ value: "Diseño de producto", status: "edited", original: "Analista de datos" });
    });

    it("changes nothing when it is the same", () => {
      const before = edit(migrated(devProfile), (p) => void (p.objective = "Analista de datos"));
      expect(reconcileFromPlain(before, toPlainProfile(before), { now: T1, newId: ids() })).toBe(before);
    });
  });

  describe("skills linked to a job, which the plain job shows among its tags", () => {
    // PostgreSQL was answered as used at e1 ("¿Dónde usaste PostgreSQL?"): a skill linked to the job, not a tool it lists.
    const linked = () => {
      const base = migrated(profileSchema.parse({ skills: ["React", "PostgreSQL"], experience: [{ id: "e1", company: "A", role: "x", bullets: ["Armé la web"], tags: ["React"] }] }));
      base.skills.find((skill) => skill.name.value === "PostgreSQL")!.experienceIds = ["e1"];
      return base;
    };
    const toolsOf = (profile: StoredProfile) => profile.experience[0]!.facts.filter((fact) => fact.kind === "tool").map((fact) => fact.text);

    it("shows it as a tag of the job, before the tools it lists", () => {
      expect(toPlainProfile(linked()).experience[0]!.tags).toEqual(["PostgreSQL", "React"]);
    });

    it("does not make it a tool of the job when something else about the job is edited", () => {
      const before = linked();
      const after = edit(before, (p) => void (p.experience[0]!.bullets = ["Armé la web y la API"]));
      expect(toolsOf(after)).toEqual(["React"]);
      expect(after.skills.find((skill) => skill.name.value === "PostgreSQL")!.experienceIds).toEqual(["e1"]);
      expect(toPlainProfile(after).experience[0]!.tags).toEqual(["PostgreSQL", "React"]);
    });

    it("keeps the contract: what was asked for is what is projected, and asking again changes nothing", () => {
      const before = linked();
      const next = structuredClone(toPlainProfile(before));
      next.experience[0]!.bullets = ["Otra cosa"];
      next.experience[0]!.tags.push("Docker");
      const after = reconcileFromPlain(before, profileSchema.parse(next), { now: T1, newId: ids() });
      expect(toPlainProfile(after)).toEqual(next);
      expect(reconcileFromPlain(after, profileSchema.parse(next), { now: T1, newId: ids() })).toBe(after);
      expect(toolsOf(after)).toEqual(["React", "Docker"]);
    });

    it("taking the tag off is saying the skill was not used there: it is unlinked, and stays among the skills", () => {
      const before = linked();
      const after = edit(before, (p) => void (p.experience[0]!.tags = p.experience[0]!.tags.filter((tag) => tag !== "PostgreSQL")));
      expect(after.skills.map((skill) => skill.name.value)).toEqual(["React", "PostgreSQL"]);
      expect(after.skills.find((skill) => skill.name.value === "PostgreSQL")!.experienceIds).toEqual([]);
      expect(toPlainProfile(after).experience[0]!.tags).toEqual(["React"]);
      expect(after.history.some((entry) => entry.path.join("/") === `skills/${after.skills[1]!.id}/experienceIds`)).toBe(true);
    });

    it("renaming it is unlinking the old one and listing the new name as a tool", () => {
      const after = edit(linked(), (p) => void (p.experience[0]!.tags = p.experience[0]!.tags.map((tag) => (tag === "PostgreSQL" ? "Postgres" : tag))));
      expect(toolsOf(after).sort()).toEqual(["Postgres", "React"]);
      expect(after.skills.find((skill) => skill.name.value === "PostgreSQL")!.experienceIds).toEqual([]);
      expect(toPlainProfile(after).experience[0]!.tags).toEqual(["Postgres", "React"]);
    });

    it("a profile whose skills are linked to nothing reconciles as it always did", () => {
      const plain = migrated(profileSchema.parse({ skills: ["React"], experience: [{ id: "e1", company: "A", role: "x", bullets: ["a"], tags: ["React"] }] }));
      plain.skills[0]!.experienceIds = [];
      const after = edit(plain, (p) => void p.experience[0]!.tags.push("Git"));
      expect(toolsOf(after)).toEqual(["React", "Git"]);
    });
  });

  describe("entities", () => {
    it("archives a removed role and can bring it back", () => {
      const before = migrated(devProfile);
      const after = edit(before, (p) => void p.experience.shift());
      expect(after.experience).toHaveLength(before.experience.length - 1);
      expect(after.archive).toHaveLength(1);
      expect(after.archive[0]).toMatchObject({ kind: "experience", parentPath: ["experience"] });

      const restored = restoreArchived(after, after.archive[0]!.id);
      expect(restored.ok).toBe(true);
      if (restored.ok) {
        expect(toPlainProfile(restored.profile).experience).toEqual(devProfile.experience);
        expect(restored.profile.archive).toHaveLength(0);
      }
    });

    it("records an added role and undoes it", () => {
      const before = migrated(devProfile);
      const after = edit(before, (p) => {
        p.experience.push(
          ...profileSchema.parse({ experience: [{ id: "nuevo", company: "Otra SA", role: "Analista" }] })
            .experience,
        );
      });
      expect(after.experience.map((e) => e.id)).toContain("nuevo");
      const entry = after.history.find((h) => h.op === "add" && h.path.join("/") === "experience/nuevo");
      expect(entry).toBeDefined();
      const undone = undoEntry(after, entry!.id);
      expect(undone.ok && undone.profile.experience.map((e) => e.id)).not.toContain("nuevo");
    });

    it("gives an entity that repeats an id a new one instead of merging the two", () => {
      const before = migrated(profileSchema.parse({}));
      const next = profileSchema.parse({
        education: [
          { id: "d", institution: "UBA", degree: "Lic." },
          { id: "d", institution: "UTN", degree: "Ing." },
        ],
      });
      const after = reconcileFromPlain(before, next, { now: T1, newId: ids() });
      expect(new Set(after.education.map((e) => e.id)).size).toBe(2);
      expect(after.education.map((e) => e.institution.value)).toEqual(["UBA", "UTN"]);
    });
  });

  describe("history", () => {
    it("folds edits of the same field made close together into one, first before and last after", () => {
      let stored = migrated(devProfile);
      stored = edit(stored, (p) => void (p.city = "C"), { now: T1 });
      stored = edit(stored, (p) => void (p.city = "Cór"), { now: "2026-09-21T13:00:05.000Z" });
      stored = edit(stored, (p) => void (p.city = "Córdoba"), { now: "2026-09-21T13:00:10.000Z" });
      const entries = stored.history.filter((h) => h.path.join("/") === "contact/city");
      expect(entries).toHaveLength(1);
      expect((entries[0]!.before as { value: string }).value).toBe("Rosario");
      expect((entries[0]!.after as { value: string }).value).toBe("Córdoba");
    });

    it("leaves no entry for an edit that ended where it began", () => {
      let stored = migrated(devProfile);
      stored = edit(stored, (p) => void (p.city = "Córdoba"), { now: T1 });
      stored = edit(stored, (p) => void (p.city = "Rosario"), { now: "2026-09-21T13:00:05.000Z" });
      expect(stored.history.filter((h) => h.path.join("/") === "contact/city")).toHaveLength(0);
    });

    it("keeps edits made far apart as separate entries", () => {
      let stored = migrated(devProfile);
      stored = edit(stored, (p) => void (p.city = "Córdoba"), { now: T1 });
      stored = edit(stored, (p) => void (p.city = "Mendoza"), { now: "2026-09-21T15:00:00.000Z" });
      expect(stored.history.filter((h) => h.path.join("/") === "contact/city")).toHaveLength(2);
    });

    it("undoes an edit, restoring the value and its status", () => {
      const before = migrated(devProfile);
      const after = edit(before, (p) => void (p.city = "Córdoba"));
      const undone = undoLast(after);
      expect(undone.ok).toBe(true);
      if (undone.ok) {
        expect(undone.profile.contact.city).toEqual(before.contact.city);
        expect(undone.profile.history).toHaveLength(0);
      }
    });

    it("refuses to undo a change that something else has since changed", () => {
      const before = migrated(devProfile);
      const first = edit(before, (p) => void (p.city = "Córdoba"), { now: T1 });
      const entry = first.history[0]!;
      const second = edit(first, (p) => void (p.city = "Mendoza"), { now: "2026-09-21T15:00:00.000Z" });
      expect(undoEntry(second, entry.id)).toEqual({ ok: false, reason: "changed" });
    });

    it("undoes a removal by restoring what was archived", () => {
      const before = migrated(devProfile);
      const after = edit(before, (p) => void (p.experience[0]!.bullets.shift()));
      const removal = after.history.find((h) => h.op === "remove")!;
      const undone = undoEntry(after, removal.id);
      expect(undone.ok).toBe(true);
      if (undone.ok) {
        expect(toPlainProfile(undone.profile).experience[0]!.bullets).toEqual(
          devProfile.experience[0]!.bullets,
        );
        expect(undone.profile.archive).toHaveLength(0);
        expect(undone.profile.history.some((h) => h.op === "restore")).toBe(false);
      }
    });

    it("addresses entries by id, so a path survives a reorder", () => {
      const stored = migrated(devProfile);
      const factId = stored.experience[0]!.facts[1]!.id;
      expect(getAt(stored, ["experience", "e1", "facts", factId])).toBe(stored.experience[0]!.facts[1]);
    });
  });
});

// --- The contract, against random edits ---------------------------------------------

function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LINES = [
  "Atendí clientes en el mostrador",
  "Coordiné un equipo de cinco personas",
  "Reduje el tiempo de entrega de los pedidos",
  "Armé los informes mensuales para dirección",
  "Capacité a los nuevos ingresos",
  "Llevé las campañas de Google Ads y Meta",
  "Programé un sistema de reservas",
  "Cerré la caja todos los días",
];
const TOOLS = ["React", "Excel", "Git", "HubSpot", "SQL", "Figma"];
const DATES = ["", "2019", "Marzo 2021", "03/2019", "ene. 2020", "Verano 2018", "sept 2018", "2021-06"];
const WORDS = ["Nubia", "Lumen", "Faro", "Andina", "Sur", "Norte", "Delta"];

function randomProfile(next: () => number): Profile {
  const pick = <T,>(items: readonly T[]) => items[Math.floor(next() * items.length)]!;
  const count = (max: number) => Math.floor(next() * (max + 1));
  const experience = Array.from({ length: count(3) }, (_, i) => ({
    id: `e${i}`,
    company: `${pick(WORDS)} ${pick(WORDS)}`,
    role: pick(["Analista", "Asistente", "Cajero", "Desarrollador"]),
    start: pick(DATES),
    end: pick(DATES),
    current: next() < 0.3,
    bullets: Array.from({ length: count(4) }, () => pick(LINES)),
    tags: Array.from({ length: count(3) }, () => pick(TOOLS)),
  }));
  return profileSchema.parse({
    fullName: next() < 0.8 ? "Ana Gómez" : "",
    city: pick(["", "Rosario", "Junín"]),
    skills: Array.from({ length: count(4) }, () => pick(TOOLS)),
    experience,
    education: Array.from({ length: count(2) }, (_, i) => ({
      id: `d${i}`,
      institution: pick(WORDS),
      degree: pick(["Lic.", "Ing.", "Tec."]),
      end: pick(DATES),
    })),
    languages: Array.from({ length: count(2) }, (_, i) => ({
      id: `l${i}`,
      name: pick(["Inglés", "Francés"]),
      level: pick(["", "B2", "Nativo", "Avanzado"]),
    })),
  });
}

function mutate(profile: Profile, next: () => number): Profile {
  const p = structuredClone(profile);
  const pick = <T,>(items: readonly T[]) => items[Math.floor(next() * items.length)]!;
  const job = p.experience.length ? pick(p.experience) : undefined;
  const roll = Math.floor(next() * 14);
  switch (roll) {
    case 0:
      p.city = pick(["", "Córdoba", "Rosario", "Mendoza"]);
      break;
    case 1:
      if (job) job.bullets.push(pick(LINES));
      break;
    case 2:
      if (job && job.bullets.length) job.bullets.splice(Math.floor(next() * job.bullets.length), 1);
      break;
    case 3:
      if (job && job.bullets.length) {
        const i = Math.floor(next() * job.bullets.length);
        job.bullets[i] = `${job.bullets[i]} con mejoras`;
      }
      break;
    case 4:
      if (job) job.bullets.reverse();
      break;
    case 5:
      p.experience.push({
        ...profileSchema.parse({ experience: [{ id: `n${Math.floor(next() * 1e6)}`, company: pick(WORDS), role: "Nuevo" }] })
          .experience[0]!,
      });
      break;
    case 6:
      if (p.experience.length) p.experience.splice(Math.floor(next() * p.experience.length), 1);
      break;
    case 7:
      if (job) job.current = !job.current;
      break;
    case 8:
      if (job) job.start = pick(DATES);
      break;
    case 9:
      if (job) job.end = pick(DATES);
      break;
    case 10:
      p.skills.push(pick(TOOLS));
      break;
    case 11:
      if (p.skills.length) p.skills[Math.floor(next() * p.skills.length)] = `${pick(TOOLS)} avanzado`;
      break;
    case 12:
      if (job) job.tags = job.tags.length ? job.tags.slice(1) : [pick(TOOLS)];
      break;
    default:
      if (p.languages.length) pick(p.languages).level = pick(["", "C1", "Nativo", "Intermedio"]);
  }
  return profileSchema.parse(p);
}

describe("reconcileFromPlain, against random edits", () => {
  it("always projects back to what was asked for, and asking twice changes nothing", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const next = rng(seed);
      let plain = randomProfile(next);
      const newId = ids();
      let stored = reconcileFromPlain(emptyStoredProfile(), plain, { now: T1, newId });
      expect(toPlainProfile(stored), `seed ${seed}: build`).toEqual(plain);

      for (let step = 0; step < 12; step++) {
        plain = mutate(plain, next);
        stored = reconcileFromPlain(stored, plain, { now: T1, newId });
        expect(toPlainProfile(stored), `seed ${seed} step ${step}`).toEqual(plain);
        expect(reconcileFromPlain(stored, plain)).toBe(stored);

        for (const list of [stored.experience, stored.education, stored.languages, stored.skills]) {
          expect(new Set(list.map((entry) => entry.id)).size, `seed ${seed}: ids`).toBe(list.length);
        }
        const factIds = stored.experience.flatMap((job) => job.facts.map((fact) => fact.id));
        expect(new Set(factIds).size, `seed ${seed}: fact ids`).toBe(factIds.length);
      }
    }
  });
});
