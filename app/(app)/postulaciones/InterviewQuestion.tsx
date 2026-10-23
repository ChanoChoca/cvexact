"use client";

import { useCallback, useId, useRef, useState } from "react";
import { Button, Field, Textarea } from "@/components/ui";
import { AnswerReceipt } from "@/components/onboarding/AnswerReceipt";
import { RequirementAnswers } from "@/components/wizard/RequirementAsk";
import { INTERVIEW_HINT, INTERVIEW_QUESTION, INTERVIEW_TEXT_MAX, interviewAsks, reachedInterview } from "@/lib/jobs/interview";
import { askMetric, askedAgainQuestion, type RequirementAsk } from "@/lib/jobs/requirement-ask";
import { recordMetric } from "@/lib/metrics/store";
import { answerOfferedClaim, answerOfferedConditions, answerOfferedCredential, declineOffered, keepOffered, putOffOffered } from "@/lib/onboarding/answer";
import { restoreProfile } from "@/lib/onboarding/last-answer";
import { isMeaningfulExperience, type StoredProfile } from "@/lib/schemas/profile-v2";
import { useProfile, useStoredProfile } from "@/lib/storage/hooks";
import { markInterviewAsked, wasInterviewAsked } from "@/lib/storage/interview-asked";
import { loadStoredProfile, updateStoredProfile } from "@/lib/storage/local";
import { useExperiment } from "@/lib/use-experiment";

/**
 * When an application reaches the interview, one question — optional, in a few words — about what they were asked that the profile does not say (O12).
 *
 * What they write is read as the lines of an offer are read, in this browser and with no model (`lib/jobs/interview.ts`), and each thing it names is a
 * question with the same three answers as the question of an offer: «Sí», «No», «Ahora no». Nothing they write is kept unless they choose to — a note,
 * which is theirs — and nothing goes to the CV. It is asked once for each application, and never when the application did not reach an interview.
 * Switched off, none of this exists (`lib/experiments.ts`).
 *
 * It has the shape of every other question of the profile (e5 UX, U45): the answers of the same weight, a line that says what «Ahora no» does —here, that it is asked
 * once and does not come back—, and after each answer what it did, with the way to take it back.
 */

export type InterviewFor = { id: string; label: string };

/** What a page that changes the status of an application needs to ask it: tell it when one moved, and show what it says to show. */
export function useInterviewQuestion() {
  const on = useExperiment("interview_question");
  const [pending, setPending] = useState<InterviewFor | null>(null);
  const moved = useCallback(
    (application: InterviewFor, from: string | undefined, to: string) => {
      if (!on || !reachedInterview(from, to) || wasInterviewAsked(application.id)) return;
      // Asked once, whatever they do with it: ignoring it is an answer too.
      markInterviewAsked(application.id);
      setPending(application);
    },
    [on],
  );
  const close = useCallback(() => setPending(null), []);
  return { pending, moved, close };
}

type Stage =
  | { kind: "ask" }
  | { kind: "read"; asks: RequirementAsk[]; at: number }
  | { kind: "nothing"; said: string }
  | { kind: "done" };

/** What the last answer did, in a line, with the profile as it was before it (when it changed it) and the step it was given at: «Deshacer» goes back to both. */
type Receipt = { text: string; before: StoredProfile | null; back: Stage };

