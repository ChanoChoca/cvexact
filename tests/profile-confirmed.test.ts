import { describe, expect, it } from "vitest";
import { confirmAll, confirmContact, confirmEducation, confirmExperience, confirmUnflagged, resolveConflict } from "@/lib/onboarding/review";
import { describeJoin, joinProfiles } from "@/lib/profile/join";
import { forSync } from "@/lib/profile/sync";
import { figuresIn, hasFigure, inventoryOf } from "@/lib/profile/inventory";
import { sectionReviewed } from "@/lib/profile/currency";
import { toPlainProfile } from "@/lib/profile/project";
import { reconcileFromPlain } from "@/lib/profile/reconcile";
import { profileSchema } from "@/lib/schemas/profile";
import { certificationSchema, storedProfileSchema, type Conflict, type StoredProfile } from "@/lib/schemas/profile-v2";
import { NOW, STAMP, newId, profileWith, withJob, withStudy } from "./helpers/profiles";

/**
 * The day the person last stood behind a value (`confirmedAt`): what moving on from a review writes, what an account's copy and a
 * browser's say of it when they are joined, and what a job's tasks count as with and without a figure.
 */

const copy = (profile: StoredProfile): StoredProfile => storedProfileSchema.parse(structuredClone(profile));
const CONFIRMED = "2026-10-03T15:00:00.000Z";
const EARLIER = "2026-03-01T10:00:00.000Z";
const LATER = "2026-08-15T10:00:00.000Z";

/** What a document gave, as a reader writes it: proposed, from a CV, with no day anyone stood behind it. */
function fromCv(): StoredProfile {
  const profile = profileWith({ company: "Nubia Retail", role: "Analista", from: { year: 2022 }, to: "current", facts: [{ text: "Armo los informes" }] });
  const job = profile.experience[0]!;
  const read = { status: "proposed" as const, source: { kind: "cv" as const, at: EARLIER } };
  job.company = { ...job.company, ...read };
  job.role = { ...job.role, ...read };
  job.start = { ...job.start, ...read };
  job.end = { ...job.end, ...read };
  job.facts[0]!.status = "proposed";
  job.facts[0]!.source = { kind: "cv", at: EARLIER };
  profile.contact.fullName = { value: "Lucía Pérez", status: "proposed", source: { kind: "cv", at: EARLIER } };
  profile.contact.email = { value: "lucia@example.com", status: "proposed", source: { kind: "cv", at: EARLIER } };
  return profile;
}

