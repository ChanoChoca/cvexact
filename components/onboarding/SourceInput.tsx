"use client";

import { useState, type ReactNode } from "react";
import { GooglePhotoNotice } from "@/components/ai/GoogleNotice";
import { Alert, Button, Spinner, Textarea } from "@/components/ui";
import { hasGoogleKey } from "@/lib/ai/google-terms";
import { isCopyFile, kindOfFile } from "@/lib/import/formats";
import { photoFooter } from "@/lib/legal/data-flow";
import { transcribeWithAi } from "@/lib/onboarding/ai";
import { useSettings } from "@/lib/storage/hooks";
import { AiAction } from "./AiAction";
import { Dropzone } from "./Dropzone";
import { useDraft } from "./useDraft";
import type { ImportSuccess, useImport } from "./useImport";

/**
 * Where documents come in: dropped, picked, or pasted. The same for a CV, a LinkedIn
 * profile and both at once — the reader tells which is which from what is inside — so
 * only the words around it differ.
 *
 * When a file cannot be read it says why, for that file, and offers the exits that make
 * sense for that reason. A scanned PDF is the hard case: it has no text to read, but it
 * is still the person's document, so it can be shown beside the forms for them to copy
 * from. A document that *does* have text but the heuristic parser could not structure —
 * the non-standard CV the spec means by that — offers "Leer con tu IA" alongside the
 * other exits, over the same text, never a second upload. A photo of a CV offers to be read
 * with the person's own model — which writes down what it sees, and puts it in the box where
 * pasted text goes, with a warning, for them to look at against the photo before anything reads
 * it. Several files at once each go in on their own: one that fails does not stop the others,
 * and what went in is not lost.
 */

type Importer = ReturnType<typeof useImport>;

