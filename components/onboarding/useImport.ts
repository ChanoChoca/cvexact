"use client";

import { useCallback, useState } from "react";
import { readDocument, sha256Hex, UnreadableFileError } from "@/lib/import/extract";
import { parseDocument } from "@/lib/parse";
import { parseLinkedInExport } from "@/lib/parse/linkedin-csv";
import { extractWithAi } from "@/lib/onboarding/ai";
import { readByAi } from "@/lib/parse/read-by-ai";
import { applyParsedDocument, importOutcome, type ApplyResult, type ImportOutcome } from "@/lib/parse/to-profile";
import type { ParsedDocument } from "@/lib/parse/types";
import type { DenialReason } from "@/lib/api/client";
import { saveSource } from "@/lib/onboarding/source-store";
import { recordMetric } from "@/lib/metrics/store";
import { StorageWriteError, loadStoredProfile, saveStoredProfile } from "@/lib/storage/local";

/**
 * Bringing a document into the profile from the browser: read it, parse it with
 * no model, apply it as proposals, keep the original beside it.
 *
 * Everything here happens on the person's own device. What comes back says how it
 * went in terms a screen can act on: a document that was read and had something
 * in it, one that was read and had nothing, or one that could not be read — each
 * with a way forward.
 */

export type ImportProblem = {
  message: string;
  /** Why it could not be read, for choosing which exits to offer. */
  reason: "scanned" | "unsupported" | "photo" | "too_large" | "empty" | "zip" | "nothing" | "other";
  /** The file that failed, so a scan can be shown beside the forms. */
  file?: File;
  /**
   * The text itself, when there was any to read — never for a ZIP (rows, not
   * lines of text) or a scanned PDF (no text at all). Present only on
   * `reason: "nothing"`, and what lets the screen offer "Leer con tu IA" on
   * exactly the non-standard document the spec means by that: the heuristic
   * parser found no structure in real text, not a document with no text in
   * it to begin with.
   */
  text?: string;
};

export type ImportSuccess = {
  ok: true;
  result: ApplyResult;
  parsed: ParsedDocument;
  sourceId: string;
  /** What the document's own content justifies telling the person — see `importOutcome`. */
  outcome: ImportOutcome;
};

/** What became of several files read one after another: the ones that went in, and the ones that did not, each with its reason. */
export type ImportBatch = { successes: ImportSuccess[]; problems: ImportProblem[] };

/** A pasted text shorter than this is not a document. */
export const MIN_PASTE = 60;

