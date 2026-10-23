import { describe, expect, it } from "vitest";
import {
  aiReadingPlan,
  assignUnassigned,
  clearProposedAbout,
  clearProposedHeadline,
  confirmMarkedPrompt,
  doubtfulLines,
  jobLine,
  markedLabel,
  studyLine,
  clearProposedPractical,
  confirmAll,
  confirmContact,
  confirmEducation,
  confirmExperience,
  confirmUnflagged,
  conflictsFavouring,
  dismissUnassigned,
  editEducation,
  editExperience,
  lowConfidenceSources,
  markedIn,
  needsAttention,
  noCareerNotice,
  readCleanly,
  readReceipt,
  readReceipts,
  removeEducation,
  removeExperience,
  removeNote,
  removeSkill,
  resolveConflictsFrom,
  reviewCounts,
  reviewSummary,
  setSelfEmployed,
  swapCompanyAndRole,
  unassignedToNote,
  unassignedToAbout,
  unassignedToExtra,
  unassignedToLink,
  unassignedToSkill,
  unreadableIn,
} from "@/lib/onboarding/review";
import { SELF_EMPLOYED } from "@/lib/onboarding/entries";
import { detectGaps } from "@/lib/onboarding/gaps";
import { restoreArchived, undoLast } from "@/lib/profile/edit";
import { toPlainProfile } from "@/lib/profile/project";
import { applyParsedDocument } from "@/lib/parse/to-profile";
import type { ParsedExperience } from "@/lib/parse/types";
import { parseCv } from "@/lib/parse/cv-heuristic";
import { linesFromText } from "@/lib/parse/lines";
import {
  emptyStoredProfile,
  storedProfileSchema,
  type Conflict,
  type ImportedSource,
  type ReadCounts,
  type SourceKind,
  type StoredExperience,
  type StoredProfile,
} from "@/lib/schemas/profile-v2";
import { AMBIGUOUS, ENGLISH_STACKED, SPANISH_BULLETS, UNDATED_EDUCATION } from "./fixtures/cv-samples";

const NOW = "2026-09-21T12:00:00.000Z";
let n = 0;
const ctx = () => ({ now: NOW, newId: () => `id-${++n}` });

function profileFrom(text: string): StoredProfile {
  const parsed = parseCv(linesFromText(text));
  return applyParsedDocument(emptyStoredProfile(), parsed, { name: "cv.pdf", fileHash: `h-${text.length}`, pasted: false, chars: 1 }, { sourceId: "src-1", now: NOW, newId: ctx().newId }).profile;
}

describe("lowConfidenceSources", () => {
  function withLowConfidenceJob(kind: "cv" | "linkedin_csv"): StoredProfile {
    const profile = emptyStoredProfile();
    profile.sources.push({ id: "src-1", kind, name: "mi-archivo", fileHash: "h-1", pasted: false, chars: 100, importedAt: NOW });
    profile.experience.push({
      id: "exp-1",
      company: { value: "Nubia Retail", status: "proposed", source: { kind, docId: "src-1", at: NOW } },
      role: { value: "", status: "proposed" },
      city: { value: "", status: "proposed" },
      country: { value: "", status: "proposed" },
      start: { value: {}, status: "proposed" },
      end: { value: {}, status: "proposed" },
      facts: [],
      review: { confidence: "low", doubts: ["no_role"], span: [0, 0] },
    });
    return profile;
  }

  it("offers a CV block still read with low confidence", () => {
    const profile = withLowConfidenceJob("cv");
    expect(lowConfidenceSources(profile)).toEqual([{ sourceId: "src-1", name: "mi-archivo" }]);
  });

  it("never offers a LinkedIn data export: it is rows, not lines, so a second AI-assisted pass has nothing to read", () => {
    const profile = withLowConfidenceJob("linkedin_csv");
    expect(lowConfidenceSources(profile)).toEqual([]);
  });

  describe("a section of experience the reader could not cut", () => {
    const TEXT = "Cajero en Kiosco del Centro\nAtención al cliente, manejo de caja y arqueo diario.";
    const withLeftover = (over: Partial<StoredProfile["unassigned"][number]> = {}, kind: "cv" | "dump" | "linkedin_pdf" = "cv"): StoredProfile => {
      const profile = emptyStoredProfile();
      profile.sources.push({ id: "src-1", kind, name: "cv-viejo.pdf", fileHash: "h-1", pasted: false, chars: 100, importedAt: NOW });
      profile.unassigned.push({ id: "u1", text: TEXT, kind: "other", heading: "EXPERIENCIA", sourceId: "src-1", ...over });
      return profile;
    };

    it("is offered the AI reading even though no block of it was read at all — that is the least it can be sure of", () => {
      expect(lowConfidenceSources(withLeftover())).toEqual([{ sourceId: "src-1", name: "cv-viejo.pdf" }]);
      expect(lowConfidenceSources(withLeftover({ heading: "Voluntariado" }))).toEqual([{ sourceId: "src-1", name: "cv-viejo.pdf" }]);
    });

    it("is offered once, however many blocks and leftovers one document has", () => {
      const profile = withLeftover();
      profile.unassigned.push({ id: "u2", text: TEXT, kind: "other", heading: "Experiencia laboral", sourceId: "src-1" });
      expect(lowConfidenceSources(profile)).toHaveLength(1);
    });

    it("is not offered for what the tray holds of any other section, or of no section", () => {
      expect(lowConfidenceSources(withLeftover({ heading: "ESTUDIOS" }))).toEqual([]);
      expect(lowConfidenceSources(withLeftover({ heading: "Intereses", kind: "interests" }))).toEqual([]);
      expect(lowConfidenceSources(withLeftover({ kind: "summary" }))).toEqual([]);
      const headless = withLeftover();
      delete headless.unassigned[0]!.heading;
      expect(lowConfidenceSources(headless)).toEqual([]);
    });

    it("is not offered for a line that says there is nothing to read", () => {
      expect(lowConfidenceSources(withLeftover({ text: "Sin experiencia previa." }))).toEqual([]);
    });

    it("is not offered for text that has no document behind it, or that a model already read", () => {
      expect(lowConfidenceSources(withLeftover({ sourceId: undefined as never }))).toEqual([]);
      expect(lowConfidenceSources(withLeftover({}, "dump"))).toEqual([]);
    });

    it("is not offered when the document did give jobs: what a section left over then is a stray line, not a section", () => {
      const profile = withLeftover();
      profile.experience.push({
        id: "exp-1",
        company: { value: "Nubia Retail", status: "confirmed", source: { kind: "cv", docId: "src-1", at: NOW } },
        role: { value: "Analista", status: "confirmed", source: { kind: "cv", docId: "src-1", at: NOW } },
        city: { value: "", status: "confirmed" },
        country: { value: "", status: "confirmed" },
        start: { value: { year: 2020 }, status: "confirmed" },
        end: { value: { year: 2022 }, status: "confirmed" },
        facts: [],
      });
      expect(lowConfidenceSources(profile)).toEqual([]);
    });

    it("is still offered when the only jobs are someone else's: a job typed by hand is not this document's reading", () => {
      const profile = withLeftover();
      profile.experience.push({
        id: "exp-2",
        company: { value: "Kiosco", status: "confirmed", source: { kind: "manual", at: NOW } },
        role: { value: "Cajero", status: "confirmed", source: { kind: "manual", at: NOW } },
        city: { value: "", status: "confirmed" },
        country: { value: "", status: "confirmed" },
        start: { value: { year: 2020 }, status: "confirmed" },
        end: { value: { year: 2022 }, status: "confirmed" },
        facts: [],
      });
      expect(lowConfidenceSources(profile)).toEqual([{ sourceId: "src-1", name: "cv-viejo.pdf" }]);
    });

    it("stops being offered once the text is gone from the tray", () => {
      const profile = withLeftover();
      profile.unassigned = [];
      expect(lowConfidenceSources(profile)).toEqual([]);
    });
  });
});

