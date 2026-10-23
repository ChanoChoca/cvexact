import { linkKey, normalizeUrl, type Practical } from "@/lib/schemas/profile";
import { compactKey, normalizeForComparison, skillKey } from "@/lib/text/normalize";
import { looseLineRanges } from "@/lib/parse/coverage";
import { languageKey } from "@/lib/parse/dictionaries";
import { findUrls } from "@/lib/parse/patterns";
import { languageLevelFrom } from "@/lib/profile/from-plain";
import type { DateValue, EndDateValue } from "@/lib/profile/dates";
import {
  certificationKey,
  matchEducations,
  matchExperiences,
  mergeCertificationInto,
  mergeContactField,
  mergeEducationInto,
  mergeExperienceInto,
  mergeLanguageInto,
  mergeProjectInto,
} from "@/lib/onboarding/merge";
import { declinedToolKeys, mentionsSkill, toolMentions } from "@/lib/onboarding/tools";
import {
  isMeaningfulExperience,
  type Field,
  type ImportedSource,
  type Source,
  type SourceKind,
  type Status,
  type StoredCertification,
  type StoredEducation,
  type StoredExperience,
  type StoredLanguage,
  type StoredProfile,
  type StoredProject,
  type StoredSkill,
} from "@/lib/schemas/profile-v2";
import type {
  Confidence,
  ParsedDocument,
  ParsedEducation,
  ParsedExperience,
  Quoted,
} from "./types";

/**
 * A document that has been read, as proposals in the profile.
 *
 * Every value keeps the fragment of the document it was read from as its source,
 * so the review can show it and "De tu CV" / "De LinkedIn" are true. A block read
 * with high confidence is taken as `confirmed` — it is the person's own document,
 * and it stays editable — and anything less is `proposed`, which is what makes the
 * review ask. Contact details are always proposed: the next screen is the one
 * that confirms them.
 *
 * Nothing already in the profile is overwritten. An experience or education entry
 * that is already there — recognised by `lib/onboarding/merge.ts`, not merely by an
 * exact match — has this document's facts folded into it instead of duplicating
 * the block; a field the two sources disagree about becomes a conflict rather than
 * being silently picked one way. A contact field already filled in is left alone
 * the same way. Nothing the person has edited is ever touched by any of this.
 */

export type ApplyContext = {
  sourceId: string;
  now: string;
  newId: () => string;
};

export type SourceInfo = Pick<ImportedSource, "name" | "fileHash" | "pasted" | "chars"> & Partial<Pick<ImportedSource, "modifiedAt" | "madeAt" | "photo">>;

export type ApplyResult = {
  profile: StoredProfile;
  /** The same file was already read: nothing was added. */
  duplicate: boolean;
  added: {
    experience: number;
    education: number;
    facts: number;
    skills: number;
    languages: number;
    certifications: number;
    projects: number;
    unassigned: number;
    /** Disagreements the merge raised — across every entity, contact included. */
    conflicts: number;
  };
  /** Details left out on purpose, for the screen to say so. */
  omittedPersonalData: number;
  confidence: Confidence;
};

const SOURCE_KIND: Record<ParsedDocument["kind"], SourceKind> = {
  cv: "cv",
  linkedin_pdf: "linkedin_pdf",
  linkedin_csv: "linkedin_csv",
  dump: "dump",
};

const IMPORTED_KIND: Record<ParsedDocument["kind"], ImportedSource["kind"]> = {
  cv: "cv",
  linkedin_pdf: "linkedin_pdf",
  linkedin_csv: "linkedin_csv",
  dump: "dump",
};

const statusOf = (confidence: Confidence): Status => (confidence === "high" ? "confirmed" : "proposed");

