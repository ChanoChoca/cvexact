"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Button, ButtonLink, PageHeading, Spinner, Textarea } from "@/components/ui";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/toast";
import { CrashGuard } from "@/components/ui/CrashGuard";
import { focusHeading } from "@/components/ui/focusHeading";
import { CVEditor } from "@/components/cv/CVEditor";
import { CVPreview, type PageFit } from "@/components/cv/CVPreview";
import { CondensedDiff } from "@/components/cv/CondensedDiff";
import {
  createCvMeasurer,
  cvFontsReady,
  sheetsHeightPx,
  type CvLayout,
  type CvMeasurer,
} from "@/components/cv/measure";
import { SheetsControl } from "@/components/cv/SheetsControl";
import { canAllowTwoSheets, type Sheets } from "@/lib/cv/sheets";
import { condenseCv } from "@/lib/cv/condense";
import type { CondensedLine, FitAnalysis } from "@/lib/cv/fit";
import { DownloadDocxButton } from "@/components/cv/DownloadDocxButton";
import { DownloadPdfButton } from "@/components/cv/DownloadPdfButton";
import { ReviewGate } from "@/components/cv/ReviewGate";
import { ExpiredCredentialsAlert, type CredentialSettle } from "@/components/cv/ExpiredCredentialsAlert";
import { credentialSettleFor } from "@/components/cv/credential-settle";
import { UnreviewedBlocksAlert } from "@/components/cv/UnreviewedBlocksAlert";
import { AiKeyPrompt } from "@/components/ai/AiKeyPrompt";
import {
  AnalysisPanel,
  CoveragePanel,
  FindingsPanel,
  InferredSkillsPanel,
} from "@/components/wizard/panels";
import { CorrectionsSection } from "@/components/wizard/CorrectionsSection";
import { ExtrasPanel } from "@/components/wizard/ExtrasPanel";
import { GenerationTip } from "@/components/wizard/GenerationTip";
import { InventedFigures } from "@/components/wizard/InventedFigures";
import { ProfileAskHeading } from "@/components/wizard/ProfileAskHeading";
import { MissingName } from "@/components/wizard/MissingName";
import { AnswerReceipt } from "@/components/onboarding/AnswerReceipt";
import { QuestionLoop } from "@/components/onboarding/QuestionLoop";
import { RequirementAskCard } from "@/components/wizard/RequirementAsk";
import { SkillReview } from "@/components/wizard/SkillReview";
import { UnsavedApplicationAlert } from "@/components/storage/UnsavedNotice";
import { ApiError, hasUntriedKeys } from "@/lib/api/client";
import { streamGenerator } from "@/lib/api/stream-client";
import { LimitReached, denialOf } from "@/components/billing/LimitReached";
import type { DenialReason } from "@/lib/api/client";
import { buildEvidenceIndex, findUnsupportedTerms } from "@/lib/ai/evidence";
import { askMetric, chooseRequirementAsk, type RequirementAsk } from "@/lib/jobs/requirement-ask";
import { readRequirements } from "@/lib/jobs/requirements";
import { answerOfferedConditions, answerOfferedCredential, countOffered, declineOffered, keepOffered, putOffOffered } from "@/lib/onboarding/answer";
import { eligibleGaps, type RuleId, type Signals } from "@/lib/onboarding/gaps";
import { restoreProfile, undoLastAnswer, type LastAnswer } from "@/lib/onboarding/last-answer";
import { reviewCounts } from "@/lib/onboarding/review";
import { lapsedCredentials } from "@/lib/profile/currency";
import { acceptInferredSkill } from "@/lib/profile/entities";
import { activeDeclined, declineThings, declinedBy, keepDeclined, vetoedSkills, withdrawDeclinedFor } from "@/lib/profile/declined";
import { recordMetric } from "@/lib/metrics/store";
import { beginSession, isSessionFresh, sessionOf } from "@/lib/onboarding/session";
import {
  applyCvResult,
  generateWithRecovery,
  isRecoverableFailure,
  type CVResponse,
} from "@/lib/applications/generation";
import { beginPendingGeneration, resolvePendingGeneration } from "@/lib/applications/pending";
import {
  countSpilledPdf,
  extremePreview,
  fitApplicationCv,
  fitReceipt,
  undoFit,
  type FitContext,
  type FitOutcome,
  type FitStore,
} from "@/lib/applications/fit";
import type { RemovedLine } from "@/lib/cv/fit";
import type { CvPdfCheck } from "@/lib/export/pdf-check";
import {
  useApplication,
  useApplicationsReady,
  useApplicationsStatus,
  useHydrated,
  useProfile,
  useSettings,
  useStoredProfile,
} from "@/lib/storage/hooks";
import {
  clearDraftJobText,
  getApplication,
  loadCachedAnalysis,
  loadCachedInferredSkills,
  loadDraftJobText,
  loadProfile,
  loadStoredProfile,
  newApplication,
  saveApplication,
  recordProviderNotes,
  saveCachedAnalysis,
  saveCachedInferredSkills,
  saveDraftJobText,
  StorageWriteError,
  saveProfile,
  updateStoredProfile,
  type Application,
  type SaveOutcome,
} from "@/lib/storage/local";
import { withEditedCV, withRestoredCV } from "@/lib/storage/applications/normalize";
import { keepDataQuietly } from "@/lib/storage/usage";
import { coverageAudit, inventedFigures, inventedFindings, verifyCV, type Finding } from "@/lib/ai/verify";
import { commit } from "@/lib/cv/edit";
import { cvContentHash } from "@/lib/cv/review-hash";
import { cvHasMetric, pickMetricsRole } from "@/lib/cv/metrics-role";
import { generatorKey } from "@/lib/profile/project";
import { normalizeForComparison } from "@/lib/text/normalize";
import type { CVDocument } from "@/lib/schemas/cv";
import type { InferredSkill, JobAnalysis } from "@/lib/schemas/job";
import type { Practical, Profile } from "@/lib/schemas/profile";
import type { DateValue } from "@/lib/profile/dates";
import { isMeaningfulExperience, type StoredProfile } from "@/lib/schemas/profile-v2";

/** Mirrors `Stage` in app/api/generate/cv/route.ts. */
type Stage = "analyzing" | "writing" | "checking";

const STAGE_LABEL: Record<Stage, string> = {
  analyzing: "Analizando la oferta…",
  writing: "Escribiendo tu CV…",
  checking: "Revisando que no falte nada…",
};

type Progress = {
  stage: Stage;
  /** Set when a provider fell over and another one picked the work up. */
  note?: string;
};

/**
 * The second round of a generation that stopped to ask which deduced skills are the person's: what the first one already
 * paid for, and the profile as the answers left it — the render this was called from still holds the one from before.
 */
type SkillsReviewed = { analysis: JobAnalysis; inferredSkills: InferredSkill[]; profile: Profile };

/**
 * The wait, said out loud.
 *
 * The elapsed count appears only once the wait is long enough to wonder about:
 * a timer that starts at zero on every click turns a five-second generation
 * into something that looks slow.
 */
function GenerationProgress({
  progress,
  elapsed,
  onCancel,
}: {
  progress: Progress;
  elapsed: number;
  onCancel: () => void;
}) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <div className="flex flex-wrap items-center gap-3.5">
        <span className="text-sm text-ink-2">{STAGE_LABEL[progress.stage]}</span>
        {elapsed >= 5 ? (
          <span className="font-mono text-[11px] tabular-nums tracking-[0.14em] text-ink-3">
            {elapsed}s
          </span>
        ) : null}
        <button
          type="button"
          onClick={onCancel}
          className="font-mono text-[11px] tracking-[0.14em] text-ink-3 underline underline-offset-4 hover:text-ink-1"
        >
          Cancelar
        </button>
      </div>
      {progress.note ? <p className="mt-2 text-xs text-ink-3">{progress.note}</p> : null}
    </div>
  );
}

/** The fourth round asks one thing and nothing else: whether the job the CV leaned on most is still going on. */
const CURRENT_JOB: ReadonlySet<RuleId> = new Set<RuleId>(["current_job_review"]);

/** When the CV came out short because the profile has little to put on it, one question: whether there is an internship, a project or an activity to list. */
const MORE_MATERIAL: ReadonlySet<RuleId> = new Set<RuleId>(["no_work_experience"]);
const SHORT_CV: Signals = { thin: true };

