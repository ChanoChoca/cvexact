import { buildEvidenceIndex, findUnsupportedTerms, normalize, supports } from "@/lib/ai/evidence";
import { cvProse, inventedFigures, retitledRoles } from "@/lib/ai/verify";
import { parseFieldPath, removeItemBullet, removePair, removeSectionBullet, setItemBullet, setPair, setProject, setRole, setSectionBullet, setSummary } from "@/lib/cv/edit";
import { roleForField } from "@/lib/cv/invented";
import { addCertification, addSkill } from "@/lib/profile/entities";
import { editContext, type EditContext } from "@/lib/profile/edit";
import { practicalFactFor } from "@/lib/profile/practical-facts";
import type { CVDocument } from "@/lib/schemas/cv";
import type { JobAnalysis } from "@/lib/schemas/job";
import type { Profile } from "@/lib/schemas/profile";
import type { Conflict, StoredProfile } from "@/lib/schemas/profile-v2";
import { skillKey } from "@/lib/text/normalize";

/**
 * What a person added or changed by hand in a generated CV, and what that says about the profile (e5, O11; e3, A3).
 *
 * A CV is edited because something was missing from it, or wrong, and the person only saw it when they read the CV for an offer: it is the freshest
 * evidence of what they know about themselves, and by default it stays in that one CV. This compares the CV as the model generated it with the CV as it
 * stands, entity by entity — a tool, a credential, a title, a number — and says which of what changed is something the profile does not have:
 *
 *  - an **entity that is new** — a tool the CV names that neither the generated CV nor the profile did, a credential in a list of the CV that the
 *    profile has no sign of, a number that nobody gave (`inventedFigures`) — is offered to the profile, once, as a card: «Guardar en el perfil»,
 *    «Solo en este CV», «Era un error»;
 *  - an **entity that contradicts** the profile — a title that shares nothing with the one the profile has for that job — is not written over it: it is
 *    kept as a disagreement, the way two documents that disagree are, for the person to settle in the profile.
 *
 * A change of words with no new entity is style, and is not a fact: nothing here learns how someone writes. The same goes for what an edit took out:
 * a line that was removed says nothing the profile should forget. Company and dates are not compared — the editor does not touch them, and what a
 * text says of a year has no place in the profile to go to.
 *
 * Pure, and about the CV on the page: the profile's own words decide whether something is new (`buildEvidenceIndex`), the same way the findings do.
 */

export type CorrectionKind = "tool" | "credential" | "role" | "figure";

export type Correction = {
  /** What it is counted by and what «solo en este CV» remembers: `tool:tango gestion`. */
  key: string;
  kind: CorrectionKind;
  /** What the CV now says: the tool, the label of the credential, the title, the figure as written. */
  text: string;
  /** Where in the CV, as a finding says it: `sections[1].items[0].bullets[2]`, `summary`, `sections[2].items[1]`, `sections[1].items[0].role`. */
  field: string;
  /** The line it is in, whole, as it stands. */
  line: string;
  /** For a credential: what is written beside it (`AWS, 2024`). */
  value?: string;
  /** For a title that contradicts the profile: the job it is about, and what the profile says. */
  against?: { experienceId: string | null; current: string };
};

type Input = {
  /** The CV as the model produced it (`Application.cvOriginal`). */
  original: CVDocument;
  /** The CV as it stands. */
  edited: CVDocument;
  /** The profile as the generators read it: what is said there is said. */
  profile: Profile;
  analysis?: Partial<Pick<JobAnalysis, "title" | "domain" | "keywords" | "requirements" | "responsibilities">> | undefined;
};

const proseOf = (cv: CVDocument): string => normalize(cvProse(cv).map(({ text }) => text).join(" "));

const pairLabels = (cv: CVDocument): Set<string> =>
  new Set(cv.sections.flatMap((section) => (section.kind === "pairs" ? section.items.map((item) => normalize(item.label)) : [])));