export function applyParsedDocument(
  profile: StoredProfile,
  parsed: ParsedDocument,
  info: SourceInfo,
  ctx: ApplyContext,
): ApplyResult {
  const added = { experience: 0, education: 0, facts: 0, skills: 0, languages: 0, certifications: 0, projects: 0, unassigned: 0, conflicts: 0 };
  const nothing: ApplyResult = {
    profile,
    duplicate: true,
    added,
    omittedPersonalData: 0,
    confidence: parsed.confidence,
  };
  if (info.fileHash && profile.sources.some((source) => source.fileHash === info.fileHash)) return nothing;

  const draft = structuredClone(profile);
  const kind = SOURCE_KIND[parsed.kind];
  const src = (quote: string): Source => ({
    kind,
    docId: ctx.sourceId,
    ...(quote ? { quote: quote.slice(0, 600) } : {}),
    ...(parsed.via ? { via: parsed.via } : {}),
    at: ctx.now,
  });

  draft.sources.push({
    id: ctx.sourceId,
    kind: IMPORTED_KIND[parsed.kind],
    name: info.name.slice(0, 200),
    fileHash: info.fileHash,
    pasted: info.pasted,
    chars: info.chars,
    importedAt: ctx.now,
    ...(parsed.via ? { via: parsed.via } : {}),
    ...(info.modifiedAt ? { modifiedAt: info.modifiedAt } : {}),
    ...(info.madeAt ? { madeAt: info.madeAt } : {}),
    ...(info.photo ? { photo: true as const } : {}),
  });

  // --- Contact: filled where empty, merged where it is not, never touched once edited ---
  const mergeCtx = { newId: ctx.newId, now: ctx.now };
  /** What this document said that the profile already had: it adds nothing to those, but it did say them. */
  const saidAgain = new Set<string>();
  const noteIfSaidAgain = (id: string, current: Field<string>, incoming: Quoted<string> | undefined): void => {
    if (incoming && current.value.trim() && normalizeForComparison(current.value) === normalizeForComparison(incoming.value)) saidAgain.add(id);
  };
  const mergeContact = (target: Field<string>, value: Quoted<string> | undefined, field: string): Field<string> => {
    const result = mergeContactField(target, value, "contact", field, src, mergeCtx);
    if (result.conflictRecord) draft.conflicts.push(result.conflictRecord);
    noteIfSaidAgain(`contact:${field}`, target, value);
    return result.field;
  };

  draft.contact.fullName = mergeContact(draft.contact.fullName, parsed.contact.fullName, "fullName");
  draft.contact.email = mergeContact(draft.contact.email, parsed.contact.email, "email");
  draft.contact.phone = mergeContact(draft.contact.phone, parsed.contact.phone, "phone");
  draft.contact.city = mergeContact(draft.contact.city, parsed.contact.city, "city");
  draft.contact.country = mergeContact(draft.contact.country, parsed.contact.country, "country");
  if (parsed.contact.links.length > 0) {
    // Additive, not a conflict: a second profile's links are more links, not a
    // disagreement about one value. Compared by `linkKey` so the same page found
    // through two documents — "linkedin.com/in/x" in one, "www.linkedin.com/in/x"
    // in the other — is not listed twice, nor twice within one document.
    const known = new Set(draft.contact.links.value.map((link) => linkKey(link.url)));
    const fresh = parsed.contact.links.filter((link) => {
      const key = linkKey(link.value.url);
      if (!key || known.has(key)) return false;
      known.add(key);
      return true;
    });
    if (fresh.length > 0) {
      draft.contact.links = {
        value: [...draft.contact.links.value, ...fresh.map((link) => ({ label: link.value.label, url: normalizeUrl(link.value.url) }))],
        status: draft.contact.links.status === "edited" ? draft.contact.links.status : "proposed",
        source: src(fresh.map((link) => link.quote).join(" ")),
      };
    }
  }
  {
    const result = mergeContactField(draft.legacy.headline, parsed.contact.headline, "legacy", "headline", src, mergeCtx);
    if (result.conflictRecord) draft.conflicts.push(result.conflictRecord);
    noteIfSaidAgain("legacy:headline", draft.legacy.headline, parsed.contact.headline);
    draft.legacy.headline = result.field;
  }

  // --- The document's own summary: fills "Sobre vos" when it is empty, or
  // becomes a conflict when it disagrees with one already there — never left
  // to sit unexplained in the tray, the way any other value this reader can
  // name a field for is not. A second summary in the same document (unusual,
  // but the schema allows it) still goes to the tray below with everything
  // else that fit nowhere. ---
  const summaryIndex = parsed.unassigned.findIndex((item) => item.kind === "summary");
  if (summaryIndex !== -1) {
    const summary = parsed.unassigned[summaryIndex]!;
    const result = mergeContactField(draft.legacy.about, { value: summary.text, quote: summary.text }, "legacy", "about", src, mergeCtx);
    if (result.conflictRecord) draft.conflicts.push(result.conflictRecord);
    noteIfSaidAgain("legacy:about", draft.legacy.about, { value: summary.text, quote: summary.text });
    draft.legacy.about = result.field;
  }

  // --- Practical facts (availability, a driving licence, work eligibility):
  // fill only whichever ones are still empty. `legacy.practical` is one
  // field wrapping all five, not five of its own, so there is no per-fact
  // status to raise a conflict on the way `contact.email` or a job's company
  // can — a fact that already has a different value simply keeps it, and the
  // document's own line goes to the tray instead of silently overriding it. ---
  if (parsed.practical) {
    const current = { ...draft.legacy.practical.value };
    const quotes: string[] = [];
    let filled = false;
    for (const [field, value] of Object.entries(parsed.practical) as Array<[keyof Practical, Quoted<string>]>) {
      const existing = current[field];
      if (!existing) {
        (current as Record<string, unknown>)[field] = value.value;
        quotes.push(value.quote);
        filled = true;
      } else if (existing !== value.value) {
        draft.unassigned.push({ id: ctx.newId(), text: value.quote, kind: "other", sourceId: ctx.sourceId });
        added.unassigned += 1;
      }
    }
    if (filled) {
      draft.legacy.practical = {
        value: current,
        status: draft.legacy.practical.status === "edited" ? draft.legacy.practical.status : "proposed",
        source: src(quotes.join(" ")),
      };
    }
  }

  // --- Experience: folded into a matching job when there is one, added otherwise ---
  // Matched only against jobs that existed before this document, never against
  // an entry this same reading just added — otherwise two roles one document
  // reads at one company (a promotion, above all) can merge into each other.
  const now = new Date(ctx.now);
  const existingExperience = [...draft.experience];
  const experienceMatches = matchExperiences(existingExperience, parsed.experience, now);
  /** Each job this document says something about, with the lines it says — for the tools they name, below. */
  const touched: Array<{ jobId: string; facts: ParsedExperience["facts"] }> = [];
  for (let i = 0; i < parsed.experience.length; i++) {
    const entry = parsed.experience[i]!;
    const match = experienceMatches.get(i);
    if (match) {
      const { conflicts, factsAdded } = mergeExperienceInto(match, entry, src, mergeCtx);
      draft.conflicts.push(...conflicts);
      added.facts += factsAdded;
      touched.push({ jobId: match.id, facts: entry.facts });
      saidAgain.add(match.id);
      continue;
    }
    const stored = storedExperience(entry, src, ctx);
    draft.experience.push(stored);
    added.experience += 1;
    added.facts += stored.facts.length;
    touched.push({ jobId: stored.id, facts: entry.facts });
  }

  // --- Education: same rule ---
  const existingEducation = [...draft.education];
  const educationMatches = matchEducations(existingEducation, parsed.education, now);
  for (let i = 0; i < parsed.education.length; i++) {
    const entry = parsed.education[i]!;
    const match = educationMatches.get(i);
    if (match) {
      const { conflicts } = mergeEducationInto(match, entry, src, mergeCtx);
      draft.conflicts.push(...conflicts);
      saidAgain.add(match.id);
      continue;
    }
    const stored = storedEducation(entry, src, ctx);
    draft.education.push(stored);
    added.education += 1;
  }

  // --- The rest of the lists: skipped when the profile already has the item ---
  const skillsByKey = new Map(draft.skills.map((skill) => [skillKey(skill.name.value), skill]));
  const addedSkills = new Set<string>();
  for (const skill of parsed.skills) {
    const key = skillKey(skill.value);
    if (!key) continue;
    const existing = skillsByKey.get(key);
    if (existing) {
      // Only read out of a job's lines before (below), and now listed by the
      // person themselves in this document's skills: no longer a proposal.
      if (existing.name.status === "proposed") existing.name = { value: skill.value, status: "confirmed", source: src(skill.quote) };
      saidAgain.add(existing.id);
      continue;
    }
    const stored: StoredSkill = {
      id: ctx.newId(),
      name: { value: skill.value, status: "confirmed", source: src(skill.quote) },
      experienceIds: [],
    };
    draft.skills.push(stored);
    skillsByKey.set(key, stored);
    addedSkills.add(stored.id);
    added.skills += 1;
  }

  // --- The tools this document's job lines name that the skills do not list:
  // added, as proposals the review lists apart with a way to take each out —
  // so "Optimicé consultas en PostgreSQL" does not leave PostgreSQL out of the
  // skills, nor turn into one more question. Only names that are nothing but
  // a tool: one that is also an ordinary word ("Meta", "Go", "Word", "Tango")
  // is left for the loose-tool question to ask about, and one the person
  // already turned down stays turned down. ---
  const declined = declinedToolKeys(draft.pending);
  for (const { facts } of touched) {
    for (const fact of facts) {
      for (const mention of toolMentions(fact.value)) {
        const key = skillKey(mention.value);
        if (mention.ambiguous || !key || skillsByKey.has(key) || declined.has(key)) continue;
        const stored: StoredSkill = { id: ctx.newId(), name: { value: mention.value, status: "proposed", source: src(fact.quote) }, experienceIds: [] };
        draft.skills.push(stored);
        skillsByKey.set(key, stored);
        addedSkills.add(stored.id);
        added.skills += 1;
      }
    }
  }

  // --- Each skill linked to the jobs whose own lines name it: a literal match,
  // the one link a skill gets without being asked (see `skillSchema`). A skill
  // this document added is looked for in every job; one the profile already
  // had, only in this document's own lines — a link the person took away by
  // hand is not put back by the next import re-reading the same old ones. ---
  const everyJob = draft.experience.filter(isMeaningfulExperience).map((job) => ({ jobId: job.id, lines: job.facts.map((fact) => fact.text) }));
  const thisDocument = touched.map(({ jobId, facts }) => ({ jobId, lines: facts.map((fact) => fact.value) }));
  for (const skill of draft.skills) {
    for (const { jobId, lines } of addedSkills.has(skill.id) ? everyJob : thisDocument) {
      if (!skill.experienceIds.includes(jobId) && mentionsSkill(lines, skill.name.value)) skill.experienceIds = [...skill.experienceIds, jobId];
    }
  }

  // A language already in the profile has its level filled in, or a differing
  // one turned into a conflict, instead of a document that names it a second
  // time being silently skipped; matched against what existed before this
  // document, same as experience and education, so two mentions of a language
  // within the *same* document still collapse into one new entry, not two.
  // By `languageKey`, so a CV's "Inglés" and a LinkedIn export's "English" are one.
  const existingLanguages = new Map(draft.languages.map((language) => [languageKey(language.name.value), language]));
  const addedLanguageNames = new Set<string>();
  for (const language of parsed.languages) {
    const key = languageKey(language.name.value);
    if (!key) continue;
    const existing = existingLanguages.get(key);
    if (existing) {
      const { conflicts } = mergeLanguageInto(existing, language.level, src, mergeCtx);
      draft.conflicts.push(...conflicts);
      saidAgain.add(existing.id);
      continue;
    }
    if (addedLanguageNames.has(key)) continue;
    addedLanguageNames.add(key);
    const stored: StoredLanguage = {
      id: ctx.newId(),
      name: { value: language.name.value, status: "confirmed", source: src(language.name.quote) },
      level: language.level
        ? { value: languageLevelFrom(language.level.value), status: "confirmed", source: src(language.level.quote) }
        : { value: {}, status: "confirmed" },
    };
    draft.languages.push(stored);
    added.languages += 1;
  }

  // One already there — however the two documents word it (see `certificationKey`) —
  // takes what this one adds where it said nothing, instead of dropping it.
  const certificationsByKey = new Map(draft.certifications.map((c) => [certificationKey(c.name.value), c]));
  for (const cert of parsed.certifications) {
    const key = certificationKey(cert.name.value);
    if (!key) continue;
    const existing = certificationsByKey.get(key);
    if (existing) {
      mergeCertificationInto(existing, cert, src);
      saidAgain.add(existing.id);
      continue;
    }
    const stored: StoredCertification = {
      id: ctx.newId(),
      name: { value: cert.name.value, status: "confirmed", source: src(cert.name.quote) },
      issuer: cert.issuer
        ? { value: cert.issuer.value, status: "confirmed", source: src(cert.issuer.quote) }
        : { value: "", status: "confirmed" },
      date: cert.date
        ? { value: cert.date.value, status: "confirmed", source: src(cert.date.quote) }
        : { value: {}, status: "confirmed" },
    };
    draft.certifications.push(stored);
    certificationsByKey.set(key, stored);
    added.certifications += 1;
  }

  // The same, by name spaced or punctuated any way ("CVExact", "CV Exact").
  const projectsByKey = new Map(draft.projects.map((p) => [compactKey(p.name.value), p]));
  for (const project of parsed.projects) {
    const key = compactKey(project.name.value);
    if (!key) continue;
    const existing = projectsByKey.get(key);
    if (existing) {
      mergeProjectInto(existing, project, src);
      saidAgain.add(existing.id);
      continue;
    }
    const stored: StoredProject = {
      id: ctx.newId(),
      name: { value: project.name.value, status: "confirmed", source: src(project.name.quote) },
      description: project.description
        ? { value: project.description.value, status: "confirmed", source: src(project.description.quote) }
        : { value: "", status: "confirmed" },
      url: project.url
        ? { value: project.url.value, status: "confirmed", source: src(project.url.quote) }
        : { value: "", status: "confirmed" },
      tags: { value: [], status: "confirmed" },
    };
    draft.projects.push(stored);
    projectsByKey.set(key, stored);
    added.projects += 1;
  }

  // --- What fit nowhere --- (the one summary just merged above is not "nowhere" any more)
  // A link the profile's own links already hold is not left to place again —
  // this document's, or one an earlier document left in the tray before this
  // one listed it ("Tengo ambos", LinkedIn first: the job's site under a job,
  // then the same site in the CV's header).
  const listed = new Set(draft.contact.links.value.map((link) => linkKey(link.url)));
  const alreadyListed = (text: string) => listed.has(linkKey(findUrls(text)[0] ?? text));
  draft.unassigned = draft.unassigned.filter((item) => item.kind !== "link" || !alreadyListed(item.text));
  for (const [index, item] of parsed.unassigned.entries()) {
    if (index === summaryIndex) continue;
    if (item.kind === "link" && alreadyListed(item.text)) continue;
    draft.unassigned.push({
      id: ctx.newId(),
      text: item.text,
      kind: item.kind,
      sourceId: ctx.sourceId,
      ...(item.heading ? { heading: item.heading.slice(0, 80) } : {}),
    });
    added.unassigned += 1;
  }

  // Every push above is additive — `draft.conflicts` only ever grows during
  // this call — so what this document raised is exactly the difference from
  // where it started, with no need to track it at each of the sites above.
  added.conflicts = draft.conflicts.length - profile.conflicts.length;

  // What this reading found, kept beside the document for the review to say.
  const recorded = draft.sources.find((entry) => entry.id === ctx.sourceId);
  if (recorded) {
    recorded.read = { ...added };
    if (saidAgain.size > 0) recorded.alsoSaid = [...saidAgain];
    // What was in the document and went nowhere: a story's loose sentences are in the tray already (`looseSentencesAsCards`).
    const loose = parsed.kind === "dump" ? [] : looseLineRanges(parsed);
    if (loose.length > 0) recorded.loose = loose;
  }

  return {
    profile: draft,
    duplicate: false,
    added,
    omittedPersonalData: parsed.omittedPersonalData,
    confidence: parsed.confidence,
  };
}