describe("aiReadingPlan", () => {
  const stubExperience: ParsedExperience = { kind: "job", facts: [], confidence: "high", doubts: [], span: [0, 0] };

  /** A job still proposed by `docId` (has `review`), or confirmed (no `review` at all). */
  function job(id: string, docId: string, confirmed = false): StoredExperience {
    return {
      id,
      company: { value: `Empresa ${id}`, status: confirmed ? "confirmed" : "proposed", source: { kind: "cv", docId, at: NOW } },
      role: { value: "Analista", status: "confirmed" },
      city: { value: "", status: "confirmed" },
      country: { value: "", status: "confirmed" },
      start: { value: { year: 2021 }, status: "confirmed" },
      end: { value: { current: true }, status: "confirmed" },
      facts: [],
      ...(confirmed ? {} : { review: { confidence: "low" as const, doubts: [], span: [0, 0] as [number, number] } }),
    };
  }

  function withThreePending(): StoredProfile {
    const profile = emptyStoredProfile();
    profile.experience.push(job("e1", "src-1"), job("e2", "src-1"), job("e3", "src-1"));
    return profile;
  }

  it("rejects an AI reading that found nothing checkable, without replacing anything", () => {
    expect(aiReadingPlan(withThreePending(), "src-1", { experience: [], education: [] })).toMatchObject({ action: "reject" });
  });

  it("asks first when the AI reading found fewer blocks than are still pending from this document", () => {
    const plan = aiReadingPlan(withThreePending(), "src-1", { experience: [stubExperience, stubExperience], education: [] });
    expect(plan).toMatchObject({ action: "confirm", removing: 3, adding: 2 });
  });

  it("replaces outright when the AI reading found at least as many blocks", () => {
    const found = [stubExperience, stubExperience, stubExperience];
    expect(aiReadingPlan(withThreePending(), "src-1", { experience: found, education: [] })).toEqual({ action: "replace" });
  });

  it("does not count a block the person already confirmed, or one read from a different document", () => {
    const profile = withThreePending();
    profile.experience.push(job("e4", "src-1", true), job("e5", "src-2"));

    const plan = aiReadingPlan(profile, "src-1", { experience: [stubExperience, stubExperience], education: [] });
    expect(plan).toMatchObject({ removing: 3 }); // e4 and e5 do not inflate it to 4 or 5
  });
});

describe("confirming", () => {
  it("takes a block read with doubts as right: every proposed value confirmed, the note dropped", () => {
    const draft = profileFrom(AMBIGUOUS);
    const job = draft.experience[0]!;
    expect(job.company.status).toBe("proposed");
    expect(needsAttention(job)).toBe(true);

    expect(confirmExperience(draft, job.id)).toBe(true);
    expect(job.company.status).toBe("confirmed");
    expect(job.role.status).toBe("confirmed");
    expect(job.start.status).toBe("confirmed");
    expect(job.review).toBeUndefined();
    expect(needsAttention(job)).toBe(false);
  });

  it("keeps where a block was read from — 'Ver en el original' — after confirming drops the review that used to carry it", () => {
    const draft = profileFrom(AMBIGUOUS);
    const job = draft.experience[0]!;
    const span = job.origin;
    expect(span).toEqual(job.review!.span);
    confirmExperience(draft, job.id);
    expect(job.review).toBeUndefined();
    expect(job.origin).toEqual(span);
  });

  it("does not turn something the person edited back into merely confirmed", () => {
    const draft = profileFrom(SPANISH_BULLETS);
    const job = draft.experience[0]!;
    editExperience(draft, job.id, { company: "Nubia SA" }, ctx());
    confirmExperience(draft, job.id);
    expect(job.company.status).toBe("edited");
  });

  it("confirms facts along with the entry", () => {
    const draft = profileFrom(AMBIGUOUS);
    const job = draft.experience[0]!;
    job.facts[0]!.status = "proposed";
    confirmExperience(draft, job.id);
    expect(job.facts.every((fact) => fact.status === "confirmed")).toBe(true);
  });

  it("confirms an education entry", () => {
    const draft = profileFrom(UNDATED_EDUCATION);
    const entry = draft.education[0]!;
    expect(needsAttention(entry)).toBe(true);
    confirmEducation(draft, entry.id);
    expect(entry.review).toBeUndefined();
    expect(entry.institution.status === "confirmed" || entry.institution.value === "").toBe(true);
  });

  it("confirms everything at once", () => {
    const draft = profileFrom(UNDATED_EDUCATION);
    confirmAll(draft);
    expect([...draft.experience, ...draft.education].some((entry) => needsAttention(entry))).toBe(false);
  });

  it("does not attend to a block that was read with confidence", () => {
    const draft = profileFrom(SPANISH_BULLETS);
    expect(draft.experience.some((entry) => needsAttention(entry))).toBe(false);
  });

  it("says no for something that is not there", () => {
    const draft = emptyStoredProfile();
    expect(confirmExperience(draft, "nada")).toBe(false);
    expect(confirmEducation(draft, "nada")).toBe(false);
  });
});

