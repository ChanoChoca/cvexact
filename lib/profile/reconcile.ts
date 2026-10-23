import { practicalSchema, type Profile } from "@/lib/schemas/profile";
import {
  isPersonSource,
  newSource,
  type ArchiveKind,
  type Fact,
  type FactKind,
  type Field,
  type SourceKind,
  type StoredProfile,
} from "@/lib/schemas/profile-v2";
import { pairBySimilarity } from "@/lib/text/similarity";
import { toDateValue, withoutCurrent, type EndDateValue } from "./dates";
import {
  archiveEntity,
  clone,
  editContext,
  editedField,
  isBlankList,
  isBlankText,
  jsonEqual,
  recordChange,
  type EditContext,
  type Path,
} from "./edit";
import {
  certificationFromPlain,
  educationFromPlain,
  experienceFromPlain,
  factFrom,
  languageFromPlain,
  languageLevelFrom,
  projectFromPlain,
  skillFrom,
  type BuildContext,
} from "./from-plain";
import { factToBullet, linkedSkillTags, metricSuffix, toPlainProfile } from "./project";

/**
 * Applies a change made to the plain profile onto the stored one.
 *
 * The editors and importers that predate provenance still hand over a whole
 * plain profile. This is what lets them keep working on top of the stored one:
 * it finds what actually changed, keeps the provenance of everything that did
 * not, and gives what changed the treatment every edit gets — `edited` with the
 * original kept, new things credited to whoever brought them, removed things
 * archived rather than lost.
 *
 * Contract, held by `tests/profile-reconcile.test.ts` across random edits:
 *
 *   toPlainProfile(reconcileFromPlain(prev, next)) equals next
 *   reconcileFromPlain(prev, toPlainProfile(prev)) is prev itself
 *
 * Changes are found by comparing plain values, never stored ones, so a
 * difference in how a date is written or a metric is appended cannot make an
 * untouched field look edited.
 */

/** Above this a changed line is an edit of the old one, below it a new line. */
const EDIT_SIMILARITY = 0.45;
/** Skill names are short; a rename has to keep more of the word than a line does. */
const RENAME_SIMILARITY = 0.5;

export type ReconcileOptions = {
  /** Who is credited for what is new in `next`. */
  origin?: SourceKind;
  now?: string;
  newId?: () => string;
};

type Env = {
  draft: StoredProfile;
  ctx: EditContext;
  origin: SourceKind;
  build: BuildContext;
};

const isBlankDate = (value: EndDateValue): boolean =>
  value.year === undefined && !value.raw && !value.current;

const isBlankLevel = (value: { cefr?: string; raw?: string }): boolean => !value.cefr && !value.raw;

const DEFAULT_PRACTICAL = practicalSchema.parse({});

function set(env: Env, path: Path, before: unknown, after: unknown) {
  recordChange(env.draft, { op: "set", path, before, after }, env.ctx);
}

/** Edits a wrapped value in `holder[key]` and records it, when it changed. */
function editValue<T>(
  env: Env,
  holder: Record<string, unknown>,
  key: string,
  value: T,
  path: Path,
  isEmpty: (value: T) => boolean,
) {
  const current = holder[key] as Field<T>;
  const updated = editedField(current, value, {
    isEmpty,
    origin: env.origin,
    now: env.ctx.now,
  });
  if (updated === current) return;
  set(env, path, current, updated);
  holder[key] = updated;
}

/**
 * The type of a job or its mode — a field that a job may not have at all — set to what a plain edit says: `""` takes it off.
 * Nothing in the app edits these through the plain profile today; this keeps the contract (the projection of the result is
 * what was asked for) for whatever one day does.
 */
function editOptionalChoice(env: Env, holder: Record<string, unknown>, key: string, next: string, path: Path) {
  const current = holder[key] as Field<string> | undefined;
  if (next === "") {
    if (current === undefined) return;
    delete holder[key];
    set(env, path, current, undefined);
    return;
  }
  const updated: Field<string> = current
    ? editedField(current, next, { isEmpty: isBlankText, origin: env.origin, now: env.ctx.now })
    : { value: next, status: "confirmed", source: { kind: env.origin, at: env.ctx.now } };
  if (updated === current) return;
  set(env, path, current, updated);
  holder[key] = updated;
}

