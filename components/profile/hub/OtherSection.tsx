"use client";

import { useId, useState } from "react";
import { CollapsibleCard, Textarea } from "@/components/ui";
import { editFieldAt, isBlankList } from "@/lib/profile/edit";
import type { StoredProfile } from "@/lib/schemas/profile-v2";
import { LABEL, TextCell, edit } from "./cells";
import { DeclinedList } from "./DeclinedList";
import { ImproveSection } from "./ImproveSection";
import { NotesList } from "./NotesList";
import { PracticalFields } from "./PracticalFields";
import type { OnRemoved } from "./removal";
import { ANCHOR, SECTION_ID } from "@/components/profile/anchors";

function ExtrasInner({ profile }: { profile: StoredProfile }) {
  const id = useId();
  const field = profile.legacy.extras;
  const [text, setText] = useState(field.value.join("\n"));
  return (
    <div>
      <label htmlFor={id} className={`mb-1 block ${LABEL}`}>
        Otros datos
      </label>
      <Textarea
        id={id}
        rows={3}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
          edit((draft) => void editFieldAt(draft, ["legacy", "extras"], lines, isBlankList));
          setText(lines.join("\n"));
        }}
      />
      <p className="mt-1 text-xs text-ink-3">Voluntariados, intereses, premios: una cosa por línea.</p>
    </div>
  );
}

/**
 * What a profile can have that the questions never ask for: a headline, a paragraph
 * about oneself, practical facts, loose lines, and the notes and leftovers of what was
 * read. It all keeps its place, so nothing written before this screen existed is lost.
 */
export function OtherSection({ profile, onRemoved, now, defaultOpen = false }: { profile: StoredProfile; onRemoved: OnRemoved; now: Date; defaultOpen?: boolean }) {
  const { legacy } = profile;
  return (
    <CollapsibleCard id={SECTION_ID.other} title="Sobre vos y otros datos" defaultOpen={defaultOpen} className={`space-y-8 ${ANCHOR}`}>
      <ImproveSection profile={profile} section="other" />
      <TextCell label="Titular" field={legacy.headline} path={["legacy", "headline"]} maxLength={160} hint="Opcional: una línea que diga qué hacés." />
      <TextCell
        label="Sobre vos"
        field={legacy.about}
        path={["legacy", "about"]}
        multiline
        rows={5}
        maxLength={2000}
        hint="Con tus palabras. No hace falta que quede lindo: se reescribe entero para cada puesto."
      />
      <ExtrasInner key={legacy.extras.value.join("\n")} profile={profile} />
      <PracticalFields profile={profile} now={now} />

      <DeclinedList profile={profile} now={now} />

      <NotesList profile={profile} onRemoved={onRemoved} />
    </CollapsibleCard>
  );
}
