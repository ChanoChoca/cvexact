"use client";

import { useId, useRef, useState, type FocusEvent, type ReactNode } from "react";
import { Checkbox, Input, Textarea } from "@/components/ui";
import { MonthYearPicker } from "@/components/onboarding/MonthYearPicker";
import { ProvenanceBadge } from "@/components/onboarding/ProvenanceBadge";
import type { EndDateValue } from "@/lib/profile/dates";
import { editFieldAt, getAt, isBlankList, isBlankText, putBack, upsertFieldAt, type Path } from "@/lib/profile/edit";
import type { Field, StoredProfile } from "@/lib/schemas/profile-v2";
import { loadStoredProfile, updateStoredProfile } from "@/lib/storage/local";
import { TagInput } from "../parts";

/**
 * The pieces every card of the profile is made of: a field, edited where it stands.
 *
 * Each one shows the value, saves it when the person leaves the box, and says what
 * became of the old one: an edited field offers the way back to what it was read as.
 * Nothing here has a "save" button and nothing asks for confirmation — an edit is a
 * step in the history and can be undone, so there is nothing to be careful about.
 */

export const LABEL = "font-solar text-[12.5px] font-bold tracking-[0.18em] text-ink-3 uppercase";

/** Changes the stored profile from an event handler. */
export const edit = (change: (draft: StoredProfile) => void) => updateStoredProfile(change);

/** For a form with no «Agregar»: the `onBlur` of the form, which runs `save` when focus leaves it for somewhere else. */
export const saveOnLeave = (save: () => void) => (event: FocusEvent<HTMLElement>) => {
  // Still inside it, or the window itself lost the focus —to look something up—: it is not left yet.
  if (event.currentTarget.contains(event.relatedTarget) || !document.hasFocus()) return;
  save();
};

type Listed = "experience" | "education" | "languages" | "certifications";

/** Takes out what a form still being written put in the profile, with what the history said of it: as if it had not been. */
function dropEntry(draft: StoredProfile, list: Listed, id: string): void {
  const entries: Array<{ id: string }> = draft[list];
  const at = entries.findIndex((entry) => entry.id === id);
  if (at >= 0) entries.splice(at, 1);
  draft.history = draft.history.filter((entry) => !(entry.path[0] === list && entry.path[1] === id));
}

/**
 * For a form with no «Agregar» that goes on holding what is in it: as it is left, the profile is given what it holds —as a new entry the first time, and after that in
 * place of the one it was given before—, and a click that missed a box leaves all as it was. `put` writes the form into a draft of the profile and says what it called
 * it there. While the form holds it the entry is not shown with the rest (`id`: the list leaves it out, and the sheet beside shows it); `release` lets go of it, to be an
 * entry like any other, and the form starts over.
 */
export function useKept({ list, id, setId, signature, ready, put }: { list: Listed; id: string | null; setId: (id: string | null) => void; signature: string; ready: boolean; put: (draft: StoredProfile) => string | null }) {
  /** What the form held when it was last given to the profile. */
  const last = useRef<string | null>(null);
  const save = () => {
    // Nothing new since the last time, or nothing to give and nothing given before.
    if (signature === last.current || (!ready && !id)) return;
    last.current = signature;
    let kept: string | null = null;
    edit((draft) => {
      if (id) dropEntry(draft, list, id);
      if (ready) kept = put(draft);
    });
    setId(kept);
  };
  return {
    save,
    onBlur: (event: FocusEvent<HTMLElement>) => saveOnLeave(save)(event),
    release: () => {
      last.current = null;
      setId(null);
    },
  };
}

/**
 * `edit`, for a change the person will be offered the way back from: what is at `path` before and after, and a function that puts it back (`putBack`)
 * unless it has been changed again since — it says whether it did.
 */
export function editWithUndo(path: Path, change: (draft: StoredProfile) => void): () => boolean {
  const before = structuredClone(getAt(loadStoredProfile(), path));
  edit(change);
  const wrote = structuredClone(getAt(loadStoredProfile(), path));
  return () => {
    let put = false;
    edit((draft) => void (put = putBack(draft, path, before, wrote)));
    return put;
  };
}

function Labelled({
  id,
  label,
  hint,
  badge,
  back,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  badge?: ReactNode;
  /** The way back to what it was, for a field the person has changed. */
  back?: ReactNode;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label htmlFor={id} className={LABEL}>
          {label}
        </label>
        {badge}
      </div>
      {children}
      {hint ? <p className="mt-1 text-xs text-ink-3">{hint}</p> : null}
      {back}
    </div>
  );
}

