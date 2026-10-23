import { describe, expect, it } from "vitest";
import { isRemovableSource, removeSource } from "@/lib/onboarding/remove-source";
import { addFactText } from "@/lib/profile/facts";
import { editFieldAt, restoreArchived, undoLast } from "@/lib/profile/edit";
import { parseCv } from "@/lib/parse/cv-heuristic";
import { linesFromText } from "@/lib/parse/lines";
import { applyParsedDocument } from "@/lib/parse/to-profile";
import { emptyStoredProfile, storedProfileSchema, type StoredProfile } from "@/lib/schemas/profile-v2";
import { SPANISH_BULLETS } from "./fixtures/cv-samples";

/**
 * "Quitar este documento y lo que trajo". What goes is what is still exactly as the document gave it;
 * what the person touched, or another document also says, stays — and all of it comes back in one tap.
 */

const NOW = "2026-10-02T12:00:00.000Z";
let n = 0;
const newId = () => `rm-${++n}`;
const ctx = () => ({ now: NOW, newId });

const read = (text: string, kind: "cv" | "linkedin_pdf" = "cv") => parseCv(linesFromText(text), kind);
const apply = (profile: StoredProfile, text: string, sourceId: string, kind: "cv" | "linkedin_pdf" = "cv", name = `${sourceId}.pdf`) =>
  applyParsedDocument(profile, read(text, kind), { name, fileHash: `hash-${sourceId}`, pasted: false, chars: text.length }, { sourceId, now: NOW, newId }).profile;

/** The same career as it reads on LinkedIn: one task more in one job, a later end date in the other, and a third job. */
const LINKEDIN = SPANISH_BULLETS.replace("• Armé los newsletters semanales.", "• Armé los newsletters semanales.\n• Medí el rendimiento de cada envío.").replace(
  "septiembre 2018 – febrero 2021",
  "septiembre 2018 – abril 2021",
).replace(
  "FORMACIÓN",
  `Casa Verde | Pasante | enero 2017 – diciembre 2017
• Atendí a los clientes del local.

FORMACIÓN`,
);

/** What changes under a removal and a restore, set aside: the trail they leave is not part of what the profile holds. */
const content = (profile: StoredProfile) => {
  const { history: _history, archive: _archive, ...rest } = structuredClone(profile);
  void _history;
  void _archive;
  return rest;
};

describe("a document nobody else says anything about", () => {
  it("goes whole, with everything it brought", () => {
    const profile = apply(emptyStoredProfile(), SPANISH_BULLETS, "cv-1");
    const draft = structuredClone(profile);
    expect(removeSource(draft, "cv-1", ctx())).toBe(true);
    expect(draft.sources).toEqual([]);
    expect(draft.experience).toEqual([]);
    expect(draft.education).toEqual([]);
    expect(draft.skills).toEqual([]);
    expect(draft.languages).toEqual([]);
    expect(draft.certifications).toEqual([]);
    expect(draft.unassigned).toEqual([]);
    expect(draft.contact.fullName.value).toBe("");
    expect(draft.contact.email.value).toBe("");
    expect(draft.contact.links.value).toEqual([]);
    expect(draft.legacy.about.value).toBe("");
  });

  it("is told apart from nothing: a profile with nothing left is blank", () => {
    const draft = apply(emptyStoredProfile(), SPANISH_BULLETS, "cv-1");
    removeSource(draft, "cv-1", ctx());
    expect(storedProfileSchema.parse(draft).experience).toHaveLength(0);
  });

  it("goes into the archive as one piece, with a label that says what it was", () => {
    const draft = apply(emptyStoredProfile(), SPANISH_BULLETS, "cv-1", "cv", "mi-cv.pdf");
    removeSource(draft, "cv-1", ctx());
    expect(draft.archive).toHaveLength(1);
    expect(draft.archive[0]).toMatchObject({ kind: "source", parentPath: ["sources"] });
    expect(draft.archive[0]!.label).toBe("mi-cv.pdf · 2 puestos, 1 estudio, 5 tareas, 6 habilidades, 2 idiomas y 2 certificaciones");
    expect(draft.history.at(-1)).toMatchObject({ op: "remove", path: ["sources", "cv-1"] });
  });

  it("comes back exactly as it was, all of it, from the archive", () => {
    const profile = apply(emptyStoredProfile(), SPANISH_BULLETS, "cv-1");
    const draft = structuredClone(profile);
    removeSource(draft, "cv-1", ctx());
    const restored = restoreArchived(draft, draft.archive[0]!.id, ctx());
    expect(restored.ok).toBe(true);
    expect(content(restored.ok ? restored.profile : draft)).toEqual(content(profile));
    expect(restored.ok && restored.profile.archive).toEqual([]);
  });

  it("comes back by undoing the last thing done", () => {
    const profile = apply(emptyStoredProfile(), SPANISH_BULLETS, "cv-1");
    const draft = structuredClone(profile);
    removeSource(draft, "cv-1", ctx());
    const undone = undoLast(draft, ctx());
    expect(undone.ok && content(undone.profile)).toEqual(content(profile));
  });
});