describe("moving on from a review", () => {
  it("is the person standing behind what was read: it is theirs, and it says the day", () => {
    const profile = fromCv();
    const job = profile.experience[0]!;
    expect(sectionReviewed(profile).experience).toBeNull();
    expect(confirmExperience(profile, job.id, CONFIRMED)).toBe(true);
    expect(job.company).toMatchObject({ status: "confirmed", confirmedAt: CONFIRMED });
    expect(job.role).toMatchObject({ status: "confirmed", confirmedAt: CONFIRMED });
    expect(job.facts[0]).toMatchObject({ status: "confirmed", confirmedAt: CONFIRMED });
    expect(sectionReviewed(profile).experience).toBe(CONFIRMED);
  });

  it("writes no day on what is empty: there was nothing there to stand behind", () => {
    const profile = fromCv();
    const job = profile.experience[0]!;
    // No city and no country were ever said, and an empty task is not one.
    job.facts.push({ id: newId(), kind: "responsibility", text: "", source: { kind: "cv", at: EARLIER }, status: "proposed" });
    confirmExperience(profile, job.id, CONFIRMED);
    expect(job.city.confirmedAt).toBeUndefined();
    expect(job.country.confirmedAt).toBeUndefined();
    expect(job.facts[1]!.confirmedAt).toBeUndefined();
    expect(job.facts[1]!.status).toBe("confirmed");
  });

  it("does the same for a study and for the contact, and not for an email that does not look like one", () => {
    const profile = fromCv();
    const study = withStudy(profile, { degree: "Licenciatura", institution: "UBA", from: { year: 2015 }, to: { year: 2020 } });
    study.degree = { ...study.degree, status: "proposed", source: { kind: "cv", at: EARLIER } };
    confirmEducation(profile, study.id, CONFIRMED);
    expect(study.degree).toMatchObject({ status: "confirmed", confirmedAt: CONFIRMED });

    profile.contact.email = { value: "lucia arroba example", status: "proposed", source: { kind: "cv", at: EARLIER } };
    confirmContact(profile, CONFIRMED);
    expect(profile.contact.fullName).toMatchObject({ status: "confirmed", confirmedAt: CONFIRMED });
    // The card still says it is wrong, so nobody has stood behind it.
    expect(profile.contact.email).toMatchObject({ status: "proposed" });
    expect(profile.contact.email.confirmedAt).toBeUndefined();
  });

  it("is one instant for everything a review confirms, whether it is all or what is not flagged", () => {
    const all = fromCv();
    all.legacy.about = { value: "Analista con diez años de experiencia", status: "proposed", source: { kind: "cv", at: EARLIER } };
    confirmAll(all, CONFIRMED);
    expect(all.legacy.about).toMatchObject({ status: "confirmed", confirmedAt: CONFIRMED });
    expect(all.experience[0]!.company.confirmedAt).toBe(CONFIRMED);
    expect(all.contact.fullName.confirmedAt).toBe(CONFIRMED);

    // Moving on stands behind what nothing flagged — the contact, and the jobs read with confidence — and leaves a doubtful one to look at.
    const unflagged = fromCv();
    withJob(unflagged, { company: "Grupo Lumen", role: "Asistente", from: { year: 2019 }, to: { year: 2021 }, facts: [{ text: "Atendía a los clientes" }] });
    confirmUnflagged(unflagged, CONFIRMED);
    expect(unflagged.experience[0]!.company).toMatchObject({ status: "proposed" });
    expect(unflagged.experience[0]!.company.confirmedAt).toBeUndefined();
    expect(unflagged.experience[1]!.company.confirmedAt).toBe(CONFIRMED);
    expect(unflagged.contact.fullName.confirmedAt).toBe(CONFIRMED);
  });

  it("is the person's own clock when no moment is given", () => {
    const profile = fromCv();
    const before = Date.now();
    confirmContact(profile);
    const day = Date.parse(profile.contact.fullName.confirmedAt!);
    expect(day).toBeGreaterThanOrEqual(before);
    expect(day).toBeLessThanOrEqual(Date.now());
  });

  it("is also what choosing a version of a conflict is, whichever document it came from", () => {
    const profile = profileWith({ company: "Nubia Retail", role: "Analista", from: { year: 2022 }, to: "current" });
    const job = profile.experience[0]!;
    const conflict: Conflict = {
      id: "conflict-1",
      entity: "experience",
      entityId: job.id,
      field: "company",
      current: { value: "Nubia Retail", source: { kind: "cv", at: EARLIER } },
      incoming: { value: "Nubia S.A.", source: { kind: "linkedin_pdf", at: LATER } },
    } as Conflict;
    profile.conflicts.push(conflict);
    expect(resolveConflict(profile, conflict.id, "incoming", { now: CONFIRMED, newId })).toBe(true);
    expect(job.company).toMatchObject({ value: "Nubia S.A.", status: "confirmed", source: { kind: "linkedin_pdf" }, confirmedAt: CONFIRMED });
  });
});

