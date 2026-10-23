import {
  cvDocumentSchema,
  type CVEducationItem,
  type CVExperienceItem,
  type CVDocument,
  type CVProjectItem,
  type CVSection,
} from "@/lib/schemas/cv";
import {
  extractFigures,
  hardTermsIn,
  keywordMatches,
  normalize,
  textOverlap,
} from "@/lib/ai/evidence";
import { coverageAudit } from "@/lib/ai/verify";
import { splitSentences } from "@/lib/text/sentences";
import { toDateValue } from "@/lib/profile/dates";

/**
 * The pure engine of «Ajuste del CV a una hoja»: it classifies every removable
 * unit, walks the ladder until the CV fits, and gives back what the page no
 * longer needs (§3 of the to-do).
 *
 * Pure and free of React/DOM: `fitToPage` takes `measure` and `limit` injected,
 * so the tests run against a fake measurement (lines per bullet) and the browser
 * runs against the real measurer in `components/cv/measure.ts`. The
 * orchestration — session, storage, consent — lives in `lib/applications/fit.ts`.
 *
 * Three decisions that are not cosmetic:
 *
 *  - **Ids over the original document.** Every unit is named by its position in
 *    the CV that came in (`s0.i2.b1`), and `applyRemovals` always rebuilds from
 *    that original with the whole set of removed ids. Removing one at a time
 *    shifts the indexes and the floors would start reading positions that no
 *    longer exist; rebuilding does not.
 *  - **Availability recomputed on every pass.** A whole job only becomes
 *    removable once it has no bullets left, and that can only be known by
 *    looking at the accumulated set — which is why there is no flat
 *    pre-computed list.
 *  - **Floors before tiers.** The T0→T5 ladder decides *what wants out*; the
 *    floors (1st job, its 1st bullet, the current job, at least one study)
 *    decide what *may* go out, and they always win.
 *
 * Deterministic and idempotent: the same CV with the same measurement gives the
 * same result, and running it on its own output changes nothing (that one fits).
 */

/** How far the ladder may go. `extreme` needs the person's consent (§3.2). */
export type FitLevel = "normal" | "relaxed" | "extreme";

/** The levels, weakest first — the order the ladder may advance in. */
export const FIT_LEVELS: readonly FitLevel[] = ["normal", "relaxed", "extreme"];

/** The next stricter level, or null at `extreme`. Used by the session (§4). */
export function nextFitLevel(level: FitLevel): FitLevel | null {
  const index = FIT_LEVELS.indexOf(level);
  return FIT_LEVELS[index + 1] ?? null;
}

/** Class of one unit, per §3.1. T0 is redundancy; T5 is excluding evidence. */
export type FitTier = "T0" | "T1" | "T2" | "T3" | "T4a" | "T4b" | "T5";

/**
 * What a removed line was, in the words the receipt and `coverage.omitted` use.
 * `summary` covers both a sentence of it and the whole paragraph (the `text`
 * says which was taken).
 */
export type RemovedKind = "bullet" | "skill" | "pair" | "project" | "activity" | "honors" | "note" | "job" | "study" | "summary";

/** One thing the fit took out, in the form the receipt reads (§6.5). */
export type RemovedLine = {
  kind: RemovedKind;
  /** Short label for `coverage.omitted`'s `item` — never the full bullet (≤ 60 chars). */
  label: string;
  text: string;
  tier: FitTier;
  /** Present for `job`/`study`: what the receipt names when the whole entry goes. */
  company?: string;
  dates?: string;
  /**
   * Present for `T5`: the excluding requirement this line was the only evidence
   * of. The consent dialog names it (§6.6) — «esto quita lo único que muestra
   * «X»» — and a generic wording would hide the thing being decided.
   */
  requirement?: string;
};

/**
 * A shortened line — Etapa 2's condense stage.
 *
 * Declared here because `FitOutcome` already reports it and both stages share
 * unit ids; the condenser itself does not exist yet in Etapa 1, so nothing ever
 * produces one. `needsReview` marks a shortening whose meaning could have
 * changed — the receipt diffs it word by word and the person confirms it.
 */
export type CondensedLine = { id: string; before: string; after: string; needsReview?: boolean };

/**
 * One removable piece, with everything the ladder and the floors need.
 *
 * Exported so tests can assert the classification directly (§8 asks for exactly
 * one category per unit and a fixed elimination order) without running the loop.
 */
export type FitUnit = {
  id: string;
  kind: RemovedKind;
  /** The text judged — a bullet, `label: value`, the honors line, a sentence. */
  text: string;
  /** ≤ 60 chars, for `coverage.omitted`. */
  label: string;
  tier: FitTier;
  /** Primary sort rank of the elimination ladder — see ORDER below. */
  order: number;
  /**
   * Index in its section (experience/education are newest-first, so a larger
   * index is an older entry) — and, for a summary sentence, the sentence's own
   * index, which is what makes the last sentence go first. -1 when neither.
   */
  jobIndex: number;
  /** Index within its job's lines; -1 when it is not a line. */
  bulletIndex: number;
  /** Position in the original document, for tie-breaks and receipt order. */
  docOrder: number;
  company?: string;
  dates?: string;
  /** The excluding requirement this unit is the only evidence of, when it is (T5). */
  requirement?: string;
};

