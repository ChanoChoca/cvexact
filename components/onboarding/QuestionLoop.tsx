"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Spinner } from "@/components/ui";
import { focusHeading } from "@/components/ui/focusHeading";
import { useIsPhone } from "@/components/ui/useIsPhone";
import { useAiAvailability } from "@/lib/ai/availability";
import {
  answerAbbreviation,
  answerReason,
  answerSkillLevels,
  answerConditions,
  answerConditionsChanged,
  answerCurrentJob,
  answerFigure,
  answerFromTray,
  answerNoLonger,
  answerRenewal,
  answerHandled,
  answerLanguageLevel,
  answerMonth,
  answerNarrative,
  answerNoteLeft,
  answerNotePlaced,
  answerObjective,
  answerOfferedClaim,
  answerOfferedConditions,
  answerOfferedCredential,
  answerPeople,
  answerPractical,
  answerProject,
  answerSkillUsed,
  answerSkillUses,
  answerStudy,
  answerTools,
  answerTransferable,
  declineOffered,
  deferQuestion,
  finishAchievements,
  keepOffered,
  type CurrentJobAnswer,
  type CurrentJobResult,
  type FigureAnswer,
} from "@/lib/onboarding/answer";
import { askMetric } from "@/lib/jobs/requirement-ask";
import type { RepeatedRequirement } from "@/lib/jobs/repeated";
import { chooseFollowUpWithAi } from "@/lib/onboarding/ai";
import { addEntry } from "@/lib/onboarding/entries";
import { MIN_CHOICES, followUpChoices } from "@/lib/onboarding/followup-choice";
import { describeFigure } from "@/lib/onboarding/figure";
import { detectGaps, eligibleGaps, figureFollowUp, followUpGaps, nextQuestion, remainingThisSession, type Gap, type NextQuestion, type Signals } from "@/lib/onboarding/gaps";
import type { RuleId } from "@/lib/onboarding/config";
import { ACHIEVEMENT_TYPES, achievementTypesFor, contextOf, questionFor, skeletonBatch, type Question } from "@/lib/onboarding/questions";
import { clearDraft, cycleHasMore, draftFor, resumeCycle, saveCycle, saveDraft, type Cycle } from "@/lib/onboarding/resume";
import { editExperience, removeSkill, setSelfEmployed } from "@/lib/onboarding/review";
import { restoreProfile, type LastAnswer } from "@/lib/onboarding/last-answer";
import { sessionOf } from "@/lib/onboarding/session";
import { useEngineSignals } from "@/lib/onboarding/use-signals";
import { MONTH_NAMES_ES, spelledDate, type DateValue } from "@/lib/profile/dates";
import { levelPhrase } from "@/lib/profile/language-levels";
import { isMeaningfulExperience, type StoredProfile } from "@/lib/schemas/profile-v2";
import { recordMetric } from "@/lib/metrics/store";
import { loadStoredProfile, updateStoredProfile } from "@/lib/storage/local";
import { QuestionBody, type QuestionHandlers } from "./QuestionBody";
import { QuestionCard } from "./QuestionCard";
import { FigureControl, NarrativeControl, RESUMED_NOTE } from "./QuestionControls";
import { SavedAnswer } from "./SavedAnswer";

/**
 * The questions whose own control has «Ahora no» beside the other answers, with the same weight: the generic ways of putting a question off are not drawn under them.
 * Those that are about time —the job that goes on, a credential's date, what they said of how they can work— are among them: «Ahora no» is one of their answers and
 * «No aplica» is not, since nothing about a date stops applying because a question was put off.
 */
const DEFERS_ITSELF: ReadonlySet<string> = new Set(["requirement-ask", "note-place", "skill-stale", "abbreviation", "current-job", "renewal", "conditions"]);

/** Whether the question's own control puts it off: by kind, or — a control that serves two questions — because the question says so. */
const defersItself = (question: Question): boolean => DEFERS_ITSELF.has(question.control.kind) || (question.control.kind === "gap-action" && question.control.defers === true);

/**
 * The question-asking loop the onboarding's S7/S7b run on (`DeepenSession`,
 * which wraps this with its side panel and mobile tabs) and that `/postular`
 * reuses to ask about a single role's missing figure — the same engine
 * (`lib/onboarding`) deciding what to ask, the same primitives applying the
 * answer, so a number typed on a posting page is the same kind of fact a
 * number typed during onboarding is: the person's own words, never a
 * model's rewrite. That is what replaced the metrics assistant, which
 * proposed a rewritten bullet with the figure filled in — exactly the
 * invention the rest of this engine refuses to do.
 *
 * Renders nothing once there is nothing left to ask, or once dismissed —
 * `onExhausted`, when given, is how the caller finds out to show its own
 * "that's it" state (`SessionClose` for the onboarding; nothing at all for
 * the wizard, which already gates whether this mounts at all).
 */

type View = { kind: "ask" } | { kind: "cycle"; cycle: Cycle } | { kind: "closed" };

/** What an open answer was kept as — shown above the next question, to look at and correct. */
type Saved = { experienceId: string; factIds: string[]; rawAnswer: string };

