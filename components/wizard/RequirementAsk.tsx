"use client";

import { useId, useState } from "react";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { EXPIRY_YEARS_AHEAD, MonthYearPicker } from "@/components/onboarding/MonthYearPicker";
import { ClaimForm } from "@/components/wizard/panels";
import { askedAgainQuestion, type RequirementAsk } from "@/lib/jobs/requirement-ask";
import type { DateValue } from "@/lib/profile/dates";
import type { Practical } from "@/lib/schemas/profile";

/**
 * The one question a posting puts to the person (`lib/jobs/requirement-ask.ts`): the offer's own line, so that they see where it comes from, the
 * question in fixed words, and three answers of the same weight — «Sí», «No» and «Ahora no» — because none of them is the one to nudge towards.
 *
 * «Sí» asks for what is theirs to say, in their own words and no one else's: the line where they used a tool or did a task, the credential they hold
 * and until when, the class of a licence, how they can work. «No» is kept in the profile with its day and not asked again in the next posting;
 * «Ahora no» is only for this one and says nothing of whether they have it. Asked a second time, a year after a «no», it says the day it was said and
 * gives the second answer its own words —«Sigue siendo no»—, which is the last; «Ahora no» is still only for this posting. It is one question: the day, and
 * whether it is still so.
 */

/** What «Sí» is called, for each kind: it says what is being said yes to when that is a thing. */
const YES: Record<RequirementAsk["kind"], (thing: string) => string> = {
  tool: (thing) => `Sí, usé ${thing}`,
  task: () => "Sí, lo hice",
  credential: () => "Sí, la tengo",
  license: () => "Sí",
  vehicle: () => "Sí",
  availability: () => "Sí",
  documents: () => "Sí",
};

type TextAnswer = { label: string; field: "driverLicense" | "availability" | "workEligibility"; max: number; rows?: number };

const TEXT_ANSWERS: Partial<Record<RequirementAsk["kind"], TextAnswer>> = {
  license: { label: "¿De qué clase?", field: "driverLicense", max: 80 },
  availability: { label: "Contá tu disponibilidad en una frase", field: "availability", max: 200, rows: 2 },
  documents: { label: "Contá qué tenés", field: "workEligibility", max: 200 },
};

function CredentialForm({ now, onSubmit, onCancel }: { now: Date; onSubmit: (values: { name: string; expires?: DateValue }) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [expires, setExpires] = useState<DateValue>({});
  const year = now.getFullYear();
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim()) onSubmit({ name: name.trim(), ...(expires.year !== undefined ? { expires } : {}) });
      }}
    >
      <Field label="¿Cuál tenés?">
        <Input autoFocus value={name} maxLength={160} onChange={(event) => setName(event.target.value)} />
      </Field>
      <MonthYearPicker label="Vigente hasta (opcional)" value={expires} onChange={setExpires} newest={year + EXPIRY_YEARS_AHEAD} oldest={year - 10} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!name.trim()}>
          Guardar en mi perfil
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function TextForm({ answer, onSubmit, onCancel }: { answer: TextAnswer; onSubmit: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState("");
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim()) onSubmit(text.trim());
      }}
    >
      <Field label={answer.label}>
        {answer.rows ? (
          <Textarea autoFocus rows={answer.rows} value={text} maxLength={answer.max} onChange={(event) => setText(event.target.value)} />
        ) : (
          <Input autoFocus value={text} maxLength={answer.max} onChange={(event) => setText(event.target.value)} />
        )}
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!text.trim()}>
          Guardar en mi perfil
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

/** What the answers need of a question: what it is about, what a «no» is kept under, and whether it is the second asking. */
export type Answerable = Pick<RequirementAsk, "kind" | "thing" | "again">;

