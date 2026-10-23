import type { Profile } from "@/lib/schemas/profile";
import type {
  CefrLevel,
  Fact,
  Metric,
  StoredExperience,
  StoredLanguage,
  StoredProfile,
} from "@/lib/schemas/profile-v2";
import { skillKey } from "@/lib/text/normalize";
import { formatDateValue } from "./dates";

/**
 * The stored profile as the plain one every generator, scorer and prompt reads.
 *
 * Provenance, status, history and the review trays stay behind; what comes out
 * is the same career data the app worked with before they existed. Keeping the
 * generators on this shape is the reason a change to what the profile *is* does
 * not reach the ~50 files that only need to read it.
 *
 * Pure and safe on both sides of the wire: the server projects a synced row for
 * job alerts with the very function the browser uses.
 */

const CEFR_LABEL: Record<CefrLevel, string> = {
  A1: "A1",
  A2: "A2",
  B1: "B1",
  B2: "B2",
  C1: "C1",
  C2: "C2",
  native: "Nativo",
};

/** "20–25 %", "150 clientes", or "" for a metric that is the answer "no lo sé". */
export function formatMetric(metric: Metric | undefined): string {
  if (!metric || "unknown" in metric) return "";
  const value = metric.value.trim().replace(/(\d)\s*-\s*(\d)/g, "$1–$2");
  if (!value) return "";
  const unit = metric.unit.trim();
  return unit ? `${value} ${unit}` : value;
}

const NUMBER = /\d+(?:[.,]\d+)?/g;

/** The figures in a string, comma-decimal folded to point so "1,2" equals "1.2". */
function figuresIn(text: string): string[] {
  return (text.match(NUMBER) ?? []).map((n) => n.replace(",", "."));
}

/**
 * What is appended to a fact's text to carry its metric, or "".
 *
 * A metric lives beside the text so the user's words are never rewritten, but a
 * generator only reads strings — so the projection puts it back on the end,
 * marked approximate when it is. Skipped when the text already states the same
 * figures: the number belongs in the profile once.
 */
export function metricSuffix(fact: Pick<Fact, "text" | "metric">): string {
  const metric = fact.metric;
  const shown = formatMetric(metric);
  if (!metric || "unknown" in metric || !shown) return "";
  const inText = new Set(figuresIn(fact.text));
  const needed = figuresIn(metric.value);
  if (needed.length > 0 && needed.every((figure) => inText.has(figure))) return "";
  return ` — ${metric.approx ? "aprox. " : ""}${shown}`;
}

/** A fact as the plain profile's bullet. */
export function factToBullet(fact: Fact): string {
  return `${fact.text}${metricSuffix(fact)}`;
}

export function languageLevelText(language: StoredLanguage): string {
  const { raw, cefr } = language.level.value;
  if (raw) return raw;
  return cefr ? CEFR_LABEL[cefr] : "";
}

/**
 * The skills the person said they used in a job — the ones linked to it, whether from the job's own lines
 * naming them or from answering "¿Dónde usaste X?" — as that job's tags, apart from the tools it already lists as its
 * own. A skill that sits in a flat list says what someone can do; one that is linked to a job says where they did it,
 * which is what a CV for an offer that asks for it needs to say, and what the generators could not see.
 * In the order of the skills' own list, each once, and by the name the skill has.
 */
export function linkedSkillTags(skills: StoredProfile["skills"], job: Pick<StoredExperience, "id" | "facts">): string[] {
  const seen = new Set(job.facts.filter((fact) => fact.kind === "tool").map((fact) => skillKey(fact.text)));
  const linked: string[] = [];
  for (const skill of skills) {
    const name = skill.name.value.trim();
    const key = skillKey(name);
    if (!name || !key || !skill.experienceIds.includes(job.id) || seen.has(key)) continue;
    seen.add(key);
    linked.push(name);
  }
  return linked;
}

/**
 * Whether a job or a task is left out of every CV by the person's own mark — «No usar en CVs».
 */
export function isLeftOut(entry: { excluded?: boolean | undefined }): boolean {
  return Boolean(entry.excluded);
}

