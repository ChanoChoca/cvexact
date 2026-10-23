"use client";

import { useId, useState, type Ref } from "react";
import { Checkbox, Field, Input } from "@/components/ui";
import { lineOf, readDateLine, type DateLine } from "@/lib/onboarding/date-line";
import { MonthYearPicker } from "./MonthYearPicker";

/**
 * The dates of a stretch, written in one line — «mar 2020 – actualidad» — with what was read shown before it is kept, and
 * the months and years to pick as the other way, one tap further.
 *
 * Both write to the same three values (`from`, `to`, `current`), so a stretch picked with the lists shows in the line, and
 * one written in the line shows in the lists. What is shown in the box is what the person is typing until they leave it, and
 * the stretch as it was read once they have — unless it was not understood: that stays as it was written, with what to
 * change, because taking it away would take their words with it.
 */
export function DateLineField({ from, to, current, onChange, inputRef, open = false }: DateLine & { onChange: (next: DateLine) => void; /** For a field the screen is about: focused when it appears. */ inputRef?: Ref<HTMLInputElement>; /** The months and years to pick are in view, and not behind a fold. */ open?: boolean }) {
  const statusId = useId();
  // What is being typed, and only while it is: `null` shows the stretch as it is held.
  const [draft, setDraft] = useState<string | null>(null);
  const [now] = useState(() => new Date());
  const shown = draft ?? lineOf({ from, to, current });
  const reading = readDateLine(shown, now);

  const type = (text: string) => {
    setDraft(text);
    const next = readDateLine(text, now);
    if (next.kind === "read") onChange(next.line);
    else if (next.kind === "empty") onChange({ from: {}, to: {}, current: false });
  };
  const pick = (next: DateLine) => {
    setDraft(null);
    onChange(next);
  };

  const pickers = (
    <div className="grid gap-5 sm:grid-cols-2">
      <MonthYearPicker label="Desde" value={from} onChange={(value) => pick({ from: value, to, current })} />
      <div className="space-y-2">
        <MonthYearPicker label="Hasta" value={to} disabled={current} onChange={(value) => pick({ from, to: value, current })} />
        {/* Same word whatever the entry is — a job, a study, an internship — so "still going" always reads the same way. */}
        <Checkbox label="Actualmente" checked={current} onChange={(event) => pick({ from, to, current: event.target.checked })} />
      </div>
    </div>
  );

  return (
    <div className="space-y-3 sm:col-span-2">
      <Field label="Fechas" hint="Escribilas como quieras: mar 2020 – actualidad, o 2018 – 2021.">
        <Input
          ref={inputRef}
          value={shown}
          maxLength={60}
          autoComplete="off"
          aria-describedby={statusId}
          onChange={(event) => type(event.target.value)}
          // Left alone while it is not understood: the words are theirs, and so is fixing them.
          onBlur={() => reading.kind !== "unclear" && setDraft(null)}
        />
      </Field>
      {/* Said, not announced as it changes: on every keystroke it would talk over the typing. */}
      <p id={statusId} className={reading.kind === "unclear" ? "min-h-5 text-sm text-amber-300" : "min-h-5 text-sm text-ink-2"}>
        {reading.kind === "read" ? `Se guarda como: ${reading.says}.` : reading.kind === "unclear" ? reading.why : ""}
      </p>
      {open ? (
        pickers
      ) : (
        <details className="text-sm">
          <summary className="cursor-pointer text-ink-3 pointer-coarse:-my-3 pointer-coarse:py-3">Elegir con los desplegables</summary>
          <div className="mt-3">{pickers}</div>
        </details>
      )}
    </div>
  );
}