export function useImport() {
  // How many files are being read right now; zero when none is.
  const [batch, setBatch] = useState(0);
  const [problems, setProblems] = useState<ImportProblem[]>([]);
  const busy = batch > 0;

  const commit = useCallback(
    (
      parsed: ParsedDocument | null,
      info: { name: string; fileHash: string; pasted: boolean; chars: number; modifiedAt?: string; madeAt?: string; photo?: true },
      /** The document's own text, for "Leer con tu IA" on whichever `"nothing"` this becomes — omitted for a ZIP. */
      text?: string,
    ): ImportSuccess | ImportProblem => {
      if (!parsed) {
        return {
          message: "Ese archivo no tiene lo que buscamos: no encontramos datos de un perfil.",
          reason: "nothing",
          ...(text ? { text } : {}),
        };
      }
      const sourceId = crypto.randomUUID();
      const current = loadStoredProfile();
      const result = applyParsedDocument(current, parsed, info, {
        sourceId,
        now: new Date().toISOString(),
        newId: () => crypto.randomUUID(),
      });
      const outcome = importOutcome(parsed, result);
      // Said as unread, so not kept: a document the person was told could not be read must not be in their
      // profile — with a name and an email it filled in, and an entry in the list of documents — when they
      // go on to paste the text, or have a model read it, and that is what goes in.
      if (!result.duplicate && outcome.kind === "empty") {
        return {
          message: "Leímos el archivo pero no encontramos experiencia ni estudios. Podés pegar el texto o seguir con formularios.",
          reason: "nothing",
          ...(text ? { text } : {}),
        };
      }
      if (!result.duplicate) {
        result.profile.onboarding.omittedPersonalData += result.omittedPersonalData;
        saveStoredProfile(result.profile);
        saveSource(sourceId, info.name, parsed.lines ?? [], { layout: parsed.layout });
        recordMetric("document_added");
      }
      return { ok: true, result, parsed, sourceId, outcome };
    },
    [],
  );

  /**
   * One file, read and applied, and what came of it as a value. It touches nothing the screen
   * shows, so a screen can do it for several files one after another and say what happened to
   * each — a scanned PDF beside a CV that went in fine is two different things to tell.
   */
  const attempt = useCallback(
    async (file: File): Promise<ImportSuccess | ImportProblem> => {
      try {
        const doc = await readDocument(file);
        const parsed =
          doc.kind === "zip"
            ? parseLinkedInExport(doc.csvFiles)
            : parseDocument({ text: doc.text, ...(doc.kind === "pdf" ? { runs: doc.runs, info: doc.info } : {}) });
        const outcome = commit(
          parsed,
          {
            name: file.name,
            fileHash: doc.fileHash,
            pasted: false,
            chars: doc.kind === "zip" ? 0 : doc.text.length,
            // The two dates a file can give, as hints for which of two documents is newer: the one it says itself, and the device's.
            ...(Number.isFinite(file.lastModified) && file.lastModified > 0 ? { modifiedAt: new Date(file.lastModified).toISOString() } : {}),
            ...(doc.kind === "pdf" && (doc.info.modified ?? doc.info.created) ? { madeAt: doc.info.modified ?? doc.info.created! } : {}),
          },
          doc.kind === "zip" ? undefined : doc.text,
        );
        return "ok" in outcome ? outcome : { ...outcome, file };
      } catch (error) {
        if (error instanceof UnreadableFileError) return { message: error.message, reason: error.reason, file };
        if (error instanceof StorageWriteError) return { message: error.message, reason: "other" };
        return { message: "No pudimos leer ese archivo. Probá con otro, o pegá el texto.", reason: "other", file };
      }
    },
    [commit],
  );

  const importFile = useCallback(
    async (file: File): Promise<ImportSuccess | null> => {
      setBatch(1);
      setProblems([]);
      const outcome = await attempt(file);
      setBatch(0);
      if ("ok" in outcome) return outcome;
      setProblems([outcome]);
      return null;
    },
    [attempt],
  );

  /** Several files, in the order they came: what went in, and what did not. Nothing stops at the first that fails. */
  const importFiles = useCallback(
    async (files: readonly File[]): Promise<ImportBatch> => {
      setBatch(files.length);
      setProblems([]);
      const successes: ImportSuccess[] = [];
      const failed: ImportProblem[] = [];
      for (const file of files) {
        const outcome = await attempt(file);
        if ("ok" in outcome) successes.push(outcome);
        else failed.push(outcome);
      }
      setBatch(0);
      setProblems(failed);
      return { successes, problems: failed };
    },
    [attempt],
  );

  const importText = useCallback(
    async (text: string, name = "Texto pegado", options: { photo?: boolean } = {}): Promise<ImportSuccess | null> => {
      const clean = text.trim();
      setProblems([]);
      if (clean.length < MIN_PASTE) {
        setProblems([{ message: "Ese texto es muy corto para ser un CV o un perfil. Pegá el contenido completo.", reason: "empty" }]);
        return null;
      }
      setBatch(1);
      try {
        // The text of a photo, written by a model: read like any text, and marked for what it is (`readByAi`, `ImportedSource.photo`).
        const read = parseDocument({ text: clean });
        const outcome = commit(
          options.photo && read ? readByAi(read) : read,
          {
            name,
            fileHash: await sha256Hex(clean),
            pasted: true,
            chars: clean.length,
            ...(options.photo ? { photo: true as const } : {}),
          },
          clean,
        );
        if ("ok" in outcome) return outcome;
        setProblems([outcome]);
        return null;
      } catch (error) {
        setProblems([
          {
            message: error instanceof StorageWriteError ? error.message : "No pudimos leer ese texto.",
            reason: "other",
          },
        ]);
        return null;
      } finally {
        setBatch(0);
      }
    },
    [commit],
  );

  /**
   * "Leer con tu IA": the non-standard-CV case the spec means by it. Never
   * shown on its own — `SourceInput` offers it only alongside a `"nothing"`
   * problem that came with real text (never a ZIP, never a scanned PDF) — so
   * this is reached only after the heuristic parser already tried and found
   * nothing, exactly like "Mejorar la lectura" over a low-confidence block.
   */
  const importWithAi = useCallback(
    async (text: string, name = "Leído con IA", signal?: AbortSignal): Promise<{ ok: true; success: ImportSuccess } | { ok: false; message: string; reason?: DenialReason }> => {
      const outcome = await extractWithAi(text, "cv", signal);
      if (!outcome.ok) return outcome;
      const applied = commit(outcome.result, { name, fileHash: "", pasted: false, chars: text.length }, text);
      return "ok" in applied ? { ok: true, success: applied } : { ok: false, message: applied.message };
    },
    [commit],
  );

  return {
    busy,
    /** How many files the reading in progress is about. */
    batch,
    /** The first thing that went wrong, for a screen that only has room for one. */
    problem: problems[0] ?? null,
    problems,
    clearProblem: () => setProblems([]),
    dismissProblem: (index: number) => setProblems((current) => current.filter((_, at) => at !== index)),
    importFile,
    importFiles,
    importText,
    importWithAi,
  };
}