/**
 * What a document's own content justifies telling the person, once it has
 * already been applied. "Nothing found" is a fact about what the *document*
 * held, not about whether the profile changed — a second reading of an
 * already-known job adds nothing on its own, but that is a success, not the
 * document being unreadable; only a document with no career content in it at
 * all deserves the "we could not read this" message.
 */
export type ImportOutcome = { kind: "empty" } | { kind: "unchanged" } | { kind: "added" };

export function importOutcome(parsed: ParsedDocument, result: ApplyResult): ImportOutcome {
  const hasContent =
    parsed.experience.length > 0 ||
    parsed.education.length > 0 ||
    parsed.skills.length > 0 ||
    parsed.languages.length > 0 ||
    parsed.certifications.length > 0 ||
    parsed.projects.length > 0;
  if (!hasContent) return { kind: "empty" };
  const { experience, education, facts, skills, languages, certifications, projects, unassigned, conflicts } = result.added;
  const changedSomething =
    experience + education + facts + skills + languages + certifications + projects + unassigned + conflicts > 0;
  return { kind: changedSomething ? "added" : "unchanged" };
}

/**
 * Clears out what one document proposed, so a second, better reading of the
 * *same* document — "Mejorar la lectura con tu IA" over a low-confidence block —
 * can take its place instead of duplicating it beside it.
 *
 * Only what that source proposed and the person has not yet confirmed: a block
 * still carrying `review` has never been through "Está bien" or "Todo correcto,
 * seguir" (both delete it on confirmation), and a contact field is only reset
 * while it is still `proposed` from this same source. Anything the person has
 * since edited or confirmed is untouched — the new reading fills gaps, it does
 * not override a correction, and if it disagrees with something confirmed the
 * ordinary merge conflict is what will ask about it.
 *
 * The caller re-applies the fresh reading with a new `sourceId` afterwards —
 * `applyParsedDocument` treats it as an unseen file, since this removes the old
 * source record along with the blocks it produced.
 */