function editText(
  env: Env,
  holder: Record<string, unknown>,
  key: string,
  next: string,
  was: string,
  path: Path,
) {
  if (next !== was) editValue(env, holder, key, next, path, isBlankText);
}

function editDate(
  env: Env,
  holder: Record<string, unknown>,
  key: string,
  next: EndDateValue,
  path: Path,
) {
  editValue<EndDateValue>(env, holder, key, next, path, isBlankDate);
}

// --- Lists of entities ------------------------------------------------------------------

type ListSpec<S extends { id: string }, P extends { id: string }> = {
  path: string[];
  kind: ArchiveKind;
  stored: S[];
  next: P[];
  before: P[];
  make: (plain: P) => S;
  update: (stored: S, plain: P, was: P) => void;
  label: (stored: S) => string;
  /**
   * Entities the plain profile never had — a job the person marked «No usar en CVs» is not projected — and so cannot be
   * absent from it on purpose: they stay, where they were, and are not archived for not being in `next`.
   */
  hidden?: (stored: S) => boolean;
};

/**
 * `kept` with the entries of `original` that were set aside put back where they were: right after the entry that came before
 * them, if it is still there — by id, since an edited entry is a new object — and at the start if nothing before them is.
 */
function withHiddenBack<T extends { id: string }>(kept: T[], original: readonly T[], hidden: (entry: T) => boolean): T[] {
  const out = [...kept];
  original.forEach((entry, index) => {
    if (!hidden(entry)) return;
    let at = 0;
    for (let before = index - 1; before >= 0; before--) {
      const position = out.findIndex((candidate) => candidate.id === original[before]!.id);
      if (position !== -1) {
        at = position + 1;
        break;
      }
    }
    out.splice(at, 0, entry);
  });
  return out;
}

/**
 * Entities are matched by id. A new id is an addition, a missing one a removal
 * (archived), and one that is present is updated only if its plain form changed.
 * The result follows the order of `next`.
 */
function reconcileList<S extends { id: string }, P extends { id: string }>(
  env: Env,
  spec: ListSpec<S, P>,
): S[] {
  const storedById = new Map(spec.stored.map((entry) => [entry.id, entry]));
  const beforeById = new Map(spec.before.map((entry) => [entry.id, entry]));
  const seen = new Set<string>();
  const result: S[] = [];

  for (const incoming of spec.next) {
    // Two entries sharing an id would be one address for two things.
    const plain = seen.has(incoming.id) ? { ...incoming, id: env.ctx.newId() } : incoming;
    seen.add(plain.id);

    const existing = storedById.get(plain.id);
    if (existing) {
      const was = beforeById.get(plain.id)!;
      if (!jsonEqual(plain, was)) spec.update(existing, plain, was);
      result.push(existing);
    } else {
      const made = spec.make(plain);
      // "Agregar trabajo" appends an empty row to be filled in; the fields record
      // themselves as they are filled, and the empty row was never something said.
      if (spec.label(made) !== "") {
        recordChange(
          env.draft,
          { op: "add", path: [...spec.path, made.id], label: spec.label(made) },
          env.ctx,
        );
      }
      result.push(made);
    }
  }

  for (const entry of spec.stored) {
    if (seen.has(entry.id)) continue;
    if (spec.hidden?.(entry)) continue;
    if (spec.label(entry) === "") continue;
    const archived = archiveEntity(
      env.draft,
      spec.kind,
      spec.path,
      entry,
      spec.label(entry),
      env.ctx,
      spec.stored.indexOf(entry),
    );
    recordChange(
      env.draft,
      {
        op: "remove",
        path: [...spec.path, entry.id],
        label: spec.label(entry),
        before: { archiveId: archived.id },
      },
      env.ctx,
    );
  }
  return spec.hidden ? withHiddenBack(result, spec.stored, spec.hidden) : result;
}

const joinLabel = (...parts: string[]) => parts.filter(Boolean).join(" — ");

// --- Facts ---------------------------------------------------------------------------------

/**
 * One group of a role's facts against the lines the plain profile now has.
 *
 * Lines are paired by exact text first and then by similarity, so a line the
 * user reworded keeps its identity (and its origin, and its `original`), while a
 * line replaced by something unrelated is a new one and the old one is archived.
 * A metric is shown on a bullet as a suffix; if the user edited the line with
 * the suffix still on the end, it is taken back off before the text is stored.
 */