/** "Volver a «lo que decía»", for a field that was edited. Typing the original back does the same. */
function BackToOriginal({ path, original, format }: { path: Path; original: unknown; format: (original: never) => string }) {
  return (
    <button
      type="button"
      onClick={() => edit((draft) => void editFieldAt(draft, path, original, () => false))}
      className="mt-1 block text-xs text-ink-3 underline decoration-white/20 underline-offset-4 hover:text-ink"
    >
      Volver a «{format(original as never)}»
    </button>
  );
}

// --- Text --------------------------------------------------------------------------------------

function TextInner({
  label,
  field,
  path,
  multiline,
  rows,
  type,
  autoComplete,
  inputMode,
  hint,
  maxLength,
  placeholder,
  badge,
  className,
  after,
  optional,
}: {
  label: string;
  field: Field<string>;
  path: Path;
  /** Runs in the same save as the edit, once it is made: what a card does when a field of it changes (settling its doubts). */
  after?: ((draft: StoredProfile) => void) | undefined;
  /** The field may not be there at all (a job's note): it is made when something is written, as `upsertFieldAt` does. */
  optional?: boolean;
  multiline?: boolean;
  rows?: number;
  type?: string;
  /**
   * What the browser may offer to fill in. Off by default, as it has been for every field of the profile — a job's
   * tasks and a company are not what a browser knows — and named for the ones it does: a person's own name, email,
   * phone and city are what it has stored, and typing them again is the work it does for them.
   */
  autoComplete?: string;
  inputMode?: "text" | "email" | "tel";
  hint?: ReactNode;
  maxLength?: number;
  placeholder?: string;
  badge?: boolean;
  className?: string | undefined;
}) {
  const id = useId();
  const [text, setText] = useState(field.value);
  const commit = () => {
    const clean = text.trim();
    if (clean !== field.value) {
      edit((draft) => {
        (optional ? upsertFieldAt : editFieldAt)(draft, path, clean, isBlankText);
        after?.(draft);
      });
    }
    setText(clean);
  };
  const props = { id, value: text, maxLength, placeholder, onChange: (event: { target: { value: string } }) => setText(event.target.value), onBlur: commit };

  return (
    <Labelled
      id={id}
      label={label}
      hint={hint}
      className={className}
      badge={badge ? <ProvenanceBadge status={field.status} source={field.source} /> : undefined}
      back={field.status === "edited" && field.original !== undefined ? <BackToOriginal path={path} original={field.original} format={(o: string) => o || "vacío"} /> : undefined}
    >
      {multiline ? <Textarea rows={rows ?? 4} {...props} /> : <Input type={type} autoComplete={autoComplete ?? "off"} inputMode={inputMode} {...props} />}
    </Labelled>
  );
}

/** A text field. Re-mounted when its stored value changes elsewhere — an undo, a restore — so it never shows stale words. */
export function TextCell(props: Parameters<typeof TextInner>[0]) {
  return <TextInner key={`${props.path.join("/")}:${props.field.value}:${props.field.status}`} {...props} />;
}

// --- Dates ----------------------------------------------------------------------------------------

const isBlankDate = (value: EndDateValue): boolean => value.year === undefined && !value.raw && !value.current;

export function DateCell({
  label,
  field,
  path,
  allowCurrent,
  after,
}: {
  label: string;
  field: Field<EndDateValue>;
  path: Path;
  allowCurrent?: boolean;
  /** As `TextCell`'s: runs in the same save as the edit. */
  after?: ((draft: StoredProfile) => void) | undefined;
}) {
  const current = Boolean(field.value.current);
  const write = (value: EndDateValue) =>
    edit((draft) => {
      editFieldAt(draft, path, value, isBlankDate);
      after?.(draft);
    });
  return (
    <div className="space-y-2">
      <MonthYearPicker label={label} value={field.value} disabled={current} onChange={write} />
      {/* Same word wherever a "still going" checkbox appears — see EntryFormFields' own. */}
      {allowCurrent ? <Checkbox label="Actualmente" checked={current} onChange={(event) => write(event.target.checked ? { current: true } : {})} /> : null}
      {field.value.raw && field.value.year === undefined && !current ? <p className="text-xs text-ink-3">Decía «{field.value.raw}»</p> : null}
    </div>
  );
}

// --- Lists ------------------------------------------------------------------------------------------

/** Tags: skills, tools — words, one at a time. */
export function TagsCell({ label, field, path, placeholder }: { label: string; field: Field<string[]>; path: Path; placeholder: string }) {
  const id = useId();
  return (
    <Labelled id={id} label={label}>
      <TagInput values={field.value} placeholder={placeholder} onChange={(next) => edit((draft) => void editFieldAt(draft, path, next, isBlankList))} />
    </Labelled>
  );
}

