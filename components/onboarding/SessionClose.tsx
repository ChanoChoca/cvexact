"use client";

import Link from "next/link";
import { AiKeyPrompt } from "@/components/ai/AiKeyPrompt";
import { ReminderOffer } from "@/components/profile/ReminderOffer";
import { Badge, Button } from "@/components/ui";
import { hasSubstance } from "@/lib/profile/replace-guard";
import { profileBackupDue, useBackupReminderState } from "@/lib/storage/backup-reminder";
import { copyWindowDays } from "@/lib/storage/durability";
import { useBrowserSetting } from "@/lib/pwa/install";
import { useAccountSync } from "@/lib/profile/use-account-sync";
import type { NextQuestion } from "@/lib/onboarding/gaps";
import type { LastAnswer } from "@/lib/onboarding/last-answer";
import { labelFor } from "@/lib/onboarding/questions";
import { pendingHref, pendingItems, progressByExperience, summaryOfSession, type PendingItem } from "@/lib/onboarding/session";
import { useEngineSignals } from "@/lib/onboarding/use-signals";
import type { StoredProfile } from "@/lib/schemas/profile-v2";
import { useCopyActions } from "@/components/storage/useCopyActions";
import { AnswerReceipt } from "./AnswerReceipt";
import { StepShell } from "./StepShell";

/**
 * S8: the end of a stretch of questions, said so it feels like an end and not like
 * a stop. It says the profile already works, what today added, how far each job is
 * and what is left — none of it required — and offers the next best thing: to keep
 * going, to use what there is, or to leave it for another day.
 *
 * Progress is per job and never a percentage of the whole profile: a single number
 * is the one thing that makes people feel they must fill in everything.
 */

