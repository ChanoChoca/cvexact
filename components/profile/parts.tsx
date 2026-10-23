"use client";

import { useState, type ReactNode } from "react";
import { Button, Input, SectionTitle, Textarea, cx } from "@/components/ui";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { normalizeForComparison } from "@/lib/text/normalize";

/**
 * The repeatable controls the ficha's sections are built from.
 *
 * Restyled against the current design rather than reused as they were: the app
 * draws in straight rules, so the cards, pills and focus rings these carried
 * from the previous system read as controls borrowed from another product. See
 * the note at the top of `components/ui/index.tsx`.
 */

export function RepeatableList<T extends { id: string }>({
  items,
  onChange,
  create,
  addLabel,
  emptyLabel,
  renderItem,
  itemLabel,
  removeWarning,
  max,
}: {
  items: T[];
  onChange: (next: T[]) => void;
  create: () => T;
  addLabel: string;
  emptyLabel: string;
  renderItem: (item: T, update: (patch: Partial<T>) => void) => ReactNode;
  /** Header noun for each card ("Trabajo" → "Trabajo 1"). The card's own fields already show its data, so the header never repeats it. */
  itemLabel?: string;
  /** Confirmed before removing, for entries that took real work to write. */
  removeWarning?: (item: T) => string | null;
  /** Past this many entries the add button is replaced by a note saying so. */
  max?: number;
}) {
  const confirm = useConfirm();

  const update = (id: string, patch: Partial<T>) =>
    onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  const remove = async (item: T) => {
    const warning = removeWarning?.(item);
    if (warning && !(await confirm(warning))) return;
    onChange(items.filter((i) => i.id !== item.id));
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <p className="border border-dashed border-rule px-4 py-6 text-center text-sm text-ink-3">
          {emptyLabel}
        </p>
      ) : null}

      {items.map((item, index) => (
        <div key={item.id} className="border border-rule bg-paper p-4">
          <SectionTitle
            action={
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  type="button"
                  aria-label="Mover arriba"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  className="px-2 py-1"
                >
                  ↑
                </Button>
                <Button
                  variant="ghost"
                  type="button"
                  aria-label="Mover abajo"
                  disabled={index === items.length - 1}
                  onClick={() => move(index, 1)}
                  className="px-2 py-1"
                >
                  ↓
                </Button>
                <Button
                  variant="danger"
                  type="button"
                  onClick={() => remove(item)}
                  className="px-2 py-1 text-xs"
                >
                  Quitar
                </Button>
              </div>
            }
          >
            {itemLabel ? `${itemLabel} ${index + 1}` : `#${index + 1}`}
          </SectionTitle>
          {renderItem(item, (patch) => update(item.id, patch))}
        </div>
      ))}

      {max && items.length >= max ? (
        <p className="text-xs text-ink-3">Máximo {max}.</p>
      ) : (
        <Button variant="secondary" type="button" onClick={() => onChange([...items, create()])}>
          + {addLabel}
        </Button>
      )}
    </div>
  );
}

/** A list of free-text lines — achievement bullets, volunteering, etc. */
export function StringListEditor({
  values,
  onChange,
  placeholder,
  addLabel,
  rows = 2,
  limit,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  addLabel: string;
  rows?: number;
  /**
   * The schema cap for one line, shown as it gets close.
   *
   * `profileSchema` truncates rather than rejects, so without this a long entry
   * is cut mid-word on save and nothing says so — which is exactly how a real
   * profile lost the tail of the one paragraph carrying its whole case for a
   * job outside the person's field. Only rendered near the limit: a counter on
   * a box nobody is going to fill is noise.
   */
  limit?: number;
}) {
  return (
    <div className="space-y-2">
      {values.map((value, index) => (
        // Index as key: these are positional free-text rows with no identity of
        // their own, and keying on the text would remount the box on every
        // keystroke and lose the caret.
        <div key={index} className="flex items-start gap-2">
          <Textarea
            value={value}
            placeholder={placeholder}
            rows={rows}
            onChange={(event) => {
              const next = [...values];
              next[index] = event.target.value;
              onChange(next);
            }}
            className="flex-1"
            maxLength={limit}
          />
          <Button
            variant="danger"
            type="button"
            aria-label="Quitar"
            onClick={() => onChange(values.filter((_, i) => i !== index))}
            className="mt-1 px-2 py-1"
          >
            ✕
          </Button>
          {limit && value.length > limit * 0.8 ? (
            <span className="mt-2 shrink-0 font-mono text-[11px] text-ink-3 tabular-nums">
              {value.length}/{limit}
            </span>
          ) : null}
        </div>
      ))}
      <Button variant="secondary" type="button" onClick={() => onChange([...values, ""])}>
        + {addLabel}
      </Button>
    </div>
  );
}

/**
 * Comma- or Enter-separated tags. Skills and tools go here; the inference pass
 * reads them, so more is better even when they feel obvious.
 */
export function TagInput({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState("");

  const commit = (raw: string) => {
    const added = raw
      .split(",")
      .map((t) => t.trim())
      .filter(
        (t) => t.length > 0 && !values.some((v) => normalizeForComparison(v) === normalizeForComparison(t)),
      );
    if (added.length) onChange([...values, ...added]);
    setDraft("");
  };

  return (
    <div>
      <div className={cx("mb-2 flex flex-wrap gap-1.5", values.length === 0 && "hidden")}>
        {values.map((value) => (
          <span
            key={value}
            className="inline-flex items-center gap-1 border border-rule bg-paper-2 py-1 pr-1 pl-2 text-xs text-ink-2"
          >
            {value}
            <button
              type="button"
              aria-label={`Quitar ${value}`}
              onClick={() => onChange(values.filter((v) => v !== value))}
              className="px-1 text-ink-3 transition-colors hover:text-ink motion-reduce:transition-none pointer-coarse:min-h-11 pointer-coarse:min-w-11"
            >
              ✕
            </button>
          </span>
        ))}
      </div>
      <Input
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            commit(draft);
          } else if (event.key === "Backspace" && draft === "" && values.length) {
            onChange(values.slice(0, -1));
          }
        }}
        // Typing a tag and clicking away without pressing Enter is the single
        // most common way to lose one.
        onBlur={() => draft.trim() && commit(draft)}
      />
    </div>
  );
}
