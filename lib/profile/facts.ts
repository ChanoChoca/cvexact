import type { Fact, FactKind, Metric, StoredExperience, StoredProfile } from "@/lib/schemas/profile-v2";
import { skillKey } from "@/lib/text/normalize";
import { archiveEntity, editContext, jsonEqual, recordChange, type EditContext } from "./edit";
import { unlinkSkill } from "./entities";

/**
 * Changing what a job says, one fact at a time: the edits the hub's cards and the
 * confirmation after an answer both make. An edited fact remembers the words it
 * had and says it was edited; a removed one goes to the archive and can come back;
 * a new one is credited to the person who wrote it. Each leaves a step in the
 * history to undo.
 */

/** The longest a fact can be; the schema cuts past it, so it is cut here, where the history can say so. */
export const FACT_MAX = 600;

const jobOf = (draft: StoredProfile, id: string): StoredExperience | undefined => draft.experience.find((job) => job.id === id);

function locate(draft: StoredProfile, experienceId: string, factId: string): { job: StoredExperience; fact: Fact; index: number } | null {
  const job = jobOf(draft, experienceId);
  const index = job ? job.facts.findIndex((fact) => fact.id === factId) : -1;
  return job && index >= 0 ? { job, fact: job.facts[index]!, index } : null;
}

const path = (experienceId: string, factId: string) => ["experience", experienceId, "facts", factId];

/** Where a fact is, for whoever changes it and keeps the way back (`putBack`). */
export const factPath = path;

/**
 * Rewords a fact. Typing the words it started with back leaves it as it was, with
 * nothing left to remember. A blank text is not an edit — it is asking to remove
 * the fact, which `removeFact` does — so it changes nothing and says so.
 */
export function editFactText(draft: StoredProfile, experienceId: string, factId: string, text: string, ctx: EditContext = editContext()): boolean {
  const found = locate(draft, experienceId, factId);
  const next = text.trim().slice(0, FACT_MAX);
  if (!found || next === "") return false;
  const { fact, job, index } = found;
  if (fact.text === next) return true;

  const before = structuredClone(fact);
  let edited: Fact;
  if (fact.original !== undefined && fact.original === next) {
    // The person's own first words, back: confirmed, with no "original" to keep.
    const { original: _original, ...rest } = fact;
    void _original;
    edited = { ...rest, text: next, status: "confirmed", confirmedAt: ctx.now };
  } else if (fact.text === "") {
    // Filling in a blank is saying something, not correcting it.
    edited = { ...fact, text: next, status: "confirmed", source: { kind: "manual", at: ctx.now }, confirmedAt: ctx.now };
  } else {
    edited = { ...fact, text: next, status: "edited", original: fact.original ?? fact.text, confirmedAt: ctx.now };
  }
  job.facts[index] = edited;
  recordChange(draft, { op: "set", path: path(experienceId, factId), before, after: edited }, ctx);
  return true;
}

/** What kind of thing a fact says — what they did, what improved, whom they led, what they used. */
export function setFactKind(draft: StoredProfile, experienceId: string, factId: string, kind: FactKind, ctx: EditContext = editContext()): boolean {
  const found = locate(draft, experienceId, factId);
  if (!found) return false;
  if (found.fact.kind === kind) return true;
  const before = structuredClone(found.fact);
  const after: Fact = { ...found.fact, kind };
  found.job.facts[found.index] = after;
  recordChange(draft, { op: "set", path: path(experienceId, factId), before, after }, ctx);
  return true;
}

/** Adds, changes or takes off the figure of a fact — its own field, never written into its words. `null` takes it off. */
export function setFactMetric(draft: StoredProfile, experienceId: string, factId: string, metric: Metric | null, ctx: EditContext = editContext()): boolean {
  const found = locate(draft, experienceId, factId);
  if (!found) return false;
  if (metric === null ? found.fact.metric === undefined : jsonEqual(found.fact.metric, metric)) return true;
  const before = structuredClone(found.fact);
  const { metric: _metric, ...rest } = found.fact;
  void _metric;
  // A figure they gave is the person standing behind the task again; «no lo sé» is an absence, and says nothing about the task.
  const stood = metric !== null && "unknown" in metric ? {} : { confirmedAt: ctx.now };
  const after: Fact = metric === null ? { ...rest, ...stood } : { ...rest, ...stood, metric };
  found.job.facts[found.index] = after;
  recordChange(draft, { op: "set", path: path(experienceId, factId), before, after }, ctx);
  return true;
}

/**
 * «No usar en CVs»: a task that stays in the profile and goes into no CV. The words are not touched and nothing is archived —
 * it is still there to see, and to bring back with the same switch. Absent, not `false`, when it is used.
 */
