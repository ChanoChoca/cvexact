"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button, Input } from "@/components/ui";
import { Chips } from "@/components/ui/Chips";
import { EXPIRY_YEARS_AHEAD, MonthYearPicker } from "@/components/onboarding/MonthYearPicker";
import { OCR_DOWNLOAD_MB, readText, type OcrProgress } from "@/lib/ocr/engine";
import { classesText, expiryLabel, likelyExpiry, readCredential, type Found } from "@/lib/ocr/credential";
import { OCR_FAILURE, ocrFailureOf, type OcrFailure } from "@/lib/ocr/failure";
import { eraseCanvas, photoToCanvas } from "@/lib/ocr/image";
import { dateFromParts, spelledDate, type DateValue } from "@/lib/profile/dates";
import { useExperiment } from "@/lib/use-experiment";
import { LABEL } from "./cells";

/**
 * «Leer de una foto» (e5, O18): the photo of a licence or a carnet, read in this browser for what the profile keeps of it — the class of a
 * licence and, when the screen asks for it, the day it lapses (`withExpiry`).
 *
 * What it does with the photo is the point of it, and the person is told before they choose one: it is opened in this browser, drawn on a canvas that is erased as soon as it
 * has been read, and read by a program that runs here (`lib/ocr/engine.ts`) and whose files come from this site. It is not uploaded, not stored and not given to an AI. Of
 * everything the text of a card says —a name, a document, an address, a date of birth, a blood group, a will to donate— `readCredential` returns the class and the dates that may be
 * the one it lapses, and nothing else; the text itself is a local of one function and is gone when it returns.
 *
 * What was found is a proposal, in boxes the person can change: nothing is kept until they say «Usar estos datos», and a date is chosen for them only when there is no doubt
 * which it is. An OCR is wrong often enough that this is not courtesy but the design.
 *
 * Switched off, it draws nothing (`lib/experiments.ts`).
 */

export type CredentialKind = "license" | "expiry";

export type PhotoResult = {
  /** The class as it will be written, or null when the person left it empty. Only for a licence. */
  license: string | null;
  /** Until when, or null when the person left it empty. */
  expires: DateValue | null;
};

/**
 * What was kept, in a line, with the sentence that says what became of the photo: «Usamos la clase B1 y el vencimiento mayo de 2029. La foto no quedó guardada en ningún lado.»
 * The line of what was kept is the point of it — what the photo gave is one tap from being a fact of the profile, and the person is told which.
 */
export function photoReceipt(kind: CredentialKind, result: PhotoResult): string {
  const kept: string[] = [];
  if (kind === "license" && result.license) kept.push(`la clase ${result.license}`);
  if (result.expires && spelledDate(result.expires)) kept.push(`el vencimiento ${spelledDate(result.expires)}`);
  return `${kept.length > 0 ? `Usamos ${kept.join(" y ")}.` : "No usamos nada."} La foto no quedó guardada en ningún lado.`;
}

/**
 * What the screen does with what the person confirmed, and the way back: a function that takes it back, or nothing when it cannot. It is asked for here —and not made
 * of the profile as it was— so that only what the photo gave is given back, and whatever else was edited in the meantime stays.
 */
export type OnUse = (result: PhotoResult) => (() => void) | void;

const THIS_YEAR = new Date().getFullYear();

type Phase =
  | { name: "idle" }
  | { name: "working"; progress: OcrProgress }
  | { name: "review"; found: Found }
  | { name: "problem"; reason: OcrFailure };

const IDLE: Phase = { name: "idle" };