const KIND_LABEL: Record<PendingItem["kind"], string> = {
  later: "Para después",
  skipped: "Para después",
  figure: "Si la encontrás",
  optional: "Opcional",
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** The first letter only: «Personas a cargo en Logística Sur» after a colon is «personas a cargo en Logística Sur», and the company stays what it is. */
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

export function SessionClose({
  profile,
  next,
  now,
  last,
  onUndoLast,
  review = false,
  onContinue,
  onFinish,
}: {
  profile: StoredProfile;
  next: NextQuestion;
  now: Date;
  /** The answer that ended the stretch: it has no next question to say what it did on, so it is said here, with the way back. */
  last?: LastAnswer | null | undefined;
  onUndoLast?: (() => void) | undefined;
  /** The close of the review of what changed, and not of a stretch of building the profile: a few questions about time, which have nothing to do with a key. */
  review?: boolean;
  onContinue: () => void;
  /** `then`: where to go, when the way out was not "Terminar por hoy". Either way the profile is done being built. */
  onFinish: (then?: string) => void;
}) {
  const summary = summaryOfSession(profile);
  const jobs = progressByExperience(profile, now);
  // What the engine may ask besides the profile, so that what was put off of it is said here as well: nothing at all while the experiments are off.
  const signals = useEngineSignals(profile, now);
  const pending = pendingItems(profile, now, signals);
  const backup = useBackupReminderState();
  // The end of a stretch of work is the moment it is worth a copy: there is more in the profile than there was this morning.
  const browser = useBrowserSetting();
  const copies = useCopyActions();
  // With an account the profile is kept there, and says so where it can be done (the list of what is left on the profile): «vive solo en este
  // navegador» is not true of it, and a copy in a file is not asked for on top.
  const account = useAccountSync(profile);
  const offerCopy = !account.hasAccount && profileBackupDue(profile, backup, hasSubstance(profile), now, copyWindowDays(browser));

  const added = [
    summary.facts > 0 ? plural(summary.facts, "tarea", "tareas") : null,
    summary.figures > 0 ? `${plural(summary.figures, "logro", "logros")} con cifra` : null,
  ].filter(Boolean);

  return (
    <StepShell
      eyebrow="Por hoy"
      title="Tu perfil ya sirve para crear un CV adaptado a una oferta"
      intro={added.length > 0 ? `Hoy agregaste ${added.join(" y ")}. Lo que sigue mejora el resultado, pero no hace falta.` : "Lo que cargaste está guardado. Lo que sigue mejora el resultado, pero no hace falta."}
    >
      {last ? <AnswerReceipt receipt={last.receipt} onUndo={onUndoLast} /> : null}

      {jobs.length > 0 ? (
        <section aria-labelledby="progress-title" className="space-y-2">
          <h2 id="progress-title" className="font-solar text-[12.5px] font-bold tracking-[0.18em] text-ink-3 uppercase">
            Cómo va cada puesto
          </h2>
          <ul className="divide-y divide-rule border-y border-rule">
            {jobs.map((job) => (
              <li key={job.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 text-sm">
                <span className="text-ink">{job.label}</span>
                <span className="text-ink-3">
                  {job.facts === 0
                    ? "Sin detalle todavía"
                    : [plural(job.facts, "tarea", "tareas"), job.hasAchievement ? "con logros" : "sin logros", job.hasFigure ? "con cifra" : null].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {pending.length > 0 ? (
        <section aria-labelledby="pending-title" className="space-y-2">
          <h2 id="pending-title" className="font-solar text-[12.5px] font-bold tracking-[0.18em] text-ink-3 uppercase">
            {pending.length === 1 ? "Queda 1 pendiente" : `Quedan ${pending.length} pendientes`}
          </h2>
          <ul className="divide-y divide-rule border-y border-rule">
            {pending.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 text-sm">
                {/* Padded and pulled back by the same amount: a row's height to touch, and the row the same as before. */}
                <Link href={pendingHref(item)} className="-my-3 min-w-0 py-3 wrap-break-word text-ink-2 underline decoration-white/20 underline-offset-4 transition-colors hover:text-ink motion-reduce:transition-none">
                  {item.label}
                </Link>
                <Badge>{KIND_LABEL[item.kind]}</Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="space-y-4">
        {next.kind === "gap" ? (
          <p className="text-sm text-ink-3">Lo próximo: {lowerFirst(labelFor(next.gap, profile))}.</p>
        ) : next.kind === "budget" ? (
          <p className="text-sm text-ink-3">Hay más preguntas para cuando quieras.</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          {next.kind !== "none" ? (
            <Button type="button" variant="secondary" onClick={onContinue}>
              Seguir un rato
            </Button>
          ) : null}
          {/* Not a link: leaving this way is also finishing, and a link would leave the profile "a la mitad" for good. */}
          <Button type="button" variant="secondary" onClick={() => onFinish("/postular")}>
            Crear un CV para una oferta →
          </Button>
          <Button type="button" onClick={() => onFinish()}>
            Terminar por hoy
          </Button>
        </div>
        {offerCopy ? (
          <p className="border-l-2 border-oro-soft py-1 pl-4 text-sm text-ink-2">
            Lo que cargaste hoy vive solo en este navegador, y un navegador puede perderlo.{" "}
            <button type="button" onClick={() => copies.saveProfile()} className="underline decoration-oro-soft underline-offset-4 hover:text-ink pointer-coarse:inline-block pointer-coarse:-my-3 pointer-coarse:py-3.5">
              Bajar una copia
            </button>{" "}
            o{" "}
            <Link href="/cuenta" className="underline decoration-oro-soft underline-offset-4 hover:text-ink pointer-coarse:inline-block pointer-coarse:-my-3 pointer-coarse:py-3.5">
              guardarlo en tu cuenta
            </Link>
            .
          </p>
        ) : null}
        {/* The promise in the title needs an IA: said here, under the way to it, and not by changing the title, which would flip a beat after the page is up. A review of what
            changed ends without it: nobody coming back to say what changed in a job was asked for anything to make a CV. */}
        {review ? <ReminderOffer /> : <AiKeyPrompt>Para crear un CV para una oferta necesitás una key.</AiKeyPrompt>}
      </div>
    </StepShell>
  );
}
