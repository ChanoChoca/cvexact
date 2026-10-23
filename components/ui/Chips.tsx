"use client";

import { useRef, type KeyboardEvent } from "react";
import { cx } from "@/components/ui";

/**
 * Chips for closed answers: a level, a kind, yes or no, "saltar". They are for
 * choosing among things the app already knows, never for offering content — what
 * a chip says is what gets saved if it is picked.
 *
 * `Chips` is one choice among several and behaves as a radio group, arrow keys
 * included; `MultiChips` is any number of them and behaves as toggle buttons.
 */

type Option<T extends string> = { value: T; label: string; hint?: string };

const CHIP =
  "min-h-9 border px-3.5 py-2 text-left text-sm transition-colors pointer-coarse:min-h-11 motion-reduce:transition-none focus-visible:outline-none focus-visible:border-solar-g4";
const OFF = "border-white/15 text-ink-2 hover:border-white/40 hover:text-ink";
const ON = "border-solar-g4 bg-white/[0.06] text-ink";

export function Chips<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: ReadonlyArray<Option<T>>;
  value: T | null | undefined;
  onChange: (value: T) => void;
  /** What is being chosen, for anyone who cannot see the question above. */
  label: string;
  className?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const move = (event: KeyboardEvent, index: number) => {
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const back = event.key === "ArrowLeft" || event.key === "ArrowUp";
    if (!forward && !back) return;
    event.preventDefault();
    const next = (index + (forward ? 1 : -1) + options.length) % options.length;
    onChange(options[next]!.value);
    refs.current[next]?.focus();
  };

  // Tab reaches the chosen chip, or the first when none is chosen: one stop in
  // the group, arrows inside it.
  const stop = Math.max(0, options.findIndex((option) => option.value === value));

  return (
    <div role="radiogroup" aria-label={label} className={cx("flex flex-wrap gap-2", className)}>
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={index === stop ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => move(event, index)}
            className={cx(CHIP, selected ? ON : OFF)}
          >
            {option.label}
            {option.hint ? <span className="mt-0.5 block text-xs text-ink-3">{option.hint}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function MultiChips<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: ReadonlyArray<Option<T>>;
  value: readonly T[];
  onChange: (value: T[]) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cx("flex flex-wrap gap-2", className)}>
      {options.map((option) => {
        const selected = value.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(selected ? value.filter((v) => v !== option.value) : [...value, option.value])}
            className={cx(CHIP, selected ? ON : OFF)}
          >
            {option.label}
            {option.hint ? <span className="mt-0.5 block text-xs text-ink-3">{option.hint}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Buttons that answer at once: a level, "sí" or "no". Not a radio group — choosing
 * one *is* the answer, so moving between them with the arrow keys must not send
 * anything, which is exactly what a radio group's arrows do.
 */
export function ChoiceButtons<T extends string>({
  options,
  onPick,
  label,
  value,
  disabled,
  className,
}: {
  options: ReadonlyArray<Option<T>>;
  onPick: (value: T) => void;
  label: string;
  /** The one that is open, when picking one reveals something instead of sending. */
  value?: T | null | undefined;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cx("flex flex-wrap gap-2", className)}>
      {options.map((option) => {
        const open = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            aria-pressed={value === undefined ? undefined : open}
            onClick={() => onPick(option.value)}
            className={cx(CHIP, open ? ON : OFF, "disabled:cursor-not-allowed disabled:opacity-50")}
          >
            {option.label}
            {option.hint ? <span className="mt-0.5 block text-xs text-ink-3">{option.hint}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