export type FitResult = {
  cv: CVDocument;
  removed: RemovedLine[];
  fits: boolean;
  before: number;
  after: number;
  level: FitLevel;
  /**
   * Requirements whose only evidence went out with this fit, so the coverage
   * block can say so (§6.5: `covered: false` with «Se quitó para que entre en
   * una hoja.»).
   */
  lostRequirements: string[];
};

/**
 * The posting's ask, reduced to what the engine reads. `JobAnalysis` satisfies
 * this structurally, so callers pass `app.analysis` unchanged.
 */
export type FitAnalysis = {
  keywords: string[];
  requirements: { text: string; kind: "hard" | "soft"; excluding: boolean }[];
  responsibilities?: string[];
};

export type FitOptions = {
  analysis?: FitAnalysis;
  /** Natural height of a candidate, in px. Must be deterministic per document. */
  measure: (cv: CVDocument) => number;
  /** The height a fitting CV must reach: `FIT_LIMIT_PX`, possibly tightened after a spilled PDF. */
  limit: number;
  /** Defaults to `normal`: the level this attempt is allowed to reach. */
  level?: FitLevel;
};

/* --- Ids ------------------------------------------------------------------ */

// Positions in the *original* document. Sections have a single kind each, so
// `s0.i0` cannot collide across an experience and an education item.
const jobId = (section: number, item: number) => `s${section}.i${item}`;
const bulletId = (section: number, item: number, bullet: number) => `s${section}.i${item}.b${bullet}`;
const sectionLineId = (section: number, bullet: number) => `s${section}.b${bullet}`;
const pairId = (section: number, item: number) => `s${section}.i${item}`;
const projectId = (section: number, item: number) => `s${section}.i${item}`;
const activityId = (section: number, item: number) => `s${section}.i${item}`;
const honorsId = (section: number, item: number) => `s${section}.i${item}.h`;
const noteId = (section: number, item: number) => `s${section}.i${item}.n`;
const studyId = (section: number, item: number) => `s${section}.i${item}`;
const sentenceId = (index: number) => `sum.s${index}`;
const SUMMARY_ID = "sum";

/* --- Ladder --------------------------------------------------------------- */

const TIER_RANK: Record<FitTier, number> = { T0: 0, T1: 10, T2: 20, T3: 30, T4a: 40, T4b: 50, T5: 60 };

/**
 * Where the structural units sit on the elimination ladder (§3.2/§3.3).
 *
 * A whole job's header (35) goes out after every line tier `normal` can reach
 * and before `T4a`: once the level accepts a bigger cut, dropping the header of
 * a job the reader will not weigh is cheaper than dropping a quantified
 * achievement, and the person is told either way. Inside `extreme`, `T4b` goes
 * first, then the older studies (55), then the summary sentence by sentence and
 * finally the whole paragraph (57), and `T5` stays last of all.
 */
const JOB_ORDER = 35;
const STUDY_ORDER = 55;
const SENTENCE_ORDER = 56;
const SUMMARY_ORDER = 57;

/** A short, human label for `coverage.omitted` — never the whole bullet (§6.5). */
function shortLabel(text: string, max = 60): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/**
 * Whether a date range runs to today, in the words the CV uses («actualidad»,
 * «presente», «hoy», «present»). `toDateValue` already knows that vocabulary; a
 * second regex here would be a second, drifting answer.
 */
function isCurrentJob(dateRange: string): boolean {
  const last = dateRange.split(/[–—-]/).pop() ?? "";
  return toDateValue(last).current === true;
}

/**
 * Every removable piece of the document, in reading order, with its structural
 * place. Tiers here are provisional — `classifyFitUnits` overwrites them.
 *
 * The summary contributes one unit per sentence *from the second one on* — the
 * first is never a unit of its own (§3.2 keeps it while anything of the summary
 * is left) — plus one for the whole paragraph, which only goes once no sentence
 * is left to take.
 */
