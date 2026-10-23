import { ENGINE } from "@/lib/onboarding/config";
import { spelledDate, type DateValue } from "./dates";
import { describePractical, isPracticalEmpty } from "./practical-facts";
import { isBlankProfile, isMeaningfulExperience, isPersonSource, type Fact, type Source, type Status, type StoredExperience, type StoredProfile } from "@/lib/schemas/profile-v2";

/**
 * How current each thing in the profile is: when the person last stood behind it, and what has a date on it that is about to
 * stop being true — the time as a datum of the profile, and not as a score.
 *
 * Three states, said of anything that can be asked after: it is `current`; it is `to_review`, with the reason — a credential
 * past its date, or near it; what the person said about how they can work, said long ago; a job that is going on and was not looked
 * at for months; or archived, which is only ever the person's own mark («No usar en CVs»). Nothing here changes a profile and nothing
 * expires on its own: a lapsed date is a question for the person (`credential_expiry`, `conditions_review`, `current_job_review` in
 * `lib/onboarding/gaps.ts`), and a thing left to answer stays in the CV until they do — it is theirs, and it is *said*, where a CV is
 * handed over (`ExpiredCredentialsAlert`), never held back.
 *
 * Pure: `now` is an argument, so the arithmetic is tested without a clock.
 */

const DAY_MS = 86_400_000;

export type Vigencia = "current" | "to_review" | "archived";

// --- When the person last stood behind something -----------------------------------------------------------------

type Stamped = { confirmedAt?: string | undefined; source?: Source | undefined; status?: Status | undefined };

/**
 * The last time the person stood behind a value, as an ISO time — or `null` when no one has.
 *
 * A confirmation or an edit says so (`confirmedAt`). What they wrote or answered is theirs from the moment they gave it, so
 * `source.at` counts when the source is a person's; what a reader took from a document does not, until they say so. A value from
 * before this was kept has only the second, which is all that is known of it and is enough: it is the last time it was known to be
 * true.
 */
export function standingAt(entry: Stamped): string | null {
  const given = entry.source && isPersonSource(entry.source.kind) && entry.source.at ? entry.source.at : null;
  const confirmed = entry.confirmedAt || null;
  if (given && confirmed) return given > confirmed ? given : confirmed;
  return given ?? confirmed;
}

/** The latest of several times, ignoring the ones nobody has. ISO times in the same form sort as text. */
function latest(times: ReadonlyArray<string | null | undefined>): string | null {
  let best: string | null = null;
  for (const time of times) if (time && (best === null || time > best)) best = time;
  return best;
}

const standing = (entries: ReadonlyArray<Stamped | undefined>): string | null => latest(entries.map((entry) => (entry ? standingAt(entry) : null)));
const standingOfFacts = (facts: readonly Fact[]): string | null => latest(facts.map((fact) => standingAt(fact)));

/**
 * The last time a value was *known* to be true, which is not the last time the person said so: that, when there is one — and, for
 * what has been taken as right since it came in but was never stamped (a document read and confirmed before the day was kept), when it
 * came in. What is only proposed is not known to anyone: nobody has looked at it, and its own review comes first.
 */
export function knownAt(entry: Stamped): string | null {
  const standing = standingAt(entry);
  if (standing) return standing;
  if (entry.status === "proposed") return null;
  return entry.source?.at || null;
}

/** The parts of the profile the hub lists as sections, for «Última revisión» under each. */
export type ReviewSection = "contact" | "experience" | "education" | "skills" | "projects" | "other";

/**
 * When each section was last stood behind, as the latest time anything in it was: edited, answered, confirmed or said. `null` for a
 * section where nobody has — the profile does not claim a review that did not happen, and says nothing instead.
 */
export function sectionReviewed(profile: StoredProfile): Record<ReviewSection, string | null> {
  const { contact, legacy } = profile;
  return {
    contact: standing([contact.fullName, contact.email, contact.phone, contact.city, contact.country, contact.links]),
    experience: latest(
      profile.experience.map((job) =>
        latest([standing([job.company, job.role, job.city, job.country, job.start, job.end, job.employmentType, job.workMode]), standingOfFacts(job.facts)]),
      ),
    ),
    education: latest(profile.education.map((entry) => standing([entry.institution, entry.degree, entry.city, entry.country, entry.start, entry.end, entry.honors, entry.highlights, entry.status]))),
    skills: latest([
      standing(profile.skills.map((skill) => skill.name)),
      standing(profile.languages.flatMap((language) => [language.name, language.level])),
      standing(profile.certifications.flatMap((cert) => [cert.name, cert.issuer, cert.date, cert.expires])),
    ]),
    projects: latest(profile.projects.map((project) => standing([project.name, project.description, project.url, project.tags]))),
    other: standing([legacy.headline, legacy.about, legacy.extras, legacy.practical, legacy.driverLicenseExpires]),
  };
}