function reconcileFactGroup(
  env: Env,
  path: Path,
  all: readonly Fact[],
  stored: Fact[],
  lines: string[],
  newKind: FactKind,
  showMetric: boolean,
): Fact[] {
  const shown = stored.map((fact) => (showMetric ? factToBullet(fact) : fact.text));
  const { pairs, removed, added } = pairBySimilarity(shown, lines, EDIT_SIMILARITY, {
    positional: showMetric,
  });
  const result = new Array<Fact>(lines.length);

  for (const [i, j] of pairs) {
    const fact = stored[i]!;
    const line = lines[j]!;
    if (line === shown[i]) {
      result[j] = fact;
      continue;
    }
    // A blank line being filled in is a new statement, not the edit of one: there
    // was nothing there to correct, and no "original" worth keeping.
    if (fact.text === "") {
      const filled: Fact = { ...fact, text: line, ...(isPersonSource(env.origin) ? { confirmedAt: env.ctx.now } : {}) };
      recordChange(env.draft, { op: "add", path: [...path, fact.id], label: line }, env.ctx);
      result[j] = filled;
      continue;
    }
    const suffix = showMetric ? metricSuffix(fact) : "";
    const text = suffix && line.endsWith(suffix) ? line.slice(0, -suffix.length) : line;
    if (text === fact.text) {
      result[j] = fact;
      continue;
    }
    const edited: Fact = {
      ...fact,
      text,
      status: "edited",
      original: fact.original !== undefined ? fact.original : fact.text,
      // Reworded by the person, through whichever editor: the last time they stood behind it. A reader doing it would not say so.
      ...(isPersonSource(env.origin) ? { confirmedAt: env.ctx.now } : {}),
    };
    set(env, [...path, fact.id], fact, edited);
    result[j] = edited;
  }

  for (const j of added) {
    const fact = factFrom(env.ctx.newId(), newKind, lines[j]!, newSource(env.origin, env.ctx.now));
    // A blank line is the editor's "add a line" box, not something the person said yet.
    if (fact.text !== "") {
      recordChange(env.draft, { op: "add", path: [...path, fact.id], label: fact.text }, env.ctx);
    }
    result[j] = fact;
  }

  for (const i of removed) {
    const fact = stored[i]!;
    // Nothing was in it, so there is nothing to bring back.
    if (fact.text === "") continue;
    const archived = archiveEntity(env.draft, "fact", path, fact, fact.text, env.ctx, all.indexOf(fact));
    recordChange(
      env.draft,
      { op: "remove", path: [...path, fact.id], label: fact.text, before: { archiveId: archived.id } },
      env.ctx,
    );
  }
  return result;
}

function reconcileSkills(env: Env, names: string[]): StoredProfile["skills"] {
  const stored = env.draft.skills;
  const { pairs, removed, added } = pairBySimilarity(
    stored.map((skill) => skill.name.value),
    names,
    RENAME_SIMILARITY,
  );
  const result = new Array<StoredProfile["skills"][number]>(names.length);

  for (const [i, j] of pairs) {
    const skill = stored[i]!;
    editText(env, skill as unknown as Record<string, unknown>, "name", names[j]!, skill.name.value, [
      "skills",
      skill.id,
      "name",
    ]);
    result[j] = skill;
  }
  for (const j of added) {
    const skill = skillFrom(env.ctx.newId(), names[j]!, newSource(env.origin, env.ctx.now));
    recordChange(env.draft, { op: "add", path: ["skills", skill.id], label: skill.name.value }, env.ctx);
    result[j] = skill;
  }
  for (const i of removed) {
    const skill = stored[i]!;
    const archived = archiveEntity(
      env.draft,
      "skill",
      ["skills"],
      skill,
      skill.name.value,
      env.ctx,
      stored.indexOf(skill),
    );
    recordChange(
      env.draft,
      {
        op: "remove",
        path: ["skills", skill.id],
        label: skill.name.value,
        before: { archiveId: archived.id },
      },
      env.ctx,
    );
  }
  return result;
}

/** A skill no longer used in a job: the link is taken off, the skill stays in the profile. */
function unlinkSkill(env: Env, name: string, jobId: string) {
  for (const skill of env.draft.skills) {
    if (skill.name.value.trim() !== name || !skill.experienceIds.includes(jobId)) continue;
    const before = skill.experienceIds;
    skill.experienceIds = before.filter((id) => id !== jobId);
    set(env, ["skills", skill.id, "experienceIds"], before, skill.experienceIds);
  }
}

