import { describe, expect, it } from "vitest";
import {
  certificationVigencia,
  conditionsReview,
  credentialReviews,
  expiryLine,
  expiryOf,
  lapsedCredentials,
  monthOf,
  sectionReviewed,
  standingAt,
} from "@/lib/profile/currency";
import { spelledDate } from "@/lib/profile/dates";
import { certificationSchema, emptyStoredProfile, type StoredProfile } from "@/lib/schemas/profile-v2";
import { profileWith } from "./helpers/profiles";

/**
 * O2 (e5): the time as a datum of the profile. When the person last stood behind something, what a date that stops being true says
 * about the thing it belongs to, and what there is to settle — all of it pure, with the clock as an argument.
 */

/** A moment by the clock of the machine, the way the code reads dates: a day of a month, at noon. */
const at = (year: number, month: number, day: number) => new Date(year, month - 1, day, 12, 0, 0);
const NOW = at(2026, 9, 21);

const cert = (id: string, name: string, extra: Record<string, unknown> = {}) =>
  certificationSchema.parse({ id, name: { value: name, status: "confirmed" }, ...extra });
const expiring = (year: number, month?: number) => ({ expires: { value: { year, ...(month ? { month } : {}) }, status: "confirmed" } });

function withCerts(...certs: Array<ReturnType<typeof cert>>): StoredProfile {
  const profile = emptyStoredProfile();
  profile.certifications.push(...certs);
  return profile;
}

describe("when the person last stood behind something", () => {
  it("is never for what a reader took from a document and nobody has looked at", () => {
    expect(standingAt({ source: { kind: "cv", at: "2026-03-01T10:00:00.000Z" } })).toBeNull();
    expect(standingAt({ source: { kind: "linkedin_pdf", at: "2026-03-01T10:00:00.000Z" } })).toBeNull();
    expect(standingAt({})).toBeNull();
  });

  it("is the moment they gave it, for what they wrote or answered", () => {
    for (const kind of ["manual", "answer", "dump"] as const) {
      expect(standingAt({ source: { kind, at: "2026-03-01T10:00:00.000Z" } }), kind).toBe("2026-03-01T10:00:00.000Z");
    }
  });

  it("is the confirmation, when there is one — and the later of the two when there are both", () => {
    expect(standingAt({ source: { kind: "cv", at: "2026-03-01T10:00:00.000Z" }, confirmedAt: "2026-06-05T09:00:00.000Z" })).toBe("2026-06-05T09:00:00.000Z");
    expect(standingAt({ source: { kind: "manual", at: "2026-03-01T10:00:00.000Z" }, confirmedAt: "2026-06-05T09:00:00.000Z" })).toBe("2026-06-05T09:00:00.000Z");
    expect(standingAt({ source: { kind: "manual", at: "2026-08-01T10:00:00.000Z" }, confirmedAt: "2026-06-05T09:00:00.000Z" })).toBe("2026-08-01T10:00:00.000Z");
  });

  it("is what is known of a value from before provenance, and nothing when nothing is", () => {
    expect(standingAt({ source: { kind: "legacy", at: "" } })).toBeNull();
    expect(standingAt({ source: { kind: "legacy", at: "" }, confirmedAt: "2026-06-05T09:00:00.000Z" })).toBe("2026-06-05T09:00:00.000Z");
  });
});