describe("correcting", () => {
  it("marks what changed as edited, remembers what it was, and leaves the rest as it was", () => {
    const draft = profileFrom(SPANISH_BULLETS);
    const job = draft.experience[0]!;
    const before = structuredClone(job.role);
    editExperience(draft, job.id, { company: "Nubia Retail SA", city: "Valencia" }, ctx());

    expect(job.company).toMatchObject({ value: "Nubia Retail SA", status: "edited", original: "Nubia Retail" });
    expect(job.role).toEqual(before);
    expect(draft.history.some((h) => h.path.join("/") === `experience/${job.id}/company`)).toBe(true);
  });

  it("changes nothing when nothing is different", () => {
    const draft = profileFrom(SPANISH_BULLETS);
    const job = draft.experience[0]!;
    const before = structuredClone(draft);
    editExperience(draft, job.id, { company: "Nubia Retail", role: "Analista de Marketing Digital" }, ctx());
    expect(draft).toEqual(before);
  });

  it("takes a date from the picker, dropping the text it was read from", () => {
    const draft = profileFrom(SPANISH_BULLETS);
    const job = draft.experience[0]!;
    editExperience(draft, job.id, { start: { year: 2021, month: 4 }, end: { year: 2024 } }, ctx());
    expect(job.start.value).toEqual({ year: 2021, month: 4 });
    expect(job.start.status).toBe("edited");
    expect(job.start.original).toMatchObject({ year: 2021, month: 3, raw: "marzo 2021" });
    expect(job.end.value).toEqual({ year: 2024 });
    expect(toPlainProfile(draft).experience[0]).toMatchObject({ start: "Abril 2021", end: "2024", current: false });
  });

  it("can say a job is still going", () => {
    const draft = profileFrom(SPANISH_BULLETS);
    const job = draft.experience[1]!;
    editExperience(draft, job.id, { end: { current: true } }, ctx());
    expect(toPlainProfile(draft).experience[1]).toMatchObject({ current: true });
  });

  it("corrects an education entry", () => {
    const draft = profileFrom(SPANISH_BULLETS);
    const entry = draft.education[0]!;
    editEducation(draft, entry.id, { degree: "Grado en ADE", end: { year: 2018 } }, ctx());
    expect(entry.degree).toMatchObject({ value: "Grado en ADE", status: "edited" });
    expect(entry.end.value).toEqual({ year: 2018 });
  });

  it("can say a study is still going — its end has no 'current' of its own, only this status", () => {
    const draft = profileFrom(SPANISH_BULLETS);
    const entry = draft.education[0]!;
    // "completed" is the schema's own default, not something the document
    // asserted, so setting it for the first time is a fill, the same as any
    // other field that starts blank — not a correction of a wrong reading.
    editEducation(draft, entry.id, { end: {}, status: "in_progress" }, ctx());
    expect(entry.status).toMatchObject({ value: "in_progress", status: "confirmed" });
    expect(entry.end.value).toEqual({});

    // Going back to "completed" afterwards, though, is undoing that choice.
    editEducation(draft, entry.id, { status: "completed" }, ctx());
    expect(entry.status).toMatchObject({ value: "completed", status: "edited" });
  });

  it("sets the type and the mode of a job that no source said anything about, as the person's own choice", () => {
    const draft = profileFrom(SPANISH_BULLETS);
    const job = draft.experience[0]!;
    expect(job.employmentType).toBeUndefined();
    editExperience(draft, job.id, { employmentType: "part_time", workMode: "remote" }, ctx());
    expect(job.employmentType).toMatchObject({ value: "part_time", status: "confirmed", source: { kind: "manual" } });
    expect(job.workMode).toMatchObject({ value: "remote", status: "confirmed" });
    expect(draft.history.some((h) => h.path.join("/") === `experience/${job.id}/employmentType`)).toBe(true);
  });

  it("changes them afterwards as an edit, keeping the first choice, and does nothing when it is the same one", () => {
    const draft = profileFrom(SPANISH_BULLETS);
    const job = draft.experience[0]!;
    editExperience(draft, job.id, { employmentType: "part_time" }, ctx());
    const once = structuredClone(draft);
    editExperience(draft, job.id, { employmentType: "part_time" }, ctx());
    expect(draft).toEqual(once);
    editExperience(draft, job.id, { employmentType: "freelance" }, ctx());
    expect(job.employmentType).toMatchObject({ value: "freelance", status: "edited", original: "part_time" });
  });

  it("saves 'Por mi cuenta' as the place of a job with no employer, and the kind of work as freelance, as the person's own choice", () => {
    const draft = emptyStoredProfile();
    draft.experience.push(storedProfileSchema.parse({ experience: [{ id: "j1", role: { value: "Diseñador" }, start: { value: { year: 2021, month: 3 } } }] }).experience[0]!);
    const job = draft.experience[0]!;
    expect(detectGaps(draft, new Date(NOW)).find((gap) => gap.rule === "incomplete_skeleton")?.payload.missing).toEqual(["company"]);

    expect(setSelfEmployed(draft, "j1", ctx())).toBe(true);
    expect(job.company).toMatchObject({ value: SELF_EMPLOYED, status: "confirmed", source: { kind: "manual" } });
    expect(job.employmentType).toMatchObject({ value: "freelance", status: "confirmed", source: { kind: "manual" } });
    // It was what the question asked for: the job is not missing its company any more.
    expect(detectGaps(draft, new Date(NOW)).some((gap) => gap.rule === "incomplete_skeleton")).toBe(false);
    expect(draft.history.some((h) => h.path.join("/") === "experience/j1/company")).toBe(true);
  });

  it("leaves the kind of work alone when a source already said which it was: the button is about the place", () => {
    const draft = emptyStoredProfile();
    draft.experience.push(
      storedProfileSchema.parse({
        experience: [{ id: "j1", role: { value: "Diseñador" }, start: { value: { year: 2021 } }, employmentType: { value: "full_time", status: "proposed", source: { kind: "cv", at: NOW } } }],
      }).experience[0]!,
    );
    setSelfEmployed(draft, "j1", ctx());
    expect(draft.experience[0]!.company.value).toBe(SELF_EMPLOYED);
    expect(draft.experience[0]!.employmentType).toMatchObject({ value: "full_time", status: "proposed" });
  });

  it("says there is nothing to save for a job that is not there, and records nothing", () => {
    const draft = emptyStoredProfile();
    expect(setSelfEmployed(draft, "nope", ctx())).toBe(false);
    expect(draft.history).toEqual([]);
  });

  it("changes nothing the second time: the place is already that and so is the kind of work", () => {
    const draft = emptyStoredProfile();
    draft.experience.push(storedProfileSchema.parse({ experience: [{ id: "j1", role: { value: "Diseñador" } }] }).experience[0]!);
    setSelfEmployed(draft, "j1", ctx());
    const once = structuredClone(draft);
    setSelfEmployed(draft, "j1", ctx());
    expect(draft).toEqual(once);
  });

  it("corrects the city, the country and the honors of a study, the same way", () => {
    const draft = profileFrom(SPANISH_BULLETS);
    const entry = draft.education[0]!;
    editEducation(draft, entry.id, { city: " Córdoba ", country: "Argentina", honors: "Promedio 9" }, ctx());
    expect(entry.city).toMatchObject({ value: "Córdoba", status: "confirmed" });
    expect(entry.country.value).toBe("Argentina");
    expect(entry.honors.value).toBe("Promedio 9");
    editEducation(draft, entry.id, { city: "Rosario" }, ctx());
    expect(entry.city).toMatchObject({ value: "Rosario", status: "edited", original: "Córdoba" });
  });

  it("can be undone", () => {
    const draft = profileFrom(SPANISH_BULLETS);
    const before = structuredClone(draft.experience[0]!.company);
    editExperience(draft, draft.experience[0]!.id, { company: "Otra" }, ctx());
    const undone = undoLast(draft, ctx());
    expect(undone.ok && undone.profile.experience[0]!.company).toEqual(before);
  });

  it("says no for something that is not there", () => {
    expect(editExperience(emptyStoredProfile(), "nada", { company: "x" })).toBe(false);
    expect(editEducation(emptyStoredProfile(), "nada", { degree: "x" })).toBe(false);
  });
});

describe("when the company was read as the role", () => {
  it("is one tap to put right, and the doubt is settled", () => {
    const draft = profileFrom(AMBIGUOUS);
    const job = draft.experience[0]!;
    expect(job.review?.candidates).toEqual(["Estrella Norte", "Mercado Sur"]);
    const { company, role } = { company: job.company.value, role: job.role.value };

    swapCompanyAndRole(draft, job.id, ctx());
    expect(job.company.value).toBe(role);
    expect(job.role.value).toBe(company);
    expect(job.company.status).toBe("edited");
    // It was the one doubt: saying which is which is standing behind the job, so there is no «Está bien» left to press.
    expect(job.review).toBeUndefined();
    expect(needsAttention(job)).toBe(false);
  });
});

