"use client";

import { useState } from "react";
import { AnswerReceipt } from "@/components/onboarding/AnswerReceipt";
import { Button } from "@/components/ui";
import { restoreProfile } from "@/lib/onboarding/last-answer";
import { activeDeclined, declinedReceipt, declinedStanding, keepDeclined, withdrawDeclined } from "@/lib/profile/declined";
import { whenWords } from "@/lib/profile/sync-status";
import type { Declined, StoredProfile } from "@/lib/schemas/profile-v2";
import { loadStoredProfile } from "@/lib/storage/local";
import { LABEL, edit } from "./cells";

/**
 * What the person said no to, with the day, and the way to take it back: what stops the same offer from being made in every posting. It is theirs to look at: nothing
 * here is read by a generator, and nothing here goes in a CV. Not drawn at all while there is nothing to say: not having said no to anything is not a hole in the profile.
 *
 * Two lists, because they are two things: what they said they do not have —an offer asked for it—, and the skills the app deduced from what they told and that they took out.
 * Taking one back says what comes next, with its «Deshacer»: the row is gone, and a row that goes without a word is a button that did nothing.
 *
 * When a line written after a «no» names the thing, it says so, quoting the line, and asks once whether the «no» still holds: the single time a «no» is asked again for what
 * the profile itself now says (CT3). The same question is in «Para revisar», at the top, where it is answered along with what else time brings.
 */
export function DeclinedList({ profile, now }: { profile: StoredProfile; now: Date }) {
  const entries = activeDeclined(profile);
  /** What the last answer here did, and the profile as it was: a row that has gone says why. */
  const [said, setSaid] = useState<{ receipt: string; before: StoredProfile } | null>(null);
  if (entries.length === 0 && !said) return null;

  const answer = (entry: Declined, how: "have" | "still") => {
    const before = loadStoredProfile();
    edit((draft) => void (how === "have" ? withdrawDeclined(draft, entry.id) : keepDeclined(draft, entry.id)));
    setSaid({ receipt: declinedReceipt(entry, how), before });
  };
  const undo = () => {
    if (!said) return;
    restoreProfile(said.before);
    setSaid(null);
  };

  const requirements = entries.filter((entry) => entry.kind === "requirement");
  const skills = entries.filter((entry) => entry.kind === "inferred_skill");
  return (
    <div className="space-y-6" data-declined-list>
      {said ? <AnswerReceipt receipt={said.receipt} onUndo={undo} /> : null}
      {requirements.length > 0 ? (
        <Group
          title="Lo que dijiste que no tenés"
          intro="Lo anotamos con su fecha para no volver a preguntártelo en cada postulación. Si cambió, podés pedir que se pregunte de nuevo: la próxima oferta que lo pida te lo pregunta."
          entries={requirements}
          profile={profile}
          now={now}
          takeBack="Volver a preguntarlo"
          onAnswer={answer}
        />
      ) : null}
      {skills.length > 0 ? (
        <Group
          title="Habilidades que sacaste"
          intro="Las dedujimos de lo que contaste. Si querés que vuelvan a aparecer entre las que deducimos, podés dejarlas volver."
          entries={skills}
          profile={profile}
          now={now}
          takeBack="Dejar que vuelva a aparecer"
          onAnswer={answer}
        />
      ) : null}
    </div>
  );
}

function Group({
  title,
  intro,
  entries,
  profile,
  now,
  takeBack,
  onAnswer,
}: {
  title: string;
  intro: string;
  entries: readonly Declined[];
  profile: StoredProfile;
  now: Date;
  /** What the button that takes the «no» back says: it says what it brings. */
  takeBack: string;
  onAnswer: (entry: Declined, how: "have" | "still") => void;
}) {
  return (
    <div className="space-y-4">
      <p className={LABEL}>{title}</p>
      <p className="text-sm text-ink-3">{intro}</p>
      <ul className="divide-y divide-rule border-y border-rule">
        {entries.map((entry) => (
          <DeclinedRow key={entry.id} profile={profile} entry={entry} now={now} takeBack={takeBack} onAnswer={onAnswer} />
        ))}
      </ul>
    </div>
  );
}

function DeclinedRow({
  profile,
  entry,
  now,
  takeBack,
  onAnswer,
}: {
  profile: StoredProfile;
  entry: Declined;
  now: Date;
  takeBack: string;
  onAnswer: (entry: Declined, how: "have" | "still") => void;
}) {
  const standing = declinedStanding(profile, entry, now);
  const when = whenWords(entry.at, now);
  return (
    <li className="space-y-2 py-3 text-sm" data-declined={entry.id}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className="min-w-0 wrap-break-word">
          <span className="block text-ink">{entry.text}</span>
          <span className="block text-xs text-ink-3">{[entry.kind === "requirement" ? "Lo pedía una oferta" : "", when ? `Anotado ${when}` : ""].filter(Boolean).join(" · ")}</span>
          {entry.quote ? <span className="block text-xs text-ink-3">«{entry.quote}»</span> : null}
        </span>
        {standing.state === "named" ? null : (
          <Button type="button" variant="ghost" onClick={() => onAnswer(entry, "have")}>
            {takeBack}
          </Button>
        )}
      </div>
      {standing.state === "named" ? (
        <div className="space-y-2 border-l-2 border-oro-soft pl-3" data-declined-named>
          <p className="text-ink-2">Hay una línea que lo nombra: «{standing.line}». ¿Sigue siendo así?</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => onAnswer(entry, "have")}>
              Ya lo tengo
            </Button>
            <Button type="button" variant="secondary" onClick={() => onAnswer(entry, "still")}>
              Sigue siendo no
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
