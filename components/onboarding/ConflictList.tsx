"use client";

import { useState } from "react";
import { Button, Checkbox, SectionTitle } from "@/components/ui";
import { conflictsFavouring, resolveConflict, resolveConflictsFrom, suggestedSide, type ConflictSide } from "@/lib/onboarding/review";
import { formatDateValue, type DateValue, type EndDateValue } from "@/lib/profile/dates";
import type { Conflict, Source, StoredProfile } from "@/lib/schemas/profile-v2";
import { updateStoredProfile } from "@/lib/storage/local";
import { MonthYearPicker } from "./MonthYearPicker";
import { sameShape } from "@/lib/onboarding/drafts";
import { useDraft } from "./useDraft";

/**
 * S10: where two sources describe the same job, the same degree or the same
 * contact detail differently — an end date, an email — and neither gets to win
 * on its own. Shown first in the review, before the skeleton itself, because a
 * conflict is the one thing here that is not simply "confirm and move on": the
 * person has to actually choose, or type a third answer for a date neither
 * source had right.
 */

const FIELD_LABEL: Record<string, string> = {
  start: "Fecha de inicio",
  end: "Fecha de fin",
  city: "Ciudad",
  country: "País",
  honors: "Honores",
  role: "Puesto",
  degree: "Título",
  level: "Nivel",
  fullName: "Nombre",
  email: "Email",
  phone: "Teléfono",
  headline: "Titular",
  about: "Resumen",
};

/**
 * Past this, a value does not fit in a button: a summary two documents word
 * differently is a paragraph each. Both are shown above the buttons instead,
 * and the buttons only say which one.
 */
const LONG_VALUE = 80;

const isDateField = (field: string) => field === "start" || field === "end";

function sourceLabel(source: Pick<Source, "kind"> | undefined): string {
  switch (source?.kind) {
    case "cv":
      return "tu CV";
    case "linkedin_pdf":
    case "linkedin_csv":
      return "LinkedIn";
    case "dump":
      return "lo que contaste";
    case "answer":
    case "manual":
      return "lo que escribiste";
    default:
      return "lo que ya tenías";
  }
}

function entityLabel(conflict: Conflict, profile: StoredProfile): string {
  if (conflict.entity === "experience") {
    const job = profile.experience.find((entry) => entry.id === conflict.entityId);
    return (job && [job.role.value, job.company.value].filter(Boolean).join(" · ")) || "un puesto";
  }
  if (conflict.entity === "education") {
    const entry = profile.education.find((item) => item.id === conflict.entityId);
    return (entry && [entry.degree.value, entry.institution.value].filter(Boolean).join(" · ")) || "un estudio";
  }
  if (conflict.entity === "language") {
    const language = profile.languages.find((entry) => entry.id === conflict.entityId);
    return language ? `tu nivel de ${language.name.value}` : "un idioma";
  }
  if (conflict.entity === "legacy") return conflict.field === "about" ? "Sobre vos" : "tu titular";
  return "tus datos de contacto";
}

function displayValue(field: string, value: unknown): string {
  if (isDateField(field)) {
    const date = (value ?? {}) as EndDateValue;
    if (date.current) return "Actualidad";
    return formatDateValue(date) || "Sin fecha";
  }
  if (field === "level" && value && typeof value === "object") {
    const level = value as { cefr?: string; raw?: string };
    return level.raw || level.cefr || "(vacío)";
  }
  return typeof value === "string" && value.trim() ? value : "(vacío)";
}

/** A day, said the way the rest of the screen says dates: «12 de marzo de 2025». */
const dayOf = (at: number): string => new Date(at).toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });

