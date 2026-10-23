import { describe, expect, it } from "vitest";
import { evidenceTextsFrom } from "@/lib/ai/evidence";
import { serializeProfile } from "@/lib/ai/prompts/shared";
import { baseCv } from "@/lib/cv/from-profile";
import { answerStudy, deferQuestion, STUDY_POINTS_MAX } from "@/lib/onboarding/answer";
import { detectGaps, eligibleGaps, hasHighlights, isAskable, type Gap } from "@/lib/onboarding/gaps";
import { labelFor, questionFor } from "@/lib/onboarding/questions";
import { isRemovableSource, removeSource } from "@/lib/onboarding/remove-source";
import { migrateV1 } from "@/lib/profile/migrate";
import { toPlainProfile } from "@/lib/profile/project";
import { reconcileFromPlain } from "@/lib/profile/reconcile";
import { profileSchema } from "@/lib/schemas/profile";
import { STUDY_HIGHLIGHT_MAX, emptyStoredProfile, storedProfileSchema, type StoredProfile } from "@/lib/schemas/profile-v2";
import { backendProfile } from "./fixtures";
import { NOW, STAMP, freshSession, newId, profileWith, withStudy } from "./helpers/profiles";

/**
 * A CV with little work behind it is made of what was studied, and a study was a degree, a place and two years. What stands out
 * of it — the subjects, the thesis, the grade if they want it seen — is the person's to say, and is asked once, of the latest.
 */

const DEGREE = "Licenciatura en Administración";
const student = (...studies: Parameters<typeof withStudy>[1][]): StoredProfile => {
  const profile = emptyStoredProfile();
  profile.onboarding.situation = "student";
  for (const study of studies) withStudy(profile, study);
  return profile;
};
const studyGap = (profile: StoredProfile): Gap | undefined => detectGaps(profile, NOW).find((found) => found.rule === "study_highlights");
const ctx = { now: STAMP, newId };

describe("when a study is asked about", () => {
  it("is the latest one of someone with no work, when it is going on or ended a year ago", () => {
    for (const to of ["current" as const, { year: 2025, month: 12 }]) {
      const profile = student({ degree: DEGREE, institution: "Universidad Nacional", from: { year: 2021 }, to });
      const found = studyGap(profile)!;
      expect(found).toMatchObject({ rule: "study_highlights", priority: "medium", payload: { educationId: profile.education[0]!.id } });
      expect(found.id).toBe(`study_highlights:${profile.education[0]!.id}`);
      expect(found.experienceId).toBeUndefined();
    }
  });

  it("is also a study with no end that can be read: not knowing is no reason to ask less", () => {
    expect(studyGap(student({ degree: DEGREE }))).toBeDefined();
  });

  it("is not one that ended long ago: a study from seven years back is a line", () => {
    expect(studyGap(student({ degree: DEGREE, from: { year: 2015 }, to: { year: 2019 } }))).toBeUndefined();
    // Three years ago is still recent; just past it is not.
    expect(studyGap(student({ degree: DEGREE, from: { year: 2020 }, to: { year: 2023, month: 10 } }))).toBeDefined();
    expect(studyGap(student({ degree: DEGREE, from: { year: 2020 }, to: { year: 2023, month: 8 } }))).toBeUndefined();
  });

  it("is not one that was left unfinished", () => {
    expect(studyGap(student({ degree: DEGREE, status: "incomplete", to: { year: 2025 } }))).toBeUndefined();
  });

  it("is not one with no name: neither a degree nor a place", () => {
    const profile = student({ degree: DEGREE });
    withStudy(profile, { degree: "", institution: "" });
    // The form never makes a nameless study, but an import can leave one: it is not asked about, and the named one still is.
    expect(detectGaps(profile, NOW).filter((found) => found.rule === "study_highlights")).toHaveLength(1);
  });

  it("is of someone with one job at most: for a career, a study is a line", () => {
    const one = profileWith({ company: "Nubia Retail", role: "Asistente", from: { year: 2024 }, to: "current" });
    withStudy(one, { degree: DEGREE, to: { year: 2025 } });
    expect(studyGap(one)).toBeDefined();

    const two = profileWith(
      { company: "Nubia Retail", role: "Asistente", from: { year: 2024 }, to: "current" },
      { company: "Grupo Lumen", role: "Cadete", from: { year: 2022 }, to: { year: 2023 } },
    );
    withStudy(two, { degree: DEGREE, to: { year: 2025 } });
    expect(studyGap(two)).toBeUndefined();
  });

  it("is only the latest of several: what stands out of an older one is not asked", () => {
    const profile = student(
      { degree: "Tecnicatura en Marketing", from: { year: 2023 }, to: { year: 2024 } },
      { degree: DEGREE, from: { year: 2025 }, to: "current" },
    );
    const latest = profile.education.find((entry) => entry.degree.value === DEGREE)!;
    expect(studyGap(profile)!.payload.educationId).toBe(latest.id);
    // Once the latest has its points, the earlier one is not asked about in its place.
    latest.highlights = { value: ["Tesis en curso"], status: "confirmed" };
    expect(studyGap(profile)).toBeUndefined();
  });

  it("is not one that already has points, and is not asked for by name either", () => {
    const profile = student({ degree: DEGREE, to: { year: 2025 } });
    const found = studyGap(profile)!;
    expect(isAskable(profile, found.id, NOW)).toBe(true);
    profile.education[0]!.highlights = { value: ["Promedio 8,7"], status: "confirmed" };
    expect(hasHighlights(profile.education[0]!)).toBe(true);
    expect(studyGap(profile)).toBeUndefined();
    expect(isAskable(profile, found.id, NOW)).toBe(false);
    // A line left blank is no point.
    profile.education[0]!.highlights = { value: ["  "], status: "confirmed" };
    expect(studyGap(profile)).toBeDefined();
  });

  it("goes after the question about work and before the course, for someone with no job", () => {
    const profile = student({ degree: DEGREE, to: { year: 2025 } });
    const order = eligibleGaps(profile, freshSession(), NOW).map((found) => found.rule);
    const picked = order.filter((rule) => ["no_work_experience", "study_highlights", "no_certifications"].includes(rule));
    expect(picked).toEqual(["no_work_experience", "study_highlights", "no_certifications"]);
  });

  it("does not come back once it was turned down", () => {
    const profile = student({ degree: DEGREE, to: { year: 2025 } });
    const found = studyGap(profile)!;
    expect(eligibleGaps(profile, freshSession(), NOW).some((entry) => entry.id === found.id)).toBe(true);
    deferQuestion(profile, found, "na", ctx);
    expect(eligibleGaps(profile, freshSession(), NOW).some((entry) => entry.id === found.id)).toBe(false);
  });
});

