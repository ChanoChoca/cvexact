import { ENGINE } from "@/lib/onboarding/config";
import { mentionsSkill } from "@/lib/onboarding/tools";
import { skillKey } from "@/lib/text/normalize";
import { isMeaningfulExperience, type Declined, type DeclinedKind, type StoredProfile } from "@/lib/schemas/profile-v2";
import { editContext, recordChange, type EditContext } from "./edit";

/**
 * What the person said no to, with the day (`profile.declined`): «No lo tengo» to a tool or a credential an offer asked for, and the veto of
 * a skill the app deduced. It used to be a mark on one application, and the same question came back in every posting that asked for the
 * same thing — which is what an offer to say yes is, said again and again. It is a «no» now: kept in the profile, with its date, and asked
 * once more, a single time, when a year has gone by or a line written after it names the thing.
 *
 * Nothing here is a fact about the person that goes in a CV, and none of it is projected to a generator (`toPlainProfile` does not read it):
 * what a model is told of a vetoed skill is its name, to leave out, as it always was. Pure, with the clock as an argument.
 */

const DAY_MS = 86_400_000;

/**
 * One thing said no to is one thing: its kind and its name, read the way a skill is (`skillKey`), so that «SAP» and «sap», or «Node.js» and
 * «nodejs», are not two.
 */
export const declinedKey = (kind: DeclinedKind, text: string): string => `${kind}:${skillKey(text)}`;

/** Whether the person still stands by it: one taken back is kept, inert, and not read. */
export const isActive = (entry: Declined): boolean => entry.withdrawnAt === undefined;

/** What the person says they do not have, of one kind or of both. */
export function activeDeclined(profile: Pick<StoredProfile, "declined">, kind?: DeclinedKind): Declined[] {
  return profile.declined.filter((entry) => isActive(entry) && (kind === undefined || entry.kind === kind));
}

/** The «no» to this thing, if the person has one. */
export function declinedBy(profile: Pick<StoredProfile, "declined">, kind: DeclinedKind, text: string): Declined | undefined {
  const key = declinedKey(kind, text);
  return profile.declined.find((entry) => isActive(entry) && declinedKey(entry.kind, entry.text) === key);
}

/** The skills the person vetoed in every posting, by name: what a generation is told to leave out. */
export const vetoedSkills = (profile: Pick<StoredProfile, "declined">): string[] => activeDeclined(profile, "inferred_skill").map((entry) => entry.text);

// --- When it is asked again ---------------------------------------------------------------------------------

/**
 * Whether a «no» to a requirement has gone long enough to be asked once more: a year, and not already asked a second time. A skill that was
 * vetoed does not grow old: the lines that deduced it are the same lines.
 */
export function askedAgain(entry: Declined, now: Date): boolean {
  if (entry.kind !== "requirement" || entry.offeredAgainAt !== undefined || !isActive(entry)) return false;
  const said = Date.parse(entry.at);
  return Number.isFinite(said) && now.getTime() - said >= ENGINE.currency.declinedDays * DAY_MS;
}

/** A line of the profile that could name something — a task, a tool, a skill, a course, a project, a degree — and when it came in. */
type Line = { text: string; at: string };

function namingLines(profile: StoredProfile): Line[] {
  const lines: Line[] = [];
  for (const job of profile.experience.filter(isMeaningfulExperience)) {
    for (const fact of job.facts) if (fact.text.trim()) lines.push({ text: fact.text, at: fact.source.at });
  }
  for (const skill of profile.skills) if (skill.name.value.trim()) lines.push({ text: skill.name.value, at: skill.name.source?.at ?? "" });
  for (const cert of profile.certifications) if (cert.name.value.trim()) lines.push({ text: cert.name.value, at: cert.name.source?.at ?? "" });
  for (const project of profile.projects) {
    for (const field of [project.name, project.description]) if (field.value.trim()) lines.push({ text: field.value, at: field.source?.at ?? "" });
  }
  for (const study of profile.education) if (study.degree.value.trim()) lines.push({ text: study.degree.value, at: study.degree.source?.at ?? "" });
  return lines;
}

/** How much of a line is quoted back: enough to know which it is, and not the paragraph. */
const quoted = (text: string): string => {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 140 ? `${clean.slice(0, 139).trimEnd()}…` : clean;
};

/**
 * A line that came into the profile after `since` and names `text`: what the person wrote, or a document brought, once they had said
 * they did not have it. `null` when nothing does. A line with no date is not a new one: nobody can say it came after.
 */
export function lineNaming(profile: StoredProfile, text: string, since: string): string | null {
  for (const line of namingLines(profile)) {
    if (line.at !== "" && line.at > since && mentionsSkill([line.text], text)) return quoted(line.text);
  }
  return null;
}

export type DeclinedStanding =
  /** Said, and left alone. */
  | { state: "quiet" }
  /** A year has gone by: asked once more. */
  | { state: "again" }
  /** A line written after it names the thing — asked once more, citing the line. */
  | { state: "named"; line: string };