const FIGURE_ERROR = "Poné solo el número, con coma o punto para los miles o los decimales.";
const PEOPLE_ERROR = "Poné solo un número, o dejalo vacío si no lo sabés.";
const END_ERROR = "Revisá la fecha: no puede ser anterior a cuando empezó.";

/** The story of one achievement stays one fact: splitting "what I did" from "what happened" would break it. */
const whole = (text: string): string[] => [text.trim()];

/** What a «¿Seguís en…?» answer did, in a line: the date it ended, the job they went on to, what was corrected — and what was told, which is shown as what it was kept as and not here. */
function currentJobReceipt(answer: CurrentJobAnswer, result: CurrentJobResult): string | null {
  const { status } = answer;
  const kept = (job: { company: string; role: string }) => [job.role.trim(), job.company.trim()].filter(Boolean).join(" en ");
  switch (status.kind) {
    case "ended":
      return result.newJob ? `Guardado: terminó en ${spelledDate(status.end)}, y agregamos tu puesto: ${kept(status.next ?? { company: "", role: "" })}.` : `Guardado: terminó en ${spelledDate(status.end)}.`;
    case "moved":
      return `Guardado: agregamos tu puesto, ${kept(status.next)}, desde ${spelledDate(status.next.start)}. El anterior terminó ese mes.`;
    case "still":
      if (status.role !== undefined || status.company !== undefined) return "Guardado: corregimos el dato del puesto.";
      return result.facts.length > 0 ? "Guardamos lo que agregaste." : "Listo: lo dejamos como está.";
  }
}