describe("removing", () => {
  it("archives instead of losing, and can bring it back where it was", () => {
    const draft = profileFrom(SPANISH_BULLETS);
    const [first, second] = draft.experience;
    expect(removeExperience(draft, first!.id, ctx())).toBe(true);
    expect(draft.experience.map((e) => e.id)).toEqual([second!.id]);
    expect(draft.archive).toHaveLength(1);
    expect(draft.archive[0]!.label).toBe("Nubia Retail — Analista de Marketing Digital");

    const restored = restoreArchived(draft, draft.archive[0]!.id, ctx());
    expect(restored.ok && restored.profile.experience.map((e) => e.id)).toEqual([first!.id, second!.id]);
  });

  it("removes an education entry the same way", () => {
    const draft = profileFrom(SPANISH_BULLETS);
    expect(removeEducation(draft, draft.education[0]!.id, ctx())).toBe(true);
    expect(draft.education).toHaveLength(0);
    expect(draft.archive[0]!.kind).toBe("education");
  });

  it("says no for something that is not there", () => {
    expect(removeExperience(emptyStoredProfile(), "nada")).toBe(false);
    expect(removeEducation(emptyStoredProfile(), "nada")).toBe(false);
    expect(removeSkill(emptyStoredProfile(), "nada")).toBe(false);
    expect(removeNote(emptyStoredProfile(), "nada")).toBe(false);
  });

  it("takes a note out the same way: to the archive, labelled by what it said, and back where it was", () => {
    const draft = emptyStoredProfile();
    draft.notes.push(
      { id: "a", text: "Trabajo en el Kiosco del Centro\ndesde 2022 y atiendo la caja, repongo la mercadería y armo los pedidos.", at: NOW },
      { id: "b", text: "Otra cosa que conté al principio.", sourceId: "dump-1", at: NOW },
    );
    expect(removeNote(draft, "a", ctx())).toBe(true);
    expect(draft.notes.map((note) => note.id)).toEqual(["b"]);
    expect(draft.archive[0]).toMatchObject({ kind: "note", parentPath: ["notes"], index: 0 });
    // Sixty characters of what it said, on one line.
    expect(draft.archive[0]!.label).toBe("Trabajo en el Kiosco del Centro desde 2022 y atiendo la caja");
    expect(draft.history.at(-1)).toMatchObject({ op: "remove", path: ["notes", "a"] });

    const restored = restoreArchived(draft, draft.archive[0]!.id, ctx());
    expect(restored.ok && restored.profile.notes.map((note) => note.id)).toEqual(["a", "b"]);
    expect(restored.ok && restored.profile.notes[0]!.text).toContain("desde 2022");
  });

  it("can be undone as the last thing done", () => {
    const draft = emptyStoredProfile();
    draft.notes.push({ id: "a", text: "Algo que conté al principio y que quiero conservar.", at: NOW });
    removeNote(draft, "a", ctx());
    const undone = undoLast(draft, ctx());
    expect(undone.ok && undone.profile.notes.map((note) => note.id)).toEqual(["a"]);
    expect(undone.ok && undone.profile.archive).toEqual([]);
  });
});

describe("the skills read out of the jobs' own lines", () => {
  it("are taken as right with everything else by 'Todo correcto'", () => {
    const draft = profileFrom(SPANISH_BULLETS);
    expect(draft.skills.find((skill) => skill.name.value === "Google Ads")!.name.status).toBe("proposed");
    confirmAll(draft);
    expect(draft.skills.every((skill) => skill.name.status === "confirmed")).toBe(true);
  });

  it("once taken out, are not offered back by the question the line would otherwise raise", () => {
    const draft = profileFrom(SPANISH_BULLETS);
    const ads = draft.skills.find((skill) => skill.name.value === "Google Ads")!;
    expect(removeSkill(draft, ads.id, ctx())).toBe(true);
    expect(draft.archive.at(-1)).toMatchObject({ kind: "skill", label: "Google Ads" });
    const offer = detectGaps(draft, new Date(NOW)).find((gap) => gap.rule === "loose_tool");
    // Only the ambiguous one the line also names is still there to ask about.
    expect(offer?.payload.tools).toEqual(["Meta"]);
  });

  it("taking out a skill that is not a tool leaves the questions as they were", () => {
    const draft = profileFrom(SPANISH_BULLETS);
    draft.skills.push({ id: "neg", name: { value: "Negociación con proveedores", status: "confirmed" }, experienceIds: [] });
    const before = draft.pending.length;
    expect(removeSkill(draft, "neg", ctx())).toBe(true);
    expect(draft.pending).toHaveLength(before);
  });
});

describe("what fit nowhere", () => {
  const withTray = () => {
    const draft = profileFrom(SPANISH_BULLETS);
    draft.unassigned.push({ id: "u1", text: "Disponibilidad inmediata para viajar", kind: "other", sourceId: "src-1", heading: "Otros" });
    return draft;
  };

  it("can be kept as a note, and is not lost", () => {
    const draft = withTray();
    expect(unassignedToNote(draft, "u1", ctx())).toBe(true);
    expect(draft.unassigned.some((u) => u.id === "u1")).toBe(false);
    expect(draft.notes.at(-1)).toMatchObject({ text: "Disponibilidad inmediata para viajar", sourceId: "src-1" });
  });

  it("can be dropped", () => {
    const draft = withTray();
    const notes = draft.notes.length;
    expect(dismissUnassigned(draft, "u1")).toBe(true);
    expect(draft.unassigned.some((u) => u.id === "u1")).toBe(false);
    expect(draft.notes).toHaveLength(notes);
  });

  it("can be given to a job, where it becomes one of its facts in its own words", () => {
    const draft = withTray();
    const job = draft.experience[0]!;
    const facts = job.facts.length;
    expect(assignUnassigned(draft, "u1", job.id, ctx())).toBe(true);
    expect(job.facts).toHaveLength(facts + 1);
    expect(job.facts.at(-1)).toMatchObject({
      text: "Disponibilidad inmediata para viajar",
      kind: "responsibility",
      status: "confirmed",
      source: { kind: "manual", docId: "src-1", quote: "Disponibilidad inmediata para viajar" },
    });
    expect(draft.unassigned.some((u) => u.id === "u1")).toBe(false);
  });

  it("says no for something that is not there, and keeps the text when the job is not", () => {
    const draft = withTray();
    expect(assignUnassigned(draft, "u1", "no-existe", ctx())).toBe(false);
    expect(draft.unassigned.some((u) => u.id === "u1")).toBe(true);
    expect(unassignedToNote(draft, "nada")).toBe(false);
    expect(dismissUnassigned(draft, "nada")).toBe(false);
  });
});

describe("the tray's own typed actions", () => {
  it("a summary becomes «Sobre vos», replacing whatever was already read there", () => {
    const draft = profileFrom(SPANISH_BULLETS);
    // The document's own "PERFIL" already filled this in on import (see `to-profile.ts`).
    expect(draft.legacy.about.value).toBe("Analista con seis años de experiencia en campañas de pago y SEO.");
    draft.unassigned.push({ id: "u2", text: "Otra vida, contada distinto.", kind: "summary", sourceId: "src-1" });
    expect(unassignedToAbout(draft, "u2", ctx())).toBe(true);
    expect(draft.legacy.about.value).toBe("Otra vida, contada distinto.");
    expect(draft.unassigned.some((u) => u.id === "u2")).toBe(false);
  });

  it("a link joins the profile's own, up to the usual cap", () => {
    const draft = profileFrom(SPANISH_BULLETS);
    draft.unassigned.push({ id: "u3", text: "https://ana.dev", kind: "link", sourceId: "src-1" });
    expect(unassignedToLink(draft, "u3", ctx())).toBe(true);
    expect(draft.contact.links.value).toContainEqual({ label: "ana.dev", url: "https://ana.dev" });
    expect(draft.unassigned.some((u) => u.id === "u3")).toBe(false);
  });

  it("does not add the same link twice, or once the profile already has five", () => {
    const draft = profileFrom(SPANISH_BULLETS);
    draft.contact.links = {
      value: Array.from({ length: 5 }, (_, i) => ({ label: `site-${i}.dev`, url: `https://site-${i}.dev` })),
      status: "confirmed",
    };
    draft.unassigned.push({ id: "u4", text: "https://ana.dev", kind: "link", sourceId: "src-1" });
    expect(unassignedToLink(draft, "u4", ctx())).toBe(false);
    expect(draft.contact.links.value).toHaveLength(5);
    expect(draft.unassigned.some((u) => u.id === "u4")).toBe(true);
  });

  it("clears a link the profile already has, however it was written, even with five links", () => {
    const draft = profileFrom(SPANISH_BULLETS);
    draft.contact.links = {
      value: [{ label: "linkedin.com/in/perfil-ejemplo", url: "https://linkedin.com/in/perfil-ejemplo" }, ...Array.from({ length: 4 }, (_, i) => ({ label: `site-${i}.dev`, url: `https://site-${i}.dev` }))],
      status: "confirmed",
    };
    draft.unassigned.push({ id: "u6", text: "https://www.linkedin.com/in/perfil-ejemplo/", kind: "link", sourceId: "src-1" });
    expect(unassignedToLink(draft, "u6", ctx())).toBe(true);
    expect(draft.contact.links.value).toHaveLength(5);
    expect(draft.unassigned.some((u) => u.id === "u6")).toBe(false);
  });

  it("a tool named in a sentence becomes an aptitude", () => {
    const draft = profileFrom(SPANISH_BULLETS);
    const skills = draft.skills.length;
    draft.unassigned.push({ id: "u5", text: "Kubernetes", kind: "skill", sourceId: "src-1" });
    expect(unassignedToSkill(draft, "u5", ctx())).toBe(true);
    expect(draft.skills).toHaveLength(skills + 1);
    expect(draft.skills.at(-1)).toMatchObject({ name: { value: "Kubernetes", status: "confirmed" } });
    expect(draft.unassigned.some((u) => u.id === "u5")).toBe(false);
  });

  it("does not add an aptitude the profile already has", () => {
    const draft = profileFrom(SPANISH_BULLETS);
    const already = draft.skills[0]!.name.value;
    draft.unassigned.push({ id: "u6", text: already, kind: "skill", sourceId: "src-1" });
    const skills = draft.skills.length;
    expect(unassignedToSkill(draft, "u6", ctx())).toBe(false);
    expect(draft.skills).toHaveLength(skills);
  });

  it("an award or interest joins «Otros datos» as one more line", () => {
    const draft = profileFrom(SPANISH_BULLETS);
    draft.unassigned.push({ id: "u7", text: "Medalla al mérito académico", kind: "awards", sourceId: "src-1" });
    expect(unassignedToExtra(draft, "u7", ctx())).toBe(true);
    expect(draft.legacy.extras.value).toContain("Medalla al mérito académico");
    expect(draft.unassigned.some((u) => u.id === "u7")).toBe(false);
  });
});