// --- The whole profile ------------------------------------------------------------------------

export function reconcileFromPlain(
  prev: StoredProfile,
  next: Profile,
  options: ReconcileOptions = {},
): StoredProfile {
  const was = toPlainProfile(prev);
  if (jsonEqual(was, next)) return prev;

  const ctx = editContext({
    ...(options.now ? { now: options.now } : {}),
    ...(options.newId ? { newId: options.newId } : {}),
  });
  const origin = options.origin ?? "manual";
  const source = newSource(origin, ctx.now);
  const draft = clone(prev);
  const env: Env = {
    draft,
    ctx,
    origin,
    build: { source, factId: () => ctx.newId(), skillId: () => ctx.newId() },
  };

  const contact = draft.contact as unknown as Record<string, unknown>;
  for (const key of ["fullName", "email", "phone", "city", "country"] as const) {
    editText(env, contact, key, next[key], was[key], ["contact", key]);
  }
  if (!jsonEqual(next.links, was.links)) {
    editValue(env, contact, "links", next.links, ["contact", "links"], isBlankList);
  }

  editText(env, draft as unknown as Record<string, unknown>, "objective", next.objective, was.objective, ["objective"]);

  const legacy = draft.legacy as unknown as Record<string, unknown>;
  for (const key of ["headline", "about"] as const) {
    editText(env, legacy, key, next[key], was[key], ["legacy", key]);
  }
  if (!jsonEqual(next.extras, was.extras)) {
    editValue(env, legacy, "extras", next.extras, ["legacy", "extras"], isBlankList);
  }
  if (!jsonEqual(next.practical, was.practical)) {
    editValue(env, legacy, "practical", next.practical, ["legacy", "practical"], (value) =>
      jsonEqual(value, DEFAULT_PRACTICAL),
    );
  }

  draft.experience = reconcileList(env, {
    path: ["experience"],
    kind: "experience",
    stored: draft.experience,
    next: next.experience,
    before: was.experience,
    make: (plain) => experienceFromPlain(plain, env.build),
    label: (job) => joinLabel(job.company.value, job.role.value),
    hidden: (job) => Boolean(job.excluded),
    update: (job, plain, wasJob) => {
      const at = ["experience", job.id];
      const holder = job as unknown as Record<string, unknown>;
      for (const key of ["company", "role", "city", "country"] as const) {
        editText(env, holder, key, plain[key], wasJob[key], [...at, key]);
      }
      if (plain.start !== wasJob.start) {
        editDate(env, holder, "start", withoutCurrent(toDateValue(plain.start)), [...at, "start"]);
      }
      if (plain.end !== wasJob.end || plain.current !== wasJob.current) {
        // `current` is the checkbox and nothing else; see `endFieldFrom`.
        const base = plain.end !== wasJob.end ? toDateValue(plain.end) : job.end.value;
        editDate(
          env,
          holder,
          "end",
          { ...withoutCurrent(base), ...(plain.current ? { current: true } : {}) },
          [...at, "end"],
        );
      }
      for (const key of ["employmentType", "workMode"] as const) {
        if (plain[key] !== wasJob[key]) editOptionalChoice(env, holder, key, plain[key], [...at, key]);
      }
      if (!jsonEqual(plain.bullets, wasJob.bullets) || !jsonEqual(plain.tags, wasJob.tags)) {
        const path = [...at, "facts"];
        const all = job.facts;
        // What the person left out of their CVs was never in the plain profile: it is neither edited nor removed by an
        // edit made there, and stays where it was.
        const shown = all.filter((fact) => !fact.excluded);
        const bullets = reconcileFactGroup(
          env,
          path,
          all,
          shown.filter((fact) => fact.kind !== "tool"),
          plain.bullets,
          "responsibility",
          true,
        );
        // A tag that is a skill linked to this job is not one of its tools: it is there because of the link, and is
        // not made a fact of the job by an edit that touched something else. Taking the tag off is unlinking the skill,
        // and writing another spelling in its place is a new tool of the job. By the exact name: two spellings that
        // `skillKey` calls one tool are still two things written.
        const linked = linkedSkillTags(draft.skills, { id: job.id, facts: shown });
        const linkedNames = new Set(linked);
        const tools = reconcileFactGroup(
          env,
          path,
          all,
          shown.filter((fact) => fact.kind === "tool"),
          plain.tags.filter((tag) => !linkedNames.has(tag)),
          "tool",
          false,
        );
        const kept = new Set(plain.tags);
        for (const name of linked) if (!kept.has(name)) unlinkSkill(env, name, job.id);
        job.facts = withHiddenBack([...bullets, ...tools], all, (fact) => Boolean(fact.excluded));
      }
    },
  });

  draft.education = reconcileList(env, {
    path: ["education"],
    kind: "education",
    stored: draft.education,
    next: next.education,
    before: was.education,
    make: (plain) => educationFromPlain(plain, env.build),
    label: (entry) => joinLabel(entry.institution.value, entry.degree.value),
    update: (entry, plain, wasEntry) => {
      const at = ["education", entry.id];
      const holder = entry as unknown as Record<string, unknown>;
      for (const key of ["institution", "degree", "city", "country", "honors"] as const) {
        editText(env, holder, key, plain[key], wasEntry[key], [...at, key]);
      }
      if (plain.start !== wasEntry.start) {
        editDate(env, holder, "start", withoutCurrent(toDateValue(plain.start)), [...at, "start"]);
      }
      if (plain.end !== wasEntry.end) {
        editDate(env, holder, "end", withoutCurrent(toDateValue(plain.end)), [...at, "end"]);
      }
      if (!jsonEqual(plain.highlights, wasEntry.highlights)) {
        editValue(env, holder, "highlights", plain.highlights, [...at, "highlights"], isBlankList);
      }
      if (plain.status !== wasEntry.status) {
        editValue(env, holder, "status", plain.status, [...at, "status"], () => false);
      }
    },
  });

  draft.certifications = reconcileList(env, {
    path: ["certifications"],
    kind: "certification",
    stored: draft.certifications,
    next: next.certifications,
    before: was.certifications,
    make: (plain) => certificationFromPlain(plain, env.build),
    label: (entry) => joinLabel(entry.name.value, entry.issuer.value),
    // «No usar en CVs»: never in the plain profile, so not absent from it on purpose — the same as a job set aside.
    hidden: (entry) => Boolean(entry.excluded),
    update: (entry, plain, wasEntry) => {
      const at = ["certifications", entry.id];
      const holder = entry as unknown as Record<string, unknown>;
      for (const key of ["name", "issuer"] as const) {
        editText(env, holder, key, plain[key], wasEntry[key], [...at, key]);
      }
      if (plain.date !== wasEntry.date) {
        editDate(env, holder, "date", withoutCurrent(toDateValue(plain.date)), [...at, "date"]);
      }
    },
  });

  draft.languages = reconcileList(env, {
    path: ["languages"],
    kind: "language",
    stored: draft.languages,
    next: next.languages,
    before: was.languages,
    make: (plain) => languageFromPlain(plain, env.build),
    label: (entry) => entry.name.value,
    update: (entry, plain, wasEntry) => {
      const at = ["languages", entry.id];
      const holder = entry as unknown as Record<string, unknown>;
      editText(env, holder, "name", plain.name, wasEntry.name, [...at, "name"]);
      if (plain.level !== wasEntry.level) {
        editValue(env, holder, "level", languageLevelFrom(plain.level), [...at, "level"], isBlankLevel);
      }
    },
  });

  draft.projects = reconcileList(env, {
    path: ["projects"],
    kind: "project",
    stored: draft.projects,
    next: next.projects,
    before: was.projects,
    make: (plain) => projectFromPlain(plain, env.build),
    label: (entry) => entry.name.value,
    update: (entry, plain, wasEntry) => {
      const at = ["projects", entry.id];
      const holder = entry as unknown as Record<string, unknown>;
      for (const key of ["name", "description", "url"] as const) {
        editText(env, holder, key, plain[key], wasEntry[key], [...at, key]);
      }
      if (!jsonEqual(plain.tags, wasEntry.tags)) {
        editValue(env, holder, "tags", plain.tags, [...at, "tags"], isBlankList);
      }
    },
  });

  if (!jsonEqual(next.skills, was.skills)) draft.skills = reconcileSkills(env, next.skills);

  return draft;
}