function projectExperience(job: StoredExperience, skills: StoredProfile["skills"]): Profile["experience"][number] {
  // What is left out is not in the plain profile at all: it does not reach a generator, a scorer or a prompt.
  const facts = job.facts.filter((fact) => !isLeftOut(fact));
  const lines = facts.filter((fact) => fact.kind !== "tool");
  return {
    id: job.id,
    company: job.company.value,
    role: job.role.value,
    city: job.city.value,
    country: job.country.value,
    start: formatDateValue(job.start.value),
    end: formatDateValue(job.end.value),
    current: Boolean(job.end.value.current),
    bullets: lines.map(factToBullet),
    // The skills linked to it, and then the tools it lists: the generators already read these as the job's tools. In
    // this order so that a tag added to the end of the plain job — what an editor does — stays at the end once it is
    // saved, which is the contract `reconcileFromPlain` keeps.
    tags: [...linkedSkillTags(skills, { id: job.id, facts }), ...facts.filter((fact) => fact.kind === "tool").map((fact) => fact.text)],
    employmentType: job.employmentType?.value ?? "",
    workMode: job.workMode?.value ?? "",
    note: job.note?.value.trim() ?? "",
    // How each line was told, by its text: what a generator can read and an editor never changes.
    achievements: lines.filter((fact) => fact.kind === "achievement").map(factToBullet),
    transferable: lines.filter((fact) => fact.transferable).map(factToBullet),
  };
}

/**
 * What a generator reads of a profile, written out so that two of them can be told apart: the CV in front of the person is behind their profile when this
 * has changed since it was made. Not when only what is no part of a CV has — a question put off, a date stood behind, a «no» — which is most of what
 * is answered about a profile, and is not a reason to say «generá otra versión».
 */
export const generatorKey = (plain: Profile): string => JSON.stringify(plain);

export function toPlainProfile(stored: StoredProfile): Profile {
  return {
    version: 1,
    // What the person declared, for the generators; a profile that never said has no such key.
    ...(stored.onboarding.situation ? { situation: stored.onboarding.situation } : {}),
    fullName: stored.contact.fullName.value,
    headline: stored.legacy.headline.value,
    objective: stored.objective.value,
    city: stored.contact.city.value,
    country: stored.contact.country.value,
    phone: stored.contact.phone.value,
    email: stored.contact.email.value,
    links: stored.contact.links.value,
    about: stored.legacy.about.value,
    experience: stored.experience.filter((job) => !isLeftOut(job)).map((job) => projectExperience(job, stored.skills)),
    education: stored.education.map((entry) => ({
      id: entry.id,
      institution: entry.institution.value,
      degree: entry.degree.value,
      city: entry.city.value,
      country: entry.country.value,
      start: formatDateValue(entry.start.value),
      end: formatDateValue(entry.end.value),
      honors: entry.honors.value,
      highlights: entry.highlights.value.filter((point) => point.trim() !== ""),
      status: entry.status.value,
    })),
    projects: stored.projects.map((entry) => ({
      id: entry.id,
      name: entry.name.value,
      description: entry.description.value,
      url: entry.url.value,
      tags: entry.tags.value,
    })),
    // What is marked «No usar en CVs» — a credential that is no longer theirs — is not in the plain profile, and a generator never reads it.
    certifications: stored.certifications
      .filter((entry) => !isLeftOut(entry))
      .map((entry) => ({
        id: entry.id,
        name: entry.name.value,
        issuer: entry.issuer.value,
        date: formatDateValue(entry.date.value),
      })),
    skills: stored.skills.map((skill) => skill.name.value),
    skillLevels: Object.fromEntries(stored.skills.flatMap((skill) => (skill.level && skill.name.value.trim() ? [[skill.name.value, skill.level.value] as const] : []))),
    languages: stored.languages.map((language) => ({
      id: language.id,
      name: language.name.value,
      level: languageLevelText(language),
    })),
    extras: stored.legacy.extras.value,
    practical: stored.legacy.practical.value,
  };
}