describe("\"Quitar\" on what a document filled in outside the timeline", () => {
  it("clears a still-proposed «Sobre vos»", () => {
    const draft = profileFrom(SPANISH_BULLETS);
    expect(draft.legacy.about.status).toBe("proposed");
    expect(clearProposedAbout(draft)).toBe(true);
    expect(draft.legacy.about).toEqual({ value: "", status: "confirmed" });
  });

  it("does nothing once the person has already confirmed or edited it", () => {
    const draft = profileFrom(SPANISH_BULLETS);
    draft.legacy.about.status = "confirmed";
    expect(clearProposedAbout(draft)).toBe(false);
    expect(draft.legacy.about.value).not.toBe("");
  });

  it("clears every proposed practical fact at once", () => {
    const draft = profileFrom(SPANISH_BULLETS);
    draft.legacy.practical = { value: { availability: "Full time, Part time", driverLicense: "", ownVehicle: false, willingToRelocate: false, workEligibility: "" }, status: "proposed" };
    expect(clearProposedPractical(draft)).toBe(true);
    expect(draft.legacy.practical.status).toBe("confirmed");
    expect(draft.legacy.practical.value.availability).toBe("");
  });

  it("leaves a confirmed practical field alone", () => {
    const draft = profileFrom(SPANISH_BULLETS);
    draft.legacy.practical = { value: { availability: "Full time", driverLicense: "", ownVehicle: false, willingToRelocate: false, workEligibility: "" }, status: "confirmed" };
    expect(clearProposedPractical(draft)).toBe(false);
    expect(draft.legacy.practical.value.availability).toBe("Full time");
  });
});

// --- Stage 2: a review that is honest about what it confirmed ------------------------------------

/** A job as the review sees it: read with doubts (`proposed`, low confidence) or read with confidence and confirmed. */
function jobEntry(id: string, doubtful: boolean): StoredExperience {
  const status = doubtful ? ("proposed" as const) : ("confirmed" as const);
  return {
    id,
    company: { value: `Empresa ${id}`, status },
    role: { value: `Puesto ${id}`, status },
    city: { value: "", status: "confirmed" },
    country: { value: "", status: "confirmed" },
    start: { value: { year: 2020 }, status },
    end: { value: { year: 2021 }, status },
    facts: [],
    review: { confidence: doubtful ? "low" : "high", doubts: doubtful ? ["no_role"] : [], span: [0, 0] },
  };
}

const conflictOf = (id: string, entityId: string, current: SourceKind, incoming: SourceKind): Conflict => ({
  id,
  entity: "experience",
  entityId,
  field: "end",
  current: { value: { year: 2021 }, source: { kind: current, at: NOW } },
  incoming: { value: { year: 2022 }, source: { kind: incoming, at: NOW } },
  at: NOW,
});

describe("moving on without saying they are all fine", () => {
  it("takes as right what nobody had a doubt about, and leaves what somebody did exactly as it was", () => {
    const draft = profileFrom(AMBIGUOUS);
    const flagged = draft.experience[0]!;
    expect(needsAttention(flagged)).toBe(true);
    const before = structuredClone(flagged);
    confirmUnflagged(draft);
    expect(flagged).toEqual(before);
    expect(needsAttention(flagged)).toBe(true);
  });

  it("drops the note of a block read with confidence: that is the person standing behind it by going on", () => {
    const draft = profileFrom(SPANISH_BULLETS);
    const job = draft.experience[0]!;
    expect(needsAttention(job)).toBe(false);
    expect(job.review).toBeDefined();
    confirmUnflagged(draft);
    expect(job.review).toBeUndefined();
  });

  it("leaves a block whose two sources disagree marked, however sure its own reading was", () => {
    const draft = emptyStoredProfile();
    draft.experience.push(jobEntry("a", false));
    draft.conflicts.push(conflictOf("c1", "a", "cv", "linkedin_pdf"));
    confirmUnflagged(draft);
    expect(draft.experience[0]!.review).toBeDefined();
    expect(needsAttention(draft.experience[0]!, draft.conflicts)).toBe(true);
    expect(draft.conflicts).toHaveLength(1);
  });

  it("is not 'están todos bien': that one does settle the doubts", () => {
    const draft = profileFrom(AMBIGUOUS);
    confirmAll(draft);
    expect(draft.experience.some((job) => needsAttention(job))).toBe(false);
  });
});

describe("the contact details, checked on the review's own card", () => {
  const read = () => {
    const draft = emptyStoredProfile();
    draft.contact.fullName = { value: "Marta Quiroga", status: "proposed" };
    draft.contact.email = { value: "marta.quiroga@example.com", status: "proposed" };
    draft.contact.phone = { value: "+54 351 555 0000", status: "proposed" };
    draft.contact.city = { value: "Córdoba", status: "proposed" };
    draft.contact.links = { value: [{ label: "LinkedIn", url: "https://linkedin.com/in/marta-quiroga" }], status: "proposed" };
    return draft;
  };

  it("takes what was read as it was as right when moving on: that is what showing it is for", () => {
    const draft = read();
    confirmContact(draft);
    for (const key of ["fullName", "email", "phone", "city", "links"] as const) expect(draft.contact[key].status, key).toBe("confirmed");
  });

  it("leaves what the person changed as their edit, not as merely confirmed", () => {
    const draft = read();
    draft.contact.city = { value: "Rosario", status: "edited", original: "Córdoba" };
    confirmContact(draft);
    expect(draft.contact.city).toMatchObject({ value: "Rosario", status: "edited", original: "Córdoba" });
  });

  it("does not stand behind an email that does not look like one: it stays as it was read", () => {
    const draft = read();
    draft.contact.email = { value: "marta.quiroga(arroba)example.com", status: "proposed" };
    confirmContact(draft);
    expect(draft.contact.email.status).toBe("proposed");
    expect(draft.contact.fullName.status).toBe("confirmed");
  });

  it("goes along with 'Seguir' and with 'Están todos bien'", () => {
    for (const move of [confirmUnflagged, confirmAll]) {
      const draft = read();
      move(draft);
      expect(draft.contact.fullName.status).toBe("confirmed");
    }
  });
});