/**
 * The latest time anything in the profile was stood behind — what «Tu perfil se revisó por última vez en mayo» says. `null` when nobody
 * ever has: the profile does not say a review happened that did not.
 */
export function lastReviewed(profile: StoredProfile): string | null {
  return latest(Object.values(sectionReviewed(profile)));
}

/**
 * The note a section keeps under its title once the whole profile has its own: only when the section was last stood behind in an earlier month than the rest. Under
 * each of five sections, «Última revisión: octubre de 2026» was the same line five times; where it differs it says which part has been left, which is what it is for.
 */
export function reviewedApart(at: string | null | undefined, overall: string | null): string | null {
  if (!at || !overall) return null;
  const month = monthOf(at);
  return month !== "" && month !== monthOf(overall) ? at : null;
}

/** «marzo de 2026»: the month a moment was in, by the person's own clock. `""` for a time nobody can read. */
export function monthOf(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return spelledDate({ year: at.getFullYear(), month: at.getMonth() + 1 });
}

// --- What a date says about what it belongs to -----------------------------------------------------------------------

export type Expiry =
  /** Valid, and not near its date. */
  | { state: "valid"; days: number }
  /** Valid, and within the window the profile asks in. */
  | { state: "soon"; days: number }
  /** Past its date, by that many whole days. */
  | { state: "lapsed"; days: number };

/**
 * Where a date that stops being true stands today. A credential holds to the end of the month it says, and one that names only a
 * year holds to the end of that year: a date is not read earlier than it was said, because an earlier reading would call valid
 * what is, and ask after it before it is due. `null` when there is no date to speak of.
 */
export function expiryOf(expires: DateValue | undefined, now: Date): Expiry | null {
  if (!expires || expires.year === undefined) return null;
  // Day 0 of the next month is the last day of this one; December when the month is not said.
  const end = new Date(expires.year, expires.month ?? 12, 0, 23, 59, 59, 999);
  const left = end.getTime() - now.getTime();
  if (left < 0) return { state: "lapsed", days: Math.floor(-left / DAY_MS) };
  const days = Math.ceil(left / DAY_MS);
  return { state: days <= ENGINE.currency.credentialSoonDays ? "soon" : "valid", days };
}

/** «Vence en noviembre de 2026» / «Venció en marzo de 2026»: what a date says, as the hub shows it beside the date. */
export function expiryLine(expires: DateValue | undefined, now: Date): { tone: "ok" | "soon" | "lapsed"; text: string } | null {
  const expiry = expiryOf(expires, now);
  if (!expiry) return null;
  const when = spelledDate(expires);
  return expiry.state === "lapsed" ? { tone: "lapsed", text: `Venció en ${when}` } : { tone: expiry.state === "soon" ? "soon" : "ok", text: `Vence en ${when}` };
}

export type CredentialReview = {
  subject: { kind: "certification"; id: string } | { kind: "license" };
  /** What it is called, as a sentence names it: «Carnet de manipulación de alimentos» —as the person named it—, «Licencia de conducir (B1)». */
  name: string;
  expires: DateValue;
  expiry: Extract<Expiry, { state: "soon" | "lapsed" }>;
};

const byUrgency = (a: CredentialReview, b: CredentialReview): number =>
  Number(b.expiry.state === "lapsed") - Number(a.expiry.state === "lapsed") ||
  (a.expiry.state === "lapsed" ? b.expiry.days - a.expiry.days : a.expiry.days - b.expiry.days);

/**
 * The credentials with a date that is near or past — a licence, a carnet, a registration the person gave a date to — that they have
 * not set aside: the ones to ask «¿Hiciste la renovación?» about. Those past their date first, the longest ago first, and then the
 * ones about to lapse, the soonest first. A credential with no date is never here: nobody can say it lapses.
 */
export function credentialReviews(profile: StoredProfile, now: Date): CredentialReview[] {
  const reviews: CredentialReview[] = [];
  for (const cert of profile.certifications) {
    const name = cert.name.value.trim();
    const expires = cert.expires?.value;
    const expiry = expiryOf(expires, now);
    if (cert.excluded || !name || !expires || !expiry || expiry.state === "valid") continue;
    reviews.push({ subject: { kind: "certification", id: cert.id }, name, expires, expiry });
  }
  const licence = profile.legacy.practical.value.driverLicense.trim();
  const expires = profile.legacy.driverLicenseExpires?.value;
  const expiry = expiryOf(expires, now);
  // A date of a licence the profile no longer says they have is a date of nothing.
  if (licence && expires && expiry && expiry.state !== "valid") {
    // In parentheses because what is typed there is a line of free text — «B1», but also «Sí, la B» — and a sentence has to read with any of them.
    reviews.push({ subject: { kind: "license" }, name: `Licencia de conducir (${licence})`, expires, expiry });
  }
  return reviews.sort(byUrgency);
}