describe("what a document says again", () => {
  it("is kept on its record: what it repeated, and so added nothing to", () => {
    const first = apply(emptyStoredProfile(), SPANISH_BULLETS, "cv-1");
    const second = apply(first, SPANISH_BULLETS.replace("• Armé los newsletters semanales.", "• Armé los newsletters semanales.\n• Medí cada envío."), "li-1", "linkedin_pdf");
    const said = second.sources.find((entry) => entry.id === "li-1")!.alsoSaid ?? [];
    for (const job of first.experience) expect(said).toContain(job.id);
    expect(said).toContain(first.education[0]!.id);
    for (const skill of first.skills.filter((entry) => entry.name.status !== "proposed")) expect(said).toContain(skill.id);
    expect(said).toContain("contact:email");
    expect(said).toContain("legacy:about");
  });

  it("is not kept for a document that is the first to say anything, or one that says something else", () => {
    const first = apply(emptyStoredProfile(), SPANISH_BULLETS, "cv-1");
    expect(first.sources[0]!.alsoSaid).toBeUndefined();
    const other = apply(first, "MARTA GÓMEZ\n\nEXPERIENCIA\nOtra Empresa | Contadora | enero 2010 – diciembre 2012\n• Llevé la contabilidad.", "li-1", "linkedin_pdf");
    expect(other.sources.find((entry) => entry.id === "li-1")!.alsoSaid ?? []).not.toContain(first.experience[0]!.id);
  });

  it("survives being saved and read back", () => {
    const second = apply(apply(emptyStoredProfile(), SPANISH_BULLETS, "cv-1"), SPANISH_BULLETS, "li-1", "linkedin_pdf");
    expect(storedProfileSchema.parse(JSON.parse(JSON.stringify(second)))).toEqual(second);
  });
});

describe("what the person has touched", () => {
  it("stays: a job they corrected is theirs now, with what it said", () => {
    const profile = apply(emptyStoredProfile(), SPANISH_BULLETS, "cv-1");
    const nubia = profile.experience.find((job) => job.company.value === "Nubia Retail")!;
    editFieldAt(profile, ["experience", nubia.id, "role"], "Analista Senior de Marketing", () => false, ctx());
    removeSource(profile, "cv-1", ctx());
    expect(profile.experience.map((job) => job.company.value)).toEqual(["Nubia Retail"]);
    expect(profile.experience[0]!.facts).toHaveLength(3);
    expect(profile.archive[0]!.label).toMatch(/se quedó lo que editaste$/);
  });

  it("stays: a job they wrote tasks in, however the document read", () => {
    const profile = apply(emptyStoredProfile(), SPANISH_BULLETS, "cv-1");
    const lumen = profile.experience.find((job) => job.company.value === "Grupo Lumen")!;
    addFactText(profile, lumen.id, "Organicé el evento de aniversario", "responsibility", ctx());
    removeSource(profile, "cv-1", ctx());
    expect(profile.experience.map((job) => job.company.value)).toEqual(["Grupo Lumen"]);
    expect(profile.experience[0]!.facts).toHaveLength(3);
  });

  it("stays: a contact detail they changed", () => {
    const profile = apply(emptyStoredProfile(), SPANISH_BULLETS, "cv-1");
    editFieldAt(profile, ["contact", "phone"], "+34 600 00 00 00", () => false, ctx());
    removeSource(profile, "cv-1", ctx());
    expect(profile.contact.phone.value).toBe("+34 600 00 00 00");
    expect(profile.contact.email.value).toBe("");
  });

  it("stays: a skill they renamed", () => {
    const profile = apply(emptyStoredProfile(), SPANISH_BULLETS, "cv-1");
    const skill = profile.skills.find((entry) => entry.name.value === "HubSpot")!;
    editFieldAt(profile, ["skills", skill.id, "name"], "HubSpot CRM", () => false, ctx());
    removeSource(profile, "cv-1", ctx());
    expect(profile.skills.map((entry) => entry.name.value)).toEqual(["HubSpot CRM"]);
  });

  it("comes back, with what they did, as it was", () => {
    const profile = apply(emptyStoredProfile(), SPANISH_BULLETS, "cv-1");
    const nubia = profile.experience.find((job) => job.company.value === "Nubia Retail")!;
    editFieldAt(profile, ["experience", nubia.id, "role"], "Analista Senior de Marketing", () => false, ctx());
    const before = content(profile);
    removeSource(profile, "cv-1", ctx());
    const restored = restoreArchived(profile, profile.archive[0]!.id, ctx());
    expect(restored.ok && content(restored.profile)).toEqual(before);
  });
});

