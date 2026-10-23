"use client";

/**
 * «Ajuste del CV a una hoja», the half that touches the world: the session, the
 * storage and the receipt.
 *
 * `lib/cv/fit.ts` decides *what* comes out; this decides *when* it is allowed to
 * — which level, how many attempts are left, what the person is told — and
 * writes the result where the rest of the app reads it.
 *
 * Medida, almacenamiento y tipografías are injected, so the whole flow is
 * testable without a DOM and without IndexedDB. (The `fontsReady` hook is the one
 * addition to the shape in to-do §6.5: the browser passes `cvFontsReady`, and a
 * caller with no `document` — the tests — passes a plain function. Reading
 * `document` from here would make the module unusable outside a browser.)
 *
 * Everything is best-effort, like `saveCachedAnalysis` in `Wizard.tsx`: a fit
 * that cannot measure, cannot load its faces or cannot do its arithmetic leaves
 * the application exactly as it was. It must never be the reason a CV the model
 * already wrote fails to reach the person.
 */

import { FIT_SLACK_PX, sheetLimitPx, type CvLayout, type CvMeasurer } from "@/components/cv/measure";
import {
  applyCondensed,
  fitToPage,
  nextFitLevel,
  type CondensedLine,
  type FitAnalysis,
  type FitLevel,
  type FitResult,
  type RemovedLine,
} from "@/lib/cv/fit";
import { cvContentHash } from "@/lib/cv/review-hash";
import { verifyCV, type Finding } from "@/lib/ai/verify";
import { OMITTED_LIMIT, cvDocumentSchema, type Coverage, type CVDocument } from "@/lib/schemas/cv";
import type { Profile } from "@/lib/schemas/profile";
import type { SaveOutcome } from "@/lib/storage/applications/store";
import type { Application } from "@/lib/storage/application";
import { withFitSession, withFittedCV } from "@/lib/storage/applications/normalize";

/** Where the fit reads and writes the application. The app passes `local.ts`; tests pass a map. */
export type FitStore = {
  get(id: string): Application | undefined;
  save(app: Application): Promise<SaveOutcome>;
};

export type FitContext = {
  profile: Profile;
  measurer: Pick<CvMeasurer, "measure" | "layout">;
  /** Whether the CV's three faces are loaded — `cvFontsReady(cv)` in the browser. */
  fontsReady: () => Promise<boolean>;
  store: FitStore;
  /** The height to reach. `FIT_LIMIT_PX`, tighter after a spilled PDF (§6.7). */
  limit?: number;
  /** Consent for `extreme` was given: the ladder may go all the way. */
  allowExtreme?: boolean;
  /**
   * Etapa 2: shorten before deleting (§7).
   *
   * Injected because it is the only part of this that talks to a model — the
   * caller knows whether the person brought a key, and which of their keys is
   * the chain. Called at most once per session, only when the page overflows,
   * and only after `aiUsed` has been stored (see the write-ahead below).
   */
  condense?: (
    cv: CVDocument,
    ctx: { layout: CvLayout; analysis?: FitAnalysis; linesToGain: number },
  ) => Promise<CondensedLine[]>;
  /**
   * `false` on the browser's fallback engine (`useApplicationsStatus().engine ===
   * "legacy"`), where a second copy of the CV does not fit: the undo then lives
   * only in the screen's own state (§6.5).
   */
  keepUndo?: boolean;
};

export type FitSession = NonNullable<Application["fitSession"]>;

export type FitOutcome =
  | { status: "unchanged" }
  | {
      status: "fitted";
      application: Application;
      removed: RemovedLine[];
      condensed: CondensedLine[];
      level: FitLevel;
      /** False when the copy that «Deshacer» needs could not be stored: the receipt must say so. */
      undoSaved: boolean;
    }
  | { status: "needs-consent"; preview: RemovedLine[] }
  | { status: "impossible" }
  | { status: "skipped"; reason: "fonts" | "error" };

/** The session of an application that never fitted anything. */
export const EMPTY_FIT_SESSION: FitSession = {
  level: "normal",
  aiUsed: false,
  pdfChecks: 0,
  failedHashes: [],
};