export function Wizard({
  applicationId,
  initialJobText,
}: {
  applicationId?: string;
  /** Del puente `/postular?desde=<id>` (`page.tsx`) — el `jdText` que la
   *  extensión o el import por URL ya dejaron en el tracker del servidor,
   *  para no repetir el copiar y pegar de siempre. */
  initialJobText?: string;
}) {
  const router = useRouter();
  const profile = useProfile();
  const storedProfile = useStoredProfile();
  const hydrated = useHydrated();
  const stored = useApplication(applicationId ?? "");
  /**
   * The applications come from the browser database now, which answers after
   * hydration. Until it has, an application that is not in the list yet is
   * "not loaded", not "not found".
   */
  const applicationsReady = useApplicationsReady();
  const applicationsStatus = useApplicationsStatus();
  const confirm = useConfirm();
  const toast = useToast();
  const settings = useSettings();
  /**
   * Whether the shortening step can even be offered: the person brought a key of
   * their own. The same condition `SettingsEditor` calls `usingOwnKey`, and the
   * same one `AiAvailability` reports.
   */
  const hasOwnKey = settings.entries.some((entry) => entry.provider && entry.apiKey.trim());
  const unsavedHere = stored ? applicationsStatus.unsaved.find((entry) => entry.id === stored.id) : undefined;

  /**
   * El borrador se lee una sola vez, cuando el cliente monta, y sólo mientras
   * se compone una postulación nueva: un `initialJobText` (viniendo de
   * `?desde=`) es más reciente que cualquier intento anterior sin terminar, y
   * una postulación guardada manda. Se lee en el inicializador y no en un
   * efecto para que el campo no se dibuje vacío un instante y después se
   * llene; el servidor renderiza el esqueleto (`if (!hydrated) return`), así
   * que no hay desajuste de hidratación.
   */
  const [jobText, setJobText] = useState(() => {
    if (initialJobText) return initialJobText;
    if (applicationId) return "";
    if (typeof window === "undefined") return "";
    return loadDraftJobText() ?? "";
  });
  /**
   * What the generation is doing, or null when nothing is running.
   *
   * This was a bare `busy` boolean and a spinner reading "Generando…" for the
   * whole wait. The wait itself is not the problem — writing a CV takes as long
   * as it takes — but an unexplained one is: a silent fallback to a second
   * provider and a silent second attempt at the document both look exactly like
   * a hang, and the reasonable thing to do about a hang is reload, which pays
   * for the generation twice.
   */
  const [progress, setProgress] = useState<Progress | null>(null);
  const busy = progress !== null;
  /** Lets the user stop a generation. `streamGenerator` takes the signal. */
  const abortRef = useRef<AbortController | null>(null);
  /**
   * The idempotency key of a generation whose connection failed in a way the
   * server may have survived (see `isRecoverableFailure`). «Reintentar» sends
   * the same key, so the server answers with the result it kept — or with a
   * 409 while it is still writing it — instead of writing and charging a
   * second CV.
   */
  const retryKeyRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The deduced skills the offer asks for, waiting for a yes or a no before the CV is written. See `SkillReview`. */
  const [review, setReview] = useState<{ skills: InferredSkill[]; reuseAnalysis: boolean } & Omit<SkillsReviewed, "profile"> | null>(null);
  /**
   * A draft or a profile change the browser would not store. Kept apart from
   * `error` on purpose: that one belongs to the generation and comes with a
   * «Reintentar» that asks the model again, and a save that failed is never a
   * reason to pay for a new CV.
   */
  const [saveError, setSaveError] = useState<string | null>(null);
  /**
   * A refusal over quota is not an error message, it is a fork in the road, and
   * a red toast saying so is the one shape that helps with neither branch.
   */
  const [denied, setDenied] = useState<DenialReason | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [fit, setFit] = useState<PageFit>("ok");
  /**
   * The profile as the CV on screen was made from it, or as it was when the person got to this page, written out: what a generator reads of it. Compared with
   * the profile now it says whether the CV is behind. A question put off, a date confirmed, a «no» say nothing of what a CV is made of and do not change it;
   * a job that ended, a task, a figure do. `null` until the profile is read.
   */
  const profileKey = useMemo(() => generatorKey(profile), [profile]);
  const [cvBasis, setCvBasis] = useState<string | null>(null);
  if (hydrated && cvBasis === null) setCvBasis(profileKey);
  const profileGrew = cvBasis !== null && cvBasis !== profileKey;
  /** The user dismissed the optional numbers question for this posting — "Ahora no", or it ran out on its own. */
  const [metricsDismissed, setMetricsDismissed] = useState(false);
  /** The same for the question of what else there is to list, which a short CV opens. */
  const [listingDismissed, setListingDismissed] = useState(false);
  /** The job whose figure the person said is real — «Es real: cargarla en mi perfil» — and is being asked for, and the figure (when they said it of one). */
  const [claim, setClaim] = useState<{ roleId: string; figure: string | null } | null>(null);
  const claimRole = claim?.roleId ?? null;
  /**
   * What the last answer given on this page did, with the way back: a round is gone as soon as it is answered, and what it did would go with it. It says it
   * where the round was, above whatever comes next, until the next answer.
   */
  const [roundReceipt, setRoundReceipt] = useState<{ receipt: string; undo: () => void } | null>(null);
  /**
   * What the last fit to one page did, with the way back — the same shape as
   * `roundReceipt`, and for the same reason: no change to the CV without being
   * told what it was, and none without a way to take it back (to-do §6.6).
   */
  const [fitNotice, setFitNotice] = useState<{
    receipt: string;
    undo: (() => void) | null;
    condensed: CondensedLine[];
  } | null>(null);
  /** Even `extreme` cannot make it fit: said where the button was, not swallowed. */
  const [fitImpossible, setFitImpossible] = useState(false);
  /** The posting's question was answered here: it does not come back as the next one while the application is being saved. */
  const [offerDone, setOfferDone] = useState(false);
  const [metricsNow] = useState(() => new Date());

  // The stored application is authoritative once it exists; the local jobText
  // only matters while composing a brand-new one.
  const effectiveJobText = stored?.jobText ?? jobText;
  const profileReady = profile.fullName.trim().length > 0;
  // A profile with a career in it and no name: the one blank the person can fill in right here,
  // instead of being sent to "load the profile" they have already loaded.
  const onlyNameMissing = !profileReady && (storedProfile.experience.some(isMeaningfulExperience) || storedProfile.education.length > 0);
  // What the CV is made of that nobody has looked at: jobs and studies read with doubts, and what two documents disagree on.
  // Said, not held back — it is the person's profile and the CV uses it as it stands — with the way to look at it.
  const toReview = reviewCounts(storedProfile);
  const unreviewed = toReview.doubtful + toReview.conflicts;
  // The credentials the CV would carry whose date has passed — and the licence, which a CV for an offer states. Said, not held back.
  const lapsed = useMemo(() => lapsedCredentials(storedProfile, metricsNow), [storedProfile, metricsNow]);

  const jobTextDirty = useRef(false);
  const jobTextRef = useRef(jobText);
  const jobTextPending = useRef(false);

  /**
   * El ref sólo alimenta la limpieza de desmontaje de más abajo, que necesita
   * el último texto aunque se haya creado al montar. Se escribe en un efecto y
   * no durante el render: un ref no forma parte de lo que se dibuja.
   */
  useEffect(() => {
    jobTextRef.current = jobText;
  }, [jobText]);

  // Quota exceeded is the realistic way this throws, and it happens on a timer
  // no one is watching — uncaught, it just vanishes into the console instead of
  // reaching the user, who loses the draft with no idea why.
  const persistDraftJobText = useCallback((text: string) => {
    try {
      saveDraftJobText(text);
      setSaveError(null);
    } catch (err) {
      setSaveError(err instanceof StorageWriteError ? err.message : "No pudimos guardar el borrador.");
    }
  }, []);

  useEffect(() => {
    if (!jobTextDirty.current || applicationId) return;
    jobTextPending.current = true;
    const timer = setTimeout(() => {
      jobTextPending.current = false;
      persistDraftJobText(jobText);
    }, 600);
    return () => clearTimeout(timer);
  }, [jobText, applicationId, persistDraftJobText]);

  useEffect(() => {
    return () => {
      if (jobTextPending.current) persistDraftJobText(jobTextRef.current);
    };
  }, [persistDraftJobText]);

  /**
   * Seconds since the current generation started.
   *
   * Keyed off `busy` rather than off `progress`, so a stage change does not
   * restart the count — the user is waiting for one CV, not for three stages.
   */
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    // Reset belongs to the click that starts a generation, not to this effect:
    // setting state in an effect body is a cascading render, and there is
    // nothing to synchronise until the timer is actually running.
    if (!busy) return;
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  const cancelGeneration = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // A generation the user has walked away from is one nobody is waiting for.
  // The route treats the closed connection as a cancellation and refunds it.
  useEffect(() => () => abortRef.current?.abort(), []);

  /**
   * One off-screen measurer for the whole screen (see `components/cv/measure.ts`):
   * the fitting engine calls it dozens of times per attempt, and each call would
   * otherwise mount a React root of its own. Torn down with the screen.
   */
  const measurerRef = useRef<CvMeasurer | null>(null);
  useEffect(
    () => () => {
      measurerRef.current?.dispose();
      measurerRef.current = null;
    },
    [],
  );
  const measurer = useCallback((): CvMeasurer => (measurerRef.current ??= createCvMeasurer()), []);

  /** Where a fit reads and writes the application: the same store every other action here uses. */
  const fitStore = useMemo<FitStore>(
    () => ({
      get: (id) => getApplication(id),
      save: (next) => saveApplication(next),
    }),
    [],
  );

  /**
   * Etapa 2, wired into the fit: the one call to the person's own model, over the
   * lines the engine picked, with none of what comes back trusted (§7).
   *
   * Without a key of their own it is not offered at all — the step exists to keep
   * material off the floor, and it must never be the reason our key is spent or
   * the CV reaches a provider the person did not choose. The route says the same
   * with a 403, which `condenseCv` reads as «no AI» and swallows.
   */
  const condenseForFit = useCallback(
    async (
      cv: CVDocument,
      options: { layout: CvLayout; analysis?: FitAnalysis; linesToGain: number },
    ): Promise<CondensedLine[]> => {
      if (!hasOwnKey) return [];
      return condenseCv(cv, {
        layout: options.layout,
        language: cv.language,
        linesToGain: options.linesToGain,
        profile,
        analysis: options.analysis,
      });
    },
    [hasOwnKey, profile],
  );

  /**
   * Everything a fit needs, for one application and one attempt. `limit` is the
   * height to reach — the engine's own, or a tighter one after a PDF that came
   * out long — and `allowExtreme` is the person's answer, never a default.
   */
  const fitContext = useCallback(
    (app: Application, options: { limit?: number; allowExtreme?: boolean } = {}): FitContext => ({
      profile,
      measurer: measurer(),
      fontsReady: () => (app.cv ? cvFontsReady(app.cv) : Promise.resolve(false)),
      store: fitStore,
      limit: options.limit,
      allowExtreme: options.allowExtreme,
      condense: condenseForFit,
      // The fallback engine has no room for a second copy of a CV (to-do §6.5).
      keepUndo: applicationsStatus.engine !== "legacy",
    }),
    [profile, measurer, fitStore, applicationsStatus.engine, condenseForFit],
  );

  /** Back to the CV from before the last fit. */
  const undoFitNow = useCallback(
    async (app: Application) => {
      const next = await undoFit(app, fitStore);
      if (!next) return;
      setFitNotice(null);
      toast({ tone: "good", message: "El CV volvió a como estaba antes del ajuste." });
    },
    [fitStore, toast],
  );

  /**
   * The receipt of a fit that happened: what came off, where it still is, and the
   * way back. `extra` is for the one sentence the PDF flow adds — that the file
   * was not handed over and the CV has to be downloaded again.
   */
  const announceFit = useCallback(
    (fitted: Extract<FitOutcome, { status: "fitted" }>, extra?: string) => {
      const what = fitReceipt(fitted.removed, fitted.condensed);
      setFitNotice({
        receipt: `${what}${extra ? ` ${extra}` : ""}${
          fitted.undoSaved ? "" : " Esta vez no vas a poder deshacerlo."
        }`,
        undo: fitted.application.fitUndo ? () => void undoFitNow(fitted.application) : null,
        condensed: fitted.condensed,
      });
      setFitImpossible(false);
    },
    [undoFitNow],
  );

  /**
   * Saves a change to the application on screen. Never throws, and the change
   * is on screen before it returns — see `saveApplication`.
   *
   * Built on the latest version in memory (`getApplication`), not on the copy
   * this render captured. The extras tabs call this when their generation
   * finishes, often thirty seconds after they were clicked; a render's copy
   * from before would have written back whatever the CV looked like then, over
   * every hand edit made while waiting.
   */
  const persist = useCallback(
    (patch: Partial<Application>): Promise<SaveOutcome> => {
      const current = stored ? (getApplication(stored.id) ?? stored) : undefined;
      if (!current) return Promise.resolve({ ok: true });
      return saveApplication({ ...current, ...patch });
    },
    [stored],
  );

  const generate = useCallback(
    async (options: { reuseAnalysis: boolean; retryKey?: string | null; reviewed?: SkillsReviewed }) => {
      /**
       * The application this CV belongs to. A first CV's does not exist yet,
       * so its id is chosen here, before the request: the idempotency marker
       * names it, and a result recovered after a crash lands on this same
       * record instead of creating a second one.
       */
      const targetId = stored?.id ?? crypto.randomUUID();

      /**
       * A plain hoisted function declaration, not the `useCallback`-bound
       * `generate` itself: the hooks linter (rightly) refuses to let a
       * `const` arrow function reference itself before its own declaration
       * finishes. Declaring it lets `attempt` call itself once more when the
       * chain ran out of budget with keys still unspent.
       *
       * `continuing` is never passed by a caller of `generate`; it exists so
       * the retry this triggers cannot itself trigger another one, which is
       * the cap the plan calls "no more than one automatic continuation per
       * click": the request already spent up to
       * `MAX_CANDIDATES_PER_GENERATION` calls proving those candidates dead,
       * and a chain that runs out twice in a row is telling the user
       * something a silent third attempt would hide.
       */
      async function attempt(options: {
        reuseAnalysis: boolean;
        continuing?: boolean;
        retryKey?: string | null;
        reviewed?: SkillsReviewed;
      }) {
        // What the request is made from: after the skills were answered, the profile as they left it.
        const sent = options.reviewed?.profile ?? profile;
        const controller = new AbortController();
        abortRef.current = controller;
        setProgress({
          stage: "analyzing",
          // Said out loud for the same reason a provider switch mid-generation
          // is: an unexplained second attempt looks exactly like a hang, and the
          // reasonable thing to do about a hang is reload and pay for it twice.
          note: options.continuing ? "Probando otra de tus keys…" : undefined,
        });
        setElapsed(0);
        setError(null);
        // The banner that says the CV is behind the profile is about to be answered: the CV
        // this makes is of the profile as it is now, and it is what the next one is compared with.
        setCvBasis(generatorKey(sent));
        setReview(null);
        // A new CV is a new answer to "does this need numbers?". Left dismissed, a
        // question the user waved off for the previous attempt would stay hidden
        // under a CV that may not have figures in it any more.
        setMetricsDismissed(false);
        setListingDismissed(false);

        const pending = beginPendingGeneration("cv", targetId, options.retryKey ?? undefined);
        retryKeyRef.current = null;

        // Only the model call is in here. Everything that stores the result
        // comes after, outside this `try`, on purpose: a CV the server has
        // already written — and charged for — used to be lost when the save
        // failed, because the save sat in this same `try` and its error came
        // out as «Ocurrió un error inesperado», with a «Reintentar» that asked
        // the model for a new one.
        let result: CVResponse;
        try {
          result = await generateWithRecovery(
            () =>
              streamGenerator<CVResponse>(
                "/api/generate/cv",
                {
                  profile: sent,
                  jobText: effectiveJobText,
                  /**
                   * Work the server would otherwise redo.
                   *
                   * Regenerating reuses this application's own analysis and derived
                   * skills, so the user is not charged for work that has not changed.
                   * A *first* generation has no application to read from yet, and
                   * falls back to what earlier ones derived from the same profile —
                   * `inferSkills` depends on nothing else, so recomputing it per
                   * application was a whole model call spent reproducing its own
                   * previous answer. See the derived-work cache in
                   * `lib/storage/local.ts`.
                   */
                  analysis:
                    options.reviewed?.analysis ??
                    (options.reuseAnalysis ? stored?.analysis : undefined) ??
                    loadCachedAnalysis(sent, effectiveJobText) ??
                    undefined,
                  inferredSkills:
                    options.reviewed?.inferredSkills ??
                    (options.reuseAnalysis ? stored?.inferredSkills : undefined) ??
                    loadCachedInferredSkills(sent) ??
                    undefined,
                  // What this posting vetoed, and what the person vetoed for every one: a skill they said they do not have is not deduced again.
                  rejectedSkills: [...new Set([...(stored?.rejectedSkills ?? []), ...vetoedSkills(loadStoredProfile())])],
                  // What the rendered page actually measured last time. Without it a
                  // regeneration resends an identical prompt and lands in the same
                  // place, which is what "Volver a generar" used to do.
                  previousFit: options.reuseAnalysis && fit !== "ok" ? fit : undefined,
                  // The excluding-requirements pre-flight is informational only here —
                  // the wizard generates straight away rather than stopping to ask.
                  acknowledgeExclusions: true,
                  // Asked once per application: the answer, or an application that already has its CV, is not asked again.
                  skillsReviewed: options.reviewed !== undefined || stored?.skillsReviewed === true,
                  // A second sheet, when the person allowed it: the budget the model writes to is two pages'.
                  sheets: stored?.sheets === 2 ? 2 : undefined,
                },
                {
                  signal: controller.signal,
                  idempotencyKey: pending.key,
                  onFrame: (frame) => {
                    if (frame.type === "stage") {
                      // The note belongs to the stage it happened in; a fallback
                      // during the analysis is not still news while the CV is being
                      // written.
                      setProgress({ stage: frame.stage as Stage });
                    } else if (frame.type === "switch") {
                      setProgress((current) =>
                        current ? { ...current, note: `${String(frame.to)} está terminando el trabajo.` } : current,
                      );
                    }
                  },
                },
              ),
            pending.key,
          );
        } catch (err) {
          // The user pressing Cancel is not an error to report back to them.
          if (err instanceof DOMException && err.name === "AbortError") {
            resolvePendingGeneration(pending.key);
            return;
          }
          // A connection that failed after the server may have finished keeps
          // its key for «Reintentar»; any other error means the server kept
          // nothing, and the marker has nothing left to recover.
          if (isRecoverableFailure(err)) retryKeyRef.current = pending.key;
          else resolvePendingGeneration(pending.key);
          // The chain sunk every candidate it touched to the end of Ajustes'
          // order before this reached here (see `recordProviderNotes` in
          // `@/lib/api/stream-client`), so a second call reaches keys the first
          // one never tried — the same thing "Reintentar" below does, minus the
          // click. Reuses the analysis exactly as that button does: a failure
          // partway through writing never got one of its own to reuse (see the
          // comment on the button), but a regeneration that failed still has the
          // successful one from before it.
          if (!options.continuing && hasUntriedKeys(err)) {
            await attempt({ reuseAnalysis: Boolean(stored?.analysis), continuing: true, reviewed: options.reviewed });
            return;
          }
          const denial = denialOf(err);
          if (denial) setDenied(denial);
          else setError(err instanceof ApiError ? err.message : "Ocurrió un error inesperado.");
          return;
        } finally {
          abortRef.current = null;
          setProgress(null);
        }

        // Cached against the profile they were derived from, so the next
        // application does not pay for them again. Best-effort by design: a
        // write that cannot fit never fails a generation that already
        // succeeded.
        saveCachedInferredSkills(sent, result.inferredSkills);
        saveCachedAnalysis(sent, effectiveJobText, result.analysis);

        // No CV yet: the server stopped to ask which of the skills it deduced are the person's. Nothing is stored and
        // nothing is left to recover; the answer starts the second round with the analysis this one paid for.
        if (result.skillReview) {
          resolvePendingGeneration(pending.key);
          setReview({
            skills: result.skillReview,
            analysis: result.analysis,
            inferredSkills: result.inferredSkills,
            reuseAnalysis: options.reuseAnalysis,
          });
          return;
        }

        // The CV exists from here on. Nothing below can ask the model again.
        setFindings(result.findings ?? []);
        recordProviderNotes(result.meta?.switches ?? []);

        const base =
          getApplication(targetId) ??
          stored ??
          newApplication(effectiveJobText, "Postulación", targetId);
        const applied = applyCvResult(base, result, effectiveJobText);

        /**
         * Before the first save, so the CV that reaches storage is the one that
         * fits: measuring it here — with the faces loaded, off-screen, the same
         * way the printer will — is what lets the person download a PDF that is
         * one sheet instead of discovering later that it is not. Best-effort by
         * design: a fit that cannot measure leaves the generated CV exactly as it
         * came, and never fails the generation.
         *
         * `normal` and `relaxed` are the levels this may reach on its own; the
         * `extreme` ones wait for the person's answer in the alert below.
         */
        const fitting = await fitApplicationCv(applied, fitContext(applied));
        const record = fitting.status === "fitted" ? fitting.application : applied;
        if (fitting.status === "fitted") {
          announceFit(fitting);
          /**
           * The panel reads the findings of the CV on screen, and the fit
           * recomputed them against the document it wrote: the stored ones name
           * positions (`sections[1].items[0].bullets[2]`) that every removal
           * shifted. Keeping the server's would point at lines that moved.
           */
          setFindings(record.findings ?? []);
        }

        // In memory — on screen, downloadable — before this line returns, so
        // navigating to the application's own URL finds it whatever the browser
        // decides about keeping it. A refusal shows up as `unsaved` on that
        // page, with a «Reintentar guardado» that retries the write only.
        const saving = saveApplication(record);
        if (!applicationId) router.replace(`/postular?app=${record.id}`);

        const outcome = await saving;
        if (outcome.ok) {
          resolvePendingGeneration(pending.key);
          // With a CV worth keeping, asked of the browser without a screen of its own: see `keepDataQuietly`.
          void keepDataQuietly();
          // The draft is the last trace of the posting until the application is
          // actually stored; it goes only then.
          if (!applicationId) {
            try {
              clearDraftJobText();
            } catch {
              // A stale draft is offered back next time — harmless.
            }
          }
        }
      }
      await attempt(options);
    },
    [profile, effectiveJobText, stored, applicationId, router, fit, fitContext, announceFit],
  );

  /**
   * A skill unchecked is a «no» with its day in the profile, for every posting: it is the same lines that would deduce it again. Checked
   * again, the veto is taken back wherever it was said — in the profile and in this posting.
   */
  const toggleSkill = useCallback(
    (skill: string, reject: boolean) => {
      if (!stored) return;
      if (reject) {
        updateStoredProfile((draft) => void declineThings(draft, "inferred_skill", [skill]));
        recordMetric("inferred_skill_vetoed");
        return;
      }
      updateStoredProfile((draft) => void withdrawDeclinedFor(draft, "inferred_skill", [skill]));
      const normalizedSkill = normalizeForComparison(skill);
      persist({ rejectedSkills: (stored.rejectedSkills ?? []).filter((s) => normalizeForComparison(s) !== normalizedSkill) });
    },
    [stored, persist],
  );

  /** «Solo para esta postulación» and «Para todas mis postulaciones»: where a veto holds. */
  const scopeSkill = useCallback(
    (skill: string, scope: "application" | "profile") => {
      if (!stored) return;
      const normalizedSkill = normalizeForComparison(skill);
      const current = stored.rejectedSkills ?? [];
      const here = current.some((s) => normalizeForComparison(s) === normalizedSkill);
      if (scope === "application") {
        updateStoredProfile((draft) => void withdrawDeclinedFor(draft, "inferred_skill", [skill]));
        persist({ rejectedSkills: here ? current : [...current, skill] });
        return;
      }
      updateStoredProfile((draft) => void declineThings(draft, "inferred_skill", [skill]));
      persist({ rejectedSkills: current.filter((s) => normalizeForComparison(s) !== normalizedSkill) });
    },
    [stored, persist],
  );

  /** «Escribir el CV»: the yeses become skills of the profile, the noes vetoes, and the second round reuses the analysis the first paid for. */
  const answerSkillReview = useCallback(
    (answers: { yes: InferredSkill[]; no: InferredSkill[] }) => {
      if (!review) return;
      updateStoredProfile((draft) => {
        for (const skill of answers.yes) acceptInferredSkill(draft, skill);
        if (answers.no.length > 0) declineThings(draft, "inferred_skill", answers.no.map((skill) => skill.skill));
      });
      answers.no.forEach(() => recordMetric("inferred_skill_vetoed"));
      const { analysis, inferredSkills, reuseAnalysis } = review;
      setReview(null);
      void generate({ reuseAnalysis, reviewed: { analysis, inferredSkills, profile: loadProfile() } });
    },
    [review, generate],
  );

  const canGenerate = useMemo(
    () => profileReady && effectiveJobText.replace(/\s+/g, " ").trim().length >= 30 && !busy,
    [profileReady, effectiveJobText, busy],
  );

  /**
   * What this session found, falling back to what was saved with the
   * application. Reopening a saved CV used to show an empty panel over a
   * document whose fabricated availability row was still on the page.
   */
  const [editError, setEditError] = useState<string | null>(null);
  /** The hand editor lives below the preview; its trigger is up in the action row. */
  const [editorOpen, setEditorOpen] = useState(false);

  /**
   * The stored document is the draft.
   *
   * An edit commits and persists, and `saveApplication` notifies subscribers
   * synchronously, so `stored.cv` is current by the time this renders again.
   * Mirroring it into local state would buy nothing and cost a reset effect on
   * every generation.
   */
  const shownCV = stored?.cv;

  /*
   * Qué CV se revisó, no «si se revisó» — y persistido, no en memoria.
   *
   * `reviewedCvHash` vive en el `Application` guardado (lib/storage/local.ts),
   * comparado contra `cvContentHash(shownCV)` en cada render. Volver a generar
   * o editar a mano cambia el contenido, así que el hash deja de matchear
   * solo. Que sobreviva a un reload no relaja la regla: mismo contenido,
   * misma confirmación. Lo que no sobrevive es a un cambio de contenido.
   */
  const reviewedCvHash = useMemo(
    () => (shownCV ? cvContentHash(shownCV) : undefined),
    [shownCV],
  );
  const reviewed = reviewedCvHash !== undefined && stored?.reviewedCvHash === reviewedCvHash;

  const confirmReview = useCallback(() => {
    if (!stored || reviewed || reviewedCvHash === undefined) return;
    persist({ reviewedCvHash });
  }, [stored, reviewed, reviewedCvHash, persist]);

  /**
   * An edit goes through `commit` before anything sees it: the schema is what
   * imposes the template's own rules, and it is also what every downstream
   * consumer re-parses against. A change it refuses is reported and dropped
   * rather than left in a state the PDF route would reject later.
   */
  const editCV = useCallback(
    (next: CVDocument) => {
      const result = commit(next, profile);
      if (!result.ok) {
        setEditError(result.message);
        return;
      }
      setEditError(null);
      const current = stored ? (getApplication(stored.id) ?? stored) : undefined;
      // The first edit keeps the generated CV as `cvOriginal`; see `withEditedCV`.
      if (current) void saveApplication(withEditedCV(current, result.cv));
    },
    [profile, stored],
  );

  const restoreGenerated = useCallback(() => {
    const current = stored ? (getApplication(stored.id) ?? stored) : undefined;
    const restored = current ? withRestoredCV(current) : null;
    if (!restored) return;
    setEditError(null);
    void saveApplication(restored);
  }, [stored]);

  /** The one question a PDF that will not fit ends on, with its consequence on the page count (§6.7). */
  const confirmDownloadAnyway = useCallback(
    (pages: number, sheets: Sheets = 1) =>
      confirm(
        sheets === 2
          ? `Este CV no entra en dos hojas sin quitar partes importantes. Descargarlo así incumple el límite de dos hojas que elegiste: el PDF tendrá ${pages} hojas. ¿Descargarlo igual?`
          : `Este CV no entra en una hoja sin quitar partes importantes. Descargarlo así incumple la meta de una sola hoja: el PDF tendrá ${pages} ${pages === 1 ? "hoja" : "hojas"}. ¿Descargarlo igual?`,
        { title: "Descargar igual", confirmLabel: "Descargar igual", cancelLabel: "No descargar" },
      ),
    [confirm],
  );

  /** Consent for `extreme`, asked once and in the person's own terms (§6.6). */
  const askExtreme = useCallback(
    (preview: RemovedLine[]) =>
      confirm(consentMessage(preview), {
        title: "Ajustar más",
        confirmLabel: "Ajustar más",
        cancelLabel: "Dejarlo así",
        confirmTone: "primary",
      }),
    [confirm],
  );

  /**
   * «Ajustar a una hoja»: the same engine, over the CV that is on screen now —
   * a hand-edited one included — and only because the person asked (§6.6).
   *
   * `extreme` is never walked without the confirm dialog in between: that level
   * takes quantified achievements, older studies and the summary, and the dialog
   * names each one instead of describing the idea of them.
   */
  const adjustToPage = useCallback(
    async (options: { limit?: number; allowExtreme?: boolean } = {}) => {
      const current = stored ? (getApplication(stored.id) ?? stored) : undefined;
      if (!current?.cv) return;
      const again = () => getApplication(current.id) ?? current;

      const outcome = await fitApplicationCv(current, fitContext(current, options));
      if (outcome.status === "fitted") {
        announceFit(outcome);
        return;
      }
      if (outcome.status === "impossible") {
        setFitImpossible(true);
        return;
      }
      if (outcome.status === "skipped") {
        toast({ tone: "warn", message: UNMEASURED });
        return;
      }
      if (outcome.status !== "needs-consent") return;
      if (!(await askExtreme(outcome.preview))) return;

      const deep = await fitApplicationCv(again(), fitContext(again(), { ...options, allowExtreme: true }));
      if (deep.status === "fitted") announceFit(deep);
      else if (deep.status === "impossible") setFitImpossible(true);
      else if (deep.status === "skipped") toast({ tone: "warn", message: UNMEASURED });
    },
    [stored, fitContext, announceFit, askExtreme, toast],
  );

  /**
   * What to do about a PDF the server says is not the one-sheet document this
   * product promises (§6.7). The bytes are still unsaved: this runs before
   * anything reaches the person's disk.
   *
   * A CV that measured right and printed long is fitted again at the next level,
   * against a limit tightened by the overflow the printer actually saw, and the
   * person is asked to download the new version — the hash changed, so it is a
   * version nobody has confirmed yet, which is exactly why it is not handed over
   * on this click.
   *
   * A typography the printer could not verify is a different failure: fitting
   * does not fix it, it does not spend one of the three checks, and the answer is
   * to try again — or, when the faces loaded but a character is not in them, to
   * take that character out.
   */
  const handleUnverifiedPdf = useCallback(
    async (info: CvPdfCheck): Promise<"download-anyway" | "stop"> => {
      const current = stored ? (getApplication(stored.id) ?? stored) : undefined;
      const cv = current?.cv;
      if (!current || !cv) return "download-anyway";

      // The file this click asked for is the one on screen: a preview the person
      // has since moved past has nothing to judge.
      if (shownCV && cvContentHash(shownCV) !== cvContentHash(cv)) {
        toast({ tone: "warn", message: "El CV cambió desde que se midió. Volvé a descargarlo." });
        return "stop";
      }

      if (!info.fontsLoaded || info.pdfFonts === "substituted") {
        toast({ tone: "warn", message: info.fontsLoaded ? substitutedFonts(info.missing, info.substitutedBy) : UNVERIFIED_FONTS });
        return "stop";
      }

      const pages = info.pages ?? 1;
      const sheets = current.sheets ?? 1;
      const overflowPx = info.heightPx === null ? 0 : Math.max(0, info.heightPx - sheetsHeightPx(sheets));
      const spill = await countSpilledPdf(current, fitStore, cv, { overflowPx });
      const again = () => getApplication(current.id) ?? spill.application;
      const notDownloaded = `El PDF salía en ${pages} ${pages === 1 ? "hoja" : "hojas"}, así que no lo bajamos. Ajustamos el CV: revisalo y volvé a descargar.`;

      if (spill.retry.kind === "tighten") {
        const fitted = await fitApplicationCv(
          again(),
          fitContext(again(), { limit: spill.retry.limit }),
        );
        if (fitted.status === "fitted") {
          announceFit(fitted, notDownloaded);
          return "stop";
        }
        return (await confirmDownloadAnyway(pages, sheets)) ? "download-anyway" : "stop";
      }

      if (spill.retry.kind === "consent") {
        const preview = extremePreview(again(), fitContext(again(), { limit: spill.retry.limit }));
        if (preview && (await askExtreme(preview))) {
          const deep = await fitApplicationCv(
            again(),
            fitContext(again(), { limit: spill.retry.limit, allowExtreme: true }),
          );
          if (deep.status === "fitted") {
            announceFit(deep, notDownloaded);
            return "stop";
          }
          if (deep.status === "skipped") {
            toast({ tone: "warn", message: UNMEASURED });
            return "stop";
          }
        }
      }

      return (await confirmDownloadAnyway(pages, sheets)) ? "download-anyway" : "stop";
    },
    [
      stored,
      shownCV,
      fitStore,
      fitContext,
      announceFit,
      askExtreme,
      confirmDownloadAnyway,
      toast,
    ],
  );

  /**
   * Re-checked against whatever is on screen. `verifyCV` is pure and already
   * runs in the browser — `CoveragePanel` imports from `lib/ai/evidence.ts` —
   * so an edit that fixes a finding makes it disappear without a round trip.
   * Falls back to what was stored for an application opened but not edited.
   */
  const shownFindings = useMemo(() => {
    if (shownCV && stored?.cvEdited) return verifyCV(shownCV, profile, stored.analysis);
    return findings.length > 0 ? findings : stored?.findings ?? [];
  }, [shownCV, stored, profile, findings]);

  // The numbers the CV states that the profile does not. Not read from what was stored or what came with the CV: where the CV
  // and the profile are is where to ask, so loading the figure into the profile — or taking the line out — is seen at once, and
  // a CV generated before this was checked is checked now. The panel above shows the rest; this is its own, with what to do.
  const invented = useMemo(() => (shownCV ? inventedFigures(shownCV, profile, stored?.analysis) : []), [shownCV, profile, stored?.analysis]);
  const panelFindings = useMemo(() => shownFindings.filter((finding) => finding.kind !== "invented_figure"), [shownFindings]);
  const gateFindings = useMemo(() => [...panelFindings, ...inventedFindings(invented)], [panelFindings, invented]);
  const canAskAbout = useCallback(
    (roleId: string) => eligibleGaps(storedProfile, sessionOf(storedProfile), metricsNow, { only: roleId }).length > 0,
    [storedProfile, metricsNow],
  );

  // A credential whose date has passed is settled where it is told of: with the CV in front, and not on another page. It is the question of the profile, and it is
  // kept the way the profile keeps it; what the person said before — «Todavía no» — is said back and not asked as if it had not been.
  const credentialSettle = useMemo<CredentialSettle>(() => credentialSettleFor(storedProfile, metricsNow), [metricsNow, storedProfile]);

  // «Es real»: the question is in the sidebar, which is under the CV on a phone and a page away from the line that was pressed on a screen: the person is taken to
  // it, and it is read out. It is the one thing here that moves the page, because they asked for it.
  const asks = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!claim) return;
    const box = asks.current;
    if (!box) return;
    box.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    focusHeading(box.querySelector<HTMLElement>("h1, h2"));
  }, [claim]);

  // A session this old is a new one: without this, a session's budget spent
  // during onboarding — possibly days ago — stays spent forever, since
  // nothing outside `DeepenSession` ever called `beginSession` to notice the
  // visit had ended. A no-op once a session is already fresh, so this never
  // resets a budget the person is still in the middle of spending here.
  //
  // Only when there is a session to begin, and never throwing. It used to write
  // the profile on every visit — a new `rev` and `updatedAt` for no change at
  // all — and on a browser with no room left that write threw inside this
  // effect, which took the whole page down to the error screen before the
  // person could see their CV. `updateStoredProfile` keeps a refused change
  // pending instead of throwing (see `pendingProfile` in `lib/storage/local`).
  useEffect(() => {
    if (!hydrated) return;
    if (isSessionFresh(loadStoredProfile())) return;
    updateStoredProfile((draft) => void beginSession(draft));
  }, [hydrated]);

  // Only offered when the CV came out with no number in it at all. A CV that
  // already has one does not need the interruption.
  //
  // `pickMetricsRole` picks *which* role, by how much the CV leaned on it
  // discounted by age — see `lib/cv/metrics-role.ts` — so a thin-but-current
  // job does not lose the ask to a heavier one from years ago, nor bury a
  // real present-day gap under an old role's word count. Whether that role
  // still has anything to give is a different question, and it belongs to
  // the gaps engine (`eligibleGaps`, the same rules the onboarding asks
  // by): a role the onboarding already covered, or one someone has already
  // answered this from a previous posting, comes back with nothing eligible
  // and this simply shows nothing — never a re-ask, and never a model call.
  //
  // `sessionOf(storedProfile)`, not `NO_SESSION`: this has to agree with
  // whatever budget `QuestionLoop` itself will check below, or the two can
  // disagree about whether there is anything left to ask — which is exactly
  // how this panel used to vanish the moment it rendered, against a session
  // the effect above had not yet had a chance to refresh.
  const storedCV = stored?.cv;
  const metricsRoleId = useMemo(() => {
    if (!storedCV || cvHasMetric(storedCV)) return null;
    const roleIndex = pickMetricsRole(storedCV, profile, metricsNow);
    const roleId = roleIndex === null ? undefined : profile.experience[roleIndex]?.id;
    if (!roleId) return null;
    return eligibleGaps(storedProfile, sessionOf(storedProfile), metricsNow, { only: roleId }).length > 0 ? roleId : null;
  }, [storedCV, profile, storedProfile, metricsNow]);

  // The fourth round, after the CV and never before it: the job the CV leaned on most, if it is going on and nobody has looked at it for months —
  // «¿Seguís en…?». It is where the CV is read first and where what the person has forgotten piles up, and it is the moment the question
  // makes sense to them: they have just seen what their profile says of that job.
  const reviewRoleId = useMemo(() => {
    if (!storedCV) return null;
    const roleIndex = pickMetricsRole(storedCV, profile, metricsNow);
    const roleId = roleIndex === null ? undefined : profile.experience[roleIndex]?.id;
    if (!roleId) return null;
    return eligibleGaps(storedProfile, sessionOf(storedProfile), metricsNow, { only: roleId, rules: CURRENT_JOB }).length > 0 ? roleId : null;
  }, [storedCV, profile, storedProfile, metricsNow]);
  const [reviewDismissed, setReviewDismissed] = useState(false);

  // The terms the coverage panel below is already offering for this posting — read the way it reads its rows — so that a tool is not asked in two places.
  const panelTerms = useMemo(() => {
    if (!shownCV) return [];
    const index = buildEvidenceIndex(profile);
    const analysis = stored?.analysis;
    const missing = analysis
      ? coverageAudit({ coverage: shownCV.coverage }, analysis).rows.filter((row) => !row.covered).map((row) => row.requirement)
      : shownCV.coverage.requirements.filter((entry) => !entry.covered).map((entry) => entry.requirement);
    return missing.flatMap((requirement) => findUnsupportedTerms(requirement, index));
  }, [shownCV, stored?.analysis, profile]);

  // The fifth round, after the CV like the others: of what the offer asks and the profile says nothing about, the one thing most worth knowing, if the
  // session still has room. Read from the offer's own words, with no model; one question for each posting, and not again once it was answered.
  const readings = useMemo(() => readRequirements(stored?.jobText ?? ""), [stored?.jobText]);
  const requirementAsk = useMemo(
    () =>
      storedCV && stored && !stored.requirementAskedAt && !offerDone
        ? chooseRequirementAsk({ requirements: readings, profile, stored: storedProfile, offered: panelTerms, now: metricsNow })
        : null,
    [storedCV, stored, offerDone, readings, profile, storedProfile, panelTerms, metricsNow],
  );

  // Which round is on, if any: the one of a figure the person said is real comes before the others, and otherwise it is the fourth, then the fifth, then the one
  // about numbers.
  const claiming = claimRole !== null;
  const reviewing = !claiming && reviewRoleId !== null && !reviewDismissed;
  const offering = !claiming && !reviewing && requirementAsk !== null;
  // The CV is short because there is nothing more to put on it (`thin_cv`): the thing to ask is what else the profile could list, and it comes before the one about numbers,
  // since a page with little on it needs lines more than it needs a figure in one of them. Only while the engine has that question to ask.
  const shortCv = useMemo(() => shownFindings.some((finding) => finding.kind === "thin_cv"), [shownFindings]);
  const moreToList = useMemo(
    () => shortCv && eligibleGaps(storedProfile, sessionOf(storedProfile), metricsNow, { rules: MORE_MATERIAL, signals: SHORT_CV }).length > 0,
    [shortCv, storedProfile, metricsNow],
  );
  const listing = !claiming && !reviewing && !offering && !listingDismissed && moreToList;
  const figuring = claiming || (!reviewing && !offering && !listing && !metricsDismissed && metricsRoleId !== null);

  // localStorage can be full, and these handlers run on a click rather than
  // inside `generate`'s try. Losing what the user just typed without saying so
  // is the one outcome worth writing a wrapper for.
  const persistProfile = useCallback((next: Profile) => {
    try {
      // What the wizard adds to the profile are the user's own answers to its questions.
      saveProfile(next, { origin: "answer" });
      setSaveError(null);
    } catch (err) {
      // A refused write keeps the change anyway (see `pendingProfile` in
      // `lib/storage/local`), so this says why it is not stored yet — without
      // the generation's «Reintentar», which would ask the model for a new CV.
      setSaveError(
        err instanceof StorageWriteError ? err.message : "No pudimos guardar tu perfil.",
      );
    }
  }, []);

  // A gap the user says they do have goes into the profile, not just into this
  // application: the same hole would otherwise reappear on every posting that
  // asks for it. The sentence they wrote becomes a bullet, because a bare tag
  // is weak evidence and the CV prompt cannot build a line out of one.
  const claimGap = useCallback(
    (terms: string[], where: string, jobId: string | null, taken: string[] = terms) => {
      const fresh = (existing: string[]) => {
        const known = new Set(existing.map(normalizeForComparison));
        return terms.filter((t) => !known.has(normalizeForComparison(t)));
      };

      // The role the panel's chips picked, when there was one to pick. With no
      // roles at all — or none chosen — it goes to the profile-level fields,
      // which the evidence index reads just the same: losing the answer would
      // be the worst outcome, never worth blocking on a choice.
      const target = jobId ? profile.experience.find((role) => role.id === jobId) : undefined;

      persistProfile(
        target
          ? {
              ...profile,
              experience: profile.experience.map((role) =>
                role.id === target.id
                  ? { ...role, bullets: [...role.bullets, where], tags: [...role.tags, ...fresh(role.tags)] }
                  : role,
              ),
            }
          : {
              ...profile,
              skills: [...profile.skills, ...fresh(profile.skills)],
              extras: [...profile.extras, where],
            },
      );
      // They did use it after all: a «no» they had said to it is taken back, wherever it was named.
      updateStoredProfile((draft) => void withdrawDeclinedFor(draft, "requirement", taken));
      recordMetric("requirement_claimed");
    },
    [profile, persistProfile],
  );

  /** «No lo tengo»: a «no» with its day, kept in the profile — not asked again in the next posting that asks for the same thing. */
  const declineGap = useCallback((terms: string[], requirement: string) => {
    updateStoredProfile((draft) => void declineThings(draft, "requirement", terms, { quote: requirement }));
    recordMetric("requirement_declined");
  }, []);

  /** The second asking, answered: it was asked once more, and it is not asked a third time. */
  const keepGap = useCallback((terms: string[]) => {
    updateStoredProfile((draft) => {
      for (const term of terms) {
        const entry = declinedBy(draft, "requirement", term);
        if (entry) keepDeclined(draft, entry.id);
      }
    });
  }, []);

  // The person's own roles, to ask which one a tool or a task belongs to: the question never guesses.
  const jobOptions = useMemo(
    () => profile.experience.map((job) => ({ id: job.id, label: [job.role, job.company].filter(Boolean).join(" · ") || "Sin nombre" })),
    [profile],
  );

  /**
   * The posting's question, dealt with — yes, no or not now: counted by what it asked and what was said, not asked again in this posting, and said, with the way
   * back: `before` is the profile as it was before the answer, and taking it back gives the question to the posting again.
   */
  const finishOffer = useCallback(
    (ask: RequirementAsk, outcome: "done" | "no" | "later", said: string, before: StoredProfile) => {
      recordMetric(askMetric(ask.type, outcome));
      setOfferDone(true);
      void persist({ requirementAskedAt: new Date().toISOString() });
      setRoundReceipt({
        receipt: said,
        undo: () => {
          restoreProfile(before);
          void persist({ requirementAskedAt: undefined });
          setOfferDone(false);
          setRoundReceipt(null);
        },
      });
    },
    [persist],
  );

  /**
   * The answer to a question about the profile, said where the question was: a round is gone as soon as it is answered — it asks only while there is something
   * to ask, and the answer ends that. Taking it back gives the profile as it was, and the round is there again because there is something to ask again.
   */
  const sayRound = useCallback((last: LastAnswer) => {
    setRoundReceipt({
      receipt: last.receipt,
      undo: () => {
        undoLastAnswer(last);
        setReviewDismissed(false);
        setMetricsDismissed(false);
        setListingDismissed(false);
        setRoundReceipt(null);
      },
    });
  }, []);

  const claimOffered = useCallback(
    (ask: RequirementAsk, where: string, jobId: string | null) => {
      const before = loadStoredProfile();
      // A tool is also a tag of the role it was used in; a task is only the line they wrote.
      claimGap(ask.kind === "tool" ? [ask.thing] : [], where, jobId, [ask.thing]);
      updateStoredProfile((draft) => void countOffered(draft));
      finishOffer(ask, "done", "Lo anotamos en tu perfil, con tus palabras.", before);
    },
    [claimGap, finishOffer],
  );

  const credentialOffered = useCallback(
    (ask: RequirementAsk, values: { name: string; expires?: DateValue }) => {
      const before = loadStoredProfile();
      const result = { kept: false };
      updateStoredProfile((draft) => void (result.kept = answerOfferedCredential(draft, values, ask.thing)));
      if (!result.kept) return;
      recordMetric("requirement_claimed");
      finishOffer(ask, "done", "Guardado en tu perfil, como algo tuyo.", before);
    },
    [finishOffer],
  );

  const conditionsOffered = useCallback(
    (ask: RequirementAsk, answer: Partial<Practical>) => {
      const before = loadStoredProfile();
      const result = { kept: false };
      updateStoredProfile((draft) => void (result.kept = answerOfferedConditions(draft, answer, ask.thing)));
      if (!result.kept) return;
      recordMetric("requirement_claimed");
      finishOffer(ask, "done", "Anotado. Lo podés cambiar cuando quieras desde tu perfil.", before);
    },
    [finishOffer],
  );

  const declineOfferedAsk = useCallback(
    (ask: RequirementAsk) => {
      const before = loadStoredProfile();
      updateStoredProfile((draft) => void declineOffered(draft, ask.thing, ask.fragment));
      recordMetric("requirement_declined");
      finishOffer(ask, "no", "Queda anotado en tu perfil y no te lo volvemos a preguntar por ahora.", before);
    },
    [finishOffer],
  );

  const keepOfferedAsk = useCallback(
    (ask: RequirementAsk) => {
      const before = loadStoredProfile();
      updateStoredProfile((draft) => void keepOffered(draft, ask.thing));
      finishOffer(ask, "no", "Queda como lo dijiste, y no te lo volvemos a preguntar.", before);
    },
    [finishOffer],
  );

  const putOffOfferedAsk = useCallback(
    (ask: RequirementAsk) => {
      const before = loadStoredProfile();
      updateStoredProfile((draft) => void putOffOffered(draft));
      finishOffer(ask, "later", "Lo dejamos para después: en esta postulación no te lo volvemos a preguntar.", before);
    },
    [finishOffer],
  );

  if (!hydrated || (applicationId && !applicationsReady)) {
    return <p className="text-sm text-ink-3">Cargando…</p>;
  }

  // Used to fall through to an empty paste box under an application URL, which
  // looked like the CV had been wiped. Said plainly instead — and if a result
  // is still being recovered for this id (see `recoverPendingGenerations`), the
  // application appears here on its own once it lands.
  if (applicationId && !stored) {
    return (
      <div className="space-y-8">
        <PageHeading eyebrow="Postulación" title="No encontramos esta postulación">
          No está guardada en este navegador. Si la generaste en otro celular o computadora, o se borraron los datos
          de este sitio, la vas a encontrar donde hayas hecho una copia: en tu cuenta o en un archivo.
        </PageHeading>
        <div className="flex flex-wrap gap-3">
          <ButtonLink href="/postular" className="px-6 py-3">
            Nueva postulación
          </ButtonLink>
          <ButtonLink href="/postulaciones" variant="secondary" className="px-6 py-3">
            Ver mis postulaciones
          </ButtonLink>
        </div>
      </div>
    );
  }

  return (
    // The paste step is one column and stays at the panel's narrow width; once
    // there is a CV the page grows a preview and a sidebar and needs the room.
    <div className="space-y-10" data-panel={stored?.cv ? "wide" : undefined}>
      <PageHeading
        eyebrow={stored?.cv ? "Paso 2 de 3" : "Paso 1 de 3"}
        title={stored?.label || "Nueva postulación"}
        action={
          applicationId ? (
            <ButtonLink href="/postular" variant="secondary" className="px-6 py-3">
              Nueva postulación
            </ButtonLink>
          ) : undefined
        }
      >
        Pegá la oferta completa. Cuanto más texto, mejor se adapta el CV.
      </PageHeading>

      {/*
       * Used to be a wall: no profile, no textarea, full stop — which threw
       * away whatever the person had just pasted from their clipboard the
       * moment they hit this page first. `canGenerate` already keeps
       * generation blocked without a profile, so the only thing this adds is
       * letting the paste happen — it's caught by the same draft mechanism
       * that already saves it while composing (see the effect below), so the
       * text is still here after a trip to `/perfil` and back.
       */}
      {!profileReady && !stored?.cv ? (
        onlyNameMissing ? (
          <Alert tone="info" title="Falta tu nombre">
            Tu perfil ya tiene tu recorrido; el CV necesita tu nombre para el encabezado. Pegá igual el aviso si querés — no se pierde.
            <div className="mt-3">
              <MissingName />
            </div>
          </Alert>
        ) : (
          <Alert tone="info" title="Para generar hace falta tu perfil">
            Pegá igual el aviso si querés — no se pierde. Cargá tu perfil{" "}
            <Link href="/perfil" className="underline underline-offset-4 hover:text-ink">
              acá
            </Link>{" "}
            y volvé; el aviso te va a estar esperando.
          </Alert>
        )
      ) : null}

      {profileReady && !stored?.cv ? <UnreviewedBlocksAlert count={unreviewed} /> : null}
      {profileReady && !stored?.cv ? <ExpiredCredentialsAlert reviews={lapsed} settle={credentialSettle} /> : null}

      {!stored?.cv ? (
        <div>
          <Textarea
            data-tour="aviso"
            rows={7}
            value={jobText}
            onChange={(e) => {
              jobTextDirty.current = true;
              setJobText(e.target.value);
            }}
            onKeyDown={(e) => {
              // The hint next to the button promises this works.
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canGenerate) {
                e.preventDefault();
                generate({ reuseAnalysis: false });
              }
            }}
            placeholder="Pegá acá el aviso: título, empresa, requisitos, responsabilidades, horario…"
            className="mt-2 min-h-34 resize-y border-t border-b py-6"
          />
          <div className="mt-7 flex flex-wrap items-center gap-5.5" data-tour="generar">
            <Button
              className="px-7 py-3.5"
              disabled={!canGenerate}
              aria-busy={busy}
              onClick={() => generate({ reuseAnalysis: false })}
            >
              {busy ? <Spinner /> : null}
              {busy ? "Generando…" : "Generar CV"}
              {/* The shortcut sits on the button it presses, and only while it works. */}
              {canGenerate ? (
                <span aria-hidden className="font-mono text-[11px] font-normal tracking-[0.14em] opacity-70">
                  ⌘ ↵
                </span>
              ) : null}
            </Button>
            {progress ? (
              <GenerationProgress progress={progress} elapsed={elapsed} onCancel={cancelGeneration} />
            ) : jobText.trim().length < 30 ? (
              <span className="font-mono text-[11px] tracking-[0.14em] text-ink-3">
                Pegá el texto de la oferta
              </span>
            ) : onlyNameMissing ? (
              <span className="font-mono text-[11px] tracking-[0.14em] text-ink-3">
                Falta tu nombre para generar
              </span>
            ) : !profileReady ? (
              <Link
                href="/perfil"
                className="font-mono text-[11px] tracking-[0.14em] text-oro underline underline-offset-4"
              >
                Cargá tu perfil para generar →
              </Link>
            ) : null}
          </div>
          {/* Whether this will work, before the button is pressed: without a key it answers "no hay IA" only after, and the key is two minutes away.
              Not once the server has refused: `LimitReached` below makes the same offer, and two of them stacked say it twice. */}
          {profileReady && !denied ? (
            <AiKeyPrompt className="mt-5">Para generar el CV necesitás una key.</AiKeyPrompt>
          ) : null}
          {progress ? <GenerationTip /> : null}
          {review ? (
            <div className="mt-5">
              <SkillReview skills={review.skills} onDone={answerSkillReview} />
            </div>
          ) : null}
        </div>
      ) : null}

      {denied ? (
        <div className="mt-6">
          <LimitReached reason={denied} onResolved={() => setDenied(null)} />
        </div>
      ) : null}

      {error ? (
        <Alert tone="bad">
          {error}{" "}
          {/* Reuses the analysis when one exists on this application — a
              failure partway through writing the CV never got to cache one
              of its own (see `generate`), so there is nothing to reuse on a
              first attempt, but a regeneration that failed still has the
              successful one from before it. */}
          <button
            type="button"
            onClick={() =>
              generate({ reuseAnalysis: Boolean(stored?.analysis), retryKey: retryKeyRef.current })
            }
            className="underline underline-offset-4 hover:text-ink"
          >
            Reintentar
          </button>
        </Alert>
      ) : null}

      {saveError ? <Alert tone="warn">{saveError}</Alert> : null}

      {unsavedHere ? <UnsavedApplicationAlert entry={unsavedHere} /> : null}

      {stored?.cv && shownCV ? (
        <>
          {/*
           * The CV measured longer than a sheet: the fix is here, one click, over
           * the CV that is on screen — not «volvé a generar», which asked the
           * model for a new document and charged for it. The engine measures,
           * removes what weighs least for *this* posting and stops as soon as it
           * fits; what it took off is in the receipt, stays in the profile and
           * can always be put back (§6.6).
           *
           * `fit` is still threaded into a regeneration as `previousFit`, for
           * whoever picks «Generar otra versión» instead.
           */}
          {fit === "over" ? (
            <Alert tone="warn" title={stored.sheets === 2 ? "El CV no entra en dos hojas" : "El CV no entra en una hoja"}>
              Se desborda a {stored.sheets === 2 ? "una tercera" : "una segunda"} página. Podemos acortar o quitar lo de menor peso para este
              aviso; todo sigue en tu perfil.{" "}
              {fitImpossible ? (
                <>
                  Aun quitando lo prescindible no entra. Probá «Generar otra versión» o editá el CV a
                  mano.
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => void adjustToPage()}
                  className="underline underline-offset-4 hover:text-ink"
                >
                  Ajustar a {stored.sheets === 2 ? "dos hojas" : "una hoja"}
                </button>
              )}
            </Alert>
          ) : null}

          {/* How many sheets: one unless the person said two, offered only to ten years of work or more. */}
          <SheetsControl
            sheets={stored.sheets ?? 1}
            offered={canAllowTwoSheets(profile)}
            onChange={(sheets) => void persist({ sheets: sheets === 2 ? 2 : undefined })}
          />

          {/* What the last fit did, with the way back: the same line an answer gets. */}
          {fitNotice ? (
            <div className="space-y-3">
              <AnswerReceipt receipt={fitNotice.receipt} onUndo={fitNotice.undo ?? undefined} />
              {/* What was shortened, word by word: the only check that can catch a meaning that moved. */}
              <CondensedDiff lines={fitNotice.condensed} />
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0 space-y-3">
              <FindingsPanel findings={panelFindings} />
              {shownCV ? (
                <InventedFigures
                  cv={shownCV}
                  profile={profile}
                  invented={invented}
                  now={metricsNow}
                  canAsk={canAskAbout}
                  onAsk={(roleId, figure) => setClaim({ roleId, figure })}
                  onEdit={editCV}
                />
              ) : null}

              {/* Everything you can do with the finished CV, in one row: get it
                  out, change it, or ask for another one. Seeing it full size is
                  the exception — that one belongs on the page itself.
                  PDF is the one primary action; the rest recede in the order
                  someone reaches for them, and "Generar otra versión" sits
                  across a rule of its own — it throws away this version, so
                  it should never be the button a stray click lands on. */}
              <ReviewGate findings={gateFindings} reviewed={reviewed} />
              {/* The CV about to be handed over carries a credential whose date has passed: said here too, where it is downloaded, and settled here. */}
              <ExpiredCredentialsAlert reviews={lapsed} settle={credentialSettle} />

              <div className="flex flex-wrap items-center gap-2" data-tour="descargas">
                <DownloadPdfButton
                  payload={{ kind: "cv", data: shownCV, label: stored.label, sheets: stored.sheets ?? 1 }}
                  fallbackHref={`/cv/${stored.id}/print`}
                  onUnverified={handleUnverifiedPdf}
                  confirm={
                    reviewed
                      ? undefined
                      : { label: "Confirmar y descargar PDF", onConfirm: confirmReview }
                  }
                />
                <DownloadDocxButton
                  data={shownCV}
                  label={stored.label}
                  confirm={
                    reviewed
                      ? undefined
                      : { label: "Confirmar y descargar Word", onConfirm: confirmReview }
                  }
                />
                <Button variant="ghost" onClick={() => setEditorOpen(true)}>
                  Editar el CV a mano
                </Button>
                {stored.cvEdited ? (
                  <span className="text-xs text-ink-3">Editado por vos.</span>
                ) : null}
                <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">
                  {progress ? (
                    <GenerationProgress progress={progress} elapsed={elapsed} onCancel={cancelGeneration} />
                  ) : null}
                  <Button
                    variant="secondary"
                    disabled={busy}
                    aria-busy={busy}
                    onClick={() => generate({ reuseAnalysis: true })}
                  >
                    {busy ? <Spinner /> : null}
                    {busy ? "Regenerando…" : "Generar otra versión"}
                  </Button>
                </div>
              </div>
              {progress ? <GenerationTip /> : null}
              {review ? <SkillReview skills={review.skills} onDone={answerSkillReview} /> : null}
              {/* O11, switched off: what was changed by hand that the profile does not say, offered to it once — after the editing, never during it. */}
              <CorrectionsSection
                application={stored}
                cv={shownCV}
                profile={profile}
                editorOpen={editorOpen}
                canAsk={canAskAbout}
                onAsk={(roleId) => setClaim({ roleId, figure: null })}
                onEdit={editCV}
              />
              <div data-tour="revision">
                <CrashGuard
                  title="No pudimos mostrar el CV"
                  hint="Los botones de arriba siguen funcionando: podés descargarlo igual, o volver a generar."
                >
                  <CVPreview
                    data={shownCV}
                    sheets={stored.sheets ?? 1}
                    onFitChange={setFit}
                    fullSizeHref={`/cv/${stored.id}/print`}
                  />
                </CrashGuard>
              </div>
              {/*
               * The persistent half of «Deshacer»: the receipt above is a
               * message, and this is the offer that survives a reload. Shown only
               * while the stored copy still names the CV on the page — an edit, a
               * regeneration or another fit replaces it, and the schema drops a
               * copy whose hash no longer matches (see `normalizeStoredApplication`).
               */}
              {stored.fitUndo && stored.fitUndo.fittedHash === cvContentHash(shownCV) ? (
                <button
                  type="button"
                  onClick={() => void undoFitNow({ ...stored, cv: shownCV })}
                  className="text-xs text-ink-3 underline underline-offset-4 hover:text-ink"
                >
                  Deshacer el ajuste a una hoja
                </button>
              ) : null}
              <CrashGuard title="El editor no pudo abrirse">
                <CVEditor
                  cv={shownCV}
                  onChange={editCV}
                  onRestore={stored.cvOriginal ? restoreGenerated : undefined}
                  edited={stored.cvEdited ?? false}
                  error={editError}
                  open={editorOpen}
                  onClose={() => setEditorOpen(false)}
                  profile={profile}
                />
              </CrashGuard>
            </div>

            <div className="min-w-0 space-y-4">
              {stored.analysis ? (
                <AnalysisPanel analysis={stored.analysis} profile={profile} />
              ) : null}

              {profileGrew ? (
                <Alert tone="good" title="Tu perfil se actualizó">
                  <p>Este CV se hizo antes de eso. Generá otra versión para que lo aproveche.</p>
                  <div className="mt-3">
                    <Button variant="secondary" disabled={busy} aria-busy={busy} onClick={() => generate({ reuseAnalysis: true })}>
                      {busy ? <Spinner /> : null}
                      {busy ? "Regenerando…" : "Generar otra versión"}
                    </Button>
                  </div>
                </Alert>
              ) : null}

              {/*
               * What the profile is asked, one round at a time and after the CV, never before it: is the job the CV leaned on most still going on; the one thing
               * the offer asks and the profile says nothing about; and, when the CV came out with no figure, the one about numbers — or the one of a figure the
               * person said is real, whatever they said to the others. A round that is started is not cut by the answer to a question of its own, and none waits
               * on an answer.
               */}
              {reviewing || offering || roundReceipt || listing || figuring ? (
                <div ref={asks} className="space-y-4">
                  {/* What the last answer did, above whatever is asked next: the round that asked it is gone. */}
                  {roundReceipt ? <AnswerReceipt receipt={roundReceipt.receipt} onUndo={roundReceipt.undo} /> : null}
                  {reviewing ? (
                    <QuestionLoop
                      key={`review-${reviewRoleId}`}
                      profile={storedProfile}
                      now={metricsNow}
                      only={reviewRoleId ?? undefined}
                      rules={CURRENT_JOB}
                      embedded
                      heading={<ProfileAskHeading />}
                      onAnswered={sayRound}
                      onExhausted={() => setReviewDismissed(true)}
                    />
                  ) : null}

                  {offering && requirementAsk ? (
                    <div className="space-y-3">
                      <ProfileAskHeading />
                      <RequirementAskCard
                        key={`offer-${requirementAsk.kind}-${requirementAsk.thing}`}
                        ask={requirementAsk}
                        jobs={jobOptions}
                        now={metricsNow}
                        onClaim={(where, jobId) => claimOffered(requirementAsk, where, jobId)}
                        onCredential={(values) => credentialOffered(requirementAsk, values)}
                        onConditions={(answer) => conditionsOffered(requirementAsk, answer)}
                        onDecline={() => declineOfferedAsk(requirementAsk)}
                        onKeep={() => keepOfferedAsk(requirementAsk)}
                        onLater={() => putOffOfferedAsk(requirementAsk)}
                      />
                    </div>
                  ) : null}

                  {listing ? (
                    <QuestionLoop
                      key="listing"
                      profile={storedProfile}
                      now={metricsNow}
                      rules={MORE_MATERIAL}
                      signals={SHORT_CV}
                      embedded
                      heading={<ProfileAskHeading about="Tu CV salió corto porque tu perfil tiene poco para este aviso. Lo que agregás acá queda en tu perfil." />}
                      onAnswered={sayRound}
                      onExhausted={() => setListingDismissed(true)}
                    />
                  ) : null}

                  {figuring ? (
                    <QuestionLoop
                      key={claimRole ?? "metrics"}
                      profile={storedProfile}
                      now={metricsNow}
                      only={claimRole ?? metricsRoleId ?? undefined}
                      embedded
                      heading={<ProfileAskHeading about={claim?.figure ? `Para cargar «${claim.figure}» en tu perfil, contanos de este puesto con tus palabras.` : undefined} />}
                      onAnswered={sayRound}
                      onExhausted={() => (claimRole ? setClaim(null) : setMetricsDismissed(true))}
                    />
                  ) : null}
                </div>
              ) : null}

              <CoveragePanel
                coverage={shownCV.coverage}
                analysis={stored.analysis}
                profile={profile}
                dismissed={stored.dismissedGaps ?? []}
                declined={activeDeclined(storedProfile, "requirement")}
                now={metricsNow}
                onClaim={claimGap}
                onDecline={declineGap}
                onKeep={keepGap}
              />
              <InferredSkillsPanel
                skills={stored.inferredSkills ?? []}
                rejected={stored.rejectedSkills ?? []}
                vetoed={vetoedSkills(storedProfile)}
                onToggle={toggleSkill}
                onScope={scopeSkill}
              />
            </div>
          </div>

          {stored.analysis ? (
            <div className="border-t border-rule pt-8">
              {/*
               * The eyebrow up top promises three steps and used to stop
               * counting at two — the extras below are the third, but arriving
               * as an unlabeled row of tabs after the download buttons made
               * them read as an appendix. Most of what this product writes
               * lives past this line: the form answers, the email, the
               * interview prep. Naming it is the difference between someone
               * downloading the PDF and leaving, and someone finding the rest.
               */}
              <p className="mb-1 font-solar text-[12.5px] font-bold tracking-[0.18em] text-oro uppercase">
                Paso 3 de 3
              </p>
              <p className="mb-5 text-[14.5px] text-ink-2">
                Tu CV está listo. Esto es lo demás de la postulación: respuestas del
                formulario, el email de presentación y la entrevista.
              </p>
              <CrashGuard
                title="No pudimos mostrar esta sección"
                hint="El CV de arriba no se vio afectado."
              >
                <ExtrasPanel application={stored} profile={profile} onSaved={persist} />
              </CrashGuard>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** Said when the fit could not even measure: the CV is untouched. */
const UNMEASURED = "No pudimos medir el CV ahora mismo. Probá de nuevo en un momento.";
/** Said when the printer could not confirm the typography: fitting does not fix it (§6.7). */
const UNVERIFIED_FONTS = "No pudimos verificar la tipografía del PDF. Probá de nuevo en un momento.";
// Loaded but not in the file: a character the typography lacks. A retry prints the same PDF.
const substitutedFonts = (missing: string[] = [], substitutedBy: string[] = []) =>
  missing.length > 0
    ? `La tipografía del CV no tiene ${missing.length === 1 ? "este carácter" : "estos caracteres"}: ${missing.join(" ")}. Sacalo y volvé a descargar.`
    : `El PDF salió con otra tipografía${substitutedBy.length > 0 ? ` (${substitutedBy.join(", ")})` : ""} sin que haya un símbolo raro en el CV. Probá de nuevo; si sigue igual, avisanos con este mensaje.`;

/**
 * What `extreme` would take, said item by item (§6.6).
 *
 * Specific on purpose: the person is deciding about lines they can recognize —
 * «2 líneas», «el puesto completo «X» (2014–2016)», «el resumen entero» — and a
 * dialog that said «hay que quitar más cosas» would be asking for consent to
 * something unnamed. When the list includes `T5` the warning is the strongest
 * one this product writes, because that is the only line evidencing a
 * requirement the posting calls excluding.
 */
function consentMessage(preview: RemovedLine[]): string {
  const lines = preview.filter(
    (line) => line.kind === "bullet" || line.kind === "skill" || line.kind === "pair" || line.kind === "project" || line.kind === "activity",
  );
  const jobs = preview.filter((line) => line.kind === "job");
  const studies = preview.filter((line) => line.kind === "study");
  const wholeSummary = preview.some((line) => line.kind === "summary");

  const cited = [
    lines.length > 0
      ? `${lines.length} ${lines.length === 1 ? "línea" : "líneas"} (${lines
          .slice(0, 3)
          .map((line) => `«${line.label}»`)
          .join(", ")}${lines.length > 3 ? " y más" : ""})`
      : "",
    ...jobs.map(
      (job) => `el puesto completo «${job.company ?? job.label}»${job.dates ? ` (${job.dates})` : ""}`,
    ),
    ...studies.map(
      (study) => `el estudio «${study.company ?? study.label}»${study.dates ? ` (${study.dates})` : ""}`,
    ),
    wholeSummary ? "el resumen entero" : "",
  ].filter(Boolean);

  const parts = [
    `Para que entre en una hoja hay que quitar más que en el ajuste normal: ${cited.join(", ")}.`,
    wholeSummary
      ? "El resumen se va completo, con sus frases, y el CV entra en una hoja."
      : "El CV entra en una hoja.",
  ];

  const strict = preview.filter((line) => line.tier === "T5");
  if (strict.length > 0) {
    const requirements = [...new Set(strict.map((line) => line.requirement).filter(Boolean))];
    parts.push(
      requirements.length > 0
        ? `Esto quita lo único que muestra «${requirements.join("», «")}», ${
            requirements.length === 1 ? "un requisito excluyente" : "requisitos excluyentes"
          } del aviso.`
        : "Esto quita la única evidencia de un requisito excluyente del aviso.",
    );
  }

  return parts.join("\n\n");
}