function ConflictRow({ profile, conflict }: { profile: StoredProfile; conflict: Conflict }) {
  // A date typed over a disagreement is kept like the rest of what is being written: the picker opens again on it.
  const kept = useDraft<{ date: DateValue; current: boolean }>(`conflict:${conflict.id}`, (value) => sameShape({ date: {}, current: false }, value));
  const [picking, setPicking] = useState(() => kept.restored !== null);
  const [date, setDate] = useState<DateValue>(() => kept.restored?.date ?? {});
  const [current, setCurrent] = useState(() => kept.restored?.current ?? false);
  const changeDate = (next: DateValue) => {
    setDate(next);
    kept.remember({ date: next, current });
  };
  const changeCurrent = (next: boolean) => {
    setCurrent(next);
    kept.remember({ date, current: next });
  };

  const resolve = (choice: "current" | "incoming" | { value: unknown }) =>
    updateStoredProfile((draft) => void resolveConflict(draft, conflict.id, choice));

  const currentText = displayValue(conflict.field, conflict.current.value);
  const incomingText = displayValue(conflict.field, conflict.incoming.value);
  const suggestion = suggestedSide(profile, conflict);
  const long = Math.max(currentText.length, incomingText.length) > LONG_VALUE;

  return (
    <li className="space-y-3 border border-amber-400/40 bg-amber-400/[0.04] p-4">
      <div>
        <p className="text-sm text-ink">{entityLabel(conflict, profile)}</p>
        <p className="text-xs text-ink-3">{FIELD_LABEL[conflict.field] ?? conflict.field}: tus fuentes no coinciden</p>
      </div>
      {long ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            { source: conflict.current.source, text: currentText },
            { source: conflict.incoming.source, text: incomingText },
          ].map((version, index) => (
            <div key={index} className="border border-rule bg-paper-2 p-3">
              <p className="text-xs text-ink-3">Según {sourceLabel(version.source)}</p>
              <p className="mt-1 line-clamp-6 text-sm whitespace-pre-line text-ink-2 wrap-break-word">{version.text}</p>
            </div>
          ))}
        </div>
      ) : null}
      {/* What the profile says in the meantime: a choice left for later is not a blank, and a CV made before it is made with this. */}
      <p className="text-xs text-ink-3">Mientras no elijas, se usa la versión de {sourceLabel(conflict.current.source)}.</p>
      {/* Only when both versions come from documents with a date and one is clearly newer: a suggestion, which the person is free to ignore. */}
      {suggestion ? (
        <p className="text-xs text-ink-2">
          Sugerimos {sourceLabel(suggestion.side === "current" ? conflict.current.source : conflict.incoming.source)}: es el archivo más reciente ({dayOf(suggestion.newer)}, contra {dayOf(suggestion.older)}). La fecha de un archivo no siempre es la de lo que dice: elegí vos.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant={suggestion?.side === "current" ? "primary" : "secondary"} onClick={() => resolve("current")}>
          Usar {sourceLabel(conflict.current.source)}
          {long ? "" : `: ${currentText}`}
        </Button>
        <Button type="button" variant={suggestion?.side === "incoming" ? "primary" : "secondary"} onClick={() => resolve("incoming")}>
          Usar {sourceLabel(conflict.incoming.source)}
          {long ? "" : `: ${incomingText}`}
        </Button>
        {isDateField(conflict.field) ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              // Put away, the half-typed date goes with it: it would come back to a form nobody opened.
              if (picking) kept.forget();
              setPicking((value) => !value);
            }}
          >
            Otra fecha
          </Button>
        ) : null}
      </div>
      {picking ? (
        <form
          className="flex flex-wrap items-end gap-3 border-t border-rule pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            resolve({ value: conflict.field === "end" && current ? { current: true } : date });
            kept.forget();
            setPicking(false);
          }}
        >
          <MonthYearPicker label="Fecha" value={date} disabled={current} onChange={changeDate} />
          {/* Only for a job: a study's end has no `current` of its own to hold
              this — "still studying" is its `status` instead, set from its own
              edit form, not from a conflict that is only ever about a date. */}
          {conflict.field === "end" && conflict.entity === "experience" ? (
            <Checkbox label="Actualmente" checked={current} onChange={(event) => changeCurrent(event.target.checked)} />
          ) : null}
          <Button type="submit" disabled={!current && date.year === undefined}>
            Guardar
          </Button>
        </form>
      ) : null}
    </li>
  );
}

/** From this many, choosing one by one is more work than the choice deserves: "my CV for all of it" is offered. */
const CHOOSE_TOGETHER_FROM = 3;

const SIDE_LABEL: Record<ConflictSide, string> = { cv: "mi CV", linkedin: "LinkedIn" };

/**
 * Deciding by document instead of by field: a person whose CV is right and LinkedIn is stale
 * (or the other way around) has one answer to give, not ten. Only the conflicts where exactly
 * one side comes from that kind of document are settled; the rest stay to be chosen one by one.
 */
function ChooseTogether({ conflicts }: { conflicts: StoredProfile["conflicts"] }) {
  const options = (["cv", "linkedin"] as const)
    .map((side) => ({ side, count: conflictsFavouring(conflicts, side).length }))
    .filter((option) => option.count > 0);
  if (conflicts.length < CHOOSE_TOGETHER_FROM || options.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border border-rule bg-paper-2 p-3">
      <span className="mr-1 text-sm text-ink-2">De una vez:</span>
      {options.map(({ side, count }) => (
        <Button
          key={side}
          type="button"
          variant="secondary"
          onClick={() => updateStoredProfile((draft) => void resolveConflictsFrom(draft, side))}
        >
          Quedarme con {SIDE_LABEL[side]} en {count === conflicts.length ? "todas" : `las ${count}`}
        </Button>
      ))}
    </div>
  );
}

export function ConflictList({ profile }: { profile: StoredProfile }) {
  if (profile.conflicts.length === 0) return null;
  return (
    <section aria-labelledby="conflicts-title" className="space-y-3">
      <SectionTitle>
        <span id="conflicts-title">Tus fuentes no coinciden en esto</span>
      </SectionTitle>
      <p className="text-sm text-ink-2">Elegí qué versión te queda, o poné otra.</p>
      <ChooseTogether conflicts={profile.conflicts} />
      <ul className="space-y-3">
        {profile.conflicts.map((conflict) => (
          <ConflictRow key={conflict.id} profile={profile} conflict={conflict} />
        ))}
      </ul>
    </section>
  );
}