describe("what still wants a look, told apart", () => {
  it("counts a doubtful reading, a disagreement between documents and a text with no place, each on its own", () => {
    const draft = emptyStoredProfile();
    draft.experience.push(jobEntry("a", true), jobEntry("b", true), jobEntry("c", false));
    draft.conflicts.push(conflictOf("c1", "c", "cv", "linkedin_pdf"));
    draft.unassigned.push({ id: "u1", text: "Ajedrez", kind: "interests" }, { id: "u2", text: "Otro", kind: "other" }, { id: "u3", text: "Más", kind: "other" });
    expect(reviewCounts(draft)).toEqual({ doubtful: 2, conflicts: 1, unplaced: 3, total: 6 });
  });

  it("does not count the ghost of a blank entry, nor a block whose only flag is a disagreement as a doubt", () => {
    const draft = emptyStoredProfile();
    const ghost = jobEntry("ghost", true);
    ghost.company = { value: "", status: "proposed" };
    ghost.role = { value: "", status: "proposed" };
    draft.experience.push(ghost, jobEntry("a", false));
    draft.conflicts.push(conflictOf("c1", "a", "cv", "linkedin_pdf"));
    expect(reviewCounts(draft)).toMatchObject({ doubtful: 0, conflicts: 1, total: 1 });
  });

  it("says nothing when there is nothing", () => {
    expect(reviewCounts(emptyStoredProfile())).toEqual({ doubtful: 0, conflicts: 0, unplaced: 0, total: 0 });
    expect(reviewSummary({ doubtful: 0, conflicts: 0, unplaced: 0 })).toBe("");
  });

  it("says each in words, in the singular and the plural, leaving out what is not there", () => {
    expect(reviewSummary({ doubtful: 2, conflicts: 1, unplaced: 3 })).toBe("2 lecturas dudosas, 1 diferencia entre tus documentos y 3 textos sin asignar");
    expect(reviewSummary({ doubtful: 1, conflicts: 0, unplaced: 0 })).toBe("1 lectura dudosa");
    expect(reviewSummary({ doubtful: 0, conflicts: 2, unplaced: 1 })).toBe("2 diferencias entre tus documentos y 1 texto sin asignar");
  });
});