export function Review({ kind, found, current, onUse, onCancel, withExpiry = true }: { kind: CredentialKind; found: Found; current: string; onUse: (result: PhotoResult) => void; onCancel: () => void; withExpiry?: boolean }) {
  const licenseId = useId();
  const likely = likelyExpiry(found);
  const [license, setLicense] = useState(classesText(found));
  const [pick, setPick] = useState<string | null>(likely ? String(found.expiries.indexOf(likely)) : null);
  const [expires, setExpires] = useState<DateValue>(likely && withExpiry ? dateFromParts(likely.year, likely.month) : {});
  const hasExpiry = withExpiry && expires.year !== undefined;
  const hasLicense = kind === "license" && license.trim() !== "";

  return (
    <div className="space-y-4" data-photo-review>
      <p className="text-sm text-ink-2">Esto es lo que encontramos en la foto. Revisalo y corregí lo que haga falta: leer una foto se equivoca.</p>
      {kind === "license" ? (
        <div>
          <label className={`mb-1 block ${LABEL}`} htmlFor={licenseId}>
            Clase
          </label>
          <Input id={licenseId} data-photo-license value={license} maxLength={80} autoComplete="off" placeholder="Como figura en la licencia" onChange={(event) => setLicense(event.target.value)} />
          {found.classes.length === 0 ? <p className="mt-1 text-xs text-ink-3">No encontramos la clase en la foto: si la sabés, escribila.</p> : null}
          {current.trim() && current.trim() !== license.trim() ? <p className="mt-1 text-xs text-ink-3">Ahora dice «{current.trim()}». Si lo usás, lo cambiamos.</p> : null}
        </div>
      ) : null}
      {withExpiry ? (
        <div className="space-y-2">
          {found.expiries.length > 0 ? (
            <>
              <p className="text-sm text-ink-2">{found.expiries.length === 1 ? "Encontramos esta fecha." : "Encontramos estas fechas."} ¿Cuál es la de vencimiento?</p>
              <Chips
                label="Fecha de vencimiento"
                options={found.expiries.map((entry, index) => ({ value: String(index), label: expiryLabel(entry) }))}
                value={pick}
                onChange={(value) => {
                  const chosen = found.expiries[Number(value)];
                  setPick(value);
                  if (chosen) setExpires(dateFromParts(chosen.year, chosen.month));
                }}
              />
              <p className="text-xs text-ink-3">Las fechas de nacimiento y de otorgamiento no las tenemos en cuenta.</p>
            </>
          ) : (
            <p className="text-sm text-ink-2">No encontramos ninguna fecha de vencimiento en la foto: elegila vos si la sabés.</p>
          )}
          <MonthYearPicker
            label="Vence"
            value={expires}
            newest={THIS_YEAR + EXPIRY_YEARS_AHEAD}
            oldest={THIS_YEAR - 10}
            onChange={(date) => {
              setPick(null);
              setExpires(date);
            }}
          />
        </div>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button type="button" disabled={!hasLicense && !hasExpiry} onClick={() => onUse({ license: hasLicense ? license.trim() : null, expires: hasExpiry ? expires : null })}>
          Usar estos datos
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

export function PhotoReader({
  kind,
  current,
  onUse,
  onClose,
  embedded = false,
  withExpiry = true,
}: {
  kind: CredentialKind;
  current: string;
  onUse: (result: PhotoResult) => void;
  onClose: () => void;
  /** Inside the panel that adds a respaldo or a photo, which has its own frame: this one draws none. */
  embedded?: boolean;
  /** Whether the date it lapses is read and asked for: a carnet's is; the licence of the practical facts reads only its class. */
  withExpiry?: boolean;
}) {
  const fileId = useId();
  const [phase, setPhase] = useState<Phase>(IDLE);
  const controller = useRef<AbortController | null>(null);

  // Leaving the page, or closing the panel, stops the reading: nothing goes on with the photo.
  useEffect(() => () => controller.current?.abort(), []);

  const read = async (file: File) => {
    controller.current?.abort();
    const mine = new AbortController();
    controller.current = mine;
    setPhase({ name: "working", progress: { stage: "preparing", fraction: null } });
    let canvas: HTMLCanvasElement | null = null;
    try {
      canvas = await photoToCanvas(file);
      // The text of the card is this local and nothing else holds it: what comes out of `readCredential` is all that is kept.
      const found = readCredential(await readText(canvas, { signal: mine.signal, onProgress: (progress) => !mine.signal.aborted && setPhase({ name: "working", progress }) }));
      if (!mine.signal.aborted) setPhase({ name: "review", found });
    } catch (error) {
      const reason = ocrFailureOf(error);
      if (!mine.signal.aborted && reason !== "aborted") setPhase({ name: "problem", reason });
    } finally {
      if (canvas) eraseCanvas(canvas);
    }
  };

  const stop = () => {
    controller.current?.abort();
    setPhase(IDLE);
  };

  const subject = kind === "license" ? "licencia de conducir" : "credencial";
  const kept = kind === "license" ? (withExpiry ? "la clase y la fecha de vencimiento" : "la clase") : "la fecha de vencimiento";

  return (
    <div className={embedded ? "space-y-4" : "space-y-4 border border-rule p-4"} data-credential-photo data-photo-phase={phase.name}>
      <div className="space-y-1">
        <p className={LABEL}>Leer la {subject} desde una foto</p>
        <p className="text-xs text-ink-3" data-photo-notice>
          La foto se lee en este navegador: no se sube, no se guarda y no va a ninguna IA. De todo lo que dice nos quedamos solo con {kept}, y {withExpiry ? "las ves" : "la ves"}
          antes de guardar. La primera vez baja unos {OCR_DOWNLOAD_MB} MB de este mismo sitio.
        </p>
      </div>

      {phase.name === "review" ? (
        <Review kind={kind} found={phase.found} current={current} onUse={onUse} onCancel={onClose} withExpiry={withExpiry} />
      ) : (
        <>
          {phase.name === "working" ? (
            <div className="space-y-3">
              <p role="status" className="text-sm text-ink-2" aria-live="polite" data-photo-progress={phase.progress.stage}>
                {phase.progress.stage === "reading" ? `Leyendo la foto… ${Math.round(phase.progress.fraction * 100)} %` : "Preparando el lector… la primera vez tarda más."}
              </p>
              <Button type="button" variant="ghost" onClick={stop}>
                Cancelar la lectura
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className={`mb-1 block ${LABEL}`} htmlFor={fileId}>
                  La foto
                </label>
                <input
                  id={fileId}
                  type="file"
                  accept="image/*"
                  className="block w-full text-sm text-ink-2 file:mr-3 file:border file:border-white/15 file:bg-transparent file:px-3 file:py-2 file:text-ink-2 pointer-coarse:min-h-11 pointer-coarse:file:py-3"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    // The file is read once and not kept: the box is emptied so that the same one can be chosen again.
                    event.target.value = "";
                    if (file) void read(file);
                  }}
                />
                <p className="mt-1 text-xs text-ink-3">Con buena luz, sin reflejos y con la credencial llenando la foto.</p>
              </div>
              {phase.name === "problem" ? (
                <p role="alert" className="text-xs text-amber-300" data-photo-problem={phase.reason}>
                  {OCR_FAILURE[phase.reason]}
                </p>
              ) : null}
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancelar
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** The line under the button that says what the photo gave, and takes it back: the same wherever a photo is read. */
export function PhotoReceipt({ line, onUndo }: { line: string; onUndo?: (() => void) | undefined }) {
  return (
    <p role="status" className="text-xs text-ink-2" data-photo-done>
      {line}
      {onUndo ? (
        <>
          {" "}
          <button type="button" onClick={onUndo} className="underline decoration-oro-soft underline-offset-4 hover:text-ink pointer-coarse:-my-3.5 pointer-coarse:inline-block pointer-coarse:py-3.5">
            Deshacer
          </button>
        </>
      ) : null}
    </p>
  );
}

export function CredentialPhoto({ kind, current = "", onUse, withExpiry = true }: { kind: CredentialKind; current?: string; onUse: OnUse; withExpiry?: boolean }) {
  const on = useExperiment("credential_photo");
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<{ line: string; undo?: () => void } | null>(null);
  if (!on) return null;

  if (!open) {
    return (
      <div className="space-y-2" data-credential-photo-entry>
        <Button type="button" variant="secondary" compact onClick={() => setOpen(true)}>
          Leer de una foto
        </Button>
        {notice ? (
          <PhotoReceipt
            line={notice.line}
            onUndo={
              notice.undo
                ? () => {
                    notice.undo?.();
                    setNotice({ line: "Listo: quedó como estaba." });
                  }
                : undefined
            }
          />
        ) : null}
      </div>
    );
  }

  return (
    <PhotoReader
      kind={kind}
      current={current}
      withExpiry={withExpiry}
      onClose={() => setOpen(false)}
      onUse={(result) => {
        const undo = onUse(result);
        setOpen(false);
        setNotice({ line: photoReceipt(kind, result), ...(undo ? { undo } : {}) });
      }}
    />
  );
}