function collectUnits(cv: CVDocument): FitUnit[] {
  const units: FitUnit[] = [];
  let docOrder = 0;
  const push = (unit: Omit<FitUnit, "docOrder">) => {
    units.push({ ...unit, docOrder: docOrder++ });
  };

  cv.sections.forEach((section, si) => {
    if (section.kind === "experience") {
      section.items.forEach((item, ii) => {
        item.bullets.forEach((bullet, bi) => {
          push({
            id: bulletId(si, ii, bi),
            kind: "bullet",
            text: bullet,
            label: shortLabel(bullet),
            tier: "T1",
            order: TIER_RANK.T1,
            jobIndex: ii,
            bulletIndex: bi,
            company: item.company,
            dates: item.dateRange,
          });
        });
        if (item.note?.trim()) {
          // The person's reason for a short stay: a line like a bullet, with no floor — the job stands without it. It is the last line
          // of its job, so it is the first of that job to go.
          push({
            id: noteId(si, ii),
            kind: "note",
            text: item.note,
            label: shortLabel(item.note),
            tier: "T1",
            order: TIER_RANK.T1,
            jobIndex: ii,
            bulletIndex: item.bullets.length,
            company: item.company,
            dates: item.dateRange,
          });
        }
        push({
          id: jobId(si, ii),
          kind: "job",
          text: `${item.company} — ${item.role} (${item.dateRange})`,
          label: shortLabel(`Puesto: ${item.company}`),
          /**
           * A placeholder, not a category: a whole job is not a *line* tier, and
           * it is gated by its own rules — the floors, `omitJobFrom(level)`, and
           * the «header-only» precondition — never by the level's tier cap
           * (§3.2 lets `normal` omit from the 4th job on).
           */
          tier: "T4b",
          order: JOB_ORDER,
          jobIndex: ii,
          bulletIndex: -1,
          company: item.company,
          dates: item.dateRange,
        });
      });
    } else if (section.kind === "education") {
      section.items.forEach((item, ii) => {
        push({
          id: studyId(si, ii),
          kind: "study",
          text: `${item.institution} — ${item.degree}`,
          label: shortLabel(`Estudio: ${item.degree || item.institution}`),
          tier: "T4b",
          order: STUDY_ORDER,
          jobIndex: ii,
          bulletIndex: -1,
          company: item.institution,
          dates: item.date,
        });
        if (item.honors.trim()) {
          push({
            id: honorsId(si, ii),
            kind: "honors",
            text: item.honors,
            label: shortLabel(item.honors),
            // T2 only on the most recent study's line (§3.1): it is recent
            // achievement, not decoration — but it still falls before evidence.
            tier: ii === 0 ? "T2" : "T1",
            order: ii === 0 ? TIER_RANK.T2 : TIER_RANK.T1,
            jobIndex: ii,
            bulletIndex: -1,
          });
        }
      });
    } else if (section.kind === "bullets") {
      section.bullets.forEach((bullet, bi) => {
        push({
          id: sectionLineId(si, bi),
          kind: "skill",
          text: bullet,
          label: shortLabel(bullet),
          tier: "T1",
          order: TIER_RANK.T1,
          jobIndex: -1,
          bulletIndex: bi,
        });
      });
    } else if (section.kind === "projects") {
      // The whole project is the unit — name, description and link go together —
      // so the page is re-measured after the entry is gone, not after a line of it.
      section.items.forEach((item, ii) => {
        const text = item.description ? `${item.name}: ${item.description}` : item.name;
        push({
          id: projectId(si, ii),
          kind: "project",
          text,
          label: shortLabel(`Proyecto: ${item.name}`),
          tier: "T1",
          order: TIER_RANK.T1,
          jobIndex: -1,
          bulletIndex: -1,
        });
      });
    } else if (section.kind === "activities") {
      section.items.forEach((item, ii) => {
        push({
          id: activityId(si, ii),
          kind: "activity",
          text: item.text,
          label: shortLabel(`Actividad: ${item.text}`),
          tier: "T1",
          order: TIER_RANK.T1,
          jobIndex: -1,
          bulletIndex: -1,
        });
      });
    } else {
      section.items.forEach((item, ii) => {
        const text = item.value ? `${item.label}: ${item.value}` : item.label;
        push({
          id: pairId(si, ii),
          kind: "pair",
          text,
          label: shortLabel(text),
          tier: "T1",
          order: TIER_RANK.T1,
          jobIndex: -1,
          bulletIndex: -1,
        });
      });
    }
  });

  const sentences = splitSentences(cv.summary);
  sentences.forEach((sentence, index) => {
    if (index === 0) return;
    push({
      id: sentenceId(index),
      kind: "summary",
      text: sentence,
      label: shortLabel(sentence),
      tier: "T4b",
      order: SENTENCE_ORDER,
      // The sentence's own index: the ladder sorts a larger index first, which
      // is what makes the last sentence go before the ones above it.
      jobIndex: index,
      bulletIndex: -1,
    });
  });
  if (cv.summary.trim()) {
    push({
      id: SUMMARY_ID,
      kind: "summary",
      text: cv.summary,
      label: shortLabel(cv.summary),
      tier: "T4b",
      order: SUMMARY_ORDER,
      jobIndex: -1,
      bulletIndex: -1,
    });
  }

  return units;
}

/* --- Classification -------------------------------------------------------- */

/** Kinds the ladder classifies from matches/figures/evidence — §3.1's line units. */
const LINE_KINDS: ReadonlySet<RemovedKind> = new Set(["bullet", "skill", "pair", "project", "activity"]);

/**
 * Kinds that take part in redundancy and best-evidence: the content lines. The
 * summary is out of both — a summary paraphrasing its own bullets would
 * otherwise group them and `T0` the experience away — and job/study units keep
 * the fixed ladder position §3.2 gives them.
 */
const REDUNDANCY_KINDS: ReadonlySet<RemovedKind> = new Set(["bullet", "skill", "pair", "project", "activity", "honors"]);

/** Two lines are duplicates at this word overlap, and only then (§3.1). */
const REDUNDANCY_OVERLAP = 0.6;
/** A line's text supports a requirement's recorded evidence from this overlap on. */
const EVIDENCE_OVERLAP = 0.5;
/** A skills line is already said by the experience when this share of its hard terms is. */
const SKILL_LINK_SHARE = 0.8;