/**
 * The experience and education blocks a document still has proposed —
 * exactly the ones `replaceSource` below would clear, and the count
 * `aiReadingPlan` (lib/onboarding/review.ts) weighs a fresh AI reading
 * against before deciding whether it is safe to apply outright.
 */
function pendingFromSource(profile: StoredProfile, sourceId: string) {
  const from = (field: { source?: Source | undefined }): boolean => field.source?.docId === sourceId;
  return {
    experience: profile.experience.filter((job) => job.review && (from(job.company) || from(job.role))),
    education: profile.education.filter((entry) => entry.review && (from(entry.institution) || from(entry.degree))),
  };
}

/** How many blocks {@link replaceSource} would clear for this document — the "removing" half of `aiReadingPlan`'s comparison. */
export function countPendingFromSource(profile: StoredProfile, sourceId: string): number {
  const pending = pendingFromSource(profile, sourceId);
  return pending.experience.length + pending.education.length;
}

export function replaceSource(profile: StoredProfile, sourceId: string): StoredProfile {
  const draft = structuredClone(profile);
  const from = (field: { source?: Source | undefined }): boolean => field.source?.docId === sourceId;
  const pendingIds = pendingFromSource(profile, sourceId);
  const experienceIds = new Set(pendingIds.experience.map((job) => job.id));
  const educationIds = new Set(pendingIds.education.map((entry) => entry.id));

  draft.experience = draft.experience.filter((job) => !experienceIds.has(job.id));
  draft.education = draft.education.filter((entry) => !educationIds.has(entry.id));

  const resetIfProposed = (field: Field<string>): Field<string> =>
    field.status === "proposed" && from(field) ? { value: "", status: "confirmed" } : field;
  draft.contact.fullName = resetIfProposed(draft.contact.fullName);
  draft.contact.email = resetIfProposed(draft.contact.email);
  draft.contact.phone = resetIfProposed(draft.contact.phone);
  draft.contact.city = resetIfProposed(draft.contact.city);
  draft.contact.country = resetIfProposed(draft.contact.country);
  draft.legacy.headline = resetIfProposed(draft.legacy.headline);
  if (draft.contact.links.status === "proposed" && from(draft.contact.links)) {
    draft.contact.links = { value: [], status: "confirmed" };
  }

  // The tools that reading proposed out of its job lines go with it (the fresh
  // reading proposes its own), and no skill keeps pointing at a job just cleared.
  draft.skills = draft.skills
    .filter((skill) => !(skill.name.status === "proposed" && from(skill.name)))
    .map((skill) => (skill.experienceIds.some((id) => experienceIds.has(id)) ? { ...skill, experienceIds: skill.experienceIds.filter((id) => !experienceIds.has(id)) } : skill));

  draft.sources = draft.sources.filter((source) => source.id !== sourceId);
  draft.unassigned = draft.unassigned.filter((item) => item.sourceId !== sourceId);

  return draft;
}