/** What is new, or in disagreement, in the edited CV: only what the edit put there. */
export function correctionsOf({ original, edited, profile, analysis }: Input): Correction[] {
  const index = buildEvidenceIndex(profile);
  const found: Correction[] = [];
  const keys = new Set<string>();
  const add = (correction: Correction) => {
    if (keys.has(correction.key)) return;
    keys.add(correction.key);
    found.push(correction);
  };

  // A tool the CV names that nobody had named, in the CV as generated or in the profile.
  const wasSaid = proseOf(original);
  for (const { field, text } of cvProse(edited)) {
    for (const term of findUnsupportedTerms(text, index)) {
      if (wasSaid.includes(normalize(term))) continue;
      add({ key: `tool:${skillKey(term)}`, kind: "tool", text: term, field, line: text });
    }
  }

  // A number that nobody gave: the figures the profile does not state, which the CV as generated did not state either.
  const before = new Set(inventedFigures(original, profile, analysis).map((figure) => figure.figure));
  for (const figure of inventedFigures(edited, profile, analysis)) {
    if (before.has(figure.figure)) continue;
    add({ key: `figure:${figure.figure}`, kind: "figure", text: figure.raw, field: figure.field, line: figure.line });
  }

  // A title that shares nothing with what the profile says for the job — and that the model did not write: the edit did.
  for (const role of retitledRoles(edited, profile)) {
    const target = parseFieldPath(role.field);
    if (target?.kind !== "role") continue;
    const generated = original.sections[target.section];
    if (generated?.kind === "experience" && generated.items[target.item]?.role.trim() === role.claimed) continue;
    add({
      key: `role:${normalize(role.claimed)}`,
      kind: "role",
      text: role.claimed,
      field: role.field,
      line: `${role.claimed} · ${role.company}`,
      against: { experienceId: roleForField(edited, profile, role.field), current: role.stated[0] ?? "" },
    });
  }

  // A line of a list — a credential and who gave it — that the profile has no sign of, and that was not in the CV as generated.
  const labelsBefore = pairLabels(original);
  for (const [s, section] of edited.sections.entries()) {
    if (section.kind !== "pairs") continue;
    for (const [i, item] of section.items.entries()) {
      const label = item.label.trim();
      // What the profile keeps about how they can work is the profile's, and what it says of a language is its own check (`verifyPairs`).
      if (!label || practicalFactFor(label) || labelsBefore.has(normalize(label)) || supports(index, label)) continue;
      add({ key: `credential:${normalize(label)}`, kind: "credential", text: label, field: `sections[${s}].items[${i}]`, line: `${label}: ${item.value}`, value: item.value.trim() });
    }
  }

  return found;
}

/** Of what changed, what is still to settle: what was not left «solo en este CV», and what the profile did not take in the meantime. */
export const unsettled = (found: readonly Correction[], settled: ReadonlySet<string>): Correction[] => found.filter((correction) => !settled.has(correction.key));

// --- What each answer does ----------------------------------------------------------------------------------

/** Where the profile says a value came from, when it came from a CV the person edited: the CV, and the day. */
export const originOf = (label: string, day: string): string => `Agregado a mano en el CV de «${label.slice(0, 80)}», ${day}`;

/**
 * «Guardar en el perfil»: a tool is a skill, a credential is a certification — both the person's own, with where they came from said —, and a title that
 * contradicts the profile is kept as a disagreement with the one the profile has, for the person to settle there. A number is not saved here: it has its
 * own way in, which asks where it comes from (`InventedFigures`). False when there was nothing to save, or it was saved already.
 */