type EvidenceFlags = { bestCovered: boolean; bestAny: boolean; excluding: boolean };

/** One requirement and the line that evidences it best, when there is one. */
type RequirementEvidence = {
  requirement: string;
  covered: boolean;
  excluding: boolean;
  unitId: string;
};

/**
 * Which line best evidences each requirement the report names.
 *
 * The report's `evidence` is the model's own wording for the line covering it,
 * so the unit overlapping it most (≥ `EVIDENCE_OVERLAP`, earliest line on a tie)
 * is the one that requirement would lose. `coverageAudit` supplies the rows —
 * the same primitive the panel beside the preview counts with, so «evidencia»
 * means one thing in both places.
 */
function requirementEvidence(
  cv: CVDocument,
  units: readonly FitUnit[],
  analysis: FitAnalysis | undefined,
): RequirementEvidence[] {
  if (!analysis || analysis.requirements.length === 0) return [];

  const pool = units.filter((unit) => REDUNDANCY_KINDS.has(unit.kind));
  const found: RequirementEvidence[] = [];

  for (const row of coverageAudit(
    { coverage: cv.coverage },
    { requirements: analysis.requirements, responsibilities: analysis.responsibilities ?? [] },
  ).rows) {
    const evidence = row.entry?.evidence?.trim();
    if (!evidence) continue;

    let best: FitUnit | null = null;
    let bestScore = 0;
    for (const unit of pool) {
      const score = textOverlap(unit.text, evidence);
      if (score < EVIDENCE_OVERLAP) continue;
      if (!best || score > bestScore || (score === bestScore && unit.docOrder < best.docOrder)) {
        best = unit;
        bestScore = score;
      }
    }
    if (!best) continue;
    found.push({
      requirement: row.requirement,
      covered: row.covered,
      excluding: row.excluding,
      unitId: best.id,
    });
  }

  return found;
}

/** The evidence flags per unit, folded from `requirementEvidence`. */
function evidenceFlags(evidence: readonly RequirementEvidence[]): Map<string, EvidenceFlags> {
  const flags = new Map<string, EvidenceFlags>();
  for (const row of evidence) {
    const entry = flags.get(row.unitId) ?? { bestCovered: false, bestAny: false, excluding: false };
    entry.bestAny = true;
    if (row.covered && !row.excluding) entry.bestCovered = true;
    if (row.excluding) entry.excluding = true;
    flags.set(row.unitId, entry);
  }
  return flags;
}

function sameFigureSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((figure) => b.has(figure));
}

/** The duplicate of each redundancy group: what falls to T0 (§3.1). */
type Groups = Set<string>;

/**
 * Redundancy, resolved before anything else (§3.1): two lines are linked when
 * their texts nearly coincide — but two lines stating *different* figures are
 * different achievements, not copies — and a skills line is linked to the
 * experience bullet that already says almost all of its hard terms.
 *
 * Each connected component keeps its most probative member; the rest become T0
 * candidates, *unless* they are some requirement's best evidence — an evidence
 * never drops to T0, however duplicated it looks.
 */
function redundantGroups(
  units: readonly FitUnit[],
  matches: ReadonlyMap<string, number>,
  figures: ReadonlyMap<string, ReadonlySet<string>>,
  flags: ReadonlyMap<string, EvidenceFlags>,
): Groups {
  const pool = units.filter((unit) => REDUNDANCY_KINDS.has(unit.kind));
  const byId = new Map(pool.map((unit) => [unit.id, unit]));
  const links: [string, string][] = [];

  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i]!;
      const b = pool[j]!;
      if (textOverlap(a.text, b.text) < REDUNDANCY_OVERLAP) continue;
      const fa = figures.get(a.id) ?? new Set<string>();
      const fb = figures.get(b.id) ?? new Set<string>();
      if (fa.size > 0 && fb.size > 0 && !sameFigureSet(fa, fb)) continue;
      links.push([a.id, b.id]);
    }
  }

  const bulletTerms = units
    .filter((unit) => unit.kind === "bullet")
    .map((unit) => ({ id: unit.id, terms: new Set(hardTermsIn(unit.text).map(normalize)) }));
  for (const skill of units.filter((unit) => unit.kind === "skill")) {
    const wanted = [...new Set(hardTermsIn(skill.text).map(normalize))];
    if (wanted.length === 0) continue;
    let carrier: { id: string; shared: number } | null = null;
    for (const bullet of bulletTerms) {
      const shared = wanted.filter((term) => bullet.terms.has(term)).length;
      if (shared > (carrier?.shared ?? 0)) carrier = { id: bullet.id, shared };
    }
    if (carrier && carrier.shared / wanted.length >= SKILL_LINK_SHARE) {
      links.push([skill.id, carrier.id]);
    }
  }

  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const up = parent.get(id);
    if (!up || up === id) return id;
    const root = find(up);
    parent.set(id, root);
    return root;
  };
  for (const unit of pool) parent.set(unit.id, unit.id);
  for (const [a, b] of links) {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  }

  const grouped = new Map<string, FitUnit[]>();
  for (const unit of pool) {
    const root = find(unit.id);
    const group = grouped.get(root) ?? [];
    group.push(unit);
    grouped.set(root, group);
  }

  const drop = new Set<string>();
  for (const group of grouped.values()) {
    if (group.length === 1) continue;
    // `probative(a, b) < 0` means `a` wins: it is the more probative of the two.
    const winner = [...group].sort((a, b) => probative(a, b, matches, figures, flags, byId))[0]!;
    for (const unit of group) if (unit.id !== winner.id) drop.add(unit.id);
  }

  return drop;
}