describe("what is asked", () => {
  const profile = student({ degree: DEGREE, institution: "Universidad Nacional", from: { year: 2021 }, to: { year: 2025 } });
  const found = studyGap(profile)!;

  it("names the study, and says what kinds of thing to say — without an example to copy", () => {
    const question = questionFor(found, profile);
    expect(question).toMatchObject({
      rule: "study_highlights",
      context: `Sobre ${DEGREE} · estudios`,
      text: `¿Hay algo para destacar de «${DEGREE}»?`,
      control: { kind: "study", educationId: profile.education[0]!.id },
    });
    expect(question.hint).toMatch(/materias|trabajos/i);
    expect(question.hint).toMatch(/solo si querés/);
    expect(question.hint).not.toMatch(/\bpor ejemplo\b|\bej\.\b/i);
  });

  it("says the place when there is no degree, and a long name in a few words", () => {
    const placeOnly = student({ institution: "Escuela de Comercio N° 5", to: { year: 2025 } });
    expect(questionFor(studyGap(placeOnly)!, placeOnly).text).toBe("¿Hay algo para destacar de «Escuela de Comercio N° 5»?");
    const long = student({ degree: "Tecnicatura Superior en Administración y Gestión de Pequeñas y Medianas Empresas Familiares", to: { year: 2025 } });
    expect(questionFor(studyGap(long)!, long).text).toMatch(/«[^»]{1,60}…»/);
  });

  it("has a line of its own in a list", () => {
    expect(labelFor(found, profile)).toBe(`Qué destacar de ${DEGREE}`);
  });
});