/** How many PDF checks the session pays for before the person decides (§4: three, the first one included). */
export const PDF_CHECK_LIMIT = 3;

/** The session as stored, with the defaults of a fresh one. */
export function readFitSession(app: Application): FitSession {
  return app.fitSession ?? EMPTY_FIT_SESSION;
}

/** Whether this exact CV's PDF already came out too long: it is never asked for again (§6.7). */
export function pdfAlreadyFailed(app: Application, cv: CVDocument): boolean {
  return readFitSession(app).failedHashes.includes(cvContentHash(cv));
}

/** The higher of two levels: the session's level only ever advances (§4). */
function highest(a: FitLevel, b: FitLevel): FitLevel {
  return FIT_ORDER.indexOf(a) >= FIT_ORDER.indexOf(b) ? a : b;
}

const FIT_ORDER: readonly FitLevel[] = ["normal", "relaxed", "extreme"];

/** The levels an attempt may walk, from where the session stands up to `top`. */
function levelsUpTo(from: FitLevel, top: FitLevel): FitLevel[] {
  const levels: FitLevel[] = [];
  for (let level: FitLevel | null = from; level; level = nextFitLevel(level)) {
    levels.push(level);
    if (level === top) break;
  }
  return levels;
}

/**
 * About how tall one line of the CV is, in px: 11pt at the template's own line
 * height (1.0791666). Used only to turn an overflow in px into «how many lines
 * this has to give back», which is what the shortening step is asked for — the
 * measurement itself is what decides whether the page fits.
 */
const LINE_PX = 16;

/** How many lines the page is over, from what the measurer says. */
function linesOver(measured: number, limit: number): number {
  return Math.max(1, Math.ceil((measured - limit) / LINE_PX));
}

/* --- Documenting what came out --------------------------------------------- */

/** One `coverage.omitted` entry for a line the fit took out. */
function omittedEntry(line: RemovedLine): { item: string; reason: string } {
  if (line.kind === "job" || line.kind === "study") {
    const what = line.kind === "job" ? "Puesto" : "Estudio";
    const name = line.company ?? line.label;
    const dates = line.dates ? ` (${line.dates})` : "";
    return {
      item: `${what} omitido: ${name}${dates}`,
      reason: "Ya no aparece en el CV: se quitó para que entre en una hoja.",
    };
  }
  return { item: line.label, reason: "Se quitó para que entre en una hoja." };
}

/**
 * `coverage.omitted` with the new entries in front, held to what the schema
 * keeps: ten, with «y N más» in the last place rather than a silent cut (§6.5).
 *
 * The removals come first — they are what left the CV — then the shortened lines,
 * which are still on the page but no longer say exactly what they said. Both are
 * what «Qué se dejó afuera del CV» is for: nobody should have to compare two
 * documents to find out what changed.
 */
function withOmitted(
  previous: Coverage["omitted"],
  lines: readonly RemovedLine[],
  condensed: readonly CondensedLine[],
): Coverage["omitted"] {
  const fresh = [
    ...lines.map(omittedEntry),
    ...condensed.map((line) => ({
      item: `Acortada: ${shorten(line.after)}`,
      reason: `Antes: «${shorten(line.before, 260)}»`,
    })),
  ];
  const all = [...fresh, ...previous];
  if (all.length <= OMITTED_LIMIT) return all;

  const kept = all.slice(0, OMITTED_LIMIT - 1);
  const rest = all.length - kept.length;
  return [...kept, { item: `y ${rest} más`, reason: "Lo demás que se dejó afuera sigue en tu perfil." }];
}

/** A label for the omitted list: one line's worth, never the whole text. */
function shorten(text: string, max = 90): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/**
 * The fitted document as it is kept: the removals written into `coverage`.
 *
 * A requirement whose evidence this fit took off the page goes back to
 * `covered: false` with the reason said out loud — the report must not keep
 * claiming a line that is no longer printed.
 */
