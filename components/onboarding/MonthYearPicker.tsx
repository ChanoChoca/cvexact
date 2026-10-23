"use client";

import { useId, useState } from "react";
import { dateFromParts, MONTH_NAMES_ES, type DateValue } from "@/lib/profile/dates";
import { Select } from "@/components/ui";

/**
 * A month and a year, and either can be left out.
 *
 * "No sé el mes" is a real answer and it saves a year: nothing here fills in a
 * month the person did not give. The value has no `raw` text because nothing was
 * written; a date typed in a document keeps its own text elsewhere.
 *
 * A month can be picked before a year — `dateFromParts` has nowhere to keep one
 * on its own, so it is held here as a draft until a year joins it, and clearing
 * the year afterwards leaves the month exactly where it was rather than wiping
 * it too. A parent that needs this draft gone on a real reset — switching what
 * kind of entry a form is for, say — remounts this component with a new `key`,
 * the same way any other stale local state is cleared.
 */

const THIS_YEAR = new Date().getFullYear();
const OLDEST = 1965;

/**
 * The years a picker offers, newest first. A date that already says a year outside them keeps it among them: a value a picker cannot show is
 * a value it silently shows as empty, and the next save would erase it.
 */
export function yearOptions(newest: number, oldest: number, current?: number): number[] {
  const years = Array.from({ length: Math.max(0, newest - oldest + 1) }, (_, i) => newest - i);
  if (current !== undefined && !years.includes(current)) years.push(current);
  return years.sort((a, b) => b - a);
}

/** How far ahead a date that lapses can be: a licence is renewed for years, and none is for much more than fifteen. */
export const EXPIRY_YEARS_AHEAD = 15;

export function MonthYearPicker({
  label,
  value,
  onChange,
  disabled,
  newest = THIS_YEAR + 1,
  oldest = OLDEST,
}: {
  label: string;
  value: DateValue;
  onChange: (value: DateValue) => void;
  disabled?: boolean;
  /** The latest and the earliest year it offers. For a date that has not come yet — until when something holds — the first looks ahead. */
  newest?: number;
  oldest?: number;
}) {
  const id = useId();
  const years = yearOptions(newest, oldest, value.year);
  const [draftMonth, setDraftMonth] = useState<number | undefined>(undefined);
  const month = value.year === undefined ? draftMonth : value.month;

  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="mb-1 block font-solar text-[12.5px] font-bold tracking-[0.18em] text-ink-3 uppercase">
        {label}
      </legend>
      <div className="flex gap-2">
        <Select
          aria-label={`${label}: mes`}
          id={`${id}-m`}
          value={month ?? ""}
          onChange={(event) => {
            const picked = event.target.value ? Number(event.target.value) : undefined;
            if (value.year === undefined) setDraftMonth(picked);
            else onChange(dateFromParts(value.year, picked));
          }}
          className="w-1/2"
        >
          <option value="">Mes (no sé)</option>
          {MONTH_NAMES_ES.map((name, i) => (
            <option key={name} value={i + 1}>
              {name}
            </option>
          ))}
        </Select>
        <Select
          aria-label={`${label}: año`}
          id={`${id}-y`}
          value={value.year ?? ""}
          onChange={(event) => {
            const picked = event.target.value ? Number(event.target.value) : undefined;
            if (picked === undefined) {
              // Clearing the year leaves its month as a draft instead of losing it too.
              setDraftMonth(month);
            } else if (month !== undefined) {
              // The year just arrived to join a month already picked.
              setDraftMonth(undefined);
            }
            onChange(dateFromParts(picked, month));
          }}
          className="w-1/2"
        >
          <option value="">Año</option>
          {years.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </Select>
      </div>
      {value.year === undefined && draftMonth !== undefined ? <p className="mt-1 text-xs text-ink-3">Falta el año</p> : null}
    </fieldset>
  );
}