describe("answering", () => {
  const asked = () => {
    const profile = student({ degree: DEGREE, institution: "Universidad Nacional", from: { year: 2021 }, to: { year: 2025 } });
    return { profile, found: studyGap(profile)!, id: profile.education[0]!.id };
  };

  it("keeps one point for each line or sentence, as they were written", () => {
    const { profile, found, id } = asked();
    const ok = answerStudy(profile, found, id, "Tesis sobre costos logísticos en pymes.\nPromedio 8,7\n- Materias: Estadística y Álgebra", ctx);
    expect(ok).toBe(true);
    expect(profile.education[0]!.highlights.value).toEqual(["Tesis sobre costos logísticos en pymes.", "Promedio 8,7", "Materias: Estadística y Álgebra"]);
  });

  it("credits the person, in the field's own provenance, and leaves a step to undo", () => {
    const { profile, found, id } = asked();
    answerStudy(profile, found, id, "Promedio 9", ctx);
    expect(profile.education[0]!.highlights).toMatchObject({ status: "confirmed", source: { kind: "answer", at: STAMP } });
    expect(profile.history.some((entry) => entry.path.join("/") === `education/${id}/highlights`)).toBe(true);
  });

  it("adds to what is there, never in place of it, and a point already there is not there twice", () => {
    const { profile, found, id } = asked();
    answerStudy(profile, found, id, "Promedio 9\nTesis sobre costos", ctx);
    answerStudy(profile, { ...found, id: "other" }, id, "promedio 9\nProyecto final de logística", ctx);
    expect(profile.education[0]!.highlights.value).toEqual(["Promedio 9", "Tesis sobre costos", "Proyecto final de logística"]);
  });

  it(`keeps at most ${STUDY_POINTS_MAX} points of ${STUDY_HIGHLIGHT_MAX} characters, as a CV has room for`, () => {
    const { profile, found, id } = asked();
    const many = Array.from({ length: 12 }, (_, n) => `Punto número ${n + 1}`).join("\n");
    answerStudy(profile, found, id, `${many}\n${"x".repeat(400)}`, ctx);
    expect(profile.education[0]!.highlights.value).toHaveLength(STUDY_POINTS_MAX);
    const long = asked();
    answerStudy(long.profile, long.found, long.id, "y".repeat(400), ctx);
    expect(long.profile.education[0]!.highlights.value[0]).toHaveLength(STUDY_HIGHLIGHT_MAX);
  });

  it("refuses an answer with nothing in it, and a study that is not there", () => {
    const { profile, found, id } = asked();
    expect(answerStudy(profile, found, id, "  \n ", ctx)).toBe(false);
    expect(answerStudy(profile, found, "nobody", "Promedio 9", ctx)).toBe(false);
    expect(profile.education[0]!.highlights.value).toEqual([]);
  });

  it("counts for the session, and is not asked again", () => {
    const { profile, found, id } = asked();
    const before = profile.onboarding.askedThisSession;
    answerStudy(profile, found, id, "Promedio 9", ctx);
    expect(profile.onboarding.askedThisSession).toBe(before + 1);
    expect(studyGap(profile)).toBeUndefined();
  });

  it("takes the question off what was put off, when it had been", () => {
    const { profile, found, id } = asked();
    deferQuestion(profile, found, "later", ctx);
    expect(profile.pending.some((entry) => entry.questionId === found.id)).toBe(true);
    answerStudy(profile, found, id, "Promedio 9", ctx);
    expect(profile.pending.some((entry) => entry.questionId === found.id)).toBe(false);
  });
});