export function SourceInput({
  importer,
  accept,
  multiple,
  dropTitle,
  dropHint,
  pasteName,
  pastePlaceholder,
  draftKey = "paste",
  onImported,
  onManual,
  onCopy,
  children,
}: {
  importer: Importer;
  accept: string;
  /** Several files in one gesture — a CV and a LinkedIn profile together. */
  multiple?: boolean;
  dropTitle: ReactNode;
  dropHint?: ReactNode;
  pasteName: string;
  pastePlaceholder: string;
  /** Under what name the text pasted and not yet read is kept: two of these on one page must not share one. */
  draftKey?: string;
  /** `all`: every document that went in, in the order it did — `success` is the last of them. */
  onImported: (success: ImportSuccess, all: readonly ImportSuccess[]) => void;
  /** Build it by hand instead, with the document (when there is one) beside the forms. */
  onManual?: (file?: File) => void;
  /** Where a copy of a profile —the `.json` that «Bajar una copia» made— goes when it is the one file that came: recovered, and not read as a CV. */
  onCopy?: ((file: File) => void) | undefined;
  children?: ReactNode;
}) {
  const { busy, batch, problems, dismissProblem, importFile, importFiles, importText, importWithAi } = importer;
  // A photo is the one reading that cannot have anything struck out of it first, and what Google says of its free tier is said to whoever has a key of its.
  const googleKey = hasGoogleKey(useSettings().entries);
  // What was pasted and not yet read survives a reload, a closed tab, a phone that went to another app.
  const kept = useDraft<string>(draftKey, (value) => typeof value === "string");
  const [pasting, setPasting] = useState(() => kept.restored !== null);
  const [draft, setDraft] = useState(() => kept.restored ?? "");
  const [resumed] = useState(() => kept.restored !== null);
  /** The text in the box was written by a model from this photo: it is read as the text of a photo, and the box says so. */
  const [fromPhoto, setFromPhoto] = useState<string | null>(null);
  /** Some files went in and some did not: whether to go on with what was read is the person's to say. */
  const [partial, setPartial] = useState<{ successes: ImportSuccess[]; read: number; total: number } | null>(null);

  const handleFiles = async (files: File[]) => {
    setPartial(null);
    // A copy of the profile is not a document to read: it brings the profile back, and what it would replace is said first.
    if (onCopy && files.length === 1 && isCopyFile(files[0]!)) {
      onCopy(files[0]!);
      return;
    }
    if (files.length === 1) {
      const success = await importFile(files[0]!);
      if (success) onImported(success, [success]);
      return;
    }
    const { successes, problems: failed } = await importFiles(files);
    const last = successes[successes.length - 1];
    if (!last) return;
    if (failed.length === 0) onImported(last, successes);
    else setPartial({ successes, read: successes.length, total: files.length });
  };

  const handleText = async () => {
    setPartial(null);
    const success = await importText(draft, fromPhoto ? `Foto: ${fromPhoto}` : pasteName, fromPhoto ? { photo: true } : {});
    if (success) {
      kept.forget();
      setFromPhoto(null);
      onImported(success, [success]);
    }
  };

  // Which file it was only needs saying when there was a choice: several at once, some of which went in.
  const named = problems.length > 1 || partial !== null;

  if (busy) {
    return (
      <p role="status" className="flex items-center justify-center gap-3 border border-rule bg-paper-2 px-6 py-12 text-sm text-ink-2">
        <Spinner />
        {batch > 1 ? "Leyendo tus documentos…" : "Leyendo tu documento…"} Pasa en tu navegador; no se sube a ningún lado.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {pasting ? (
        <div className="space-y-3">
          {fromPhoto ? (
            <Alert tone="warn">
              Este texto lo escribió tu IA mirando tu foto, y puede tener errores: un número, una fecha, un nombre. Comparalo con la foto y corregí lo que esté mal antes de leerlo. Lo que salga de acá queda marcado para que lo revises, y la revisión compara con este texto, no con tu foto.
            </Alert>
          ) : null}
          {resumed && !fromPhoto ? <p className="text-xs text-ink-3">Retomé el texto que habías pegado.</p> : null}
          <Textarea
            rows={10}
            autoFocus
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              kept.remember(event.target.value);
            }}
            placeholder={pastePlaceholder}
            aria-label="Texto para leer"
            className="min-h-48 border py-3"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={handleText}>Leer este texto</Button>
            <Button
              variant="ghost"
              onClick={() => {
                setPasting(false);
                setFromPhoto(null);
                importer.clearProblem();
                // The file is the way they chose: a reload should not open the paste box they put away.
                kept.forget();
              }}
            >
              Mejor subo el archivo
            </Button>
          </div>
        </div>
      ) : (
        <>
          <Dropzone accept={accept} multiple={multiple} onFiles={handleFiles} title={dropTitle} hint={dropHint} />
          <p className="text-sm text-ink-3">
            ¿Preferís pegar el texto?{" "}
            <button
              type="button"
              onClick={() => setPasting(true)}
              className="cursor-pointer underline decoration-oro-soft underline-offset-4 transition-colors hover:text-ink pointer-coarse:-my-3 pointer-coarse:py-3"
            >
              Pegar el texto
            </button>
          </p>
        </>
      )}

      {partial ? (
        <Alert tone="info">
          <p>
            Leímos {partial.read} de {partial.total} archivos. Podés seguir con lo que se leyó y agregar el resto después.
          </p>
          <div className="mt-3">
            <Button onClick={() => onImported(partial.successes[partial.successes.length - 1]!, partial.successes)}>Revisar lo que encontramos</Button>
          </div>
        </Alert>
      ) : null}

      {problems.map((problem, index) => (
        <Alert key={`${index}:${problem.file?.name ?? ""}`} tone="bad">
          <p>
            {named && problem.file ? `«${problem.file.name}»: ` : ""}
            {problem.message}
          </p>
          {/* A PDF printed from an image has no letters in it, only a picture of them: the fix is upstream. */}
          {problem.reason === "scanned" || (problem.reason === "empty" && problem.file) ? (
            <p className="mt-2 text-xs text-ink-3">
              Si tu CV está en Word o Google Docs, subí ese archivo (.docx) o descargalo otra vez como PDF: así tiene texto para leer.
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {/* A photo has nothing to read but can be copied from: the way on is the text, and it is the first thing offered. */}
            {problem.reason === "photo" && !pasting ? (
              <Button
                onClick={() => {
                  dismissProblem(index);
                  setPasting(true);
                }}
              >
                Pegar el texto
              </Button>
            ) : null}
            <Button variant="secondary" onClick={() => dismissProblem(index)}>
              Subir otra versión
            </Button>
            {!pasting && problem.reason !== "photo" ? (
              <Button
                variant="secondary"
                onClick={() => {
                  dismissProblem(index);
                  setPasting(true);
                }}
              >
                Pegar el texto
              </Button>
            ) : null}
            {onManual ? (
              <Button variant="secondary" onClick={() => onManual(problem.file)}>
                {/* Named for what it does: a PDF is drawn beside the forms; anything else goes to the forms alone. */}
                {problem.file && kindOfFile(problem.file) === "pdf" ? "Cargarlo yo, con el documento al lado" : "Seguir con formularios"}
              </Button>
            ) : null}
          </div>
          {/* A photo has the letters in it as a picture: a model that sees can copy them down, and the person checks the copy. */}
          {problem.reason === "photo" && problem.file ? (
            <div className="mt-3 space-y-3">
              {googleKey ? <GooglePhotoNotice /> : null}
              <AiAction
                label="Leer la foto con tu IA"
                busyLabel="Leyendo la foto…"
                footer={photoFooter()}
                // Only for whoever has a key already: the way on for everyone is copying the text out of the photo, and a key is not
                // something to ask for in the middle of a refused file.
                whenUnavailable="hide"
                run={async (signal) => {
                  const outcome = await transcribeWithAi(problem.file!, signal);
                  if (!outcome.ok) return outcome;
                  dismissProblem(index);
                  setDraft(outcome.result);
                  kept.remember(outcome.result);
                  setFromPhoto(problem.file!.name);
                  setPasting(true);
                  return { ok: true };
                }}
                onDone={() => undefined}
              />
            </div>
          ) : null}
          {problem.text ? (
            <div className="mt-3">
              <AiAction
                label="Leer con tu IA"
                busyLabel="Leyendo…"
                run={async (signal) => {
                  const outcome = await importWithAi(problem.text!, problem.file?.name ?? pasteName, signal);
                  if (!outcome.ok) return outcome;
                  onImported(outcome.success, [outcome.success]);
                  return { ok: true };
                }}
                onDone={() => undefined}
              />
            </div>
          ) : null}
        </Alert>
      ))}

      {children}
    </div>
  );
}
