import { describe, expect, it } from "vitest";
import { baseCv, previewEntryCount } from "@/lib/cv/from-profile";
import { confirmPractical, dropLicense, setCertificationExcluded, setCertificationExpiry, setLicenseExpiry } from "@/lib/profile/credentials";
import { credentialReviews } from "@/lib/profile/currency";
import { confirmFieldAt, editFieldAt, editedField, isBlankText, undoEntry, upsertFieldAt } from "@/lib/profile/edit";
import { addCertification } from "@/lib/profile/entities";
import { editFactText, setFactMetric } from "@/lib/profile/facts";
import { toPlainProfile } from "@/lib/profile/project";
import { reconcileFromPlain } from "@/lib/profile/reconcile";
import { profileSchema } from "@/lib/schemas/profile";
import { certificationSchema, emptyStoredProfile, isPersonSource, storedProfileSchema, type Field, type StoredProfile } from "@/lib/schemas/profile-v2";
import { NOW, STAMP, newId, profileWith } from "./helpers/profiles";

/**
 * What the person does about a credential and about what they said of how they can work — say until when it holds, set it
 * aside, say it still stands — and the day they last stood behind a value, which every one of those edits writes.
 */

let n = 0;
const ctx = (now: string = STAMP) => ({ now, newId: () => `c-${++n}` });
const LATER = "2026-10-05T09:30:00.000Z";

const withCert = (profile: StoredProfile, name: string, extra: Record<string, unknown> = {}) => {
  const cert = certificationSchema.parse({ id: `cert-${++n}`, name: { value: name, status: "confirmed" }, ...extra });
  profile.certifications.push(cert);
  return cert;
};

const practical = (extra: Partial<StoredProfile["legacy"]["practical"]["value"]> = {}): StoredProfile["legacy"]["practical"] => ({
  value: { availability: "Tiempo completo", driverLicense: "B1", ownVehicle: true, willingToRelocate: false, workEligibility: "", ...extra },
  status: "confirmed",
});

describe("the last time the person stood behind a value", () => {
  const field = (extra: Partial<Field<string>> = {}): Field<string> => ({ value: "Rosario", status: "confirmed", source: { kind: "cv", at: "2026-01-01T00:00:00.000Z" }, ...extra });
  const opts = (origin: Parameters<typeof editedField>[2]["origin"]) => ({ now: LATER, origin, isEmpty: isBlankText });

  it("is what an edit of theirs writes — typed, answered or dictated", () => {
    for (const origin of ["manual", "answer", "dump"] as const) {
      expect(isPersonSource(origin)).toBe(true);
      expect(editedField(field(), "Córdoba", opts(origin)).confirmedAt, origin).toBe(LATER);
    }
  });

  it("is not what a reader writes when it fills a field from a document", () => {
    for (const origin of ["cv", "linkedin_pdf", "linkedin_csv", "legacy"] as const) {
      expect(isPersonSource(origin), origin).toBe(false);
      expect(editedField(field(), "Córdoba", opts(origin)).confirmedAt, origin).toBeUndefined();
    }
    expect(isPersonSource(undefined)).toBe(false);
  });

  it("is written whichever way the edit went: a change, a blank filled in, or the original typed back", () => {
    // A change.
    expect(editedField(field(), "Córdoba", opts("manual"))).toMatchObject({ value: "Córdoba", status: "edited", confirmedAt: LATER });
    // A blank filled in is saying something.
    expect(editedField(field({ value: "" }), "Córdoba", opts("manual"))).toMatchObject({ value: "Córdoba", status: "confirmed", confirmedAt: LATER });
    // The original, typed back: the value they stood behind from the start, and nothing left to remember.
    const edited = editedField(field(), "Córdoba", opts("manual"));
    expect(editedField(edited, "Rosario", opts("manual"))).toMatchObject({ value: "Rosario", status: "confirmed", confirmedAt: LATER });
  });

  it("does not make a step in the history of an edit that ended where it began", () => {
    const profile = emptyStoredProfile();
    profile.contact.city = { value: "Rosario", status: "confirmed", source: { kind: "manual", at: STAMP }, confirmedAt: STAMP };
    editFieldAt(profile, ["contact", "city"], "Córdoba", isBlankText, ctx("2026-09-21T12:00:01.000Z"), "manual");
    editFieldAt(profile, ["contact", "city"], "Rosario", isBlankText, ctx("2026-09-21T12:00:02.000Z"), "manual");
    // The day it was last stood behind moved, and the value did not: there is nothing to undo.
    expect(profile.history).toEqual([]);
    expect(profile.contact.city.value).toBe("Rosario");
    expect(profile.contact.city.confirmedAt).toBe("2026-09-21T12:00:02.000Z");
  });

  it("is written on a task reworded and on a figure given, and not on «no lo sé»", () => {
    const profile = profileWith({ company: "Nubia Retail", role: "Analista", from: { year: 2022 }, to: "current", facts: [{ text: "Armo los informes" }] });
    const job = profile.experience[0]!;
    const task = job.facts[0]!;
    expect(editFactText(profile, job.id, task.id, "Armo los informes de ventas", ctx(LATER))).toBe(true);
    expect(job.facts[0]!.confirmedAt).toBe(LATER);

    const later = "2026-11-01T10:00:00.000Z";
    expect(setFactMetric(profile, job.id, task.id, { value: "20", unit: "%", approx: false }, ctx(later))).toBe(true);
    expect(job.facts[0]!.confirmedAt).toBe(later);

    const unknown = "2026-12-01T10:00:00.000Z";
    expect(setFactMetric(profile, job.id, task.id, { unknown: true }, ctx(unknown))).toBe(true);
    expect(job.facts[0]!.confirmedAt).toBe(later);
  });
});

