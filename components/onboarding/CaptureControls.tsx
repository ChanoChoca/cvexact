"use client";

import { useState } from "react";
import { Button, Checkbox } from "@/components/ui";

/**
 * The controls of two questions that are about what the person already told the profile, each with three answers of the same weight — the one that
 * does something, the one that says no, and «Ahora no» — because none of them is the one to nudge towards:
 *  - what they wrote down in «Anotá algo» (O15), offered to the one job it names: its sentences are ticked, and each one that stays ticked becomes a task of
 *    that job, in the words it was written in;
 *  - a skill nothing has backed for years (O17): still used, no longer, or not now. «Ya no» takes it out of their CVs and keeps it where the way back is;
 *  - a skill written as its initials (UI-2): it is the whole name, it is something else, or not now. «Sí» renames it.
 * What each question says is its title and its hint (`questionFor`); this is what is below them.
 */

export type NotePlaceHandlers = {
  /** The sentences that stayed ticked. */
  place: (sentences: string[]) => void;
  leave: () => void;
  later: () => void;
};

export function NotePlaceControl({ sentences, handlers }: { sentences: string[]; handlers: NotePlaceHandlers }) {
  // The person wrote them thinking of this job a short time ago: they begin ticked, as the starting point and not as the decision.
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set(sentences));
  const toggle = (sentence: string) =>
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(sentence)) next.delete(sentence);
      else next.add(sentence);
      return next;
    });
  const chosen = sentences.filter((sentence) => ticked.has(sentence));
  return (
    <div className="space-y-4" data-note-place>
      {sentences.length > 0 ? (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs text-ink-3">Cada frase que dejes tildada queda como una tarea de ese puesto, con tus palabras.</legend>
          <ul className="space-y-2">
            {sentences.map((sentence) => (
              <li key={sentence}>
                <Checkbox label={<span className="wrap-break-word text-ink-2">{sentence}</span>} checked={ticked.has(sentence)} onChange={() => toggle(sentence)} />
              </li>
            ))}
          </ul>
        </fieldset>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={chosen.length === 0} onClick={() => handlers.place(chosen)}>
          Sí, agregarla como tarea
        </Button>
        <Button variant="secondary" onClick={handlers.leave}>
          No va ahí
        </Button>
        <Button variant="secondary" onClick={handlers.later}>
          Ahora no
        </Button>
      </div>
    </div>
  );
}

export type AbbreviationHandlers = {
  yes: () => void;
  no: () => void;
  later: () => void;
};

export function AbbreviationControl({ handlers }: { handlers: AbbreviationHandlers }) {
  return (
    <div className="flex flex-wrap gap-2" data-abbreviation>
      <Button variant="secondary" onClick={handlers.yes}>
        Sí
      </Button>
      <Button variant="secondary" onClick={handlers.no}>
        No, es otra cosa
      </Button>
      <Button variant="secondary" onClick={handlers.later}>
        Ahora no
      </Button>
    </div>
  );
}

export type StaleSkillHandlers = {
  keep: () => void;
  drop: () => void;
  later: () => void;
};

export function StaleSkillControl({ handlers }: { handlers: StaleSkillHandlers }) {
  return (
    <div className="flex flex-wrap gap-2" data-skill-stale>
      <Button variant="secondary" onClick={handlers.keep}>
        Sí, la sigo usando
      </Button>
      <Button variant="secondary" onClick={handlers.drop}>
        Ya no
      </Button>
      <Button variant="secondary" onClick={handlers.later}>
        Ahora no
      </Button>
    </div>
  );
}