export function saveCorrection(
  draft: StoredProfile,
  correction: Correction,
  origin: string,
  ctx: EditContext = editContext(),
): boolean {
  switch (correction.kind) {
    case "tool": {
      const skill = addSkill(draft, correction.text, ctx);
      if (!skill) return false;
      skill.name = { ...skill.name, source: { kind: "manual", quote: origin.slice(0, 600), at: ctx.now } };
      return true;
    }
    case "credential": {
      const year = /\b(?:19|20)\d{2}\b/.exec(correction.value ?? "")?.[0];
      const issuer = (correction.value ?? "").replace(/\b(?:19|20)\d{2}\b/g, "").replace(/^[\s,;–—-]+|[\s,;–—-]+$/g, "").slice(0, 120);
      const cert = addCertification(draft, { name: correction.text, ...(issuer ? { issuer } : {}), ...(year ? { date: { year: Number(year) } } : {}) }, ctx);
      if (!cert) return false;
      cert.name = { ...cert.name, source: { kind: "manual", quote: origin.slice(0, 600), at: ctx.now } };
      return true;
    }
    case "role": {
      const job = draft.experience.find((entry) => entry.id === correction.against?.experienceId);
      if (!job) return false;
      const exists = draft.conflicts.some((entry) => entry.entity === "experience" && entry.entityId === job.id && entry.field === "role" && entry.incoming.value === correction.text);
      if (exists) return false;
      const conflict: Conflict = {
        id: ctx.newId(),
        entity: "experience",
        entityId: job.id,
        field: "role",
        current: { value: job.role.value, ...(job.role.source ? { source: job.role.source } : {}) },
        incoming: { value: correction.text, source: { kind: "manual", quote: origin.slice(0, 600), at: ctx.now } },
        at: ctx.now,
      };
      draft.conflicts.push(conflict);
      return true;
    }
    case "figure":
      return false;
  }
}

/**
 * «Era un error»: the line goes back to what the model generated — or, if the model had no line there, goes. Null when the CV has changed shape since (a
 * section moved or taken out, an item removed) and nothing says which line was the generated one: it is left to be edited by hand.
 */
export function revertCorrection(edited: CVDocument, original: CVDocument, correction: Correction): CVDocument | null {
  const target = parseFieldPath(correction.field);
  if (!target) return null;
  const sameSection = (index: number) => {
    const now = edited.sections[index];
    const was = original.sections[index];
    return now && was && now.kind === was.kind && now.title === was.title ? was : null;
  };

  switch (target.kind) {
    case "summary":
      return setSummary(edited, original.summary);
    case "role": {
      const was = sameSection(target.section);
      const now = edited.sections[target.section];
      if (was?.kind !== "experience" || now?.kind !== "experience") return null;
      const item = was.items[target.item];
      return item && item.company === now.items[target.item]?.company ? setRole(edited, target.section, target.item, item.role) : null;
    }
    case "itemBullet": {
      const was = sameSection(target.section);
      const now = edited.sections[target.section];
      if (was?.kind !== "experience" || now?.kind !== "experience") return null;
      if (was.items[target.item]?.company !== now.items[target.item]?.company) return null;
      const old = was.items[target.item]?.bullets[target.bullet];
      return old === undefined ? removeItemBullet(edited, target.section, target.item, target.bullet) : setItemBullet(edited, target.section, target.item, target.bullet, old);
    }
    case "sectionBullet": {
      const was = sameSection(target.section);
      if (was?.kind !== "bullets") return null;
      const old = was.bullets[target.bullet];
      return old === undefined ? removeSectionBullet(edited, target.section, target.bullet) : setSectionBullet(edited, target.section, target.bullet, old);
    }
    case "pair": {
      const was = sameSection(target.section);
      if (was?.kind !== "pairs") return null;
      const old = was.items[target.item];
      return old === undefined ? removePair(edited, target.section, target.item) : setPair(edited, target.section, target.item, { label: old.label, value: old.value });
    }
    case "projectDescription": {
      const was = sameSection(target.section);
      const now = edited.sections[target.section];
      if (was?.kind !== "projects" || now?.kind !== "projects") return null;
      // The name is the project's identity: a description goes back only to the same project.
      const old = was.items[target.item];
      return old && old.name === now.items[target.item]?.name ? setProject(edited, target.section, target.item, old.description) : null;
    }
    default:
      return null;
  }
}