describe("undoing an edit", () => {
  it("still works after the person said «sigue igual» to what it wrote: the day moved, and the value did not", () => {
    const profile = emptyStoredProfile();
    profile.legacy.practical = practical({ availability: "Tiempo completo" });
    editFieldAt(profile, ["legacy", "practical"], { ...profile.legacy.practical.value, availability: "Fines de semana" }, () => false, ctx("2026-09-21T12:00:00.000Z"), "manual");
    confirmFieldAt(profile, ["legacy", "practical"], LATER);
    const undone = undoEntry(profile, profile.history.at(-1)!.id);
    expect(undone.ok).toBe(true);
    if (undone.ok) expect(undone.profile.legacy.practical.value.availability).toBe("Tiempo completo");
  });

  it("still says no when the value itself changed since", () => {
    const profile = emptyStoredProfile();
    profile.legacy.practical = practical({ availability: "Tiempo completo" });
    const first = ctx("2026-09-21T12:00:00.000Z");
    editFieldAt(profile, ["legacy", "practical"], { ...profile.legacy.practical.value, availability: "Fines de semana" }, () => false, first, "manual");
    const entry = profile.history.at(-1)!;
    editFieldAt(profile, ["legacy", "practical"], { ...profile.legacy.practical.value, availability: "Por la noche" }, () => false, ctx("2026-09-21T13:00:00.000Z"), "manual");
    expect(undoEntry(profile, entry.id)).toEqual({ ok: false, reason: "changed" });
  });
});