describe("what a date that stops being true says", () => {
  it("holds to the end of the month it names, and to the end of the year when only that is said", () => {
    // 31 October is the last day of «octubre de 2026».
    expect(expiryOf({ year: 2026, month: 10 }, at(2026, 10, 31))).toMatchObject({ state: "soon" });
    expect(expiryOf({ year: 2026, month: 10 }, at(2026, 11, 1))).toMatchObject({ state: "lapsed" });
    expect(expiryOf({ year: 2026 }, at(2026, 12, 31))).toMatchObject({ state: "soon" });
    expect(expiryOf({ year: 2026 }, at(2027, 1, 1))).toMatchObject({ state: "lapsed" });
  });

  it("is asked after from sixty days before, and not before", () => {
    // «noviembre de 2026» holds to 30 November, which is 61 days from 1 October at midnight and 60 from the next day.
    expect(expiryOf({ year: 2026, month: 11 }, new Date(2026, 9, 1, 0, 0, 0))).toMatchObject({ state: "valid" });
    expect(expiryOf({ year: 2026, month: 11 }, new Date(2026, 9, 2, 0, 0, 0))).toMatchObject({ state: "soon", days: 60 });
    expect(expiryOf({ year: 2030, month: 6 }, NOW)).toMatchObject({ state: "valid" });
  });

  it("says by how many whole days one has lapsed", () => {
    const lapsed = expiryOf({ year: 2026, month: 3 }, NOW);
    expect(lapsed?.state).toBe("lapsed");
    // From the last moment of 31 March to noon on 21 September: 173 whole days, and half of the 174th.
    expect(lapsed?.days).toBe(173);
  });

  it("says nothing of a date that is not one", () => {
    expect(expiryOf(undefined, NOW)).toBeNull();
    expect(expiryOf({}, NOW)).toBeNull();
    expect(expiryOf({ raw: "no vence" }, NOW)).toBeNull();
  });

  it("is said in the date's own words, as a fact about the date", () => {
    expect(expiryLine({ year: 2030, month: 6 }, NOW)).toEqual({ tone: "ok", text: "Vence en junio de 2030" });
    expect(expiryLine({ year: 2026, month: 10 }, NOW)).toEqual({ tone: "soon", text: "Vence en octubre de 2026" });
    expect(expiryLine({ year: 2026, month: 3 }, NOW)).toEqual({ tone: "lapsed", text: "Venció en marzo de 2026" });
    expect(expiryLine({ year: 2027 }, NOW)).toEqual({ tone: "ok", text: "Vence en 2027" });
    expect(expiryLine({}, NOW)).toBeNull();
  });

  it("is spelled with the month when there is one, and as the year alone when there is not", () => {
    expect(spelledDate({ year: 2026, month: 3 })).toBe("marzo de 2026");
    expect(spelledDate({ year: 2026 })).toBe("2026");
    expect(spelledDate({})).toBe("");
    expect(spelledDate(undefined)).toBe("");
  });
});

describe("the credentials to ask about", () => {
  it("are the ones whose date is near or past, past ones first and the longest ago first", () => {
    const profile = withCerts(
      cert("far", "Matrícula de gasista", expiring(2030, 5)),
      // Until 31 October: forty days from the 21st of September.
      cert("soon", "Carnet de manipulación de alimentos", expiring(2026, 10)),
      cert("old", "Registro de electricista", expiring(2025, 1)),
      cert("recent", "Curso de seguridad", expiring(2026, 8)),
    );
    const reviews = credentialReviews(profile, NOW);
    expect(reviews.map((review) => review.subject)).toEqual([
      { kind: "certification", id: "old" },
      { kind: "certification", id: "recent" },
      { kind: "certification", id: "soon" },
    ]);
    expect(reviews.map((review) => review.expiry.state)).toEqual(["lapsed", "lapsed", "soon"]);
    expect(reviews[0]!.name).toBe("Registro de electricista");
  });

  it("are never one with no date, one that is not theirs any more, or one with no name", () => {
    const profile = withCerts(
      cert("nodate", "Curso de Excel"),
      cert("excluded", "Matrícula vieja", { ...expiring(2024, 1), excluded: true }),
      cert("nameless", "", expiring(2024, 1)),
    );
    expect(credentialReviews(profile, NOW)).toEqual([]);
  });

  it("include the driving licence, by its class, once its date is near or past", () => {
    const profile = emptyStoredProfile();
    profile.legacy.practical = { value: { availability: "", driverLicense: "B1", ownVehicle: false, willingToRelocate: false, workEligibility: "" }, status: "confirmed" };
    profile.legacy.driverLicenseExpires = { value: { year: 2026, month: 4 }, status: "confirmed" };
    const [review] = credentialReviews(profile, NOW);
    expect(review).toMatchObject({ subject: { kind: "license" }, name: "Licencia de conducir (B1)", expiry: { state: "lapsed" } });
  });

  it("leave out a licence's date when the profile says no licence — it is the date of nothing", () => {
    const profile = emptyStoredProfile();
    profile.legacy.driverLicenseExpires = { value: { year: 2026, month: 4 }, status: "confirmed" };
    expect(credentialReviews(profile, NOW)).toEqual([]);
  });

  it("say which of them are past their date, for the CV that carries them", () => {
    const profile = withCerts(cert("soon", "Carnet", expiring(2026, 10)), cert("old", "Matrícula", expiring(2025, 1)));
    expect(lapsedCredentials(profile, NOW).map((review) => review.name)).toEqual(["Matrícula"]);
  });
});