describe("a document another one agrees with", () => {
  const both = () => apply(apply(emptyStoredProfile(), SPANISH_BULLETS, "cv-1"), LINKEDIN, "li-1", "linkedin_pdf", "linkedin.pdf");

  it("raises what the test needs: shared jobs, a job of its own, a task of its own and a disagreement", () => {
    const profile = both();
    expect(profile.experience.map((job) => job.company.value)).toEqual(["Nubia Retail", "Grupo Lumen", "Casa Verde"]);
    expect(profile.experience[1]!.facts.some((fact) => fact.source.docId === "li-1")).toBe(true);
    expect(profile.conflicts.some((conflict) => conflict.incoming.source?.docId === "li-1")).toBe(true);
  });

  it("takes out the later document: its own job, its task, and the disagreement it raised — and keeps the rest", () => {
    const profile = both();
    removeSource(profile, "li-1", ctx());
    expect(profile.experience.map((job) => job.company.value)).toEqual(["Nubia Retail", "Grupo Lumen"]);
    const lumen = profile.experience[1]!;
    expect(lumen.facts.map((fact) => fact.text)).toEqual(["Gestioné el calendario de contenidos en redes sociales.", "Armé los newsletters semanales."]);
    expect(lumen.end.value).toMatchObject({ year: 2021, month: 2 });
    expect(profile.conflicts).toEqual([]);
    expect(profile.sources.map((entry) => entry.id)).toEqual(["cv-1"]);
  });

  it("leaves what the first said exactly as it was said, as if the second had never come", () => {
    const first = apply(emptyStoredProfile(), SPANISH_BULLETS, "cv-1");
    const profile = apply(structuredClone(first), LINKEDIN, "li-1", "linkedin_pdf");
    removeSource(profile, "li-1", ctx());
    expect(content(profile)).toEqual(content(first));
  });

  it("takes out the earlier one: what the later one also says stays as it is — all of it, the jobs and what is under them", () => {
    const profile = both();
    removeSource(profile, "cv-1", ctx());
    expect(profile.experience.map((job) => job.company.value)).toEqual(["Nubia Retail", "Grupo Lumen", "Casa Verde"]);
    const lumen = profile.experience.find((job) => job.company.value === "Grupo Lumen")!;
    expect(lumen.facts.map((fact) => fact.text)).toEqual([
      "Gestioné el calendario de contenidos en redes sociales.",
      "Armé los newsletters semanales.",
      "Medí el rendimiento de cada envío.",
    ]);
    expect(profile.education).toHaveLength(1);
    expect(profile.skills).toHaveLength(6);
    expect(profile.contact.email.value).toBe("lucia.fernandez@example.com");
    expect(profile.sources.map((entry) => entry.id)).toEqual(["li-1"]);
  });

  it("says what stayed, and why", () => {
    const profile = both();
    removeSource(profile, "cv-1", ctx());
    expect(profile.archive[0]!.label).toBe("cv-1.pdf · se quedó lo que otro documento también dice");
  });

  describe("an earlier one that says more than the later one does", () => {
    /** LinkedIn without the second job, without most skills and without the certifications. */
    const PARTIAL = SPANISH_BULLETS.replace(/Grupo Lumen[\s\S]*?FORMACIÓN/, "FORMACIÓN")
      .replace("Google Analytics, SEO, HubSpot, Email marketing, Copywriting", "Google Analytics, SEO")
      .replace(/CURSOS Y CERTIFICACIONES[\s\S]*$/, "");
    const partial = () => apply(apply(emptyStoredProfile(), SPANISH_BULLETS, "cv-1"), PARTIAL, "li-1", "linkedin_pdf", "linkedin.pdf");

    it("goes with what only it said, and keeps what the other one says too", () => {
      const profile = partial();
      expect(profile.experience.map((job) => job.company.value)).toEqual(["Nubia Retail", "Grupo Lumen"]);
      removeSource(profile, "cv-1", ctx());
      expect(profile.experience.map((job) => job.company.value)).toEqual(["Nubia Retail"]);
      expect(profile.experience[0]!.facts).toHaveLength(3);
      // Google Ads is not in LinkedIn's list, but a task of the job that stays names it.
      expect(profile.skills.map((skill) => skill.name.value).sort()).toEqual(["Google Ads", "Google Analytics", "SEO"]);
      expect(profile.certifications).toEqual([]);
      expect(profile.languages).toHaveLength(2);
    });

    it("says both: what went, and what stayed", () => {
      const profile = partial();
      removeSource(profile, "cv-1", ctx());
      expect(profile.archive[0]!.label).toBe("cv-1.pdf · 1 puesto, 2 tareas, 3 habilidades y 2 certificaciones · se quedó lo que otro documento también dice");
    });

    it("comes back, from either side, exactly as it was", () => {
      for (const id of ["cv-1", "li-1"]) {
        const profile = partial();
        const before = content(profile);
        const draft = structuredClone(profile);
        removeSource(draft, id, ctx());
        const restored = restoreArchived(draft, draft.archive[0]!.id, ctx());
        expect(restored.ok && content(restored.profile), id).toEqual(before);
      }
    });
  });

  it("comes back, from either side, exactly as it was", () => {
    for (const id of ["cv-1", "li-1"]) {
      const profile = both();
      const before = content(profile);
      const draft = structuredClone(profile);
      removeSource(draft, id, ctx());
      expect(content(draft)).not.toEqual(before);
      const restored = restoreArchived(draft, draft.archive[0]!.id, ctx());
      expect(restored.ok && content(restored.profile), id).toEqual(before);
    }
  });

  it("does not write over what was put there after it was removed", () => {
    const profile = both();
    const draft = structuredClone(profile);
    removeSource(draft, "li-1", ctx());
    // Something the person filled in after: not the document's to put back.
    const lumen = draft.experience.find((job) => job.company.value === "Grupo Lumen")!;
    addFactText(draft, lumen.id, "Un logro que sumé yo después", "achievement", ctx());
    const restored = restoreArchived(draft, draft.archive[0]!.id, ctx());
    expect(restored.ok).toBe(true);
    const texts = restored.ok ? restored.profile.experience.find((job) => job.company.value === "Grupo Lumen")!.facts.map((fact) => fact.text) : [];
    expect(texts).toContain("Un logro que sumé yo después");
    expect(texts).toContain("Medí el rendimiento de cada envío.");
  });

  it("skips a task whose job has since been removed, and says nothing more of it", () => {
    const profile = both();
    removeSource(profile, "li-1", ctx());
    const gone = profile.experience.findIndex((job) => job.company.value === "Grupo Lumen");
    profile.experience.splice(gone, 1);
    const restored = restoreArchived(profile, profile.archive[0]!.id, ctx());
    expect(restored.ok).toBe(true);
    expect(restored.ok && restored.profile.experience.map((job) => job.company.value)).toEqual(["Nubia Retail", "Casa Verde"]);
  });
});