describe("a field that may not be there yet", () => {
  it("is created with what the person said, credited to them, and is a step in the history", () => {
    const profile = emptyStoredProfile();
    withCert(profile, "Carnet");
    const id = profile.certifications[0]!.id;
    expect(upsertFieldAt(profile, ["certifications", id, "expires"], { year: 2028, month: 5 }, () => false, ctx(LATER), "manual")).toBe(true);
    expect(profile.certifications[0]!.expires).toMatchObject({ value: { year: 2028, month: 5 }, status: "confirmed", source: { kind: "manual", at: LATER }, confirmedAt: LATER });
    expect(profile.history).toHaveLength(1);
    const undone = undoEntry(profile, profile.history[0]!.id);
    expect(undone.ok).toBe(true);
    if (undone.ok) expect(undone.profile.certifications[0]!.expires).toBeUndefined();
  });

  it("is edited when it is there, with everything an edit does", () => {
    const profile = emptyStoredProfile();
    const cert = withCert(profile, "Carnet", { expires: { value: { year: 2026, month: 3 }, status: "confirmed", source: { kind: "cv", at: STAMP } } });
    upsertFieldAt(profile, ["certifications", cert.id, "expires"], { year: 2029 }, () => false, ctx(LATER), "answer");
    expect(profile.certifications[0]!.expires).toMatchObject({ value: { year: 2029 }, status: "edited", confirmedAt: LATER });
    expect(profile.certifications[0]!.expires?.original).toEqual({ year: 2026, month: 3 });
  });

  it("creates nothing out of nothing, and says whether the place it would go exists", () => {
    const profile = emptyStoredProfile();
    const cert = withCert(profile, "Carnet");
    const isEmpty = (value: { year?: number }) => value.year === undefined;
    expect(upsertFieldAt(profile, ["certifications", cert.id, "expires"], {}, isEmpty, ctx(LATER))).toBe(true);
    expect(profile.certifications[0]!.expires).toBeUndefined();
    expect(profile.history).toEqual([]);
    expect(upsertFieldAt(profile, ["certifications", "nobody", "expires"], { year: 2030 }, isEmpty, ctx(LATER))).toBe(false);
  });
});

describe("«sigue igual»", () => {
  it("changes the day and nothing else, and is not a step in the history", () => {
    const profile = emptyStoredProfile();
    profile.legacy.practical = { ...practical(), source: { kind: "answer", at: "2026-01-01T00:00:00.000Z" } };
    const before = structuredClone(profile.legacy.practical.value);
    expect(confirmFieldAt(profile, ["legacy", "practical"], LATER)).toBe(true);
    expect(profile.legacy.practical.value).toEqual(before);
    expect(profile.legacy.practical.confirmedAt).toBe(LATER);
    expect(profile.history).toEqual([]);
  });

  it("makes what was only proposed the person's own", () => {
    const profile = emptyStoredProfile();
    profile.contact.city = { value: "Rosario", status: "proposed", source: { kind: "cv", at: STAMP } };
    expect(confirmFieldAt(profile, ["contact", "city"], LATER)).toBe(true);
    expect(profile.contact.city).toMatchObject({ status: "confirmed", confirmedAt: LATER });
  });

  it("has nothing to stand behind where nothing was said, or where there is no such field", () => {
    const profile = emptyStoredProfile();
    expect(confirmFieldAt(profile, ["contact", "city"], LATER)).toBe(false);
    expect(confirmFieldAt(profile, ["contact", "nobody"], LATER)).toBe(false);
    expect(profile.contact.city.confirmedAt).toBeUndefined();
  });

  it("is what confirming how they can work does, and not when nothing was said about it", () => {
    const profile = emptyStoredProfile();
    expect(confirmPractical(profile, ctx(LATER))).toBe(false);
    profile.legacy.practical = practical();
    expect(confirmPractical(profile, ctx(LATER))).toBe(true);
    expect(profile.legacy.practical.confirmedAt).toBe(LATER);
  });
});