describe("what was said about how they can work", () => {
  const practical = (at: string | null, extra: Partial<StoredProfile["legacy"]["practical"]["value"]> = {}): StoredProfile => {
    const profile = emptyStoredProfile();
    profile.legacy.practical = {
      value: { availability: "Tiempo completo", driverLicense: "B1", ownVehicle: true, willingToRelocate: false, workEligibility: "", ...extra },
      status: "confirmed",
      ...(at ? { source: { kind: "answer" as const, at } } : {}),
    };
    return profile;
  };

  it("is asked after once it has gone ninety days without being said to still hold", () => {
    // 90 days before 21 September 2026 is 23 June.
    expect(conditionsReview(practical("2026-06-24T12:00:00.000Z"), NOW)).toBeNull();
    expect(conditionsReview(practical("2026-06-20T12:00:00.000Z"), NOW)).toMatchObject({ since: "2026-06-20T12:00:00.000Z" });
  });

  it("shows what is held, in a line, as the person said it", () => {
    expect(conditionsReview(practical("2026-01-01T12:00:00.000Z"), NOW)?.line).toBe("Tiempo completo · Licencia B1 · Vehículo propio");
  });

  it("counts from the last confirmation when there is one", () => {
    const profile = practical("2026-01-01T12:00:00.000Z");
    profile.legacy.practical.confirmedAt = "2026-09-01T12:00:00.000Z";
    expect(conditionsReview(profile, NOW)).toBeNull();
  });

  it("is not asked where nothing was said, or where nobody can say when", () => {
    const empty = emptyStoredProfile();
    expect(conditionsReview(empty, NOW)).toBeNull();
    expect(conditionsReview(practical(null), NOW)).toBeNull();
    // Read from a document and never looked at: nobody has said it holds.
    const read = practical(null);
    read.legacy.practical.source = { kind: "cv", at: "2025-01-01T12:00:00.000Z" };
    expect(conditionsReview(read, NOW)).toBeNull();
  });
});

describe("the state of a credential", () => {
  it("is archived when they set it aside, to review when its date is near or past, and current otherwise", () => {
    const profile = withCerts(
      cert("a", "Una", { ...expiring(2024, 1), excluded: true }),
      cert("b", "Otra", expiring(2026, 10)),
      cert("c", "La tercera", expiring(2031, 10)),
      cert("d", "Sin fecha"),
    );
    expect(certificationVigencia(profile, "a", NOW)).toBe("archived");
    expect(certificationVigencia(profile, "b", NOW)).toBe("to_review");
    expect(certificationVigencia(profile, "c", NOW)).toBe("current");
    expect(certificationVigencia(profile, "d", NOW)).toBe("current");
    expect(certificationVigencia(profile, "gone", NOW)).toBe("current");
  });
});

describe("when each section was last stood behind", () => {
  it("is nothing for a profile nobody has touched, and the latest of anything in a section otherwise", () => {
    expect(Object.values(sectionReviewed(emptyStoredProfile()))).toEqual([null, null, null, null, null, null]);

    const profile = profileWith({ company: "Nubia Retail", role: "Analista", from: { year: 2022 }, to: "current", facts: [{ text: "Armo los pedidos" }] });
    // Typed by hand at the stamp of the helpers (2026-09-21): theirs from the moment they gave it.
    expect(sectionReviewed(profile).experience).toBe("2026-09-21T12:00:00.000Z");
    // An edit after that is the later day, and it is a fact's own that counts.
    profile.experience[0]!.facts[0]!.confirmedAt = "2026-10-02T08:00:00.000Z";
    expect(sectionReviewed(profile).experience).toBe("2026-10-02T08:00:00.000Z");
    // Nothing of the rest.
    expect(sectionReviewed(profile).contact).toBeNull();
    expect(sectionReviewed(profile).other).toBeNull();
  });

  it("does not claim a review for what was only read from a document", () => {
    const profile = emptyStoredProfile();
    profile.contact.email = { value: "lucia@example.com", status: "confirmed", source: { kind: "cv", at: "2026-09-01T10:00:00.000Z" } };
    expect(sectionReviewed(profile).contact).toBeNull();
    profile.contact.email.confirmedAt = "2026-09-05T10:00:00.000Z";
    expect(sectionReviewed(profile).contact).toBe("2026-09-05T10:00:00.000Z");
  });

  it("puts a certification's date and a licence's in the sections they are shown in", () => {
    const profile = withCerts(cert("a", "Carnet", { expires: { value: { year: 2030 }, status: "confirmed", confirmedAt: "2026-08-10T10:00:00.000Z" } }));
    profile.legacy.driverLicenseExpires = { value: { year: 2031 }, status: "confirmed", confirmedAt: "2026-09-12T10:00:00.000Z" };
    expect(sectionReviewed(profile).skills).toBe("2026-08-10T10:00:00.000Z");
    expect(sectionReviewed(profile).other).toBe("2026-09-12T10:00:00.000Z");
  });

  it("says the month in words, by the person's clock", () => {
    expect(monthOf(new Date(2026, 2, 15, 12).toISOString())).toBe("marzo de 2026");
    expect(monthOf("not a time")).toBe("");
  });
});