function documented(cv: CVDocument, result: FitResult, condensed: readonly CondensedLine[]): CVDocument {
  const coverage: Coverage = {
    requirements: cv.coverage.requirements.map((entry) =>
      result.lostRequirements.includes(entry.requirement)
        ? { ...entry, covered: false, evidence: "Se quitó para que entre en una hoja." }
        : entry,
    ),
    omitted: withOmitted(cv.coverage.omitted, result.removed, condensed),
  };

  const parsed = cvDocumentSchema.safeParse({ ...cv, coverage });
  return parsed.success ? parsed.data : cv;
}

/**
 * The findings of the fitted CV, re-derived.
 *
 * Stored findings name positions (`sections[1].items[0].bullets[2]`) and every
 * removal shifts them, so what was stored is recomputed against the document the
 * person now has. The one exception is the truncation warning, which is about the
 * model's response rather than about the document and cannot be recomputed here:
 * it is carried over verbatim (and only once).
 */
function refind(cv: CVDocument, app: Application, profile: Profile): Finding[] {
  const fresh = verifyCV(cv, profile, app.analysis);
  const kept = (app.findings ?? []).filter(
    (finding) =>
      finding.field === "sections" &&
      /se cortó/.test(finding.detail) &&
      !fresh.some((entry) => entry.field === finding.field && entry.detail === finding.detail),
  );
  return [...fresh, ...kept];
}

/* --- The receipt ------------------------------------------------------------ */

/**
 * What the fit did, in the words the person reads (§6.6).
 *
 * Never silent: the count, which lines, and where they still are. An omitted job
 * says so with its company and dates — that is the one removal the page no
 * longer hints at, since the header went with the bullets.
 */
export function fitReceipt(removed: readonly RemovedLine[], condensed: readonly CondensedLine[]): string {
  const lines = removed.filter((line) => line.kind !== "job" && line.kind !== "study");
  const jobs = removed.filter((line) => line.kind === "job");
  const studies = removed.filter((line) => line.kind === "study");
  const parts: string[] = [];

  if (lines.length > 0) {
    const labels = lines.slice(0, 4).map((line) => `«${line.label}»`).join(", ");
    const more = lines.length > 4 ? ` y ${lines.length - 4} más` : "";
    parts.push(
      `Para que entre en una hoja, quitamos ${lines.length} ${lines.length === 1 ? "línea" : "líneas"} de menor peso para este aviso: ${labels}${more}. Siguen en tu perfil y las ves en «Qué se dejó afuera del CV».`,
    );
  }

  for (const job of [...jobs, ...studies]) {
    const what = job.kind === "job" ? "puesto" : "estudio";
    const name = job.company ?? job.label;
    const dates = job.dates ? ` (${job.dates})` : "";
    parts.push(`Omitimos el ${what} «${name}»${dates}: ya no aparece en el CV.`);
  }

  if (condensed.length > 0) {
    parts.push(
      `Para que entre en una hoja, acortamos ${condensed.length} ${condensed.length === 1 ? "frase" : "frases"} sin cambiar lo que dicen. Las ves en «Qué se dejó afuera del CV».`,
    );
  }

  return parts.join(" ");
}

/* --- The attempt ------------------------------------------------------------ */

async function fontsOk(ctx: FitContext): Promise<boolean> {
  try {
    return await ctx.fontsReady();
  } catch {
    // A face that cannot even be asked about is a face that is not ready.
    return false;
  }
}

/**
 * Fits the CV of `app` to one page, or says why it could not.
 *
 * The ladder starts where the session left it and climbs to `relaxed` on its
 * own — that is the level an automatic fit is allowed to reach. `extreme` is
 * only walked when the caller passes `allowExtreme`, which is the person's own
 * answer in the confirm dialog (§6.6); without it this returns `needs-consent`
 * and what `extreme` would take, so the dialog can be specific.
 *
 * Nothing is applied unless the result fits: an adjustment nobody agreed to is
 * not a document the person can be handed.
 */
