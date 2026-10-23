"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui";
import { AnswerReceipt } from "./AnswerReceipt";

/**
 * What is said under a question whose own answers include putting it off: when it comes back. «Ahora no» is not «No aplica»: it is asked again, in another
 * visit — a session lasts a few hours (`ENGINE.session.staleAfterHours`), and what was put off waits for the next one — and the person is told so where
 * they can read it before pressing, in the words of the button they press (`label`: «Ahora no», and «Todavía no» for a date that has not been renewed).
 */
export const putOffNote = (label = "Ahora no"): string => `Con «${label}» te lo volvemos a preguntar la próxima vez que vengas.`;

/**
 * The frame of every question: which job it is about, the question, how to answer
 * it in shape, the control, and the two ways not to — neither of which is a failure.
 *
 * "Ahora no" brings it back another day, weighed a little less each time it is put
 * off; "No aplica" is for good. A question that makes a job exist at all — its
 * company, its role, its start — has no score to weigh, so "Ahora no" brings it back
 * as it was, and "Dejarlo así" is the way to leave it as it is.
 *
 * A question whose control has «Ahora no» among its own answers (`putOffLabel`) has no row of ways not to: it says, in a line, when it comes back.
 */
export function QuestionCard({
  context,
  text,
  hint,
  receipt,
  saved,
  onUndo,
  onShowProfile,
  progress,
  blocking,
  onDefer,
  putOffLabel,
  children,
}: {
  context?: string | undefined;
  text: string;
  hint?: string | undefined;
  /** What the last answer did, in a line: "Guardado como aproximado: 20–25 %". */
  receipt?: string | null | undefined;
  /** What the last answer was kept as, when that is more than a line — shown above the question, instead of a receipt. */
  saved?: ReactNode;
  onUndo?: (() => void) | undefined;
  /** Where the answer went, on a screen too narrow to show the profile beside the question. */
  onShowProfile?: (() => void) | undefined;
  /** How much is left: "Quedan unas 4 preguntas." — or, in a review of a few, which of them this is: "Pregunta 1 de 3". */
  progress?: string | undefined;
  blocking?: boolean | undefined;
  /** Omitted for the steps that are a part of one question. */
  onDefer?: ((state: "later" | "skipped" | "na") => void) | undefined;
  /** The question puts itself off, with an answer of its own of this name: the card says when it comes back instead of drawing the generic row. */
  putOffLabel?: string | undefined;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby="question-title" className="space-y-5">
      {saved}
      {receipt ? <AnswerReceipt receipt={receipt} onUndo={onUndo} onShowProfile={onShowProfile} /> : null}

      <div className="space-y-4 border border-rule bg-paper-2 p-5 sm:p-6">
        {context ? <p className="font-solar text-[12.5px] font-bold tracking-[0.18em] text-ink-3 uppercase">{context}</p> : null}
        <div className="space-y-2">
          <h2 id="question-title" className="text-[19px] leading-snug text-ink">
            {text}
          </h2>
          {hint ? <p className="text-sm text-ink-3">{hint}</p> : null}
        </div>
        {children}
      </div>

      {!onDefer && putOffLabel ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1" data-put-off-note>
          <p className="text-xs text-ink-3">{putOffNote(putOffLabel)}</p>
          {progress ? <span className="ml-auto pl-3 text-xs text-ink-3">{progress}</span> : null}
        </div>
      ) : null}

      {onDefer ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Button type="button" variant="ghost" onClick={() => onDefer(blocking ? "later" : "skipped")}>
            Ahora no
          </Button>
          <Button type="button" variant="ghost" onClick={() => onDefer("na")}>
            {blocking ? "Dejarlo así" : "No aplica"}
          </Button>
          {progress ? <span className="ml-auto pl-3 text-xs text-ink-3">{progress}</span> : null}
        </div>
      ) : null}
    </section>
  );
}