/** The credentials already past their date that are in the CV: the ones a CV should not be handed over without the person knowing. */
export function lapsedCredentials(profile: StoredProfile, now: Date): CredentialReview[] {
  return credentialReviews(profile, now).filter((review) => review.expiry.state === "lapsed");
}

// --- What was said about how the person can work -------------------------------------------------------------------------

export type ConditionsReview = {
  /** When the person last said it still held. */
  since: string;
  /** What is held, in a line: «Tiempo completo · Licencia B1 · Vehículo propio». */
  line: string;
};

/**
 * Whether what the person said about how they can work — when they can, whether they drive, whether they would move — is old enough
 * to ask «¿Sigue igual?». It changes faster than anything else on a CV, and it is the one thing asked in a single tap. Nothing to ask
 * where nothing was said, or where nobody can say when it was.
 */
export function conditionsReview(profile: StoredProfile, now: Date): ConditionsReview | null {
  const practical = profile.legacy.practical;
  if (isPracticalEmpty(practical.value)) return null;
  const since = standingAt(practical);
  if (!since) return null;
  const age = now.getTime() - Date.parse(since);
  if (!Number.isFinite(age) || age <= ENGINE.currency.conditionsDays * DAY_MS) return null;
  return { since, line: describePractical(practical.value) };
}

// --- A job that is going on -------------------------------------------------------------------------------------------------

export type CurrentJobReview = {
  job: StoredExperience;
  /** The last time anything of this job was known to be true — the day the person stood behind it, or the day it came in. */
  since: string;
};

/** What makes a job *this* job, and not what it says: the four things a reader takes from a document and a person has to look at. */
const JOB_IDENTITY = ["company", "role", "start", "end"] as const;
const JOB_DETAILS = ["city", "country", "employmentType", "workMode"] as const;

/** The last time anything of a job — what it is, and every line told of it — was known to be true. `null` when nobody can say. */
export function jobKnownAt(job: StoredExperience): string | null {
  const entries: Array<Stamped | undefined> = [...JOB_IDENTITY.map((key) => job[key]), ...JOB_DETAILS.map((key) => job[key]), ...job.facts];
  return latest(entries.map((entry) => (entry ? knownAt(entry) : null)));
}

/**
 * The jobs that are going on and were last looked at long ago — six months, to start with: «¿Seguís en…?». A job that is going on never
 * grows old on its own, and it is where what the person has forgotten piles up. Asked of the stalest first.
 *
 * Not of one that was only read from a document and has not been looked at: its review comes first, and asking «¿seguís?» of what nobody
 * has confirmed asks twice. Not of one the person left out of their CVs. Nothing is asked of a job whose time nobody can say.
 */
export function currentJobReviews(profile: StoredProfile, now: Date): CurrentJobReview[] {
  const cutoff = now.getTime() - ENGINE.currency.currentJobDays * DAY_MS;
  const reviews: CurrentJobReview[] = [];
  for (const job of profile.experience) {
    if (!isMeaningfulExperience(job) || !job.end.value.current || job.excluded) continue;
    if (JOB_IDENTITY.some((key) => job[key].status === "proposed")) continue;
    const since = jobKnownAt(job);
    const at = since ? Date.parse(since) : Number.NaN;
    if (!since || !Number.isFinite(at) || at > cutoff) continue;
    reviews.push({ job, since });
  }
  return reviews.sort((a, b) => a.since.localeCompare(b.since));
}

// --- A profile nobody has stood behind for a while -------------------------------------------------------------------------

/**
 * Whether a profile has gone as long as it takes — two months, to start with — without anyone standing behind anything in it, and the
 * date of the last time: «Tu perfil se revisó por última vez en mayo. ¿Qué cambió desde entonces?». The date and never the length of
 * time (CT6): how long someone was away is a reproach, and the date is a fact. `null` when it has not, when it is empty, and when
 * nobody ever did — there is no date to say.
 */
export function returnReview(profile: StoredProfile, now: Date): { since: string } | null {
  if (isBlankProfile(profile)) return null;
  const since = lastReviewed(profile);
  const at = since ? Date.parse(since) : Number.NaN;
  if (!since || !Number.isFinite(at) || now.getTime() - at < ENGINE.currency.returnDays * DAY_MS) return null;
  return { since };
}

// --- The state of a thing ------------------------------------------------------------------------------------------------

/** A credential: archived when the person set it aside, to review when its date is near or past, current otherwise. */
export function certificationVigencia(profile: StoredProfile, certId: string, now: Date): Vigencia {
  const cert = profile.certifications.find((entry) => entry.id === certId);
  if (!cert) return "current";
  if (cert.excluded) return "archived";
  return credentialReviews(profile, now).some((review) => review.subject.kind === "certification" && review.subject.id === certId) ? "to_review" : "current";
}
