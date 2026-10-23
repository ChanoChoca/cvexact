"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert } from "@/components/ui";
import { RenewalControl } from "@/components/onboarding/QuestionControls";
import { credentialGapId } from "@/lib/onboarding/gaps";
import type { CredentialReview } from "@/lib/profile/currency";
import { spelledDate, type DateValue } from "@/lib/profile/dates";
import { whenWords } from "@/lib/profile/sync-status";

/**
 * The credentials in a CV whose date has already passed, said where the CV is handed over: «Tu CV incluye una credencial con fecha
 * vencida». Said and not held back, like the blocks nobody has looked at (`UnreviewedBlocksAlert`): it is the person's profile, a
 * lapsed date may well be one they already renewed and did not say, and the CV uses what the profile holds until they do. What is
 * given is the way to settle it — the very question that asks «¿Hiciste la renovación?» —, and nothing else.
 *
 * Shared by the screens that hand over a CV, so they say it in the same words. Where there is a place for it to be settled, it is one tap away: in the profile, it is
 * the block «Para revisar» (`onReview`, which opens that very question there); on a page with no block, the question's own page (`/perfil/preguntas`). On the page of
 * an application, with the CV in front, it is settled right here (`settle`), and what was already said —«Todavía no»— is told and not asked again as if it had not
 * been. Nothing when no date has passed.
 */

/** What the page of an application gives for the credentials to be settled in place: the answers, kept in the profile the way the question keeps them. */
export type CredentialSettle = {
  now: Date;
  /** The day «Todavía no» was said to this one, if it was. */
  putOffAt: (review: CredentialReview) => string | null;
  /** «Sí, la hice» with the date it holds until now, or without one. */
  onRenewed: (review: CredentialReview, expires: DateValue | null) => void;
  onNoLonger: (review: CredentialReview) => void;
  onLater: (review: CredentialReview) => void;
};

/** What each answer says it did, in the words the question's own card uses for it. */
export function receiptOf(review: CredentialReview, answer: "renewed" | "no-longer" | "later", expires: DateValue | null): string {
  switch (answer) {
    case "renewed":
      return expires ? `«${review.name}»: guardado, vence en ${spelledDate(expires)}.` : `«${review.name}»: listo, sin fecha no te lo volvemos a preguntar.`;
    case "no-longer":
      return review.subject.kind === "license" ? `«${review.name}»: listo, lo sacamos de lo que anotaste.` : `«${review.name}»: listo, queda en tu perfil pero no va en ningún CV.`;
    case "later":
      return `«${review.name}»: lo dejamos para después.`;
  }
}

function Row({ review, settle, onDone }: { review: CredentialReview; settle: CredentialSettle; onDone: (line: string) => void }) {
  const [open, setOpen] = useState(false);
  const putOff = settle.putOffAt(review);
  return (
    <li>
      «{review.name}» venció en {spelledDate(review.expires)}.
      {putOff ? ` Dijiste ${whenWords(putOff, settle.now)} que todavía no.` : ""}{" "}
      {open ? (
        <div className="mt-2 space-y-3" data-renewal>
          <RenewalControl
            onRenewed={(expires) => {
              settle.onRenewed(review, expires);
              onDone(receiptOf(review, "renewed", expires));
            }}
            onNoLonger={() => {
              settle.onNoLonger(review);
              onDone(receiptOf(review, "no-longer", null));
            }}
            onLater={() => {
              settle.onLater(review);
              onDone(receiptOf(review, "later", null));
              setOpen(false);
            }}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="underline underline-offset-4 hover:text-ink pointer-coarse:inline-block pointer-coarse:-my-3 pointer-coarse:py-3.5"
        >
          {putOff ? "Ya hice la renovación" : "¿Hiciste la renovación?"}
        </button>
      )}
    </li>
  );
}

export function ExpiredCredentialsAlert({
  reviews,
  settle,
  onReview,
}: {
  reviews: readonly CredentialReview[];
  settle?: CredentialSettle;
  /** The profile page lists what time brings in one block, and this opens the question there: by the id of the question. */
  onReview?: (gapId: string) => void;
}) {
  // What was just answered stays said after the credential is no longer lapsed — which is what answering it did.
  const [done, setDone] = useState<string[]>([]);
  if (reviews.length === 0 && done.length === 0) return null;
  const one = reviews.length === 1;
  return (
    <div data-expired-credentials>
      {reviews.length > 0 ? (
        <Alert tone="info" title={one ? "Tu CV incluye una credencial con fecha vencida" : `Tu CV incluye ${reviews.length} credenciales con fecha vencida`}>
          <ul className="mt-1 space-y-1">
            {reviews.map((review) =>
              settle ? (
                <Row key={credentialGapId(review)} review={review} settle={settle} onDone={(line) => setDone((lines) => [...lines, line])} />
              ) : (
                <li key={credentialGapId(review)}>
                  «{review.name}» venció en {spelledDate(review.expires)}.{" "}
                  {onReview ? (
                    <button
                      type="button"
                      onClick={() => onReview(credentialGapId(review))}
                      className="underline underline-offset-4 hover:text-ink pointer-coarse:inline-block pointer-coarse:-my-3 pointer-coarse:py-3.5"
                    >
                      ¿Hiciste la renovación?
                    </button>
                  ) : (
                    <Link
                      href={`/perfil/preguntas?pregunta=${encodeURIComponent(credentialGapId(review))}`}
                      className="underline underline-offset-4 hover:text-ink pointer-coarse:inline-block pointer-coarse:-my-3 pointer-coarse:py-3.5"
                    >
                      ¿Hiciste la renovación?
                    </Link>
                  )}
                </li>
              ),
            )}
          </ul>
          <p className="mt-2">El CV {one ? "la usa tal como está" : "las usa tal como están"}.</p>
        </Alert>
      ) : null}
      {done.length > 0 ? (
        <Alert tone="good" role="status">
          {done.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </Alert>
      ) : null}
    </div>
  );
}