describe("choosing between documents all at once", () => {
  const setup = () => {
    const draft = emptyStoredProfile();
    for (const id of ["a", "b", "c", "d"]) draft.experience.push(jobEntry(id, false));
    draft.conflicts.push(
      conflictOf("c1", "a", "cv", "linkedin_pdf"), // the CV is the current one
      conflictOf("c2", "b", "linkedin_csv", "cv"), // the CV is the incoming one
      conflictOf("c3", "c", "cv", "cv"), // two readings of the CV: not a choice between documents
      conflictOf("c4", "d", "answer", "linkedin_pdf"), // no CV on either side
    );
    return draft;
  };

  it("names the conflicts where exactly one side is that kind of document", () => {
    const draft = setup();
    expect(conflictsFavouring(draft.conflicts, "cv").map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(conflictsFavouring(draft.conflicts, "linkedin").map((c) => c.id)).toEqual(["c1", "c2", "c4"]);
  });

  it("settles them by picking that whole version, whichever side it was on, and only them", () => {
    const draft = setup();
    expect(resolveConflictsFrom(draft, "cv", { now: NOW, newId: () => `r-${++n}` })).toBe(2);
    expect(draft.conflicts.map((c) => c.id)).toEqual(["c3", "c4"]);
    // c1's CV side was `current` (2021); c2's was `incoming` (2022).
    expect(draft.experience[0]!.end).toMatchObject({ value: { year: 2021 }, status: "confirmed", source: { kind: "cv" } });
    expect(draft.experience[1]!.end).toMatchObject({ value: { year: 2022 }, status: "confirmed", source: { kind: "cv" } });
    // The ones it did not name are untouched.
    expect(draft.experience[2]!.end.status).toBe("confirmed");
  });

  it("does nothing when neither side is that kind of document", () => {
    const draft = emptyStoredProfile();
    draft.experience.push(jobEntry("a", false));
    draft.conflicts.push(conflictOf("c1", "a", "answer", "manual"));
    expect(resolveConflictsFrom(draft, "cv")).toBe(0);
    expect(draft.conflicts).toHaveLength(1);
  });
});

describe("what a reading says it found", () => {
  const source = (read: Partial<ReadCounts> | undefined, name = "CV.pdf", extra: Partial<ImportedSource> = {}): ImportedSource => ({
    id: "s",
    kind: "cv",
    name,
    fileHash: "h",
    pasted: false,
    chars: 1,
    importedAt: NOW,
    ...(read ? { read: { experience: 0, education: 0, facts: 0, skills: 0, languages: 0, certifications: 0, projects: 0, unassigned: 0, conflicts: 0, ...read } } : {}),
    ...extra,
  });

  it("is counted when the document is read, and kept with it", () => {
    const draft = profileFrom(SPANISH_BULLETS);
    const read = draft.sources[0]!.read!;
    expect(read).toMatchObject({ experience: 2, education: 1, languages: 2, certifications: 2, conflicts: 0 });
    expect(read.facts).toBe(draft.experience.reduce((total, job) => total + job.facts.length, 0));
    expect(read.skills).toBeGreaterThanOrEqual(5);
  });

  it("counts, on a second document, only what it added — the rest was already there", () => {
    const first = profileFrom(SPANISH_BULLETS);
    const again = applyParsedDocument(
      first,
      parseCv(linesFromText(SPANISH_BULLETS)),
      { name: "otra-copia.pdf", fileHash: "other-hash", pasted: false, chars: 1 },
      { sourceId: "src-2", now: NOW, newId: ctx().newId },
    ).profile;
    expect(again.sources[1]!.read).toMatchObject({ experience: 0, education: 0, languages: 0, certifications: 0 });
  });

  it("says it in a sentence: what was found, said the way it is read out", () => {
    expect(readReceipt(source({ experience: 4, education: 2, facts: 23, skills: 12 }))).toEqual({
      sourceId: "s",
      name: "CV.pdf",
      text: "4 puestos, 2 estudios, 23 tareas y 12 habilidades",
    });
    expect(readReceipt(source({ experience: 1 }))!.text).toBe("1 puesto");
    expect(readReceipt(source({ experience: 1, education: 1 }))!.text).toBe("1 puesto y 1 estudio");
  });

  it("adds the disagreements and the texts with no place, apart from what was found", () => {
    expect(readReceipt(source({ education: 1, conflicts: 2, unassigned: 1 }))!.text).toBe("1 estudio · 2 diferencias con lo que ya tenías · 1 texto sin asignar");
    expect(readReceipt(source({ conflicts: 1 }))!.text).toBe("nada nuevo: ya estaba en tu perfil · 1 diferencia con lo que ya tenías");
  });

  it("says a document that added nothing added nothing, rather than nothing at all", () => {
    expect(readReceipt(source({}))!.text).toBe("nada nuevo: ya estaba en tu perfil");
  });

  it("has nothing to say about a document read before it was counted, and names a nameless one", () => {
    expect(readReceipt(source(undefined))).toBeNull();
    expect(readReceipt(source({ experience: 1 }, "  "))!.name).toBe("tu documento");
  });

  it("lists the latest few, in the order they were read, leaving out what has no receipt", () => {
    const draft = emptyStoredProfile();
    draft.sources.push(
      source({ experience: 1 }, "uno.pdf", { id: "1", importedAt: "2026-09-01T10:00:00.000Z" }),
      source(undefined, "viejo.pdf", { id: "2", importedAt: "2026-09-02T10:00:00.000Z" }),
      source({ experience: 2 }, "tres.pdf", { id: "3", importedAt: "2026-09-03T10:00:00.000Z" }),
      source({ experience: 3 }, "cuatro.pdf", { id: "4", importedAt: "2026-09-04T10:00:00.000Z" }),
      source({ experience: 4 }, "cinco.pdf", { id: "5", importedAt: "2026-09-05T10:00:00.000Z" }),
    );
    expect(readReceipts(draft).map((receipt) => receipt.name)).toEqual(["tres.pdf", "cuatro.pdf", "cinco.pdf"]);
    expect(readReceipts(draft, 10).map((receipt) => receipt.name)).toEqual(["uno.pdf", "tres.pdf", "cuatro.pdf", "cinco.pdf"]);
  });

  it("keeps two files dropped together in the order they were dropped, even with the same instant", () => {
    const draft = emptyStoredProfile();
    const at = "2026-09-01T10:00:00.000Z";
    draft.sources.push(source({ experience: 3 }, "cv.docx", { id: "1", importedAt: at }), source({}, "linkedin.docx", { id: "2", importedAt: at }));
    expect(readReceipts(draft).map((receipt) => receipt.name)).toEqual(["cv.docx", "linkedin.docx"]);
  });

  it("loads from a profile stored before it existed, and a damaged one does not fail the whole profile", () => {
    const old = { id: "a", kind: "cv", name: "x", fileHash: "h", pasted: false, chars: 1, importedAt: NOW };
    expect(storedProfileSchema.parse({ sources: [old] }).sources[0]!.read).toBeUndefined();
    expect(storedProfileSchema.parse({ sources: [{ ...old, read: "roto" }] }).sources[0]!.read).toBeUndefined();
    expect(storedProfileSchema.parse({ sources: [{ ...old, read: { experience: 3 } }] }).sources[0]!.read).toMatchObject({ experience: 3, facts: 0 });
  });
});

describe("a letter the reader could not recover", () => {
  it("is pointed at the block it is in, not at the whole screen", () => {
    const draft = emptyStoredProfile();
    draft.experience.push(jobEntry("a", false), jobEntry("b", false));
    draft.experience[1]!.facts.push({ id: "f1", kind: "responsibility", text: "Gesti�n de pedidos", source: { kind: "cv", at: NOW }, status: "confirmed" });
    const found = unreadableIn(draft);
    expect([...found.experience]).toEqual(["b"]);
    expect(found.education.size).toBe(0);
    expect(found.elsewhere).toBe(false);
  });

  it("is said on the screen only when it is in something that has no card", () => {
    const draft = emptyStoredProfile();
    draft.experience.push(jobEntry("a", false));
    draft.contact.fullName = { value: "Mar�a", status: "proposed" };
    expect(unreadableIn(draft).elsewhere).toBe(true);
    expect(unreadableIn(draft).experience.size).toBe(0);
  });

  it("finds nothing in a clean profile", () => {
    const found = unreadableIn(profileFrom(SPANISH_BULLETS));
    expect(found.experience.size + found.education.size).toBe(0);
    expect(found.elsewhere).toBe(false);
  });
});

describe("a review with no job and no study to show", () => {
  const withOnly = (build: (profile: StoredProfile) => void): StoredProfile => {
    const profile = emptyStoredProfile();
    build(profile);
    return profile;
  };
  const skill = (id: string, name: string) => ({ id, name: { value: name, status: "confirmed" as const }, experienceIds: [] });

  it("says what was read and that the career is what is missing, and where to put it", () => {
    const profile = withOnly((p) => {
      p.skills.push(skill("k1", "Excel"));
      p.languages.push({ id: "l1", name: { value: "Inglés", status: "confirmed" }, level: { value: { cefr: "B2" }, status: "confirmed" } } as StoredProfile["languages"][number]);
    });
    expect(noCareerNotice(profile)).toBe("Leímos tus habilidades y tus idiomas, pero no encontramos puestos ni estudios. Podés agregarlos más abajo, en «¿Falta algo?».");
  });

  it("names every kind of thing it read, in the order a CV has them", () => {
    const profile = withOnly((p) => {
      p.skills.push(skill("k1", "Excel"));
      p.certifications.push({ id: "c1", name: { value: "Curso", status: "confirmed" }, issuer: { value: "", status: "confirmed" }, date: { value: {}, status: "confirmed" } } as StoredProfile["certifications"][number]);
      p.projects.push({ id: "p1", name: { value: "Sistema de turnos", status: "confirmed" }, description: { value: "", status: "confirmed" }, url: { value: "", status: "confirmed" }, tags: { value: [], status: "confirmed" } } as StoredProfile["projects"][number]);
    });
    expect(noCareerNotice(profile)).toBe("Leímos tus habilidades, tus certificaciones y tus proyectos, pero no encontramos puestos ni estudios. Podés agregarlos más abajo, en «¿Falta algo?».");
  });

  it("says where a story went when all of it is in the tray", () => {
    const profile = withOnly((p) => {
      p.unassigned.push({ id: "u1", text: "Me gusta trabajar en equipo.", kind: "other" });
    });
    expect(noCareerNotice(profile)).toMatch(/No pudimos armar puestos ni estudios con lo que cargaste\. .*«Sin asignar».*«¿Falta algo\?»/);
  });

  it("says nothing when there is a career, or nothing else either", () => {
    expect(noCareerNotice(emptyStoredProfile())).toBeNull();
    expect(noCareerNotice(profileFrom(SPANISH_BULLETS))).toBeNull();
    const onlyStudy = withOnly((p) => {
      p.education.push({ ...profileFrom(SPANISH_BULLETS).education[0]! });
    });
    expect(noCareerNotice(onlyStudy)).toBeNull();
  });
});

describe("what the document filled in outside the timeline, once the person moves on", () => {
  const withProposed = (): StoredProfile => {
    const draft = profileFrom(SPANISH_BULLETS);
    draft.legacy.about = { value: "Analista con diez años en marketing", status: "proposed", source: { kind: "cv", at: NOW } };
    draft.legacy.headline = { value: "Analista de marketing digital", status: "proposed", source: { kind: "cv", at: NOW } };
    draft.legacy.practical = { value: { availability: "Tiempo completo", driverLicense: "B1", ownVehicle: false, willingToRelocate: false, workEligibility: "" }, status: "proposed", source: { kind: "cv", at: NOW } };
    return draft;
  };

  it("is taken as right by 'Seguir', like the rest of what was shown and not marked: «Sobre vos», the headline and the practical facts", () => {
    const draft = withProposed();
    confirmUnflagged(draft);
    expect(draft.legacy.about.status).toBe("confirmed");
    expect(draft.legacy.headline.status).toBe("confirmed");
    expect(draft.legacy.practical.status).toBe("confirmed");
    expect(draft.legacy.about.value).toBe("Analista con diez años en marketing");
  });

  it("and by 'Los N marcados están bien'", () => {
    const draft = withProposed();
    confirmAll(draft);
    expect([draft.legacy.about.status, draft.legacy.headline.status, draft.legacy.practical.status]).toEqual(["confirmed", "confirmed", "confirmed"]);
  });

  it("without turning what the person edited back into merely confirmed", () => {
    const draft = withProposed();
    draft.legacy.about = { value: "Escrito por mí", status: "edited", original: "Analista con diez años en marketing" };
    confirmUnflagged(draft);
    expect(draft.legacy.about).toMatchObject({ value: "Escrito por mí", status: "edited" });
  });

  it("with a way to take the headline out, right where it is shown, as with «Sobre vos»", () => {
    const draft = withProposed();
    expect(clearProposedHeadline(draft)).toBe(true);
    expect(draft.legacy.headline).toEqual({ value: "", status: "confirmed" });
    expect(clearProposedHeadline(draft)).toBe(false);
    const confirmedAlready = withProposed();
    confirmedAlready.legacy.headline.status = "confirmed";
    expect(clearProposedHeadline(confirmedAlready)).toBe(false);
    expect(confirmedAlready.legacy.headline.value).not.toBe("");
  });
});

describe("what 'Los N marcados están bien' would take as right", () => {
  /** Three jobs and a study, as a profile stores them: two jobs and the study are still proposed; the third was read with no doubt. */
  const marked = (): StoredProfile =>
    storedProfileSchema.parse({
      experience: [
        { id: "a", role: { value: "Analista", status: "proposed" }, company: { value: "Nubia Retail" }, start: { value: { year: 2021 } }, end: { value: { current: true } } },
        { id: "b", role: { value: "Asistente" }, company: { value: "Grupo Lumen" }, start: { value: { year: 2018 } }, end: { value: { year: 2021 } } },
        { id: "c", role: { value: "Cajero", status: "proposed" }, company: { value: "Kiosco" }, start: { value: { year: 2016 } }, end: { value: { year: 2016 } } },
      ],
      education: [{ id: "s1", degree: { value: "Licenciatura en Economía", status: "proposed" }, institution: { value: "UBA" }, start: { value: { year: 2013 } }, end: { value: { year: 2017 } } }],
    });

  it("is one line for each block still waiting on a tap, jobs first and then studies", () => {
    expect(doubtfulLines(marked())).toEqual(["Analista · Nubia Retail · 2021–hoy", "Cajero · Kiosco · 2016", "Licenciatura en Economía · UBA · 2013–2017"]);
  });

  it("the same ones that are counted as doubtful, and no more: not a block nobody had a doubt about", () => {
    const draft = marked();
    expect(doubtfulLines(draft)).toHaveLength(reviewCounts(draft).doubtful);
    expect(doubtfulLines(draft).join("\n")).not.toContain("Grupo Lumen");
  });

  it("is nothing for a profile with nothing marked, and does not count an empty entry", () => {
    expect(doubtfulLines(profileFrom(SPANISH_BULLETS))).toEqual([]);
    const ghost = emptyStoredProfile();
    ghost.experience.push(jobEntry("ghost", true));
    expect(doubtfulLines(ghost)).toEqual(doubtfulLines(ghost).filter(Boolean));
  });

  it("a block is a line of what it is, where, and when: with only some of it, only that", () => {
    const only = (value: object) => storedProfileSchema.parse({ experience: [{ id: "x", ...value }] }).experience[0]!;
    expect(jobLine(only({ role: { value: "Cajero" } }))).toBe("Cajero");
    expect(jobLine(only({ company: { value: "Kiosco" }, start: { value: { year: 2020 } } }))).toBe("Kiosco · 2020");
    expect(jobLine(only({ role: { value: "Cajero" }, company: { value: "Kiosco" }, start: { value: { year: 2020 } }, end: { value: { year: 2020 } } }))).toBe("Cajero · Kiosco · 2020");
    expect(jobLine(only({ role: { value: "Cajero" }, end: { value: { year: 2022 } } }))).toBe("Cajero · 2022");
    const study = storedProfileSchema.parse({ education: [{ id: "s", institution: { value: "UBA" } }] }).education[0]!;
    expect(studyLine(study)).toBe("UBA");
  });

  it("is a button that says how many, so it is not a blanket 'todo está bien'", () => {
    expect(markedLabel(1)).toBe("El marcado está bien");
    expect(markedLabel(3)).toBe("Los 3 marcados están bien");
  });

  it("is asked with the list of what is taken as right, and says they can be changed after", () => {
    const text = confirmMarkedPrompt(["Analista · Nubia Retail · 2021–hoy", "Cajero · Kiosco · 2016"]);
    expect(text).toContain("las 2 lecturas marcadas");
    expect(text).toContain("• Analista · Nubia Retail · 2021–hoy\n• Cajero · Kiosco · 2016");
    expect(text).toMatch(/desde tu perfil/);
    expect(confirmMarkedPrompt(["Analista · Nubia Retail"])).toContain("la lectura marcada");
  });

  it("lists only the first few of many, and says how many more", () => {
    const many = Array.from({ length: 11 }, (_, i) => `Puesto ${i + 1} · Empresa`);
    const text = confirmMarkedPrompt(many);
    expect(text).toContain("• Puesto 8 · Empresa");
    expect(text).not.toContain("• Puesto 9 · Empresa");
    expect(text).toContain("… y 3 más");
  });
});

describe("a reading with nothing to look at twice", () => {
  /** A document as it goes in: read with confidence, nobody has said anything about it yet. */
  const clean = (): StoredProfile => profileFrom(SPANISH_BULLETS);

  it("is one that was read with confidence, where no one has anything to say", () => {
    expect(readCleanly(clean())).toBe(true);
    expect(markedIn(clean())).toMatchObject({ total: 0, unreadable: false, photo: false, noCareer: false });
    expect(readCleanly(profileFrom(ENGLISH_STACKED))).toBe(true);
  });

  it("is not one the reader was unsure of, though the document is a real one", () => {
    expect(readCleanly(profileFrom(AMBIGUOUS))).toBe(false);
    expect(markedIn(profileFrom(UNDATED_EDUCATION)).doubtful).toBeGreaterThan(0);
  });

  it("is not one with a doubtful reading, a difference between two documents, or a text with no place", () => {
    const doubtful = clean();
    doubtful.experience.push(jobEntry("a", true));
    expect(readCleanly(doubtful)).toBe(false);
    const differs = clean();
    differs.conflicts.push(conflictOf("c1", differs.experience[0]!.id, "cv", "linkedin_pdf"));
    expect(readCleanly(differs)).toBe(false);
    const loose = clean();
    loose.unassigned.push({ id: "u1", text: "Ajedrez", kind: "interests" });
    expect(readCleanly(loose)).toBe(false);
  });

  it("is not one with a letter the reader lost, in a card or outside one", () => {
    const inCard = clean();
    inCard.experience[0]!.facts.push({ id: "f1", kind: "responsibility", text: "Gesti�n de pedidos", source: { kind: "cv", at: NOW }, status: "confirmed" });
    expect(markedIn(inCard).unreadable).toBe(true);
    expect(readCleanly(inCard)).toBe(false);
    const outside = clean();
    outside.contact.fullName = { value: "Mar�a", status: "proposed" };
    expect(markedIn(outside).unreadable).toBe(true);
    expect(readCleanly(outside)).toBe(false);
  });

  it("is not one a model wrote from a photo: what it is checked against is that text, and the photo is the person's to compare", () => {
    const profile = clean();
    profile.sources.push({ id: "src-2", kind: "cv", name: "foto.jpg", fileHash: "h-photo", pasted: true, chars: 100, importedAt: NOW, photo: true });
    expect(markedIn(profile).photo).toBe(true);
    expect(readCleanly(profile)).toBe(false);
  });

  it("is not one with no job and no study, whatever else it read: the CV it would be called ready for has no career in it", () => {
    const profile = emptyStoredProfile();
    profile.skills.push({ id: "k1", name: { value: "Excel", status: "confirmed" }, experienceIds: [] });
    expect(markedIn(profile)).toMatchObject({ total: 0, noCareer: true });
    expect(readCleanly(profile)).toBe(false);
    expect(readCleanly(emptyStoredProfile())).toBe(false);
  });

  it("is a study alone, if nothing about it is doubtful", () => {
    const profile = emptyStoredProfile();
    profile.education.push({ ...profileFrom(SPANISH_BULLETS).education[0]!, review: undefined });
    expect(markedIn(profile).noCareer).toBe(false);
  });
});
