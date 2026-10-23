"use client";

import { Field, Input } from "@/components/ui";
import type { EntryForm } from "@/lib/onboarding/entries";
import { DateLineField } from "./DateLineField";
import { MonthYearPicker } from "./MonthYearPicker";

/**
 * The fields of an entry — what, where, and its dates, in one line or picked — shared by the profile's own forms to add a job or a study and by "add
 * what is missing" on the review.
 */
export function EntryFormFields({
  form,
  onChange,
  whatLabel,
  whereLabel,
  datesOpen = false,
}: {
  form: EntryForm;
  onChange: (patch: Partial<EntryForm>) => void;
  whatLabel: string;
  whereLabel: string;
  /** The months and years to pick are in view, and not behind a fold. */
  datesOpen?: boolean;
}) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Field label={whatLabel}>
        <Input value={form.what} onChange={(event) => onChange({ what: event.target.value })} autoComplete="off" />
      </Field>
      <Field label={whereLabel}>
        <Input value={form.where} onChange={(event) => onChange({ where: event.target.value })} autoComplete="off" />
      </Field>
      {form.kind === "certification" ? (
        // One date: when it was finished or given. The "Hasta" of the form, so that what is kept is a date like the others.
        <MonthYearPicker label="Fecha" value={form.to} onChange={(to) => onChange({ to })} />
      ) : form.kind !== "project" ? (
        <DateLineField from={form.from} to={form.to} current={form.current} onChange={(next) => onChange(next)} open={datesOpen} />
      ) : null}
    </div>
  );
}