// --- Entities -----------------------------------------------------------------------------

type SourceOf = (quote: string) => Source;

function textField(value: Quoted<string> | undefined, status: Status, src: SourceOf): Field<string> {
  return value ? { value: value.value, status, source: src(value.quote) } : { value: "", status: "confirmed" };
}

function dateField<T extends DateValue | EndDateValue>(
  value: Quoted<T> | undefined,
  status: Status,
  src: SourceOf,
): Field<T> {
  return value ? { value: value.value, status, source: src(value.quote) } : { value: {} as T, status: "confirmed" };
}

function storedExperience(entry: ParsedExperience, src: SourceOf, ctx: ApplyContext): StoredExperience {
  const status = statusOf(entry.confidence);
  const stored: StoredExperience = {
    id: ctx.newId(),
    company: textField(entry.company, status, src),
    role: textField(entry.role, status, src),
    city: textField(entry.city, status, src),
    country: textField(entry.country, status, src),
    start: dateField(entry.start, status, src),
    end: dateField(entry.end, status, src),
    facts: entry.facts.map((fact) => ({
      id: ctx.newId(),
      kind: "responsibility" as const,
      text: fact.value,
      source: src(fact.quote),
      status,
    })),
    review: {
      confidence: entry.confidence,
      doubts: entry.doubts,
      ...(entry.candidates ? { candidates: entry.candidates } : {}),
      span: entry.span,
    },
    // Kept even once `review` is gone — see the field's own doc comment.
    origin: entry.span,
  };
  if (entry.employmentType) {
    stored.employmentType = { value: entry.employmentType.value, status, source: src(entry.employmentType.quote) };
  }
  if (entry.workMode) {
    stored.workMode = { value: entry.workMode.value, status, source: src(entry.workMode.quote) };
  }
  return stored;
}

function storedEducation(entry: ParsedEducation, src: SourceOf, ctx: ApplyContext): StoredEducation {
  const status = statusOf(entry.confidence);
  return {
    id: ctx.newId(),
    institution: textField(entry.institution, status, src),
    degree: textField(entry.degree, status, src),
    city: textField(entry.city, status, src),
    country: textField(entry.country, status, src),
    start: dateField(entry.start, status, src),
    end: dateField(entry.end, status, src),
    honors: textField(entry.honors, status, src),
    // A document says what a study was, not what stood out of it: that is for the person to say.
    highlights: { value: [], status: "confirmed" },
    status: entry.status
      ? { value: entry.status.value, status, source: src(entry.status.quote) }
      : { value: "completed", status: "confirmed" },
    review: { confidence: entry.confidence, doubts: entry.doubts, ...(entry.candidates ? { candidates: entry.candidates } : {}), span: entry.span },
    origin: entry.span,
  };
}