export async function fitApplicationCv(app: Application, ctx: FitContext): Promise<FitOutcome> {
  const cv = app.cv;
  if (!cv) return { status: "unchanged" };

  const session = readFitSession(app);
  const limit = ctx.limit ?? sheetLimitPx(app.sheets ?? 1);
  const analysis = app.analysis;
  const top: FitLevel = ctx.allowExtreme ? "extreme" : "relaxed";

  if (!(await fontsOk(ctx))) return { status: "skipped", reason: "fonts" };

  const measure = (doc: CVDocument) => ctx.measurer.measure(doc, app.sheets ?? 1);

  /**
   * Etapa 2 comes first: shortening a line keeps what removing it throws away, so
   * it is tried before the ladder, and only when the page really overflows.
   *
   * The attempt is written **before** it is spent. If the session cannot be
   * stored, the model is not asked at all: an attempt a reload hands back is worse
   * than no attempt — the person would get a second one on the same CV, which is
   * exactly what the session exists to prevent (§4).
   */
  let source = cv;
  let condensed: CondensedLine[] = [];
  let spent = session;

  if (ctx.condense && !session.aiUsed) {
    try {
      if (measure(cv) > limit) {
        const ahead: FitSession = { ...session, aiUsed: true };
        const current = ctx.store.get(app.id) ?? app;
        const written = await ctx.store.save(withFitSession(current, ahead));

        if (written.ok) {
          spent = ahead;
          const rewrites = await ctx.condense(cv, {
            layout: ctx.measurer.layout(cv),
            analysis,
            linesToGain: linesOver(measure(cv), limit),
          });
          const shortened = applyCondensed(cv, rewrites);
          // Kept only if it bought height: a rewrite that saved nothing would put
          // the person through a diff for nothing.
          if (shortened !== cv && measure(shortened) < measure(cv)) {
            source = shortened;
            condensed = rewrites;
          }
        }
      }
    } catch {
      // Shortening is an improvement on the deterministic fit, never a reason to
      // stop it: whatever went wrong, the ladder below runs on the CV as it was.
    }
  }

  let fitted: FitResult | null = null;
  try {
    for (const level of levelsUpTo(session.level, top)) {
      const attempt = fitToPage(source, { analysis, measure, limit, level });
      if (attempt.fits) {
        fitted = attempt;
        break;
      }
    }
  } catch {
    return { status: "skipped", reason: "error" };
  }

  if (!fitted) {
    // Nothing at or below `top` fits. `extreme` is next — with the person's yes
    // — and when the yes was already given, this is the end of the road.
    if (ctx.allowExtreme) return { status: "impossible" };
    let preview: FitResult;
    try {
      preview = fitToPage(source, { analysis, measure, limit, level: "extreme" });
    } catch {
      return { status: "skipped", reason: "error" };
    }
    if (!preview.fits) return { status: "impossible" };
    return { status: "needs-consent", preview: preview.removed };
  }

  // It already fits and nothing was shortened: nothing to change, nothing to say,
  // nothing to remember.
  if (fitted.removed.length === 0 && condensed.length === 0) return { status: "unchanged" };

  const adjusted = documented(cv, fitted, condensed);
  const findings = refind(adjusted, app, ctx.profile);
  const nextSession: FitSession = { ...spent, level: highest(spent.level, fitted.level) };
  const keepUndo = ctx.keepUndo !== false;
  const undo: Application["fitUndo"] = keepUndo
    ? {
        cv,
        findings: app.findings ?? [],
        fittedHash: cvContentHash(adjusted),
        at: new Date().toISOString(),
      }
    : undefined;

  let saved = withFittedCV(app, { cv: adjusted, findings, fitSession: nextSession, fitUndo: undo });
  const outcome = await ctx.store.save(saved);
  let undoSaved = outcome.ok && undo !== undefined;

  if (!outcome.ok && undo !== undefined) {
    // Running out of room must not cost the fit: the retry writes the same thing
    // without the second copy of the CV, and the receipt says undo is not
    // available this time (§6.5). «Deshacer» is never offered without a copy.
    saved = withFittedCV(app, { cv: adjusted, findings, fitSession: nextSession, fitUndo: undefined });
    await ctx.store.save(saved);
    // Whatever the retry said, there is no copy to go back to, and the receipt
    // must say so rather than offering a «Deshacer» that would restore nothing.
    undoSaved = false;
  }

  return {
    status: "fitted",
    application: saved,
    removed: fitted.removed,
    condensed,
    level: fitted.level,
    undoSaved,
  };
}