/** Where a «no» stands today: left alone, or due to be asked once more — and why. */
export function declinedStanding(profile: StoredProfile, entry: Declined, now: Date): DeclinedStanding {
  if (!isActive(entry) || entry.offeredAgainAt !== undefined) return { state: "quiet" };
  const line = lineNaming(profile, entry.text, entry.at);
  if (line) return { state: "named", line };
  return askedAgain(entry, now) ? { state: "again" } : { state: "quiet" };
}

// --- What the person does ---------------------------------------------------------------------------------------

/**
 * «No lo tengo»: each thing named is a «no» with today's date. One said before — also one taken back — is the same «no», dated again and
 * asked once more if it comes to that; nothing is added twice. `quote` is the line of the offer that asked for it. Each is a step in the
 * history, to undo like any other. Returns what is kept.
 */
export function declineThings(draft: StoredProfile, kind: DeclinedKind, texts: readonly string[], extra: { quote?: string } = {}, ctx: EditContext = editContext()): Declined[] {
  const kept: Declined[] = [];
  const quote = extra.quote?.replace(/\s+/g, " ").trim().slice(0, 300);
  for (const raw of texts) {
    const text = raw.trim().slice(0, 160);
    if (!text || skillKey(text) === "") continue;
    const key = declinedKey(kind, text);
    const existing = draft.declined.find((entry) => declinedKey(entry.kind, entry.text) === key);
    if (existing) {
      const before = structuredClone(existing);
      existing.at = ctx.now;
      delete existing.offeredAgainAt;
      delete existing.withdrawnAt;
      if (quote) existing.quote = quote;
      recordChange(draft, { op: "set", path: ["declined", existing.id], label: existing.text, before, after: structuredClone(existing) }, ctx);
      kept.push(existing);
      continue;
    }
    const created: Declined = { id: ctx.newId(), kind, text, ...(quote ? { quote } : {}), at: ctx.now };
    draft.declined.push(created);
    recordChange(draft, { op: "add", path: ["declined", created.id], label: text }, ctx);
    kept.push(created);
  }
  return kept;
}

function change(draft: StoredProfile, entry: Declined, apply: (entry: Declined) => void, ctx: EditContext): void {
  const before = structuredClone(entry);
  apply(entry);
  recordChange(draft, { op: "set", path: ["declined", entry.id], label: entry.text, before, after: structuredClone(entry) }, ctx);
}

/** «Volver a preguntarlo»: the person takes a «no» back. It stays, inert, so that no copy of the profile brings it back. False when there is none. */
export function withdrawDeclined(draft: StoredProfile, id: string, ctx: EditContext = editContext()): boolean {
  const entry = draft.declined.find((candidate) => candidate.id === id && isActive(candidate));
  if (!entry) return false;
  change(draft, entry, (target) => void (target.withdrawnAt = ctx.now), ctx);
  return true;
}

/**
 * They did use it after all, or they have it now: what they said no to is taken back wherever it is named. How many were taken back.
 */
export function withdrawDeclinedFor(draft: StoredProfile, kind: DeclinedKind, texts: readonly string[], ctx: EditContext = editContext()): number {
  let taken = 0;
  for (const text of texts) {
    const entry = declinedBy(draft, kind, text);
    if (entry && withdrawDeclined(draft, entry.id, ctx)) taken += 1;
  }
  return taken;
}

/**
 * «Sigue siendo no»: it was asked a second time and the answer is the same. That was the second and the last: it is not asked again,
 * and it stays as they said it, with the day they first said it.
 */
export function keepDeclined(draft: StoredProfile, id: string, ctx: EditContext = editContext()): boolean {
  const entry = draft.declined.find((candidate) => candidate.id === id && isActive(candidate));
  if (!entry) return false;
  if (entry.offeredAgainAt !== undefined) return true;
  change(draft, entry, (target) => void (target.offeredAgainAt = ctx.now), ctx);
  return true;
}

/**
 * What is said when a «no» is answered, in a line, for the receipt: what it did, and what comes next. «Ya lo tengo» takes it back — and says what that brings
 * (a thing an offer asked for is asked about again by the next offer that asks for it; a skill the app deduced may be deduced again) — and «Sigue siendo no» keeps it,
 * and says it is not asked a third time. The thing is quoted and not pointed at: what is said no to can be a tool or a credential, and what a pronoun would say of it
 * is a guess about its gender.
 */
export function declinedReceipt(entry: Pick<Declined, "kind" | "text">, how: "have" | "still"): string {
  if (how === "still") return "Listo: queda como lo dijiste, y no te lo volvemos a preguntar.";
  return entry.kind === "inferred_skill"
    ? `Listo: «${entry.text}» puede volver a aparecer entre las habilidades que deducimos de tu perfil.`
    : `Listo: sacamos «${entry.text}» de lo que dijiste que no tenés. Si otro aviso pide «${entry.text}», te lo preguntamos de nuevo.`;
}