export function InterviewQuestion({ application, onClose }: { application: InterviewFor; onClose: () => void }) {
  const headingId = useId();
  const profile = useProfile();
  const stored = useStoredProfile();
  const [now] = useState(() => new Date());
  const [said, setSaid] = useState("");
  const [stage, setStage] = useState<Stage>({ kind: "ask" });
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  /** The answer is told, and the next step shown: nothing is answered without being said what it did. */
  const answered = (text: string, before: StoredProfile | null, next: Stage) => {
    setReceipt({ text, before, back: stage });
    setStage(next);
  };

  /** «Deshacer»: the profile as it was before that answer — what it changed and nothing earlier — and the step it was given at. */
  const undo = () => {
    if (!receipt) return;
    if (receipt.before) restoreProfile(receipt.before);
    setStage(receipt.back);
    setReceipt(null);
  };

  const jobs = stored.experience.filter(isMeaningfulExperience).map((job) => ({ id: job.id, label: [job.role.value, job.company.value].filter(Boolean).join(" · ") || "Sin nombre" }));

  const read = () => {
    const asks = interviewAsks({ said, profile, stored, now });
    setStage(asks.length > 0 ? { kind: "read", asks, at: 0 } : { kind: "nothing", said: said.trim() });
  };

  const keepAsNote = (text: string) => {
    const before = loadStoredProfile();
    updateStoredProfile((draft) => void draft.notes.push({ id: crypto.randomUUID(), text: text.slice(0, 2000), at: new Date().toISOString() }));
    answered("Lo dejamos como nota en tu perfil.", before, { kind: "done" });
  };

  return (
    <section aria-labelledby={headingId} data-interview-question className="space-y-4 border border-rule bg-paper-2 p-5 sm:p-6">
      <p className="font-solar text-[12.5px] font-bold tracking-[0.18em] text-ink-3 uppercase">Pasó a entrevista</p>
      <h2 id={headingId} className="text-[19px] leading-snug text-ink">
        {application.label}
      </h2>

      {receipt ? <AnswerReceipt receipt={receipt.text} onUndo={undo} /> : null}

      {stage.kind === "ask" ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (said.trim()) read();
          }}
        >
          <Field label={INTERVIEW_QUESTION} hint={INTERVIEW_HINT}>
            <Textarea autoFocus rows={3} value={said} maxLength={INTERVIEW_TEXT_MAX} onChange={(event) => setSaid(event.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="secondary" disabled={!said.trim()}>
              Contar
            </Button>
            <Button type="button" variant="secondary" onClick={() => answered("Anotado: no hay nada nuevo.", null, { kind: "done" })}>
              Nada nuevo
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Ahora no
            </Button>
          </div>
          {/* «Ahora no» is not the same here as in a question of the profile, and it says so where it is read: this one is asked once for each application, and does not come back. */}
          <p className="text-xs text-ink-3" data-put-off-note>
            Con «Ahora no» se cierra, y no te lo volvemos a preguntar de esta postulación.
          </p>
        </form>
      ) : null}

      {stage.kind === "read" ? (
        <Proposals
          key={stage.at}
          stage={stage}
          jobs={jobs}
          now={now}
          onNext={(message, before) => answered(message, before, stage.at + 1 < stage.asks.length ? { ...stage, at: stage.at + 1 } : { kind: "done" })}
        />
      ) : null}

      {stage.kind === "nothing" ? (
        <div className="space-y-3" data-interview-nothing>
          <p className="text-[15px] text-ink-2">No encontramos una herramienta, una credencial, una condición ni una tarea en lo que contaste. Si querés, queda como nota en tu perfil.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => keepAsNote(stage.said)}>
              Dejarlo como nota
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cerrar
            </Button>
          </div>
        </div>
      ) : null}

      {stage.kind === "done" ? (
        <div className="space-y-3" data-interview-done>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/** One of the things they named, as the question of an offer: the words they used, the question, and yes, no or not now. */
function Proposals({
  stage,
  jobs,
  now,
  onNext,
}: {
  stage: Extract<Stage, { kind: "read" }>;
  jobs: ReadonlyArray<{ id: string; label: string }>;
  now: Date;
  /** What the answer did, in a line, and the profile as it was before it. */
  onNext: (message: string, before: StoredProfile) => void;
}) {
  const ask = stage.asks[stage.at]!;
  // The profile as it was before the answer that is being given: what «Deshacer» gives back. Taken as the answer starts, and kept for the one that is being said.
  const before = useRef<StoredProfile | null>(null);
  const said = (outcome: "done" | "no" | "later", message: string) => {
    recordMetric(askMetric(ask.type, outcome));
    // Each one says what it did, the last as well: «Listo» alone left the person to find out where it went.
    onNext(message, before.current ?? loadStoredProfile());
  };
  const apply = (change: (draft: StoredProfile) => boolean | void): boolean => {
    before.current = loadStoredProfile();
    const result = { kept: true };
    updateStoredProfile((draft) => void (result.kept = change(draft) !== false));
    return result.kept;
  };

  return (
    <div className="space-y-4" data-interview-proposal={ask.kind}>
      <p className="text-sm text-ink-3">
        {stage.asks.length > 1 ? `Nombraste ${stage.asks.length} cosas: esta es la ${stage.at + 1}.` : "Nombraste algo que tu perfil no dice."}
      </p>
      <blockquote className="border-l-2 border-oro-soft pl-3 text-[15px] leading-snug wrap-break-word text-ink-2" data-requirement-quote>
        {ask.fragment}
      </blockquote>
      <h3 className="text-[19px] leading-snug text-ink">{ask.again ? askedAgainQuestion(ask.again, now) : ask.question}</h3>
      <RequirementAnswers
        ask={ask}
        jobs={jobs}
        now={now}
        onClaim={(where, jobId) => {
          if (ask.kind !== "tool" && ask.kind !== "task") return;
          if (!apply((draft) => answerOfferedClaim(draft, { kind: ask.kind as "tool" | "task", thing: ask.thing }, where, jobId))) return;
          recordMetric("requirement_claimed");
          said("done", "Anotado en tu perfil, con tus palabras.");
        }}
        onCredential={(values) => {
          if (!apply((draft) => answerOfferedCredential(draft, values, ask.thing))) return;
          recordMetric("requirement_claimed");
          said("done", "Guardado en tu perfil, como algo tuyo.");
        }}
        onConditions={(answer) => {
          if (!apply((draft) => answerOfferedConditions(draft, answer, ask.thing))) return;
          recordMetric("requirement_claimed");
          said("done", "Anotado en lo práctico de tu perfil.");
        }}
        onDecline={() => {
          apply((draft) => void declineOffered(draft, ask.thing, ask.fragment));
          recordMetric("requirement_declined");
          said("no", "Queda anotado en tu perfil y no te lo volvemos a preguntar por ahora.");
        }}
        onKeep={() => {
          apply((draft) => void keepOffered(draft, ask.thing));
          said("no", "Queda como lo dijiste, y no te lo volvemos a preguntar.");
        }}
        onLater={() => {
          apply((draft) => void putOffOffered(draft));
          said("later", "Lo dejamos para después.");
        }}
      />
    </div>
  );
}