export function setFactExcluded(draft: StoredProfile, experienceId: string, factId: string, excluded: boolean, ctx: EditContext = editContext()): boolean {
  const found = locate(draft, experienceId, factId);
  if (!found) return false;
  if (Boolean(found.fact.excluded) === excluded) return true;
  const before = structuredClone(found.fact);
  const { excluded: _excluded, ...rest } = found.fact;
  void _excluded;
  const after: Fact = excluded ? { ...rest, excluded: true } : rest;
  found.job.facts[found.index] = after;
  recordChange(draft, { op: "set", path: path(experienceId, factId), label: found.fact.text.slice(0, 80), before, after }, ctx);
  return true;
}

/** The same for a whole job: it stays in the profile, with every task it has, and goes into no CV. */
export function setJobExcluded(draft: StoredProfile, experienceId: string, excluded: boolean, ctx: EditContext = editContext()): boolean {
  const job = jobOf(draft, experienceId);
  if (!job) return false;
  if (Boolean(job.excluded) === excluded) return true;
  const before = job.excluded;
  if (excluded) job.excluded = true;
  else delete job.excluded;
  recordChange(draft, { op: "set", path: ["experience", experienceId, "excluded"], label: job.company.value || job.role.value, before, after: excluded ? true : undefined }, ctx);
  return true;
}

/** Marks a task as one that carries over to the kind of job the person is after, or takes the mark off. */
export function setFactTransferable(draft: StoredProfile, experienceId: string, factId: string, transferable: boolean, ctx: EditContext = editContext()): boolean {
  const found = locate(draft, experienceId, factId);
  if (!found) return false;
  if (Boolean(found.fact.transferable) === transferable) return true;
  const before = structuredClone(found.fact);
  const { transferable: _transferable, ...rest } = found.fact;
  void _transferable;
  const after: Fact = transferable ? { ...rest, transferable: true } : rest;
  found.job.facts[found.index] = after;
  recordChange(draft, { op: "set", path: path(experienceId, factId), before, after }, ctx);
  return true;
}

/** Takes a fact out of the job. It goes to the archive, where it can be brought back. */
export function removeFact(draft: StoredProfile, experienceId: string, factId: string, ctx: EditContext = editContext()): boolean {
  const found = locate(draft, experienceId, factId);
  if (!found) return false;
  const { job, fact, index } = found;
  job.facts.splice(index, 1);
  // A blank one — the "add a line" box left empty — has nothing to bring back.
  if (fact.text.trim() === "") return true;
  const archived = archiveEntity(draft, "fact", ["experience", experienceId, "facts"], fact, fact.text, ctx, index);
  recordChange(draft, { op: "remove", path: path(experienceId, factId), label: fact.text, before: { archiveId: archived.id } }, ctx);
  return true;
}

/** A fact the person writes themselves, in the hub. Nothing is added to it and nothing is asked of it. */
export function addFactText(
  draft: StoredProfile,
  experienceId: string,
  text: string,
  kind: FactKind = "responsibility",
  ctx: EditContext = editContext(),
): Fact | null {
  const job = jobOf(draft, experienceId);
  const clean = text.trim().slice(0, FACT_MAX);
  if (!job || clean === "") return null;
  const fact: Fact = { id: ctx.newId(), kind, text: clean, source: { kind: "manual", at: ctx.now }, status: "confirmed" };
  job.facts.push(fact);
  recordChange(draft, { op: "add", path: path(experienceId, fact.id), label: clean }, ctx);
  return fact;
}

/** A tool a job lists, once: the skill linked to it and the tool facts it carries under the same name. */
export type JobTool = { name: string; skillId?: string; factIds: string[] };

/**
 * The tools of a job as one list. A skill linked to it and a `tool` fact that `skillKey` calls the same thing ("Node.js",
 * "NodeJS") are one tool, not two. A tool fact left out of the CVs is not here: its row stays where it can be turned back on.
 */
export function toolsOfJob(profile: StoredProfile, job: StoredExperience): JobTool[] {
  const byKey = new Map<string, JobTool>();
  for (const skill of profile.skills) {
    const key = skillKey(skill.name.value);
    if (key && skill.experienceIds.includes(job.id) && !byKey.has(key)) byKey.set(key, { name: skill.name.value, skillId: skill.id, factIds: [] });
  }
  for (const fact of job.facts) {
    const key = skillKey(fact.text);
    if (fact.kind !== "tool" || fact.excluded || !key) continue;
    const tool = byKey.get(key) ?? { name: fact.text.trim(), factIds: [] };
    tool.factIds.push(fact.id);
    byKey.set(key, tool);
  }
  return [...byKey.values()];
}

/** Takes a tool off a job for good: the link of its skill (the skill stays among theirs) and its facts, which go to the archive. */
export function removeJobTool(draft: StoredProfile, experienceId: string, tool: JobTool, ctx: EditContext = editContext()): boolean {
  let removed = tool.skillId ? unlinkSkill(draft, tool.skillId, experienceId) : false;
  for (const id of tool.factIds) removed = removeFact(draft, experienceId, id, ctx) || removed;
  return removed;
}