describe("a credential set aside", () => {
  it("is a mark on it, absent and not false when it is used, and says nothing when nothing changed", () => {
    const profile = emptyStoredProfile();
    const cert = withCert(profile, "Carnet de manipulación");
    expect(setCertificationExcluded(profile, cert.id, true, ctx())).toBe(true);
    expect(profile.certifications[0]!.excluded).toBe(true);
    expect(setCertificationExcluded(profile, cert.id, false, ctx())).toBe(true);
    expect("excluded" in profile.certifications[0]!).toBe(false);
    const steps = profile.history.length;
    expect(setCertificationExcluded(profile, cert.id, false, ctx())).toBe(true);
    expect(profile.history).toHaveLength(steps);
    expect(setCertificationExcluded(profile, "nobody", true, ctx())).toBe(false);
  });

  it("can be taken back with the history, like any other edit", () => {
    const profile = emptyStoredProfile();
    const cert = withCert(profile, "Carnet de manipulación");
    setCertificationExcluded(profile, cert.id, true, ctx());
    const undone = undoEntry(profile, profile.history.at(-1)!.id);
    expect(undone.ok).toBe(true);
    if (undone.ok) expect(undone.profile.certifications[0]!.excluded).toBeUndefined();
  });

  it("stays in the profile with all it says, and is in no CV and no plain profile", () => {
    const profile = emptyStoredProfile();
    withCert(profile, "Curso de Excel", { issuer: { value: "UTN", status: "confirmed" } });
    const aside = withCert(profile, "Matrícula de gasista", { expires: { value: { year: 2024, month: 1 }, status: "confirmed" } });
    setCertificationExcluded(profile, aside.id, true, ctx());

    expect(profile.certifications.map((cert) => cert.name.value)).toEqual(["Curso de Excel", "Matrícula de gasista"]);
    expect(profile.certifications[1]!.expires?.value).toEqual({ year: 2024, month: 1 });
    expect(toPlainProfile(profile).certifications.map((cert) => cert.name)).toEqual(["Curso de Excel"]);

    const everything = JSON.stringify(baseCv(profile).document);
    expect(everything).toContain("Curso de Excel");
    expect(everything).not.toContain("Matrícula de gasista");
    // The preview counts what the CV draws, and it does not draw this.
    expect(previewEntryCount(profile)).toBe(1);
  });

  it("is not archived by an edit made on the plain profile, which never had it", () => {
    const profile = profileWith({ company: "Nubia Retail", role: "Analista", from: { year: 2022 }, to: "current", facts: [{ text: "Armo los informes" }] });
    withCert(profile, "Curso de Excel");
    const aside = withCert(profile, "Matrícula de gasista", { expires: { value: { year: 2024 }, status: "confirmed" } });
    setCertificationExcluded(profile, aside.id, true, ctx());

    // Nothing edited: the very same profile, with or without the mark.
    expect(reconcileFromPlain(profile, toPlainProfile(profile))).toBe(profile);

    const next = structuredClone(toPlainProfile(profile));
    next.certifications[0]!.issuer = "UTN";
    const saved = reconcileFromPlain(profile, profileSchema.parse(next), { now: STAMP, newId });
    expect(saved.archive).toHaveLength(0);
    expect(saved.certifications.map((cert) => cert.name.value)).toEqual(["Curso de Excel", "Matrícula de gasista"]);
    expect(saved.certifications[1]).toMatchObject({ excluded: true, expires: { value: { year: 2024 } } });
    expect(saved.certifications[0]!.issuer.value).toBe("UTN");
  });

  it("is not asked about again, because there is no date left to ask after", () => {
    const profile = emptyStoredProfile();
    const cert = withCert(profile, "Matrícula", { expires: { value: { year: 2025, month: 1 }, status: "confirmed" } });
    expect(credentialReviews(profile, NOW)).toHaveLength(1);
    setCertificationExcluded(profile, cert.id, true, ctx());
    expect(credentialReviews(profile, NOW)).toEqual([]);
  });
});

