import { cvContentHash } from "@/lib/cv/review-hash";
import type { Finding } from "@/lib/ai/verify";
import type { Application } from "../application";
import type { CVDocument } from "@/lib/schemas/cv";

/**
 * `cvOriginal` exists so a hand edit can be undone. It used to be written on
 * every generation, a second full copy of a document nobody had touched: in a
 * real export of 127 applications it was byte-identical to `cv` in all 127 and
 * made up 30 % of everything stored. It is now kept only while `cv` differs from
 * it, which is the only time there is anything to restore.
 *
 * These are the only functions that change `cv`, `cvOriginal` and `cvEdited`, so
 * the three cannot drift apart: whatever path a CV takes — generated, edited,
 * restored, or read back from an older build — it goes through here.
 */

/** Same content, compared the way it is stored. Key order is part of it, and both sides come out of the same code. */
export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Drops a `cvOriginal` that says nothing `cv` does not already say.
 *
 * Lossless by construction: only when the two serialise identically and the CV
 * is not marked as edited. Anything else — an edited CV, or an unedited one whose
 * copies differ for a reason this code does not know — is left exactly as it was.
 * Returns the same object when there is nothing to drop, so callers can tell.
 */
export function normalizeStoredApplication(app: Application): Application {
  const compacted = dropSpentUndo(app);
  if (!compacted.cvOriginal || compacted.cvEdited === true) return compacted;
  if (!sameJson(compacted.cvOriginal, compacted.cv)) return compacted;
  const rest = { ...compacted };
  delete rest.cvOriginal;
  return rest;
}

/**
 * Drops a «Deshacer el ajuste» copy that no longer names the CV on the page.
 *
 * `fittedHash` is the hash the adjusted CV had when the copy was taken; a CV
 * that changed since — by hand, by a regeneration, by another fit — is not the
 * one that copy would replace, so offering to restore it would swap in a
 * version nobody asked for. Lossless the other way: with the hash matching, the
 * copy stays exactly as it was.
 */
function dropSpentUndo(app: Application): Application {
  if (!app.fitUndo || !app.cv) return app;
  if (app.fitUndo.fittedHash === cvContentHash(app.cv)) return app;
  const rest = { ...app };
  delete rest.fitUndo;
  return rest;
}

/**
 * An application with no trace of the fitting flow left: no session to resume
 * and nothing to undo.
 *
 * Shared by the three writers of `cv` that are not the fit itself. A new CV
 * (generated, hand-edited, restored) starts the ladder over — a session that
 * named positions of a document that no longer exists would be worse than no
 * session at all — and the copy that «Deshacer» would have restored is a
 * document the person has already moved past.
 */
function withoutFit(app: Application): Application {
  const next = { ...app };
  delete next.fitUndo;
  delete next.fitSession;
  return next;
}

/** A freshly generated CV: nothing edited yet, so nothing to restore. */
export function withGeneratedCV(app: Application, cv: CVDocument | undefined): Application {
  const next: Application = withoutFit({ ...app, cv, cvEdited: false });
  delete next.cvOriginal;
  return next;
}

/**
 * A hand edit. The first one keeps what it replaces as `cvOriginal`; later ones
 * leave that alone, so «restaurar el generado» always goes back to the model's
 * version rather than to the previous keystroke.
 *
 * An application edited before `cvOriginal` existed has none, and stays without
 * one: there is no generated version left to put back.
 */
export function withEditedCV(app: Application, cv: CVDocument): Application {
  if (app.cvEdited === true) return withoutFit({ ...app, cv });
  return withoutFit({ ...app, cvOriginal: app.cv, cv, cvEdited: true });
}

/** «Restaurar el generado»: the original back in place, and nothing left to restore. Null when there is none. */
export function withRestoredCV(app: Application): Application | null {
  if (!app.cvOriginal) return null;
  const next: Application = withoutFit({ ...app, cv: app.cvOriginal, cvEdited: false });
  delete next.cvOriginal;
  return next;
}

/**
 * The fitted CV, written with its findings, its session and the copy that
 * «Deshacer» restores — all in one write, so no reader ever sees one without
 * the others.
 *
 * Deliberately not `withEditedCV`: an automatic adjustment is not a hand edit.
 * It must leave `cvEdited` and `cvOriginal` alone — «Editado por vos» and the
 * corrections offered to the profile (`lib/cv/corrections.ts`) both hang off
 * `cvEdited`, and a line the engine took out because the page demanded it is not
 * something the person wrote.
 */
export function withFittedCV(
  app: Application,
  fitted: {
    cv: CVDocument;
    findings: Finding[];
    fitSession: Application["fitSession"];
    fitUndo: Application["fitUndo"];
  },
): Application {
  const next: Application = { ...app, cv: fitted.cv, findings: fitted.findings };
  if (fitted.fitSession) next.fitSession = fitted.fitSession;
  else delete next.fitSession;
  if (fitted.fitUndo) next.fitUndo = fitted.fitUndo;
  else delete next.fitUndo;
  return next;
}

/**
 * The session alone, written ahead of the step it pays for: `aiUsed` before the
 * AI is asked (to-do §4), `pdfChecks` and `failedHashes` before the ladder
 * advances. A reload in the middle must not hand back an attempt already spent.
 */
export function withFitSession(app: Application, fitSession: NonNullable<Application["fitSession"]>): Application {
  return { ...app, fitSession };
}

/**
 * An application as it travels out of this browser: backups, account sync and
 * exports drop the fitting trace, which belongs to this machine's flow and to
 * the CV it was taken from. Neither field is content — `fitUndo` is a second
 * copy of the CV before the fit, and uploading it would double what the account
 * keeps for nothing.
 */
export function withoutFitTrace(app: Application): Application {
  const next = { ...app };
  delete next.fitUndo;
  delete next.fitSession;
  return next;
}

/**
 * Roughly how much room an application takes, in characters of its stored form.
 * For the size shown next to each row and the totals in Ajustes — an
 * approximation on purpose: what the browser actually uses on disk depends on
 * its own encoding and compression, and no API reports it per record.
 */
export function applicationSize(app: unknown): number {
  try {
    return JSON.stringify(app)?.length ?? 0;
  } catch {
    return 0;
  }
}