describe("what is not a document", () => {
  it("is not taken out as one: what someone said has its own notes", () => {
    const profile = emptyStoredProfile();
    profile.sources.push({ id: "dump-1", kind: "dump", name: "Lo que contaste", fileHash: "", pasted: true, chars: 10, importedAt: NOW });
    expect(isRemovableSource(profile.sources[0]!)).toBe(false);
    expect(removeSource(profile, "dump-1", ctx())).toBe(false);
    expect(profile.sources).toHaveLength(1);
    expect(profile.archive).toEqual([]);
  });

  it("is nothing to take out when there is no such document", () => {
    const profile = apply(emptyStoredProfile(), SPANISH_BULLETS, "cv-1");
    expect(removeSource(profile, "nada", ctx())).toBe(false);
    expect(profile.sources).toHaveLength(1);
  });

  it("leaves what a dump brought when a document is removed", () => {
    const profile = apply(emptyStoredProfile(), SPANISH_BULLETS, "cv-1");
    profile.notes.push({ id: "note-1", text: "Lo que conté al principio", sourceId: "dump-1", at: NOW });
    removeSource(profile, "cv-1", ctx());
    expect(profile.notes).toHaveLength(1);
  });
});

describe("a bundle that cannot be read back", () => {
  it("is not restored, and nothing is changed", () => {
    const profile = apply(emptyStoredProfile(), SPANISH_BULLETS, "cv-1");
    removeSource(profile, "cv-1", ctx());
    profile.archive[0]!.entity = { id: "cv-1", source: "no es un documento" };
    const restored = restoreArchived(profile, profile.archive[0]!.id, ctx());
    expect(restored).toEqual({ ok: false, reason: "invalid" });
  });
});