describe("until when a credential holds", () => {
  it("is kept as a year and its month if there is one, as the person said it", () => {
    const profile = emptyStoredProfile();
    const cert = withCert(profile, "Carnet");
    expect(setCertificationExpiry(profile, cert.id, { year: 2029, month: 8, raw: "agosto 2029" }, ctx(LATER))).toBe(true);
    expect(profile.certifications[0]!.expires?.value).toEqual({ year: 2029, month: 8 });
    expect(setCertificationExpiry(profile, cert.id, { year: 2031 }, ctx(LATER))).toBe(true);
    expect(profile.certifications[0]!.expires?.value).toEqual({ year: 2031 });
  });

  it("is taken off by saying nothing, and a month with no year is no date", () => {
    const profile = emptyStoredProfile();
    const cert = withCert(profile, "Carnet", { expires: { value: { year: 2025, month: 1 }, status: "confirmed" } });
    expect(credentialReviews(profile, NOW)).toHaveLength(1);
    expect(setCertificationExpiry(profile, cert.id, { month: 5 }, ctx(LATER))).toBe(true);
    expect(credentialReviews(profile, NOW)).toEqual([]);
    // And with a new date it is asked about again, when it comes to that.
    expect(setCertificationExpiry(profile, cert.id, { year: 2025, month: 3 }, ctx(LATER))).toBe(true);
    expect(credentialReviews(profile, NOW)).toHaveLength(1);
    expect(setCertificationExpiry(profile, cert.id, null, ctx(LATER))).toBe(true);
    expect(credentialReviews(profile, NOW)).toEqual([]);
  });

  it("belongs to a credential that is there", () => {
    expect(setCertificationExpiry(emptyStoredProfile(), "nobody", { year: 2030 }, ctx())).toBe(false);
  });

  it("is given when the credential is added, and is optional", () => {
    const profile = emptyStoredProfile();
    const withDate = addCertification(profile, { name: "Carnet de manipulación", issuer: "Municipio", date: { year: 2023 }, expires: { year: 2027, month: 9, raw: "x" } }, ctx());
    const without = addCertification(profile, { name: "Curso de Excel" }, ctx());
    expect(withDate?.expires).toMatchObject({ value: { year: 2027, month: 9 }, status: "confirmed", source: { kind: "manual" } });
    expect(without && "expires" in without).toBe(false);
    // A month with no year is no date, here either.
    expect(addCertification(profile, { name: "Otro", expires: { month: 4 } }, ctx())).not.toHaveProperty("expires");
  });

  it("is the licence's too, apart from the class, and is never in the plain profile or what a model reads", () => {
    const profile = emptyStoredProfile();
    profile.legacy.practical = practical();
    expect(setLicenseExpiry(profile, { year: 2031, month: 2 }, ctx(LATER))).toBe(true);
    expect(profile.legacy.driverLicenseExpires).toMatchObject({ value: { year: 2031, month: 2 }, confirmedAt: LATER });
    // The class travels, as it always did, in what they said about how they can work. The date does not.
    const plain = JSON.stringify(toPlainProfile(profile));
    expect(plain).toContain("B1");
    expect(plain).not.toContain("2031");
    expect(plain).not.toContain("driverLicenseExpires");
    expect(setLicenseExpiry(profile, null, ctx(LATER))).toBe(true);
    expect(profile.legacy.driverLicenseExpires?.value).toEqual({});
  });
});

describe("what a model reads", () => {
  it("has no day anyone stood behind a value, no date a credential holds until, and no mark of one set aside", () => {
    const profile = profileWith({ company: "Nubia Retail", role: "Analista", from: { year: 2022 }, to: "current", facts: [{ text: "Armo los informes" }] });
    profile.contact.fullName = { value: "Lucía Pérez", status: "confirmed", confirmedAt: "2026-09-02T09:00:00.000Z" };
    profile.experience[0]!.facts[0]!.confirmedAt = "2026-09-03T09:00:00.000Z";
    withCert(profile, "Carnet de manipulación", { expires: { value: { year: 2034, month: 7 }, status: "confirmed", confirmedAt: "2026-09-04T09:00:00.000Z" } });
    withCert(profile, "Matrícula vieja", { excluded: true });
    profile.legacy.practical = practical();
    profile.legacy.driverLicenseExpires = { value: { year: 2035, month: 2 }, status: "confirmed", confirmedAt: "2026-09-05T09:00:00.000Z" };

    // The plain profile is what every generator and every reader of a document is given: the profile as the CV says it, and nothing about when.
    const plain = JSON.stringify(toPlainProfile(profile));
    expect(plain).toContain("Carnet de manipulación");
    expect(plain).not.toContain("Matrícula vieja");
    for (const absent of ["confirmedAt", "expires", "excluded", "2034", "2035", "2026-09-0"]) expect(plain, absent).not.toContain(absent);
  });
});