export function QuestionLoop({
  profile,
  now,
  only,
  startWith,
  rules,
  limit,
  signals: told,
  showRemaining,
  onShowProfile,
  onExhausted,
  onHighlight,
  onAnswered,
  embedded = false,
  heading,
  dismissLabel = "Ahora no",
}: {
  profile: StoredProfile;
  now: Date;
  /** Ask only about this job — the wizard's one use; omitted, the onboarding asks across the whole profile. */
  only?: string | undefined;
  /** A question to ask first, by its id — what a pending item opens. Whatever the session's budget, and whether or not it was put off. */
  startWith?: string | undefined;
  /** Ask only these kinds of question, and at most `limit` in all: the review of what changed since the last time. */
  rules?: ReadonlySet<RuleId> | undefined;
  limit?: number | undefined;
  /** What the caller knows of the page it is on that the engine does not (a CV that came out short): added to what the engine is already told of their search. */
  signals?: Signals | undefined;
  /** Say how many of today's questions are left, on each one. */
  showRemaining?: boolean | undefined;
  /** Offered beside a receipt: where the answer went, for a caller whose panel is out of sight on a phone. */
  onShowProfile?: (() => void) | undefined;
  /**
   * Nothing is eligible any more, or the person dismissed it — `next` is what was left, if anything, for a summary. `last` is the answer that ended it, when it
   * was one, with the way to take it back: the loop is gone, and with it the card that said what the answer did, so the caller says it where it is.
   */
  onExhausted?: ((next: NextQuestion, last?: LastAnswer) => void) | undefined;
  /** Which facts to mark "Nuevo" right now — mirrors this component's own highlight state, for a caller showing its own panel (`ProfilePanel`) beside the question. */
  onHighlight?: ((ids: string[]) => void) | undefined;
  /**
   * What each answer did, with the way back, the moment it is given: for a caller whose page takes the question away as soon as it is answered (the wizard asks
   * about a job only while there is something to ask, and the answer ends that) and so has no card left to say it on.
   */
  onAnswered?: ((last: LastAnswer) => void) | undefined;
  /**
   * Asked inside another page, beside what that page is about (the wizard, with the CV): a round and not a session. It asks the one question it
   * opened with, and what that question brings with it —the achievements it goes on to ask one by one, the follow-ups on what was said—, and then
   * it is done; putting that question off is the end of it. And it does not move the page: it takes the focus to what it changed to, and leaves
   * the person where they are.
   */
  embedded?: boolean;
  /** Said above whatever is asked, for as long as something is: what an embedded loop is for, on a page whose subject is another. */
  heading?: ReactNode;
  dismissLabel?: string;
}) {
  const compact = useIsPhone();
  // Where a reload, or a return another day, left the achievements: back to telling them. Not when a question was
  // asked for by name — that is what they came for — and not for a job this loop is not asking about.
  const [view, setView] = useState<View>(() => {
    const resumed = startWith ? null : resumeCycle(profile, only);
    return resumed ? { kind: "cycle", cycle: resumed } : { kind: "ask" };
  });
  /** Follow-ups to ask before the engine's next question, as gap ids — or the one question asked for by name. */
  const [queue, setQueue] = useState<string[]>(() => (startWith ? [startWith] : []));
  const [receipt, setReceipt] = useState<string | null>(null);
  /** The person's own model is picking which question follows the last answer (an experiment they turned on): waited for, a few seconds at most, and the way to stop waiting. */
  const [choosing, setChoosing] = useState<AbortController | null>(null);
  const ai = useAiAvailability();
  /** What the last open answer was kept as: shown above the question that follows it, until the next answer. */
  const [saved, setSaved] = useState<Saved | null>(null);
  /** What the last open answer said, to give back to the box if the answer is taken back. */
  const [typed, setTyped] = useState<{ key: string; text: string } | null>(null);
  /** The profile as it was before the last answer, for "Deshacer". */
  const [undo, setUndo] = useState<StoredProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** How many things were answered or put off since this loop opened (or since the last one taken back): an embedded loop is done with its first. */
  const [answers, setAnswers] = useState(0);
  // No local copy: nothing in this component reads it back, only the caller's `ProfilePanel` does.
  const setHighlight = (ids: string[]) => onHighlight?.(ids);

  // --- What is asked ---------------------------------------------------------------

  // What was turned down for good stays turned down, even queued: an answer that records "no aplica"
  // can leave its gap standing (a month nobody remembers is still a year with no month), and the
  // queue would ask it again for as long as it held it.
  const turnedDown = new Set(profile.pending.filter((entry) => entry.state === "na").map((entry) => entry.questionId));
  // What the engine is told of their search, besides the profile: nothing at all while the experiment that asks about it is off.
  const known = useEngineSignals(profile, now);
  const signals = told ? { ...known, ...told } : known;
  const queued = queue.filter((id) => !turnedDown.has(id)).map((id) => detectGaps(profile, now, signals).find((gap) => gap.id === id)).find(Boolean);
  const scope = { ...(only ? { only } : {}), ...(rules ? { rules } : {}), ...(limit !== undefined ? { limit } : {}), signals };
  // Inside another page the question asked is the only one, once it is answered — or put off — and what it asked next with it is done (a cycle is not a
  // question: it is in its own view, and a follow-up on what was said is in the queue).
  const roundDone = embedded && answers > 0 && view.kind === "ask";
  const next: NextQuestion = queued ? { kind: "gap", gap: queued } : roundDone ? { kind: "none" } : nextQuestion(profile, sessionOf(profile), now, { ...scope, compact });
  // The last answer of a session has no question after it to show what it was kept as, so it keeps the pause that every answer used to have.
  const closing = view.kind === "closed" || (view.kind === "ask" && next.kind !== "gap" && !saved);
  const jobs = profile.experience.filter(isMeaningfulExperience);
  const remaining =
    showRemaining && view.kind === "ask" && next.kind === "gap"
      ? remainingThisSession(profile, sessionOf(profile), now, { ...scope, compact })
      : 0;
  // A review of what changed is a few questions that were counted before they were asked —«Son tres preguntas»—, and it counts them the same way: «Pregunta 1 de 3».
  // The session's own are an estimate («unas»), and a session lasts hours: it is not «hoy».
  const askedSoFar = sessionOf(profile).askedThisSession + sessionOf(profile).askedQuick;
  const progress =
    remaining <= 0
      ? undefined
      : limit !== undefined
        ? `Pregunta ${askedSoFar + 1} de ${askedSoFar + remaining}`
        : remaining === 1
          ? "Última pregunta."
          : `Quedan unas ${remaining} preguntas.`;

  useEffect(() => {
    if (closing) onExhausted?.(next, receipt && undo ? { receipt, before: undo } : undefined);
    // `next` is a fresh object every render; only whether *this* run just
    // became closing is worth telling the caller about.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing]);

  // Each screen starts at the top: on a phone the last one may have been scrolled to its foot, and the next would open in the middle.
  const screen = closing
    ? "closed"
    : view.kind === "cycle"
      ? `cycle:${view.cycle.remaining[0] ?? ""}:${view.cycle.figure?.factId ?? ""}`
      : next.kind === "gap"
        ? `ask:${next.gap.id}`
        : "saved";
  const box = useRef<HTMLDivElement>(null);
  const shown = useRef<string | null>(null);
  useEffect(() => {
    // Inside another page, the one that matters is the page's: it is where the person is looking, and it does not go anywhere.
    if (!embedded) window.scrollTo({ top: 0 });
    // The first screen is what the page opened on. A later one replaces whatever was pressed to
    // get there, and whoever cannot see it change is only told if focus goes with it.
    const first = shown.current === null;
    shown.current = screen;
    if (!first) focusHeading(box.current?.querySelector<HTMLElement>("h1, h2"));
  }, [screen, embedded]);

  // --- Applying an answer ----------------------------------------------------------------

  /** Runs a change on the stored profile, remembering what it was before so the last answer can be taken back. */
  function apply<T>(
    change: (draft: StoredProfile) => T,
    options: {
      receipt?: string | null | ((result: T) => string | null);
      undoable?: boolean;
      keepReceipt?: boolean;
      /** Whether this is an answer to count (`question_answered`). Not for putting a question off, nor for the step that closes a cycle. */
      count?: boolean;
    } = {},
  ): T {
    const before = loadStoredProfile();
    let result!: T;
    updateStoredProfile((draft) => {
      result = change(draft);
      // Whatever was being typed has been answered, or put off: it is no longer something to give back.
      clearDraft(draft);
    });
    setAnswers((count) => count + 1);
    // An answer that was not accepted (a figure that is not one, a line with nothing in it) reaches here too, as `false` or
    // an empty list: it is not one the person has given. What returns nothing at all is one that has no way to fail.
    const given = result !== false && !(Array.isArray(result) && result.length === 0);
    if (options.count !== false && given) recordMetric("question_answered");
    setError(null);
    setHighlight([]);
    // What was kept of the answer before, and what it said, belong to that answer: a later one does not take them over.
    setSaved(null);
    setTyped(null);
    // The end of a cycle follows right after the answer that ended it: what that answer said is still the news.
    const said = options.keepReceipt ? null : typeof options.receipt === "function" ? options.receipt(result) : (options.receipt ?? null);
    if (!options.keepReceipt) setReceipt(said);
    setUndo(options.undoable === false ? null : before);
    if (said && given && options.undoable !== false) onAnswered?.({ receipt: said, before });
    return result;
  }

  function restore() {
    if (!undo) return;
    // Taken back to be written again: the words are where they were, in the box.
    restoreProfile(undo, typed);
    setUndo(null);
    setReceipt(null);
    setSaved(null);
    setTyped(null);
    setQueue([]);
    setAnswers(0);
    setHighlight([]);
    setView({ kind: "ask" });
  }

  /** How long the experiment waits for a model's choice before the engine's own goes on. */
  const CHOOSE_WAIT_MS = 8000;

  /**
   * «Que mi IA elija la próxima pregunta»: after an open answer, the model picks which of the few questions the engine could ask
   * about this job comes first — or none. It is queued ahead of what the engine would have asked, and nothing else changes: a
   * failure, a wait that runs out, «Seguir sin la IA» or a choice of none all end in the engine's own next question.
   */
  async function chooseNext(answer: string, jobId: string) {
    const current = loadStoredProfile();
    const options = followUpChoices(current, jobId, sessionOf(current), now, new Set(queue), { compact });
    if (options.length < MIN_CHOICES) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHOOSE_WAIT_MS);
    setChoosing(controller);
    const outcome = await chooseFollowUpWithAi(answer, options.map(({ id, about }) => ({ id, about })), controller.signal);
    clearTimeout(timer);
    // Stopped — by the person, or by the wait running out — whatever it came back with is not applied.
    const stopped = controller.signal.aborted;
    setChoosing((current) => (current === controller ? null : current));
    if (stopped || !outcome.ok) return;
    if (outcome.result) {
      const chosen = outcome.result;
      setQueue((current) => [chosen, ...current.filter((id) => id !== chosen)]);
      recordMetric("followup_ai_chosen");
    } else {
      recordMetric("followup_ai_none");
    }
  }

  /** «Seguir sin la IA»: the request is stopped, and what the model might answer is not applied. */
  function skipChoosing() {
    choosing?.abort();
    setChoosing(null);
  }

  function defer(gap: Gap, state: "later" | "skipped" | "na") {
    // A table of jobs is put aside as one: «Ahora no» and «Dejarlo así» are about every row on it, and not about the first.
    const rows = asked?.question.control.kind === "skeleton-batch" ? new Set(asked.question.control.rows.map((row) => row.gapId)) : null;
    const gaps = rows ? detectGaps(profile, now).filter((found) => rows.has(found.id)) : [gap];
    apply((draft) => void gaps.forEach((found) => deferQuestion(draft, found, state)), {
      receipt: state === "na" ? "Listo, no lo volvemos a preguntar." : "Lo dejamos para después.",
      count: false,
    });
    recordMetric("question_put_off");
    setQueue((current) => current.filter((id) => !gaps.some((found) => found.id === id)));
  }

  // --- The achievements cycle: choose, tell each one, give its figure --------------------------

  // Every step of it is kept in the profile as it is reached (`saveCycle`), so a reload, or leaving it for
  // another day, picks up at the same card.

  function showCycle(cycle: Cycle) {
    updateStoredProfile((draft) => {
      saveCycle(draft, cycle);
      clearDraft(draft);
    });
    setView({ kind: "cycle", cycle });
  }

  function advance(cycle: Cycle, options: { keepReceipt?: boolean } = {}) {
    if (cycleHasMore(cycle)) {
      showCycle(cycle);
      return;
    }
    const job = loadStoredProfile().experience.find((entry) => entry.id === cycle.experienceId);
    apply(
      (draft) => {
        finishAchievements(draft, cycle.gap, cycle.created);
        saveCycle(draft, null);
      },
      {
        receipt: cycle.created > 0 ? `Guardamos ${cycle.created === 1 ? "tu logro" : `tus ${cycle.created} logros`}${job ? ` de ${job.company.value || job.role.value}` : ""}.` : null,
        undoable: false,
        keepReceipt: options.keepReceipt ?? false,
        // Closing the cycle is not another answer: each of its steps was counted when it was given.
        count: false,
      },
    );
    setView({ kind: "ask" });
  }

  function tellAchievement(cycle: Cycle, text: string) {
    const type = cycle.remaining[0];
    if (!type) return;
    const facts = apply((draft) => answerNarrative(draft, cycle.gap, cycle.experienceId, text, { kind: "achievement", questionId: `${cycle.gap.id}:${type}`, split: whole }), { undoable: false });
    const rest = cycle.remaining.slice(1);
    const [told] = facts;
    if (!told) return advance({ ...cycle, remaining: rest });
    setHighlight([told.id]);
    // Its figure, unless the words already carry one.
    const afterAnswer = loadStoredProfile();
    const figureGap = figureFollowUp(afterAnswer, told, now, sessionOf(afterAnswer));
    advance({ ...cycle, remaining: rest, created: cycle.created + 1, ...(figureGap ? { figure: { gap: figureGap, factId: told.id, quote: told.text } } : {}) });
  }

  function figureFor(cycle: Cycle, answer: FigureAnswer) {
    const target = cycle.figure;
    if (!target) return;
    const ok = apply((draft) => answerFigure(draft, target.gap, target.factId, answer, undefined, { followUp: true }), { receipt: describeFigure(answer), undoable: false });
    if (!ok) {
      setError(FIGURE_ERROR);
      setReceipt(null);
      return;
    }
    advance({ ...cycle, figure: undefined }, { keepReceipt: true });
  }

  // --- One handler per kind of question ----------------------------------------------------------

  // Three or more jobs asking for their start are one table, not a run of cards — unless one was asked for by name, or the loop is
  // about a single job, where there is nothing to put beside it.
  const batch = next.kind === "gap" && !only && !queued ? skeletonBatch(next.gap, eligibleGaps(profile, sessionOf(profile), now, { compact }), profile) : null;
  const asked = next.kind === "gap" ? { gap: next.gap, question: batch ?? questionFor(next.gap, profile) } : null;

  const handlers: QuestionHandlers | null = asked
    ? (() => {
        const { gap, question } = asked;
        const jobId = gap.experienceId ?? "";
        return {
          narrative: (text) => {
            const facts = apply((draft) => answerNarrative(draft, gap, jobId, text));
            if (facts.length === 0) return;
            setReceipt(null);
            setHighlight(facts.map((fact) => fact.id));
            // No screen between this answer and the next question: what it was kept as goes above it, and the follow-ups on what was said are lined up now.
            setSaved({ experienceId: jobId, factIds: facts.map((fact) => fact.id), rawAnswer: text });
            setTyped({ key: gap.id, text });
            const afterAnswer = loadStoredProfile();
            setQueue(followUpGaps(afterAnswer, facts, now, sessionOf(afterAnswer)).map((followUp) => followUp.id));
            if (profile.onboarding.aiFollowUp && ai?.byok && jobId) void chooseNext(text, jobId);
          },
          draft: (text) => updateStoredProfile((draft) => saveDraft(draft, gap.id, text)),
          project: (text) => {
            const control = question.control;
            if (control.kind !== "project") return;
            const ok = apply((draft) => answerProject(draft, gap, control.projectId, text), { receipt: "Guardado en el proyecto." });
            if (!ok) return;
            setHighlight([control.projectId]);
            setTyped({ key: gap.id, text });
          },
          pickFacts: (ids) => {
            const ok = apply((draft) => answerTransferable(draft, gap, jobId, ids), {
              receipt: ids.length === 0 ? "Listo, no lo volvemos a preguntar." : "Anotado: lo tenemos en cuenta primero.",
            });
            if (ok && ids.length > 0) setHighlight(ids);
          },
          study: (text) => {
            const control = question.control;
            if (control.kind !== "study") return;
            const ok = apply((draft) => answerStudy(draft, gap, control.educationId, text), { receipt: "Guardado en tus estudios." });
            if (!ok) return;
            setHighlight([control.educationId]);
            setTyped({ key: gap.id, text });
          },
          practical: (answer) => {
            const ok = apply((draft) => answerPractical(draft, gap, answer), { receipt: "Anotado. Lo podés cambiar cuando quieras desde tu perfil." });
            if (ok) setHighlight(["practical"]);
          },
          renewed: (expires) => {
            const ok = apply((draft) => answerRenewal(draft, gap, expires), { receipt: expires ? `Guardado: vence en ${spelledDate(expires)}.` : "Listo: sin fecha, no te lo volvemos a preguntar." });
            if (!ok) setReceipt(null);
          },
          noLonger: () => {
            const licence = (gap.payload.subject as { kind?: string } | undefined)?.kind === "license";
            apply((draft) => answerNoLonger(draft, gap), { receipt: licence ? "Listo: sacamos la licencia de lo que anotaste." : "Listo: queda en tu perfil, pero no va en ningún CV." });
          },
          currentJob: (answer) => {
            const result = apply((draft) => answerCurrentJob(draft, gap, answer), { receipt: (done) => (done ? currentJobReceipt(answer, done) : null) });
            // An end before the start is the one thing that is not accepted: said where it was typed, and nothing is kept.
            if (!result) {
              setReceipt(null);
              setError(END_ERROR);
              return;
            }
            // What they told of the time since is shown as what it was kept as, to look at and correct, like any open answer — in the job it was told of.
            if (result.facts.length > 0) {
              // When nothing else was done the card of what was kept says it all; when a job ended or began, the line that says so stays above it.
              if (answer.status.kind === "still" && answer.status.role === undefined && answer.status.company === undefined) setReceipt(null);
              setHighlight(result.facts.map((fact) => fact.id));
              setSaved({ experienceId: (result.newJob ?? jobs.find((entry) => entry.id === jobId))?.id ?? jobId, factIds: result.facts.map((fact) => fact.id), rawAnswer: answer.news });
            }
          },
          later: () => defer(gap, gap.priority === "blocking" ? "later" : "skipped"),
          conditions: (changed) => apply((draft) => (changed ? answerConditionsChanged(draft, gap, changed) : answerConditions(draft, gap)), { receipt: "Listo: lo dejamos anotado." }),
          types: (types) => {
            // Told in the order the question lists them, not the order they were tapped.
            const listed = achievementTypesFor(question.control.kind === "achievement-types" ? question.control.covered : []);
            const ordered = listed.map((type) => type.value).filter((value) => types.includes(value));
            setReceipt(null);
            setUndo(null);
            showCycle({ gap, experienceId: jobId, remaining: ordered, created: 0 });
          },
          noAchievements: () => defer(gap, "na"),
          figure: (answer) => {
            const control = question.control;
            if (control.kind !== "figure") return;
            const ok = apply((draft) => answerFigure(draft, gap, control.factId, answer), { receipt: describeFigure(answer) });
            if (!ok) {
              setError(FIGURE_ERROR);
              setReceipt(null);
            }
          },
          people: (answer) => {
            const ok = apply((draft) => answerPeople(draft, gap, answer), { receipt: answer.yes ? (answer.count ? `Anotado: ${answer.count} personas a cargo.` : "Anotado: con personas a cargo.") : "Anotado." });
            if (!ok) {
              setError(PEOPLE_ERROR);
              setReceipt(null);
            }
          },
          month: (month) => {
            const control = question.control;
            if (control.kind !== "month") return;
            apply((draft) => answerMonth(draft, gap, control.which, month), { receipt: month ? `Guardado: ${MONTH_NAMES_ES[month - 1]}.` : "Listo, dejamos solo el año." });
          },
          tools: (accepted) => {
            const control = question.control;
            if (control.kind !== "tools") return;
            apply((draft) => answerTools(draft, gap, accepted, control.tools), { receipt: accepted.length > 0 ? `Agregamos ${accepted.join(", ")} a tus habilidades.` : "Listo, no las agregamos." });
          },
          skillUses: (ids) => {
            const control = question.control;
            if (control.kind !== "skill-uses") return;
            apply((draft) => answerSkillUses(draft, gap, control.skillId, ids), { receipt: ids.length > 0 ? "Guardado." : "Anotado." });
          },
          level: (level) => {
            const control = question.control;
            if (control.kind !== "level") return;
            apply((draft) => answerLanguageLevel(draft, gap, control.languageId, level), { receipt: level === "unknown" ? "Listo, lo dejamos sin nivel." : `Guardado: ${levelPhrase(level)}.` });
          },
          overlapYes: () => apply((draft) => answerHandled(draft, gap), { receipt: "Listo." }),
          overlapFix: (patches) =>
            apply(
              (draft) => {
                for (const patch of patches) editExperience(draft, patch.id, { start: patch.start, end: patch.end });
                answerHandled(draft, gap);
              },
              { receipt: "Fechas corregidas." },
            ),
          skeleton: (value, options) => {
            const control = question.control;
            if (control.kind !== "skeleton") return;
            if (control.field === "company" && options?.selfEmployed) {
              // Said before it is applied: whether the kind of work was set depends on whether a source had already said one.
              const marked = !profile.experience.find((entry) => entry.id === jobId)?.employmentType;
              apply((draft) => setSelfEmployed(draft, jobId), { receipt: marked ? "Guardado: por tu cuenta, como freelance." : "Guardado." });
              return;
            }
            const patch = control.field === "start" ? { start: value as DateValue } : control.field === "company" ? { company: String(value) } : { role: String(value) };
            apply((draft) => editExperience(draft, jobId, patch), { receipt: "Guardado." });
          },
          skeletonBatch: (entries) =>
            apply(
              (draft) => {
                for (const entry of entries) editExperience(draft, entry.experienceId, { start: entry.start });
              },
              { receipt: entries.length === 1 ? "Guardamos 1 fecha." : `Guardamos ${entries.length} fechas.` },
            ),
          addEntry: (form) =>
            apply(
              (draft) => {
                addEntry(draft, form, { newId: () => crypto.randomUUID(), now: new Date().toISOString() });
                answerHandled(draft, gap);
              },
              { receipt: "Agregado a tu perfil." },
            ),
          objective: (value) => apply((draft) => answerObjective(draft, value, undefined, gap), { receipt: "Guardado." }),
          fromTray: (unassignedId, as) => {
            const fact = apply((draft) => answerFromTray(draft, gap, unassignedId, as), { receipt: as === "achievement" ? "Agregado como logro, con tus palabras." : "Agregado como tarea, con tus palabras." });
            if (!fact) return;
            setHighlight([fact.id]);
            // An achievement is asked its figure right after, like one just told: the words may not carry it.
            const afterAnswer = loadStoredProfile();
            setQueue(followUpGaps(afterAnswer, [fact], now, sessionOf(afterAnswer)).map((followUp) => followUp.id));
          },
          requirement: (() => {
            // A thing that comes up in several of the offers they analysed: the answers are those of the question of one offer, in the same places.
            const ask = gap.payload.ask as RepeatedRequirement | undefined;
            const said = (outcome: "done" | "no" | "later") => {
              if (ask) recordMetric(askMetric(ask.type, outcome));
            };
            return {
              claim: (where, claimJobId) => {
                if (!ask || (ask.kind !== "tool" && ask.kind !== "task")) return;
                const ok = apply((draft) => answerOfferedClaim(draft, { kind: ask.kind as "tool" | "task", thing: ask.thing }, where, claimJobId), { receipt: "Lo anotamos en tu perfil, con tus palabras." });
                if (!ok) return setReceipt(null);
                recordMetric("requirement_claimed");
                said("done");
              },
              credential: (values) => {
                if (!ask) return;
                const ok = apply((draft) => answerOfferedCredential(draft, values, ask.thing), { receipt: "Guardado en tu perfil, como algo tuyo." });
                if (!ok) return setReceipt(null);
                recordMetric("requirement_claimed");
                said("done");
              },
              conditions: (answer) => {
                if (!ask) return;
                const ok = apply((draft) => answerOfferedConditions(draft, answer, ask.thing), { receipt: "Anotado. Lo podés cambiar cuando quieras desde tu perfil." });
                if (!ok) return setReceipt(null);
                recordMetric("requirement_claimed");
                said("done");
              },
              decline: () => {
                if (!ask) return;
                apply((draft) => void declineOffered(draft, ask.thing, ask.fragment), { receipt: "Queda anotado en tu perfil y no te lo volvemos a preguntar por ahora." });
                recordMetric("requirement_declined");
                said("no");
              },
              keep: () => {
                if (!ask) return;
                apply((draft) => void keepOffered(draft, ask.thing), { receipt: "Queda como lo dijiste, y no te lo volvemos a preguntar." });
                said("no");
              },
              later: () => {
                // «Ahora no» is only for now, and says nothing of whether they have it: it is asked again another day, like any question put off.
                defer(gap, "later");
                said("later");
              },
            };
          })(),
          // What they wrote down, offered to the job it names: the sentences that stayed ticked, as tasks of it; it staying as a note; or not now.
          notePlace: {
            place: (sentences) => {
              const control = question.control;
              if (control.kind !== "note-place") return;
              const ok = apply((draft) => answerNotePlaced(draft, gap, control.noteId, control.jobId, sentences), {
                receipt: sentences.length === 1 ? `Agregamos una tarea a «${control.label}», con tus palabras.` : `Agregamos ${sentences.length} tareas a «${control.label}», con tus palabras.`,
              });
              if (!ok) setReceipt(null);
            },
            leave: () => {
              const control = question.control;
              if (control.kind !== "note-place") return;
              apply((draft) => answerNoteLeft(draft, gap, control.noteId), { receipt: "Listo: queda como una nota, y no te lo volvemos a preguntar." });
            },
            later: () => defer(gap, "later"),
          },
          // A skill nothing has backed for years: it still holds — the day is what changes —, it is no longer theirs — out of their CVs, and in the bin —, or not now.
          skillStale: {
            keep: () => {
              const control = question.control;
              if (control.kind !== "skill-stale") return;
              apply((draft) => answerSkillUsed(draft, gap, control.skillId), { receipt: "Listo: la dejamos como está." });
            },
            drop: () => {
              const control = question.control;
              if (control.kind !== "skill-stale") return;
              apply(
                (draft) => {
                  removeSkill(draft, control.skillId);
                  answerHandled(draft, gap);
                },
                { receipt: "Listo: la sacamos de tus CV." },
              );
            },
            later: () => defer(gap, "later"),
          },
          // A skill written as its initials: it is the whole name — renamed —, it is something else — left as it is, and not asked again —, or not now.
          abbreviation: {
            yes: () => {
              const control = question.control;
              if (control.kind !== "abbreviation") return;
              const name = String(gap.payload.name);
              apply((draft) => answerAbbreviation(draft, gap, control.skillId, name), { receipt: `Listo: ahora figura como «${name}».` });
            },
            no: () => apply((draft) => answerHandled(draft, gap), { receipt: "Listo: la dejamos como está." }),
            later: () => defer(gap, "later"),
          },
          // A line of the CV that is theirs: the reason for a short stay, or for the pause before a job.
          reason: (jobId, text) => apply((draft) => answerReason(draft, gap, jobId, text), { receipt: "Listo: va en una línea debajo del puesto." }),
          skillLevels: (levels) => apply((draft) => answerSkillLevels(draft, gap, levels), { receipt: "Listo: lo vas a ver en tu CV y lo podés cambiar en tus habilidades." }),
          decline: () => defer(gap, "na"),
        } satisfies QuestionHandlers;
      })()
    : null;

  // --- What is shown --------------------------------------------------------------------------------

  /** What the last open answer was kept as, with the ways to correct it or take it back. */
  const savedAnswer = saved ? (
    <SavedAnswer
      profile={profile}
      experienceId={saved.experienceId}
      factIds={saved.factIds}
      rawAnswer={saved.rawAnswer}
      onFactIdsChange={(factIds) => setSaved({ ...saved, factIds })}
      onUndo={restore}
      onShowProfile={onShowProfile}
    />
  ) : null;

  function main() {
    // The answer is kept and said, and the next question waits a moment for the choice — with a way past it.
    if (choosing !== null) {
      return (
        <section aria-label="Eligiendo la próxima pregunta" className="space-y-5">
          {savedAnswer}
          <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-3 text-sm text-ink-2">
            <Spinner />
            <span>Tu IA está eligiendo la pregunta que sigue…</span>
            <Button type="button" variant="ghost" onClick={skipChoosing}>
              Seguir sin la IA
            </Button>
          </div>
        </section>
      );
    }
    if (view.kind === "cycle") {
      const { cycle } = view;
      const job = profile.experience.find((entry) => entry.id === cycle.experienceId);
      const context = job ? contextOf(job, jobs) : undefined;
      if (cycle.figure) {
        return (
          <QuestionCard context={context} text="¿Tenés una cifra, aunque sea aproximada?" receipt={receipt} onShowProfile={onShowProfile}>
            <FigureControl key={cycle.figure.factId} quote={cycle.figure.quote} onSubmit={(answer) => figureFor(cycle, answer)} error={error} />
          </QuestionCard>
        );
      }
      const type = ACHIEVEMENT_TYPES.find((entry) => entry.value === cycle.remaining[0]);
      // What was being typed for this kind, if the person left it half told.
      const key = `${cycle.gap.id}:${cycle.remaining[0] ?? ""}`;
      return (
        <QuestionCard
          context={context}
          text={`Contame lo ${type?.follow ?? "de eso"}: ¿qué hiciste y qué pasó?`}
          hint="Con tus palabras: qué hiciste, y qué cambió después."
          receipt={receipt}
          onShowProfile={onShowProfile}
        >
          <NarrativeControl
            key={key}
            label="Qué hiciste y qué pasó"
            initial={draftFor(profile, key)}
            note={RESUMED_NOTE}
            onDraft={(text) => updateStoredProfile((draft) => saveDraft(draft, key, text))}
            onSubmit={(text) => tellAchievement(cycle, text)}
          />
          <div>
            <Button type="button" variant="ghost" onClick={() => advance({ ...cycle, remaining: cycle.remaining.slice(1) })}>
              Saltar este
            </Button>
          </div>
        </QuestionCard>
      );
    }

    if (!asked || !handlers) {
      // The last answer of the session: nothing follows it, so it is looked at on its own before the session closes.
      if (!savedAnswer) return null;
      return (
        <section aria-labelledby="saved-title" className="space-y-5">
          <h2 id="saved-title" className="sr-only">
            Lo guardamos así
          </h2>
          {savedAnswer}
          <Button type="button" onClick={() => setSaved(null)}>
            Seguir
          </Button>
        </section>
      );
    }
    return (
      <QuestionCard
        context={asked.question.context}
        text={asked.question.text}
        hint={asked.question.hint}
        receipt={receipt}
        saved={savedAnswer}
        onUndo={undo ? restore : undefined}
        onShowProfile={onShowProfile}
        progress={progress}
        blocking={asked.gap.priority === "blocking"}
        // The three answers of these are in the question itself, with the same weight: there is no «No aplica» for them, because their «no» is that.
        onDefer={defersItself(asked.question) ? undefined : (state) => defer(asked.gap, state)}
        putOffLabel={defersItself(asked.question) ? (asked.question.control.kind === "renewal" ? "Todavía no" : "Ahora no") : undefined}
      >
        <QuestionBody key={asked.question.id + (asked.question.control.kind === "skeleton" ? asked.question.control.field : "")} question={asked.question} profile={profile} handlers={handlers} error={error} />
      </QuestionCard>
    );
  }

  if (closing) return null;
  return (
    <div ref={box} className="space-y-4">
      {heading}
      {main()}
      {/* Embedded, the cards of a question have their own «Ahora no», and a second one under it would be two ways of saying the same that do different things. */}
      {onExhausted && !(saved && !asked) && !(embedded && view.kind !== "cycle") ? (
        <Button type="button" variant="ghost" onClick={() => setView({ kind: "closed" })}>
          {dismissLabel}
        </Button>
      ) : null}
    </div>
  );
}