/**
 * Most probative first (§3.1): excluding evidence, then evidence, then a stated
 * figure, then more matches, then the earlier line on the page. A total order,
 * so the winner never depends on the iteration order of a `Map`.
 */
function probative(
  a: FitUnit,
  b: FitUnit,
  matches: ReadonlyMap<string, number>,
  figures: ReadonlyMap<string, ReadonlySet<string>>,
  flags: ReadonlyMap<string, EvidenceFlags>,
  byId: ReadonlyMap<string, FitUnit>,
): number {
  const strength = (id: string) => {
    const flag = flags.get(id);
    if (flag?.excluding) return 2;
    return flag?.bestAny ? 1 : 0;
  };
  if (strength(a.id) !== strength(b.id)) return strength(b.id) - strength(a.id);
  const figuresA = figures.get(a.id)?.size ?? 0;
  const figuresB = figures.get(b.id)?.size ?? 0;
  if (figuresA !== figuresB) return figuresB - figuresA;
  const matchesA = matches.get(a.id) ?? 0;
  const matchesB = matches.get(b.id) ?? 0;
  if (matchesA !== matchesB) return matchesB - matchesA;
  return (byId.get(a.id)?.docOrder ?? 0) - (byId.get(b.id)?.docOrder ?? 0);
}

/* --- Classification -------------------------------------------------------- */

function classifyTier(
  keywords: readonly string[],
  score: number,
  figures: number,
  bestCovered: boolean,
  matchedAnEvidence: boolean,
  practical: boolean,
): FitTier {
  if (bestCovered) return "T4b";
  if (!practical && figures > 0 && score >= 1) return "T4b";
  if (!practical && figures > 0 && !matchedAnEvidence) return "T4a";
  // A posting with no keywords cannot say a line «no aporta»: every line would
  // land in T1 and `normal` would strip the CV bare. T3 leaves them removable
  // only when the page really demands it.
  if (keywords.length === 0) return "T3";
  return score === 0 ? "T1" : score === 1 ? "T2" : "T3";
}

/**
 * Every unit of `cv`, each in exactly one category (§3.1).
 *
 * The order of the rules is the point: excluding evidence first (T5), then the
 * evidence and the quantified achievements (T4b/T4a), then the plain ladder by
 * how many keywords the line states (T3/T2/T1). Redundancy is resolved before
 * any of it, and only the lines that are not redundancy remain in the ladder.
 */
export function classifyFitUnits(cv: CVDocument, analysis?: FitAnalysis): FitUnit[] {
  const units = collectUnits(cv);
  const keywords = analysis?.keywords ?? [];
  const lines = units.filter((unit) => LINE_KINDS.has(unit.kind));
  const matches = new Map(lines.map((unit) => [unit.id, keywordMatches(keywords, unit.text)]));
  const figures = new Map(lines.map((unit) => [unit.id, new Set(extractFigures(unit.text))]));
  const evidence = requirementEvidence(cv, units, analysis);
  const flags = evidenceFlags(evidence);
  const excluding = new Map<string, string>();
  for (const row of evidence) {
    if (row.excluding) excluding.set(row.unitId, row.requirement);
  }
  const groups = redundantGroups(units, matches, figures, flags);
  const byId = new Map(units.map((unit) => [unit.id, unit]));

  for (const unit of units) {
    const flag = flags.get(unit.id);
    if (flag?.excluding) {
      unit.tier = "T5";
      unit.order = TIER_RANK.T5;
      const requirement = excluding.get(unit.id);
      if (requirement !== undefined) unit.requirement = requirement;
      continue;
    }
    if (!LINE_KINDS.has(unit.kind)) continue;
    const tier = classifyTier(
      keywords,
      matches.get(unit.id) ?? 0,
      figures.get(unit.id)?.size ?? 0,
      flag?.bestCovered ?? false,
      flag?.bestAny ?? false,
      unit.kind === "pair",
    );
    unit.tier = tier;
    unit.order = TIER_RANK[tier];
  }

  // Redundancy lands on top of that: the duplicates of each group are T0 —
  // even the ones with figures — except a line that evidences a requirement,
  // which never drops to T0 (§3.1).
  for (const id of groups) {
    const unit = byId.get(id);
    if (!unit || flags.get(id)?.bestAny) continue;
    unit.tier = "T0";
    unit.order = TIER_RANK.T0;
  }

  return units;
}

/* --- Floors and availability ----------------------------------------------- */

/**
 * One job, as the floors read it: how many bullets it has, which of them, and
 * whether it is the one the person still holds.
 */