describe("the licence no longer theirs", () => {
  it("goes from what they said about how they can work, with its date, and the rest stays", () => {
    const profile = emptyStoredProfile();
    profile.legacy.practical = practical({ workEligibility: "Argentino" });
    setLicenseExpiry(profile, { year: 2026, month: 4 }, ctx());
    expect(dropLicense(profile, ctx(LATER))).toBe(true);
    expect(profile.legacy.practical.value).toMatchObject({ driverLicense: "", availability: "Tiempo completo", ownVehicle: true, workEligibility: "Argentino" });
    expect(profile.legacy.driverLicenseExpires?.value).toEqual({});
    expect(credentialReviews(profile, NOW)).toEqual([]);
  });

  it("can be taken back with the history", () => {
    const profile = emptyStoredProfile();
    profile.legacy.practical = practical();
    dropLicense(profile, ctx(LATER));
    const step = profile.history.find((entry) => entry.path.join("/") === "legacy/practical")!;
    expect(step).toBeDefined();
    const undone = undoEntry(profile, step.id);
    expect(undone.ok).toBe(true);
    if (undone.ok) expect(undone.profile.legacy.practical.value.driverLicense).toBe("B1");
  });

  it("has nothing to do where there was no licence", () => {
    const profile = emptyStoredProfile();
    profile.legacy.practical = practical({ driverLicense: "" });
    expect(dropLicense(profile, ctx())).toBe(false);
    expect(profile.history).toEqual([]);
  });
});

describe("a profile from before any of it", () => {
  it("has no day, no date and no mark, and is the same profile once read", () => {
    const profile = profileWith({ company: "Nubia Retail", role: "Analista", from: { year: 2022 }, to: "current", facts: [{ text: "Armo los informes" }] });
    withCert(profile, "Curso de Excel");
    const raw = JSON.parse(JSON.stringify(profile)) as Record<string, unknown>;
    const parsed = storedProfileSchema.parse(raw);
    expect(parsed.certifications[0]!.expires).toBeUndefined();
    expect(parsed.certifications[0]!.excluded).toBeUndefined();
    expect(parsed.legacy.driverLicenseExpires).toBeUndefined();
    expect(parsed.contact.city.confirmedAt).toBeUndefined();
    expect(JSON.stringify(parsed)).not.toContain("confirmedAt");
  });

  it("lets go of a date, a mark or a day that is not one, and keeps the credential it was on", () => {
    const profile = emptyStoredProfile();
    withCert(profile, "Carnet de manipulación");
    withCert(profile, "Matrícula");
    const raw = JSON.parse(JSON.stringify(profile)) as { certifications: Array<Record<string, unknown>>; contact: { city: Record<string, unknown> } };
    // A date whose year is not one says nothing; a date that is not even a field is let go of altogether.
    raw.certifications[0]!.expires = { value: { year: "pronto" }, status: "confirmed" };
    raw.certifications[1]!.expires = "2030";
    raw.certifications[0]!.excluded = "yes";
    raw.contact.city.confirmedAt = 20260921;
    const parsed = storedProfileSchema.parse(raw);
    expect(parsed.certifications.map((cert) => cert.name.value)).toEqual(["Carnet de manipulación", "Matrícula"]);
    expect(parsed.certifications[0]!.expires?.value.year).toBeUndefined();
    expect(parsed.certifications[1]!.expires).toBeUndefined();
    expect(parsed.certifications[0]!.excluded).toBeUndefined();
    expect(parsed.contact.city.confirmedAt).toBeUndefined();
    // And neither is asked about: there is no date to ask after.
    expect(credentialReviews(parsed, NOW)).toEqual([]);
  });
});
