"use client";

import { useId, useState } from "react";
import { Button, Textarea } from "@/components/ui";
import { CAPTURE_MAX, CAPTURE_PROBLEM, captureNote, type CaptureResult } from "@/lib/profile/capture";
import type { NoteVia } from "@/lib/schemas/profile-v2";
import { updateStoredProfile } from "@/lib/storage/local";

/**
 * «Anotá algo» (e5, O15): one box, and a note with today's date. Nothing reads it — no model, no rule — and nothing is asked of it: it is written down
 * as it was written, to be put somewhere the next time the app asks about it, or never. The way out is as plain as the way in: «Cerrar» costs nothing.
 *
 * Used in the dialog that every screen of the app can open and in the page that what is shared from another app lands on (`SharedNote`); `via` says which.
 */

export function NoteForm({ via, initial = "", onSaved, onClose, closeLabel = "Cerrar" }: { via: NoteVia; initial?: string; onSaved: () => void; onClose: () => void; closeLabel?: string }) {
  const field = useId();
  const [text, setText] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);

  const save = () => {
    let result = null as CaptureResult | null;
    updateStoredProfile((draft) => {
      result = captureNote(draft, text, via);
    });
    if (!result || !result.ok) {
      setProblem(CAPTURE_PROBLEM[result ? result.reason : "empty"]);
      return;
    }
    setProblem(null);
    onSaved();
  };

  return (
    <div className="space-y-4" data-note-form>
      <div className="space-y-1">
        <label htmlFor={field} className="font-solar text-[12.5px] font-bold tracking-[0.18em] text-ink-3 uppercase">
          Anotá algo
        </label>
        <Textarea
          id={field}
          rows={4}
          value={text}
          maxLength={CAPTURE_MAX}
          placeholder="Lo que hiciste, lo que lograste o lo que no quieras olvidar. Se guarda con la fecha de hoy."
          onChange={(event) => {
            setText(event.target.value);
            setProblem(null);
          }}
        />
        <p className="text-xs text-ink-3">Queda en tus notas, en este navegador. No hace falta que quede prolijo: después te preguntamos si va en alguno de tus puestos.</p>
      </div>
      {problem ? (
        <p role="alert" className="text-xs text-amber-300">
          {problem}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button type="button" onClick={save} disabled={text.trim() === ""}>
          Guardar
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          {closeLabel}
        </Button>
      </div>
    </div>
  );
}