type JobPlan = { id: string; index: number; current: boolean; bulletIds: string[] };

type Bounds = {
  /** Every job of the experience section, by its id. */
  jobs: Map<string, JobPlan>;
  /** A bullet's id → the job it belongs to. */
  byBullet: Map<string, JobPlan>;
  /** How many sentence units the summary has (its sentences beyond the first). */
  sentenceCount: number;
};

function boundsOf(cv: CVDocument): Bounds {
  const jobs = new Map<string, JobPlan>();
  const byBullet = new Map<string, JobPlan>();

  cv.sections.forEach((section, si) => {
    if (section.kind !== "experience") return;
    section.items.forEach((item, ii) => {
      const plan: JobPlan = {
        id: jobId(si, ii),
        index: ii,
        current: isCurrentJob(item.dateRange),
        bulletIds: item.bullets.map((_, bi) => bulletId(si, ii, bi)),
      };
      jobs.set(plan.id, plan);
      for (const id of plan.bulletIds) byBullet.set(id, plan);
    });
  });

  return { jobs, byBullet, sentenceCount: Math.max(0, splitSentences(cv.summary).length - 1) };
}

const TIER_CAP: Record<FitLevel, number> = {
  normal: TIER_RANK.T3,
  relaxed: TIER_RANK.T4a,
  extreme: TIER_RANK.T5,
};

/** Bullets the first two jobs must keep (§3.2). Jobs 3+ may go header-only. */
function bulletFloor(jobIndex: number, level: FitLevel): number {
  if (jobIndex > 1) return 0;
  return level === "normal" ? 2 : 1;
}

/** A whole job may be omitted — header included — from this experience index on (§3.2). */
function omitJobFrom(level: FitLevel): number {
  return level === "normal" ? 3 : 2;
}

/**
 * Whether `unit` may be removed right now: its tier is within what `level`
 * allows, and no floor stands in the way (§3.2/§3.3).
 *
 * Recomputed against the accumulated set on every pass, which is the only way
 * the «header-only» precondition of omitting a job can be read: a whole job is
 * available exactly when it has no bullets left.
 */
function isAvailable(
  unit: FitUnit,
  removed: ReadonlySet<string>,
  level: FitLevel,
  bounds: Bounds,
): boolean {
  /**
   * The level's cap applies to the *line* tiers. The structural units carry a
   * placeholder tier and are gated by their own rules below — a whole job is
   * omittable from the 4th on at `normal` (§3.2) even though its placeholder is
   * `T4b`, and `honors` is a `normal`-level line by definition.
   */
  if (LINE_KINDS.has(unit.kind) && TIER_RANK[unit.tier] > TIER_CAP[level]) return false;

  switch (unit.kind) {
    case "job": {
      const plan = bounds.jobs.get(unit.id);
      // The job someone still holds is never omitted, and neither are the most
      // recent ones the level protects.
      if (!plan || plan.current) return false;
      if (plan.index < omitJobFrom(level)) return false;
      return plan.bulletIds.every((id) => removed.has(id));
    }
    case "study":
      // Only in `extreme`, and the most recent study always stays (§3.2).
      return level === "extreme" && unit.jobIndex > 0;
    case "bullet": {
      const plan = bounds.byBullet.get(unit.id);
      if (!plan) return false;
      // The first bullet of the first job is never touched (§3.2).
      if (plan.index === 0 && unit.bulletIndex === 0) return false;
      const remaining = plan.bulletIds.filter((id) => !removed.has(id)).length;
      return remaining - 1 >= bulletFloor(plan.index, level);
    }
    case "summary": {
      if (level !== "extreme") return false;
      // The whole paragraph goes only once no later sentence is left, and the
      // first sentence goes with it — never on its own.
      if (unit.id === SUMMARY_ID) {
        return Array.from({ length: bounds.sentenceCount }, (_, k) => sentenceId(k + 1)).every((id) =>
          removed.has(id),
        );
      }
      return bounds.sentenceCount > 0;
    }
    default:
      // Skills lines, pairs and honors: no floor of their own. A `bullets`
      // section that falls under its minimum goes whole, which `applyRemovals`
      // does and reports.
      return true;
  }
}

/** §3.1's elimination order, made total so the result never depends on iteration. */
function compareElimination(a: FitUnit, b: FitUnit): number {
  if (a.order !== b.order) return a.order - b.order;
  // Older job first (the experience section is newest-first), then the later
  // line, then the longer one, then the earlier one on the page.
  if (a.jobIndex !== b.jobIndex) return b.jobIndex - a.jobIndex;
  if (a.bulletIndex !== b.bulletIndex) return b.bulletIndex - a.bulletIndex;
  if (a.text.length !== b.text.length) return b.text.length - a.text.length;
  return a.docOrder - b.docOrder;
}

/* --- Rebuilding the document ----------------------------------------------- */

/** The summary as it stands after `removed`: whole, or without the sentences taken. */
function buildSummary(cv: CVDocument, removed: ReadonlySet<string>): string {
  if (removed.has(SUMMARY_ID)) return "";
  return splitSentences(cv.summary)
    .filter((_, index) => !removed.has(sentenceId(index)))
    .join(" ");
}

