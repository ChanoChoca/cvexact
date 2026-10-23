"use client";

import { useState, type ReactNode } from "react";
import { Button, Checkbox, Field, Input } from "@/components/ui";
import { useFocusOnDesktop } from "@/components/ui/useFocusOnDesktop";
import { ENTRY_LABELS } from "@/lib/onboarding/entries";
import { FIXABLE_DOUBTS, type DoubtFix } from "@/lib/onboarding/review";
import { type DateValue } from "@/lib/profile/dates";
import { DateLineField } from "./DateLineField";
import { MonthYearPicker } from "./MonthYearPicker";

/**
 * The control for the one missing thing a doubt is about, right under the doubt: the company, the role, the dates, the end.
 *
 * A doubt used to be a sentence — «No encontramos las fechas» — and putting it right meant opening the card's whole form,
 * finding the field and saving: three steps for one blank, with the blank itself not even in focus. Now the doubt carries its
 * own control, folded until it is tapped (a card is not a screen of boxes), with the field in focus where there is a mouse
 * to want it, and saving it settles that doubt and no other.
 */

/** What the button that opens the control says: what it is for, not «Corregir» for everything. */
export const FIX_LABEL: Record<string, string> = {
  no_company: "Escribirla",
  no_role: "Escribirlo",
  no_institution: "Escribirla",
  no_degree: "Escribirlo",
  no_dates: "Poner las fechas",
  unreadable_date: "Poner las fechas",
  no_end: "Poner la fecha de fin",
};

export type FixTarget = {
  entity: "experience" | "education";
  /** The stretch as the card has it now, so that what was read is the starting point and not a blank. */
  start: DateValue;
  end: DateValue;
  current: boolean;
};

/** Whether a doubt has a control of its own: the blanks do, the looks («qué línea es cuál») stay for the card's form. */
export const isFixable = (entity: FixTarget["entity"], doubt: string): boolean => (FIXABLE_DOUBTS[entity] as readonly string[]).includes(doubt);

function TextFix({ doubt, label, onFix }: { doubt: "no_company" | "no_role" | "no_institution" | "no_degree"; label: string; onFix: (fix: DoubtFix) => void }) {
  const [value, setValue] = useState("");
  const focus = useFocusOnDesktop<HTMLInputElement>();
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim()) onFix({ doubt, value });
      }}
    >
      <Field label={label}>
        <Input ref={focus} value={value} maxLength={160} autoComplete="off" onChange={(event) => setValue(event.target.value)} />
      </Field>
      <Button type="submit" compact disabled={!value.trim()}>
        Guardar
      </Button>
    </form>
  );
}

function DatesFix({ doubt, target, onFix }: { doubt: "no_dates" | "unreadable_date"; target: FixTarget; onFix: (fix: DoubtFix) => void }) {
  const [stretch, setStretch] = useState({ from: target.start, to: target.end, current: target.current });
  const focus = useFocusOnDesktop<HTMLInputElement>();
  // The start is what a stretch cannot go without; the end may stay as it is.
  const ready = stretch.from.year !== undefined;
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) onFix({ doubt, start: stretch.from, end: stretch.to, current: stretch.current });
      }}
    >
      <DateLineField {...stretch} onChange={setStretch} inputRef={focus} />
      <Button type="submit" compact disabled={!ready}>
        Guardar
      </Button>
    </form>
  );
}

function EndFix({ target, onFix }: { target: FixTarget; onFix: (fix: DoubtFix) => void }) {
  const [end, setEnd] = useState<DateValue>(target.end);
  const [current, setCurrent] = useState(target.current);
  const ready = end.year !== undefined || current;
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) onFix({ doubt: "no_end", end, current });
      }}
    >
      <div className="space-y-2">
        <MonthYearPicker label="Hasta" value={end} disabled={current} onChange={setEnd} />
        <Checkbox label="Actualmente" checked={current} onChange={(event) => setCurrent(event.target.checked)} />
      </div>
      <Button type="submit" compact disabled={!ready}>
        Guardar
      </Button>
    </form>
  );
}

/** The control for one doubt, or nothing when the doubt is not a blank to fill in. `onFix` saves it. */
export function DoubtFixControl({ doubt, target, onFix }: { doubt: string; target: FixTarget; onFix: (fix: DoubtFix) => void }): ReactNode {
  if (!isFixable(target.entity, doubt)) return null;
  switch (doubt) {
    case "no_company":
      return <TextFix doubt="no_company" label={ENTRY_LABELS.job.where} onFix={onFix} />;
    case "no_role":
      return <TextFix doubt="no_role" label={ENTRY_LABELS.job.what} onFix={onFix} />;
    case "no_institution":
      return <TextFix doubt="no_institution" label={ENTRY_LABELS.study.where} onFix={onFix} />;
    case "no_degree":
      return <TextFix doubt="no_degree" label={ENTRY_LABELS.study.what} onFix={onFix} />;
    case "no_dates":
    case "unreadable_date":
      return <DatesFix doubt={doubt} target={target} onFix={onFix} />;
    case "no_end":
      return <EndFix target={target} onFix={onFix} />;
    default:
      return null;
  }
}
