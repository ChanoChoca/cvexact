"use client";

import { useId, useState } from "react";
import { Alert, Button, Textarea } from "@/components/ui";
import { replaceFactsWithSplit } from "@/lib/onboarding/answer";
import { splitWithAi } from "@/lib/onboarding/ai";
import { jobName } from "@/lib/onboarding/questions";
import { splitCovers } from "@/lib/parse/verify-extraction";
import { editFactText, removeFact } from "@/lib/profile/facts";
import { isMeaningfulExperience, type Fact, type StoredProfile } from "@/lib/schemas/profile-v2";
import { updateStoredProfile } from "@/lib/storage/local";
import { AiAction } from "./AiAction";

/**
 * What was just said, saved the way it was understood — shown where the next question is, not on a screen of
 * its own.
 *
 * Splitting a paragraph into facts is a reading, and this is where it can be corrected: each fact is the
 * person's own words, editable where it stands, and the whole answer can be taken back. It used to be a
 * screen between every open answer and the next question, with a "Seguir" to press each time; now it is a
 * few lines above the next question, and the question is already there. Nothing here was written by anyone
 * but them.
 */

/** How many of the lines are shown before "y N más": enough to see how the answer was split, not a second copy of the profile. */
const SHOWN = 4;

const LINK = "underline decoration-current/40 underline-offset-4 hover:decoration-current pointer-coarse:-my-3 pointer-coarse:py-3";

function FactRow({ experienceId, fact }: { experienceId: string; fact: Fact }) {
  const [text, setText] = useState(fact.text);
  const commit = () => {
    const clean = text.trim();
    if (clean && clean !== fact.text) updateStoredProfile((draft) => void editFactText(draft, experienceId, fact.id, clean));
    else setText(fact.text);
  };
  return (
    <li className="flex items-start gap-2">
      <Textarea aria-label="Lo que dijiste" rows={2} maxLength={600} value={text} onChange={(event) => setText(event.target.value)} onBlur={commit} className="flex-1" />
      <Button type="button" variant="danger" compact aria-label="Quitar" onClick={() => updateStoredProfile((draft) => void removeFact(draft, experienceId, fact.id))} className="mt-1">
        ✕
      </Button>
    </li>
  );
}

export function SavedAnswer({
  profile,
  experienceId,
  factIds,
  /** The answer as typed, before any split — what "Separar con tu IA" re-reads. Omitted where there is none. */
  rawAnswer,
  /** "Separar con tu IA" replaces the facts, not just their text — the caller's own `factIds` has to move with them, so what is shown still points at what is actually there. */
  onFactIdsChange,
  onUndo,
  onShowProfile,
}: {
  profile: StoredProfile;
  experienceId: string;
  factIds: readonly string[];
  rawAnswer?: string | undefined;
  onFactIdsChange: (ids: string[]) => void;
  onUndo: () => void;
  /** Where the facts went, on a screen too narrow to show the profile beside the question. */
  onShowProfile?: (() => void) | undefined;
}) {
  const panelId = useId();
  const [editing, setEditing] = useState(false);
  const job = profile.experience.find((entry) => entry.id === experienceId);
  // What is still there: a fact removed here is not shown again.
  const facts = (job?.facts ?? []).filter((fact) => factIds.includes(fact.id));
  if (facts.length === 0) return null;
  const where = job ? jobName(job, profile.experience.filter(isMeaningfulExperience)) : "";
  const questionId = facts[0]?.source.questionId;

  return (
    <>
      <Alert tone="good">
        <div className="space-y-2">
          <p>{where ? `Lo guardamos así, en ${where}:` : "Lo guardamos así:"}</p>
          <ul className="space-y-1 border-l-2 border-current/30 pl-3">
            {facts.slice(0, SHOWN).map((fact) => (
              <li key={fact.id} className="line-clamp-2 wrap-break-word">
                {fact.text}
              </li>
            ))}
          </ul>
          {facts.length > SHOWN ? <p className="text-xs">y {facts.length - SHOWN} más</p> : null}
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <button type="button" aria-expanded={editing} aria-controls={panelId} onClick={() => setEditing((open) => !open)} className={LINK}>
              {editing ? "Listo" : "Corregir"}
            </button>
            <button type="button" onClick={onUndo} className={LINK}>
              Deshacer
            </button>
            {onShowProfile ? (
              <button type="button" onClick={onShowProfile} className={`${LINK} lg:hidden`}>
                Ver en tu perfil
              </button>
            ) : null}
          </span>
        </div>
      </Alert>

      <div id={panelId} hidden={!editing} className="space-y-3 border border-rule p-4">
        <p className="text-sm text-ink-3">Son tus palabras, separadas de a una. Corregí lo que haga falta.</p>
        <ul className="space-y-3">
          {facts.map((fact) => (
            // Keyed by text as well as id: an undo, or an edit made elsewhere, remounts the row with the words as they are now.
            <FactRow key={`${fact.id}:${fact.text}`} experienceId={experienceId} fact={fact} />
          ))}
        </ul>

        {editing && rawAnswer && questionId ? (
          <AiAction
            label="Separar con tu IA"
            busyLabel="Separando…"
            // The key is asked for at the two moments the spec allows — a non-standard document, or
            // "Contámelo a mi manera" — never here, after an answer already saved.
            whenUnavailable="hide"
            run={async (signal) => {
              const outcome = await splitWithAi(rawAnswer, signal);
              if (!outcome.ok) return outcome;
              if (outcome.result.length <= 1) {
                return { ok: false, message: "No encontramos una separación más fina que la que ya tenés." };
              }
              if (!splitCovers(rawAnswer, outcome.result)) {
                return { ok: false, message: "Tu IA cambió o dejó afuera parte de lo que dijiste; lo dejamos separado por frases." };
              }
              let created: Fact[] = [];
              updateStoredProfile((draft) => {
                created = replaceFactsWithSplit(draft, experienceId, factIds, outcome.result, questionId);
              });
              onFactIdsChange(created.map((fact) => fact.id));
              return { ok: true };
            }}
            onDone={() => undefined}
            onSkip={() => setEditing(false)}
          />
        ) : null}
      </div>
    </>
  );
}
