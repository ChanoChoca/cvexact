import { z } from "zod";
import { jobAnalysisSchema, inferredSkillSchema } from "@/lib/schemas/job";
import { cvDocumentSchema } from "@/lib/schemas/cv";
import {
  answersWithLimitsSchema,
  coverEmailSchema,
  interviewPrepSchema,
  videoScriptSchema,
} from "@/lib/schemas/outputs";
import { PROVIDERS } from "@/lib/ai/provider-catalog";
import { APPLICATION_STATUSES, type ApplicationStatus } from "@/lib/tracker/status";

/**
 * The shape of one saved application, on its own so that everything which stores
 * or validates one — `local.ts`, the IndexedDB layer, the applications store —
 * can import it without importing each other. `local.ts` re-exports all of it,
 * so `@/lib/storage/local` stays the one address the rest of the app uses.
 */

/** Mirrors `Finding` in `@/lib/ai/verify` — kept separate so this file does not
 * import a schema from a module that has none to offer, just the plain type. */
const findingSchema = z.object({
  severity: z.enum(["error", "warning"]),
  field: z.string(),
  detail: z.string(),
  kind: z.enum(["invented_figure", "thin_cv"]).optional().catch(undefined),
});

/**
 * Los nueve estados del tracker (`lib/tracker/status.ts`) son también el
 * vocabulario del navegador — una sola fuente para los dos lados, no un
 * enum de cuatro valores acá y otro de nueve en el servidor.
 *
 * `LEGACY_STATUS_MAP` traduce lo que una versión anterior de la app haya
 * guardado (`borrador | enviada | entrevista | cerrada`) al estado nuevo más
 * parecido, reversible desde la UI. `cerrada → rechazado` es la apuesta más
 * discutible del lote — así termina la enorme mayoría de los procesos que se
 * cierran, no todos — y por eso es un click corregirla, no una migración.
 */
const LEGACY_STATUS_MAP: Record<string, ApplicationStatus> = {
  borrador: "guardado",
  enviada: "postulado",
  entrevista: "entrevista",
  cerrada: "rechazado",
};
const applicationStatusSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  if (value in LEGACY_STATUS_MAP) return LEGACY_STATUS_MAP[value];
  return value;
}, z.enum(APPLICATION_STATUSES));

/**
 * Validated shape of a stored application, checked on every read.
 *
 * `loadApplications` used to trust `JSON.parse` alone — a plausible-looking
 * object with the wrong shape (an old build, a hand-edited backup, a bug
 * upstream) would parse fine and then throw the first time some component
 * reached into it, taking the whole `/postulaciones` route down. Reusing the
 * schemas the rest of the app already validates against (`cvDocumentSchema`,
 * `jobAnalysisSchema`, …) means this list can never drift from what a real
 * generation actually produces.
 */