type ApplyResult = {
  doc: CVDocument;
  /**
   * The ids that are actually gone from the new document. It can be larger than
   * what was asked for: omitting a job takes its bullets with it, and a
   * `bullets` section under its minimum takes the line that was still standing.
   */
  gone: ReadonlySet<string>;
};

/**
 * The document with `removed` taken out, rebuilt from the original.
 *
 * Rebuilt rather than patched: the ids name positions in the document that came
 * in, so the whole set is applied in one pass and the indexes never shift under
 * the floors. `cvDocumentSchema` is the gate, exactly as `commit` in
 * `lib/cv/edit.ts` is for the editor — it is also what drops a section that
 * fell under `SECTION_MINIMUM`. `null` when the result would not be a valid
 * document, which the caller reads as «this one unit cannot go».
 */
function applyRemovals(cv: CVDocument, removed: ReadonlySet<string>): ApplyResult | null {
  const sections: CVSection[] = [];
  const gone = new Set<string>();

  cv.sections.forEach((section, si) => {
    if (section.kind === "experience") {
      const items: CVExperienceItem[] = [];
      section.items.forEach((item, ii) => {
        if (removed.has(jobId(si, ii))) {
          gone.add(jobId(si, ii));
          gone.add(noteId(si, ii));
          item.bullets.forEach((_, bi) => gone.add(bulletId(si, ii, bi)));
          return;
        }
        const bullets = item.bullets.filter((_, bi) => !removed.has(bulletId(si, ii, bi)));
        item.bullets.forEach((_, bi) => {
          if (removed.has(bulletId(si, ii, bi))) gone.add(bulletId(si, ii, bi));
        });
        if (removed.has(noteId(si, ii))) gone.add(noteId(si, ii));
        items.push({ ...item, bullets, note: removed.has(noteId(si, ii)) ? "" : item.note });
      });
      if (items.length > 0) sections.push({ ...section, items });
      else {
        section.items.forEach((item, ii) => {
          gone.add(jobId(si, ii));
          gone.add(noteId(si, ii));
          item.bullets.forEach((_, bi) => gone.add(bulletId(si, ii, bi)));
        });
      }
    } else if (section.kind === "education") {
      const items: CVEducationItem[] = [];
      section.items.forEach((item, ii) => {
        if (removed.has(studyId(si, ii))) {
          gone.add(studyId(si, ii));
          gone.add(honorsId(si, ii));
          return;
        }
        if (removed.has(honorsId(si, ii))) gone.add(honorsId(si, ii));
        items.push(removed.has(honorsId(si, ii)) ? { ...item, honors: "" } : item);
      });
      if (items.length > 0) sections.push({ ...section, items });
      else {
        section.items.forEach((item, ii) => {
          gone.add(studyId(si, ii));
          gone.add(honorsId(si, ii));
        });
      }
    } else if (section.kind === "bullets") {
      const kept = section.bullets.filter((_, bi) => !removed.has(sectionLineId(si, bi)));
      if (kept.length < 2) {
        // Under its minimum the whole section goes (§6.4/§8) — and every line of
        // it is reported, not only the one that was asked for.
        section.bullets.forEach((_, bi) => gone.add(sectionLineId(si, bi)));
      } else {
        section.bullets.forEach((_, bi) => {
          if (removed.has(sectionLineId(si, bi))) gone.add(sectionLineId(si, bi));
        });
        sections.push({ ...section, bullets: kept });
      }
    } else if (section.kind === "projects") {
      const kept: CVProjectItem[] = section.items.filter((_, ii) => !removed.has(projectId(si, ii)));
      section.items.forEach((_, ii) => {
        if (removed.has(projectId(si, ii))) gone.add(projectId(si, ii));
      });
      if (kept.length > 0) sections.push({ ...section, items: kept });
    } else if (section.kind === "activities") {
      const kept = section.items.filter((_, ii) => !removed.has(activityId(si, ii)));
      section.items.forEach((_, ii) => {
        if (removed.has(activityId(si, ii))) gone.add(activityId(si, ii));
      });
      if (kept.length > 0) sections.push({ ...section, items: kept });
    } else {
      const kept = section.items.filter((_, ii) => !removed.has(pairId(si, ii)));
      section.items.forEach((_, ii) => {
        if (removed.has(pairId(si, ii))) gone.add(pairId(si, ii));
      });
      if (kept.length > 0) sections.push({ ...section, items: kept });
    }
  });

  if (removed.has(SUMMARY_ID)) gone.add(SUMMARY_ID);
  splitSentences(cv.summary).forEach((_, index) => {
    if (removed.has(sentenceId(index))) gone.add(sentenceId(index));
  });

  const parsed = cvDocumentSchema.safeParse({
    ...cv,
    summary: buildSummary(cv, removed),
    sections,
  });
  if (!parsed.success) return null;
  return { doc: parsed.data, gone };
}

/* --- Applying what the AI shortened (Etapa 2) ------------------------------ */