type AnswerHandlers = {
  /** A tool or a task: the line they wrote, and the role it belongs to. */
  onClaim: (where: string, jobId: string | null) => void;
  onCredential: (values: { name: string; expires?: DateValue }) => void;
  /** A licence, a vehicle, an availability or a permit: what they said, of the five things the profile keeps about how they can work. */
  onConditions: (answer: Partial<Practical>) => void;
  onDecline: () => void;
  /** «Sigue siendo no», the second asking answered the same. */
  onKeep: () => void;
  onLater: () => void;
};

/**
 * The three answers and what «Sí» asks for, for a question about something an offer asks — wherever the question is asked: under the line of the one offer
 * (`RequirementAskCard`) or among the engine's own, about the offers they analysed (`components/onboarding/RequirementControl.tsx`). The same words and the
 * same weight in both, and the same places the answers go.
 */
export function RequirementAnswers({ ask, jobs, now, onClaim, onCredential, onConditions, onDecline, onKeep, onLater }: AnswerHandlers & {
  ask: Answerable;
  /** The person's own roles, to ask which one a tool or a task belongs to — never guessed. */
  jobs: ReadonlyArray<{ id: string; label: string }>;
  now: Date;
}) {
  const [answering, setAnswering] = useState(false);
  const text = TEXT_ANSWERS[ask.kind];

  const yes = () => {
    // A vehicle is a yes and nothing more to say.
    if (ask.kind === "vehicle") onConditions({ ownVehicle: true });
    else setAnswering(true);
  };

  if (answering && (ask.kind === "tool" || ask.kind === "task")) {
    return (
      <ClaimForm
        className="space-y-2"
        terms={[ask.thing]}
        jobs={jobs}
        question={ask.kind === "tool" ? undefined : "¿Dónde lo hiciste?"}
        placeholder={ask.kind === "tool" ? undefined : "Qué hiciste, dónde y para qué…"}
        onClaim={onClaim}
        onCancel={() => setAnswering(false)}
      />
    );
  }
  if (answering && ask.kind === "credential") return <CredentialForm now={now} onSubmit={onCredential} onCancel={() => setAnswering(false)} />;
  if (answering && text) return <TextForm answer={text} onSubmit={(value) => onConditions({ [text.field]: value })} onCancel={() => setAnswering(false)} />;
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" onClick={yes}>
        {YES[ask.kind](ask.thing)}
      </Button>
      <Button variant="secondary" onClick={ask.again ? onKeep : onDecline}>
        {ask.again ? "Sigue siendo no" : "No"}
      </Button>
      <Button variant="secondary" onClick={onLater}>
        Ahora no
      </Button>
    </div>
  );
}

export function RequirementAskCard({
  ask,
  jobs,
  now,
  onClaim,
  onCredential,
  onConditions,
  onDecline,
  onKeep,
  onLater,
}: AnswerHandlers & {
  ask: RequirementAsk;
  /** The person's own roles, to ask which one a tool or a task belongs to — never guessed. */
  jobs: ReadonlyArray<{ id: string; label: string }>;
  now: Date;
}) {
  const headingId = useId();
  // A quote that was cut at the length of a line says so.
  const quoted = ask.fragment.length >= 238 ? `${ask.fragment}…` : ask.fragment;

  return (
    <section aria-labelledby={headingId} data-requirement-ask={ask.kind} className="space-y-4 border border-rule bg-paper-2 p-5 sm:p-6">
      <p className="font-solar text-[12.5px] font-bold tracking-[0.18em] text-ink-3 uppercase">Lo que pide el aviso</p>
      <blockquote className="border-l-2 border-oro-soft pl-3 text-[15px] leading-snug wrap-break-word text-ink-2" data-requirement-quote>
        {quoted}
      </blockquote>
      <h2 id={headingId} className="text-[19px] leading-snug text-ink" {...(ask.again ? { "data-declined-again": "" } : {})}>
        {ask.again ? askedAgainQuestion(ask.again, now) : ask.question}
      </h2>
      <RequirementAnswers ask={ask} jobs={jobs} now={now} onClaim={onClaim} onCredential={onCredential} onConditions={onConditions} onDecline={onDecline} onKeep={onKeep} onLater={onLater} />
    </section>
  );
}