export const applicationSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** The pasted job post, kept so artifacts can be regenerated. */
  jobText: z.string(),
  label: z.string(),
  analysis: jobAnalysisSchema.optional(),
  inferredSkills: z.array(inferredSkillSchema).optional(),
  /** Skills the user vetoed; excluded from every later generation. */
  rejectedSkills: z.array(z.string()).optional(),
  /**
   * The person already answered which of the deduced skills this posting asks for are theirs. A regeneration sends it
   * along, so it is not asked again. Absent on an application from before the question existed.
   */
  skillsReviewed: z.boolean().optional(),
  /**
   * How many sheets the person allowed this CV: absent is one. Set by «Permitir 2 hojas», offered only to a career of ten years or more
   * (`canAllowTwoSheets`), and read by the preview, the fit, the PDF check and the prompt, so that all of them judge the same page.
   */
  sheets: z.union([z.literal(1), z.literal(2)]).optional().catch(undefined),
  /**
   * Uncovered requirements the user has answered "I don't have that" to, so the
   * coverage panel stops offering to add them. Keyed by the requirement text.
   */
  dismissedGaps: z.array(z.string()).optional(),
  /**
   * The day the one question this posting puts (`lib/jobs/requirement-ask.ts`) was dealt with — yes, no or not now: it is asked once for each
   * posting, and a posting opened again does not ask it again. Absent until then.
   */
  requirementAskedAt: z.string().optional(),
  /**
   * No longer settable from the UI — leaving jobs and tasks out of one application was removed; what is left out of every CV is
   * the «No usar en CVs» mark on the profile. Kept optional and unused so applications and backups saved before the removal
   * still parse.
   */
  excludedIds: z.array(z.string()).optional(),
  /**
   * No longer settable from the UI — the manual language override was
   * removed, so documents always use `analysis.language`. Kept optional and
   * unused so applications and backups saved before the removal still parse.
   */
  outputLanguage: z.string().optional(),
  /**
   * Which model produced `cv`. Recorded because the eval harness scores a real
   * export, and without it a corpus generated across several providers reports
   * one average that belongs to none of them — a prompt tuned against Gemini
   * and shipped to someone on Cohere was never measured where it runs.
   */
  provider: z.enum(PROVIDERS).optional(),
  model: z.string().optional(),
  cv: cvDocumentSchema.optional(),
  /**
   * What the verifier said about `cv`.
   *
   * Persisted because it used to live only in React state: reopening a saved
   * application showed an empty findings panel over a CV whose fabricated
   * availability row was still there. The check is cheap and pure, but re-running
   * it on mount would report on a CV the user has since edited, so what is stored
   * is what was found — and `cv` and `findings` are always written together.
   */
  findings: z.array(findingSchema).optional(),
  /**
   * The session of «Ajuste del CV a una hoja» (to-do §4).
   *
   * Small on purpose: how far the ladder has gone, whether the AI was already
   * asked once, and how many times the PDF came out wrong. It is persisted so a
   * reload mid-way cannot hand back an attempt that was already spent — the
   * limits count real attempts, not calls to a function. A corrupt value is
   * discarded rather than quarantining the application: it is a scratchpad, and
   * losing it costs at most one extra attempt.
   */
  fitSession: z
    .object({
      /** Highest level reached: it only advances, except back to "normal" when the fit is undone. */
      level: z.enum(["normal", "relaxed", "extreme"]),
      /** Etapa 2's cap: one call to the AI per session. */
      aiUsed: z.boolean(),
      /** PDF checks that failed **on content** — more than one sheet, or a sideways overflow. */
      pdfChecks: z.number().int().min(0).max(3),
      /** CVs whose PDF already came out too long: never asked for again. */
      failedHashes: z.array(z.string()).max(6),
    })
    .optional()
    .catch(undefined),
  /**
   * The CV as it was before the last fit, so the person can undo it.
   *
   * One copy per application, in the same record as the fitted CV (the write is
   * atomic). Replaced by each new fit, and dropped as soon as the CV changes by
   * hand or by a regeneration — `withGeneratedCV`, `withEditedCV` and
   * `withRestoredCV` all delete it — or when `fittedHash` no longer matches
   * `cv`. Absent when no fit happened, or when the browser had no room for it
   * (see `undoSaved` in `lib/applications/fit.ts`).
   */
  fitUndo: z
    .object({
      cv: cvDocumentSchema,
      findings: z.array(findingSchema),
      /** `cvContentHash` of the CV this copy would replace. */
      fittedHash: z.string(),
      at: z.string(),
    })
    .optional()
    .catch(undefined),
  /**
   * The CV exactly as the model produced it, kept so an edit is reversible.
   *
   * Only while `cv` differs from it: absent means `cv` is still the generated
   * document, so there is nothing to restore. It used to be written on every
   * generation — a second full copy of a CV nobody had touched, 30 % of what a
   * real history stored. The first hand edit is what writes it now (see
   * `withEditedCV` in `./applications/normalize`).
   */
  cvOriginal: cvDocumentSchema.optional(),
  /** Whether `cv` has been hand-edited since it was generated. */
  cvEdited: z.boolean().optional(),
  /**
   * El hash del `cv` exacto que el usuario confirmó haber revisado, no un
   * booleano. Ver el comentario de `ReviewGate` (components/cv/ReviewGate.tsx)
   * para el razonamiento legal completo: un booleano quedaría en pie después de
   * editar a mano o regenerar, y el usuario habría confirmado una versión y
   * descargado otra. Comparando el hash contra `cvContentHash(cv)` en cada
   * render, la confirmación caduca sola en cuanto el contenido cambia.
   */
  reviewedCvHash: z.string().optional(),
  answers: answersWithLimitsSchema.optional(),
  /**
   * What the verifier said about `answers`. Persisted for the reason `findings`
   * above is: reopening a saved application must not show an empty panel over a
   * set of answers whose "0 años" is still sitting there.
   */
  answersFindings: z.array(findingSchema).optional(),
  email: coverEmailSchema.optional(),
  interview: interviewPrepSchema.optional(),
  video: videoScriptSchema.optional(),
  /**
   * Where this application stands. Absent means "guardado" — the historical
   * default ("borrador" pre-tracker), so every application saved before this
   * existed keeps parsing and keeps reading as freshly saved rather than
   * needing a migration to say so.
   */
  status: applicationStatusSchema.optional(),
  /** Free-form: a contact, the salary offered, what they answered. */
  notes: z.string().optional(),
});

export type Application = z.infer<typeof applicationSchema>;