describe("joining two copies of a profile, by the day each stood behind it", () => {
  const base = () => {
    const profile = profileWith({ company: "Nubia Retail", role: "Analista", from: { year: 2022 }, to: "current", facts: [{ text: "Armo los informes" }] });
    const job = profile.experience[0]!;
    job.company.confirmedAt = EARLIER;
    job.facts[0]!.confirmedAt = EARLIER;
    return profile;
  };

  it("takes the later day when both say the same thing", () => {
    const local = base();
    const account = copy(local);
    account.experience[0]!.company.confirmedAt = LATER;
    account.experience[0]!.facts[0]!.confirmedAt = LATER;
    const { profile, added } = joinProfiles(local, account);
    expect(profile.experience[0]!.company).toMatchObject({ value: "Nubia Retail", confirmedAt: LATER });
    expect(profile.experience[0]!.facts[0]!.confirmedAt).toBe(LATER);
    // A day moving is not something added, and there is nothing to tell.
    expect(describeJoin(added)).toBe("");
  });

  it("keeps its own when its own is the later one, or the account has none", () => {
    const local = base();
    local.experience[0]!.company.confirmedAt = LATER;
    const account = copy(local);
    account.experience[0]!.company.confirmedAt = EARLIER;
    delete account.experience[0]!.facts[0]!.confirmedAt;
    const { profile } = joinProfiles(local, account);
    expect(profile.experience[0]!.company.confirmedAt).toBe(LATER);
    expect(profile.experience[0]!.facts[0]!.confirmedAt).toBe(EARLIER);
  });

  it("does not make up a day for what neither ever stood behind", () => {
    const local = profileWith({ company: "Nubia Retail", role: "Analista", from: { year: 2022 }, to: "current", facts: [{ text: "Armo los informes" }] });
    const { profile } = joinProfiles(local, copy(local));
    expect(JSON.stringify(profile.experience)).not.toContain("confirmedAt");
  });

  it("keeps the browser's value and its day where they say something different", () => {
    const local = base();
    const account = copy(local);
    account.experience[0]!.company = { value: "Nubia S.A.", status: "edited", confirmedAt: LATER };
    const { profile } = joinProfiles(local, account);
    expect(profile.experience[0]!.company).toMatchObject({ value: "Nubia Retail", confirmedAt: EARLIER });
  });

  describe("a credential and a licence", () => {
    const cert = (extra: Record<string, unknown> = {}) => certificationSchema.parse({ id: "cert-1", name: { value: "Matrícula de gasista", status: "confirmed" }, ...extra });
    const expires = (year: number, confirmedAt?: string) => ({ value: { year, month: 3 }, status: "confirmed", ...(confirmedAt ? { confirmedAt } : {}) });

    it("takes the later day for the date both hold", () => {
      const local = base();
      local.certifications.push(cert({ expires: expires(2029, EARLIER) }));
      const account = copy(local);
      account.certifications[0]!.expires!.confirmedAt = LATER;
      const { profile } = joinProfiles(local, account);
      expect(profile.certifications[0]!.expires).toMatchObject({ value: { year: 2029, month: 3 }, confirmedAt: LATER });
    });

    it("brings the date the account has for a credential this browser has none for, and says so", () => {
      const local = base();
      local.certifications.push(cert());
      const account = copy(local);
      account.certifications[0]!.expires = { ...expires(2029, LATER), status: "confirmed" };
      const { profile, added } = joinProfiles(local, account);
      expect(profile.certifications[0]!.expires).toMatchObject({ value: { year: 2029, month: 3 }, confirmedAt: LATER });
      expect(added.certifications).toBe(0);
      expect(describeJoin(added)).toBe("1 dato suelto");
    });

    it("does not bring a date to a credential that the person set aside here", () => {
      const local = base();
      local.certifications.push(cert({ excluded: true }));
      const account = copy(local);
      delete account.certifications[0]!.excluded;
      account.certifications[0]!.expires = { ...expires(2029), status: "confirmed" };
      const { profile, added } = joinProfiles(local, account);
      expect(profile.certifications[0]!.excluded).toBe(true);
      expect(profile.certifications[0]!.expires).toBeUndefined();
      expect(describeJoin(added)).toBe("");
    });

    it("keeps this browser's date where the account says another one", () => {
      const local = base();
      local.certifications.push(cert({ expires: expires(2029, EARLIER) }));
      const account = copy(local);
      account.certifications[0]!.expires = { ...expires(2031, LATER), status: "confirmed" };
      const { profile } = joinProfiles(local, account);
      expect(profile.certifications[0]!.expires).toMatchObject({ value: { year: 2029 }, confirmedAt: EARLIER });
    });

    it("joins the licence's date the same way: the later day for the same date, and the account's when this browser has none", () => {
      const local = base();
      local.legacy.driverLicenseExpires = { value: { year: 2030, month: 6 }, status: "confirmed", confirmedAt: EARLIER };
      const account = copy(local);
      account.legacy.driverLicenseExpires = { value: { year: 2030, month: 6 }, status: "confirmed", confirmedAt: LATER };
      expect(joinProfiles(local, account).profile.legacy.driverLicenseExpires).toMatchObject({ value: { year: 2030, month: 6 }, confirmedAt: LATER });

      const bare = base();
      const { profile, added } = joinProfiles(bare, account);
      expect(profile.legacy.driverLicenseExpires).toMatchObject({ value: { year: 2030, month: 6 }, confirmedAt: LATER });
      expect(describeJoin(added)).toBe("1 dato suelto");

      // A date with no year is no date: nothing to bring.
      const empty = copy(base());
      empty.legacy.driverLicenseExpires = { value: {}, status: "confirmed" };
      expect(joinProfiles(bare, empty).profile.legacy.driverLicenseExpires).toBeUndefined();
    });
  });
});