/**
 * The CV with the accepted rewrites in place, rebuilt and re-parsed.
 *
 * By unit id, the same ids the ladder uses, and through the same gate
 * (`cvDocumentSchema`) that `applyRemovals` goes through: a rewrite naming a line
 * that is no longer there, or one the schema refuses, changes nothing at all.
 * `SUM_ID` replaces the whole paragraph, which is the only way the summary is
 * ever shortened — a sentence of it is not a unit on its own.
 */
export function applyCondensed(cv: CVDocument, lines: readonly CondensedLine[]): CVDocument {
  if (lines.length === 0) return cv;
  const byId = new Map(lines.map((line) => [line.id, line.after]));

  const sections: CVSection[] = cv.sections.map((section, si) => {
    if (section.kind === "bullets") {
      return {
        ...section,
        bullets: section.bullets.map((bullet, bi) => byId.get(sectionLineId(si, bi)) ?? bullet),
      };
    }
    if (section.kind !== "experience") return section;
    return {
      ...section,
      items: section.items.map((item, ii) => ({
        ...item,
        bullets: item.bullets.map((bullet, bi) => byId.get(bulletId(si, ii, bi)) ?? bullet),
      })),
    };
  });

  const summary = byId.get(SUMMARY_ID);
  const parsed = cvDocumentSchema.safeParse({
    ...cv,
    ...(summary !== undefined ? { summary } : {}),
    sections,
  });
  return parsed.success ? parsed.data : cv;
}

/* --- The loop -------------------------------------------------------------- */

/** The receipt's lines: what is actually gone, in the order it was taken out. */
function removedLines(units: readonly FitUnit[], gone: ReadonlySet<string>): RemovedLine[] {
  const reported = new Set(gone);
  // The whole summary is reported once, not also sentence by sentence.
  if (reported.has(SUMMARY_ID)) {
    for (const unit of units) {
      if (unit.kind === "summary" && unit.id !== SUMMARY_ID) reported.delete(unit.id);
    }
  }

  return [...units]
    .filter((unit) => reported.has(unit.id))
    .sort(compareElimination)
    .map((unit) => ({
      kind: unit.kind,
      label: unit.label,
      text: unit.text,
      tier: unit.tier,
      ...(unit.company !== undefined ? { company: unit.company } : {}),
      ...(unit.dates !== undefined ? { dates: unit.dates } : {}),
      ...(unit.requirement !== undefined ? { requirement: unit.requirement } : {}),
    }));
}

/** The requirements whose evidence this fit took off the page (§6.5). */
function lostEvidence(
  evidence: readonly RequirementEvidence[],
  gone: ReadonlySet<string>,
): string[] {
  const lost = new Set<string>();
  for (const row of evidence) {
    if (row.covered && gone.has(row.unitId)) lost.add(row.requirement);
  }
  return [...lost];
}

function withExtra(set: ReadonlySet<string>, id: string): Set<string> {
  return new Set([...set, id]);
}

/**
 * Fits `cv` to one page at `level`, removing whole units in §3.1's order and
 * **giving back** what no longer needs to go (§6.4).
 *
 * The give-back is the half that keeps the sheet from ending half empty: as soon
 * as the page fits, the removals are undone from the highest category down while
 * the page still fits — a cascade like a whole skills section leaving frees more
 * than the one line it was asked for.
 *
 * Returns the original document untouched when it already fits, and `fits:
 * false` when even the level's whole ladder cannot make it fit — in which case
 * `cv` is the maximum-effort reduction, which the caller must not apply (the
 * person is owed the choice, not a document nobody agreed to).
 */
export function fitToPage(cv: CVDocument, options: FitOptions): FitResult {
  const level = options.level ?? "normal";
  const before = options.measure(cv);
  if (before <= options.limit) {
    return { cv, removed: [], fits: true, before, after: before, level, lostRequirements: [] };
  }

  const units = classifyFitUnits(cv, options.analysis);
  const evidence = requirementEvidence(cv, units, options.analysis);
  const bounds = boundsOf(cv);
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const ladder = [...units].sort(compareElimination);

  const taken = new Set<string>();
  let current = cv;
  let gone: ReadonlySet<string> = new Set<string>();

  for (const unit of ladder) {
    if (!isAvailable(unit, taken, level, bounds)) continue;
    const applied = applyRemovals(cv, withExtra(taken, unit.id));
    // A unit the schema refuses (a section it would empty) is not removable,
    // however expendable the ladder says it is.
    if (!applied) continue;
    taken.add(unit.id);
    current = applied.doc;
    gone = applied.gone;
    if (options.measure(current) <= options.limit) break;
  }

  for (const id of [...taken].sort((a, b) => compareElimination(byId.get(b)!, byId.get(a)!))) {
    const candidate = new Set(taken);
    candidate.delete(id);
    const applied = applyRemovals(cv, candidate);
    if (!applied) continue;
    if (options.measure(applied.doc) > options.limit) continue;
    taken.delete(id);
    current = applied.doc;
    gone = applied.gone;
  }

  const after = options.measure(current);
  return {
    cv: current,
    removed: removedLines(units, gone),
    fits: after <= options.limit,
    before,
    after,
    level,
    lostRequirements: lostEvidence(evidence, gone),
  };
}