describe("what is said of a study, read by everything that reads the profile", () => {
  const withPoints = () => {
    const profile = student({ degree: DEGREE, institution: "Universidad Nacional", from: { year: 2021 }, to: { year: 2025 } });
    profile.education[0]!.highlights = { value: ["Tesis sobre costos logísticos", "Promedio 8,7"], status: "confirmed", source: { kind: "answer", at: STAMP } };
    return profile;
  };

  it("is in the plain profile the generators read, and empty when there is nothing", () => {
    expect(toPlainProfile(withPoints()).education[0]!.highlights).toEqual(["Tesis sobre costos logísticos", "Promedio 8,7"]);
    expect(toPlainProfile(student({ degree: DEGREE })).education[0]!.highlights).toEqual([]);
  });

  it("licenses what it says, as the rest of the profile does: a figure in a thesis is not a figure the CV made up", () => {
    expect(evidenceTextsFrom(toPlainProfile(withPoints()))).toContain("Promedio 8,7");
  });

  it("is on the line of the study in what the model reads", () => {
    const text = serializeProfile(toPlainProfile(withPoints()), {});
    expect(text).toContain('highlights="Tesis sobre costos logísticos; Promedio 8,7"');
    expect(serializeProfile(toPlainProfile(student({ degree: DEGREE })), {})).not.toContain("highlights=");
  });

  it("is on the CV under the study, with the words «Destacados» and not «Honores»", () => {
    const { document, omissions } = baseCv(withPoints());
    const education = document.sections.find((section) => section.kind === "education");
    expect(education?.kind === "education" && education.items[0]!.honors).toBe("Tesis sobre costos logísticos · Promedio 8,7");
    expect(document.labels?.honors).toBe("Destacados");
    expect(omissions.filter((omission) => omission.section === "education")).toEqual([]);
  });

  it("puts the honours first, and keeps «Honores» when there are no points", () => {
    const profile = withPoints();
    profile.education[0]!.honors = { value: "Diploma de honor", status: "confirmed" };
    const education = baseCv(profile).document.sections.find((section) => section.kind === "education");
    expect(education?.kind === "education" && education.items[0]!.honors).toBe("Diploma de honor · Tesis sobre costos logísticos · Promedio 8,7");

    const plain = student({ degree: DEGREE });
    plain.education[0]!.honors = { value: "Diploma de honor", status: "confirmed" };
    expect(baseCv(plain).document.labels?.honors).toBe("Honores");
  });

  it("says what the line of a study had no room for, as every other cut is said", () => {
    const profile = withPoints();
    profile.education[0]!.highlights = { value: Array.from({ length: 6 }, (_, n) => `Punto ${n + 1}: ${"palabra ".repeat(11)}`.trim()), status: "confirmed" };
    const { document, omissions } = baseCv(profile);
    const education = document.sections.find((section) => section.kind === "education");
    const line = education?.kind === "education" ? education.items[0]!.honors : "";
    expect(line.length).toBeLessThanOrEqual(300);
    // Stops at a point, not in the middle of one.
    expect(line.endsWith("palabra")).toBe(true);
    const said = omissions.find((omission) => omission.section === "education");
    expect(said?.item).toMatch(/^\d+ destacados? de tus estudios$/);
  });

  it("goes back to the stored profile when an editor that speaks the plain one changes it", () => {
    const profile = withPoints();
    const next = structuredClone(toPlainProfile(profile));
    next.education[0]!.highlights = ["Tesis sobre costos logísticos", "Premio al mejor trabajo final"];
    const saved = reconcileFromPlain(profile, profileSchema.parse(next), { now: STAMP, newId });
    expect(saved.education[0]!.highlights.value).toEqual(["Tesis sobre costos logísticos", "Premio al mejor trabajo final"]);
    expect(saved.education[0]!.highlights.status).toBe("edited");
    // And asking for what is already there changes nothing.
    expect(reconcileFromPlain(saved, toPlainProfile(saved), { now: STAMP, newId })).toBe(saved);
  });

  it("is empty for a profile from before it existed, in both shapes", () => {
    const stored = storedProfileSchema.parse(JSON.parse(JSON.stringify(emptyStoredProfile())));
    const old = structuredClone(withPoints());
    const raw = JSON.parse(JSON.stringify(old)) as { education: Array<Record<string, unknown>> };
    delete raw.education[0]!.highlights;
    const parsed = storedProfileSchema.parse({ ...stored, ...raw });
    expect(parsed.education[0]!.highlights).toEqual({ value: [], status: "confirmed" });
    expect(migrateV1(backendProfile, { now: STAMP }).education.every((entry) => entry.highlights.value.length === 0)).toBe(true);
  });
});

describe("a study with points of its own, when the document that named it is taken out", () => {
  it("stays: what stands out of it is only ever the person's", () => {
    const profile = student({ degree: DEGREE, institution: "Universidad Nacional", from: { year: 2021 }, to: { year: 2025 } });
    const study = profile.education[0]!;
    // As a document would have left it: proposed, and from that document.
    const from = { kind: "cv" as const, at: STAMP, docId: "cv-1" };
    study.institution = { value: study.institution.value, status: "proposed", source: from };
    study.degree = { value: study.degree.value, status: "proposed", source: from };
    profile.sources.push({ id: "cv-1", kind: "cv", name: "cv.pdf", fileHash: "h", pasted: false, chars: 1, importedAt: STAMP });
    expect(isRemovableSource(profile.sources[0]!)).toBe(true);

    const without = structuredClone(profile);
    removeSource(without, "cv-1", ctx);
    expect(without.education).toEqual([]);

    const withPointsKept = structuredClone(profile);
    withPointsKept.education[0]!.highlights = { value: ["Promedio 9"], status: "confirmed", source: { kind: "answer", at: STAMP } };
    removeSource(withPointsKept, "cv-1", ctx);
    expect(withPointsKept.education).toHaveLength(1);
    expect(withPointsKept.education[0]!.highlights.value).toEqual(["Promedio 9"]);
  });
});