/**
 * «Deshacer el ajuste»: the CV from before the last fit, back in place.
 *
 * Only while the copy names the CV that is on screen (`fittedHash`); only `cv`
 * and `findings` are patched, and onto the record as it stands *now* — anything
 * changed while the fit was on screen survives. The level goes back to `normal`,
 * which is the one direction it may move; the attempts already spent
 * (`aiUsed`, `pdfChecks`, `failedHashes`) are not refunded — a reload must not be
 * a way to get extra tries (§4).
 */
export async function undoFit(app: Application, store: FitStore): Promise<Application | null> {
  const undo = app.fitUndo;
  if (!undo || !app.cv) return null;
  if (undo.fittedHash !== cvContentHash(app.cv)) return null;

  const current = store.get(app.id) ?? app;
  const next: Application = {
    ...current,
    cv: undo.cv,
    findings: undo.findings,
    fitSession: { ...readFitSession(current), level: "normal" },
  };
  delete next.fitUndo;

  await store.save(next);
  return next;
}

/* --- What a spilled PDF costs ----------------------------------------------- */

export type PdfRetry =
  /** The session has room: fit again at the next level, against a tighter limit. */
  | { kind: "tighten"; allowExtreme: false; limit: number }
  /** The next level is `extreme`: it needs the person's specific consent first. */
  | { kind: "consent"; limit: number }
  /** No attempts left: the person decides whether to download it anyway (§6.7). */
  | { kind: "spent" };

/**
 * The PDF came out wrong — more than one sheet, or a sideways overflow — and
 * this is what it costs the session.
 *
 * The check is written **before** the caller acts on it, so closing the tab in
 * between cannot refund an attempt. Only content failures come through here: a
 * typography the printer could not verify is not something fitting can fix, and
 * must not eat one of the three (§6.7).
 *
 * The limit for the next round is tightened by the overflow the PDF actually
 * had: the printed page measured longer than the screen did, and fitting again
 * against the same number would land in the same place.
 */
export async function countSpilledPdf(
  app: Application,
  store: FitStore,
  spilled: CVDocument,
  options: { overflowPx?: number; limit?: number } = {},
): Promise<{ application: Application; retry: PdfRetry }> {
  const current = store.get(app.id) ?? app;
  const session = readFitSession(current);
  const hash = cvContentHash(spilled);

  const nextSession: FitSession = {
    ...session,
    pdfChecks: Math.min(PDF_CHECK_LIMIT, session.pdfChecks + 1),
    failedHashes: [...session.failedHashes.filter((entry) => entry !== hash), hash].slice(-6),
  };
  const written = withFitSession(current, nextSession);
  await store.save(written);

  const limit = (options.limit ?? sheetLimitPx(current.sheets ?? 1)) - (options.overflowPx ?? 0) - FIT_SLACK_PX;
  const advance = nextFitLevel(session.level);

  if (nextSession.pdfChecks >= PDF_CHECK_LIMIT || !advance) {
    return { application: written, retry: { kind: "spent" } };
  }
  if (advance === "extreme") return { application: written, retry: { kind: "consent", limit } };
  return { application: written, retry: { kind: "tighten", allowExtreme: false, limit } };
}

/**
 * What `extreme` would take from this CV, for the specific consent dialog
 * (§6.6) — the list of lines, studies, sentences and the excluding evidence it
 * would go through.
 *
 * `null` when even `extreme` does not make it fit: there is nothing to consent
 * to, and the honest answer is «no entra». Runs the engine and nothing else — no
 * session is written and nothing is stored, because asking what it would cost is
 * not spending an attempt.
 */
export function extremePreview(app: Application, ctx: FitContext): RemovedLine[] | null {
  const cv = app.cv;
  if (!cv) return null;
  try {
    const preview = fitToPage(cv, {
      analysis: app.analysis,
      measure: (doc) => ctx.measurer.measure(doc, app.sheets ?? 1),
      limit: ctx.limit ?? sheetLimitPx(app.sheets ?? 1),
      level: "extreme",
    });
    return preview.fits ? preview.removed : null;
  } catch {
    return null;
  }
}