describe("a line reworded in the editor of the CV", () => {
  const edited = (profile: StoredProfile, change: (bullets: string[]) => string[]) => {
    const plain = structuredClone(toPlainProfile(profile));
    plain.experience[0]!.bullets = change(plain.experience[0]!.bullets);
    return profileSchema.parse(plain);
  };

  it("is the person standing behind it, and the lines they did not touch keep the day they had", () => {
    const profile = profileWith({ company: "Nubia Retail", role: "Analista", from: { year: 2022 }, to: "current", facts: [{ text: "Armo los informes" }, { text: "Coordino al equipo" }] });
    profile.experience[0]!.facts[1]!.confirmedAt = EARLIER;
    const saved = reconcileFromPlain(profile, edited(profile, (bullets) => [bullets[0]!, "Coordino al equipo de ventas"]), { now: CONFIRMED, newId });
    const [, second] = saved.experience[0]!.facts;
    expect(second).toMatchObject({ text: "Coordino al equipo de ventas", status: "edited", confirmedAt: CONFIRMED });
    expect(saved.experience[0]!.facts[0]!.confirmedAt).toBeUndefined();
  });

  it("is not what a reader does when it rewords a line", () => {
    const profile = profileWith({ company: "Nubia Retail", role: "Analista", from: { year: 2022 }, to: "current", facts: [{ text: "Armo los informes" }] });
    const saved = reconcileFromPlain(profile, edited(profile, () => ["Armo todos los informes"]), { now: CONFIRMED, newId, origin: "cv" });
    expect(saved.experience[0]!.facts[0]).toMatchObject({ text: "Armo todos los informes", status: "edited" });
    expect(saved.experience[0]!.facts[0]!.confirmedAt).toBeUndefined();
  });

  it("is also a blank line filled in, since that is the person saying something", () => {
    const profile = profileWith({ company: "Nubia Retail", role: "Analista", from: { year: 2022 }, to: "current", facts: [{ text: "Armo los informes" }, { text: "" }] });
    const saved = reconcileFromPlain(profile, edited(profile, (bullets) => [bullets[0]!, "Atiendo a los clientes"]), { now: CONFIRMED, newId });
    expect(saved.experience[0]!.facts.find((fact) => fact.text === "Atiendo a los clientes")).toMatchObject({ confirmedAt: CONFIRMED });
  });
});

describe("the account's copy of a profile", () => {
  it("has the days and the dates with the rest of the profile, which is what keeping it in sync is, and with nothing else", () => {
    const profile = fromCv();
    confirmAll(profile, CONFIRMED);
    profile.certifications.push(
      certificationSchema.parse({ id: "cert-1", name: { value: "Matrícula de gasista", status: "confirmed" }, expires: { value: { year: 2030, month: 3 }, status: "confirmed", confirmedAt: CONFIRMED }, excluded: true }),
    );
    profile.legacy.driverLicenseExpires = { value: { year: 2031 }, status: "confirmed", confirmedAt: CONFIRMED };
    const out = forSync(profile);
    expect(out.experience[0]!.company.confirmedAt).toBe(CONFIRMED);
    expect(out.experience[0]!.facts[0]!.confirmedAt).toBe(CONFIRMED);
    expect(out.certifications[0]).toMatchObject({ excluded: true, expires: { value: { year: 2030, month: 3 }, confirmedAt: CONFIRMED } });
    expect(out.legacy.driverLicenseExpires).toMatchObject({ value: { year: 2031 }, confirmedAt: CONFIRMED });
    // Read back the way the account sends it, it is the same profile.
    expect(storedProfileSchema.parse(JSON.parse(JSON.stringify(out)))).toEqual(out);
  });
});

describe("what a job counts, with and without a figure", () => {
  const job = () =>
    profileWith({
      company: "Nubia Retail",
      role: "Analista",
      from: { year: 2022 },
      to: "current",
      facts: [
        { text: "Armo los informes" },
        { kind: "achievement", text: "Subí las ventas", metric: { value: "20", unit: "%", approx: false } },
        { text: "Atiendo a 40 clientes por día" },
        { text: "Llevo el stock", metric: { unknown: true } },
        { kind: "tool", text: "Excel" },
      ],
    });

  it("is the tasks that say what was done and the ones that count something, and never the tools", () => {
    const profile = job();
    expect(figuresIn(profile.experience[0]!)).toEqual({ tasks: 4, withFigure: 2 });
  });

  it("takes a figure kept beside the line, or one in the line's own words — and not a year, and not «no lo sé»", () => {
    const [plain, kept, said, unknown] = job().experience[0]!.facts;
    expect(hasFigure(plain!)).toBe(false);
    expect(hasFigure(kept!)).toBe(true);
    expect(hasFigure(said!)).toBe(true);
    expect(hasFigure(unknown!)).toBe(false);
    const year = job().experience[0]!.facts[0]!;
    year.text = "Entré a la empresa en 2022";
    expect(hasFigure(year)).toBe(false);
  });

  it("counts the same as the whole profile does, so a job's line and «Ya tenés» never disagree", () => {
    const profile = job();
    const total = inventoryOf(profile);
    expect(figuresIn(profile.experience[0]!)).toEqual({ tasks: total.tasks, withFigure: total.withFigure });
  });

  it("is nothing for a job with no tasks", () => {
    expect(figuresIn(profileWith({ company: "Nubia Retail", role: "Analista" }).experience[0]!)).toEqual({ tasks: 0, withFigure: 0 });
  });

  it("is what the clock says when the day is counted: the profile in this file was written at the same instant as the helpers", () => {
    expect(NOW.toISOString()).toBe(STAMP);
  });
});
