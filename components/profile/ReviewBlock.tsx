"use client";

import { useEffect, useRef, useState } from "react";
import { QuestionLoop } from "@/components/onboarding/QuestionLoop";
import { AnswerReceipt } from "@/components/onboarding/AnswerReceipt";
import { ReminderOffer } from "@/components/profile/ReminderOffer";
import { Badge, Button } from "@/components/ui";
import { focusHeading } from "@/components/ui/focusHeading";
import { ANCHOR, SECTION_ID } from "@/components/profile/anchors";
import { ENGINE } from "@/lib/onboarding/config";
import { REVIEW_RULES } from "@/lib/onboarding/gaps";
import { restoreProfile, type LastAnswer } from "@/lib/onboarding/last-answer";
import { beginSession, isSessionFresh } from "@/lib/onboarding/session";
import { returnReview } from "@/lib/profile/currency";
import { declinedReceipt, keepDeclined, withdrawDeclined } from "@/lib/profile/declined";
import { whenWords } from "@/lib/profile/sync-status";
import { openReviewItems, pauseLine, putOffThisVisit, recapLine, type ReviewItem } from "@/lib/profile/to-review";
import type { StoredProfile } from "@/lib/schemas/profile-v2";
import { inWeeks } from "@/lib/storage/durability";
import { loadStoredProfile, updateStoredProfile } from "@/lib/storage/local";
import { putOffReviewItem, snoozeReturnReview, useReturnReviewState } from "@/lib/storage/return-review";

/** Asked from another part of the page — a credential's card, a job's — to open one of the things to review. `n` counts up, so the same one can be asked twice. */
export type ReviewRequest = { id: string; n: number };

type Asked = { id: string; short: string };
type Outcome = "done" | "later" | "aside";
/** What was reviewed in this visit: what it was, what became of it, what was said, and the profile as it was before — to take the last one back. */
type Done = Asked & { outcome: Outcome; receipt: string; before: StoredProfile | null };

const TITLE = "font-solar text-[12.5px] font-bold tracking-[0.18em] text-ink-3 uppercase";
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * «Para revisar», at the top of the profile: what time brings, listed once, and answered where it is listed.
 *
 * It is the one door to what the review of what changed, «Fechas para revisar» and the questions that make a CV better each opened on their own: a tap on a row
 * asks the question there, in the block, with the same answers —the same weight, «Ahora no» among them— and says what it did, with its «Deshacer»; «Revisar todo»
 * goes through them one by one in the same place. When there is nothing left to settle the block says what was reviewed and what stayed for later, and folds into
 * that line. «Ahora no» to the block as a whole folds it too, and says until when. Nothing here is required, and nothing waits on it: the profile below is as usable
 * as it was.
 */
export function ReviewBlock({ profile, now, items, request }: { profile: StoredProfile; now: Date; items: readonly ReviewItem[]; request?: ReviewRequest | null | undefined }) {
  const returnState = useReturnReviewState();
  const open = openReviewItems(items);
  const later = items.filter((item) => item.later);
  const asksAnything = open.filter((item) => item.kind !== "declined");

  const [asking, setAsking] = useState<Asked | null>(null);
  const [queue, setQueue] = useState<Asked[]>([]);
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState<Done[]>([]);
  const [unfolded, setUnfolded] = useState(false);
  const [handled, setHandled] = useState(0);
  // The pause is said as the page opened: answering moves the date it counts from, and the line would go with the first answer.
  const [pause] = useState(() => returnReview(profile, now));
  const box = useRef<HTMLElement>(null);
  const wasAsking = useRef(false);

  // Asked for from another part of the page: it opens, wherever it was.
  if (request && request.n !== handled) {
    setHandled(request.n);
    const wanted = items.find((item) => item.id === request.id && item.kind !== "declined");
    if (wanted) {
      setAsking({ id: wanted.id, short: wanted.short });
      setQueue([]);
      setTotal(1);
      setUnfolded(true);
    }
  }

  // What replaced what was pressed is said to whoever cannot see it change: the question, and then — when it is done — the block.
  const askingId = asking?.id;
  useEffect(() => {
    if (askingId) {
      wasAsking.current = true;
      focusHeading(box.current?.querySelector<HTMLElement>("#question-title"));
    } else if (wasAsking.current) {
      wasAsking.current = false;
      focusHeading(box.current?.querySelector<HTMLElement>("#review-title"));
    }
  }, [askingId]);

  /** A visit long after the last is a new session: begun before anything is asked, so that «Ahora no» is until the next one. */
  const ask = (first: ReviewItem, rest: readonly ReviewItem[] = []) => {
    if (!isSessionFresh(loadStoredProfile())) updateStoredProfile((draft) => void beginSession(draft));
    setAsking({ id: first.id, short: first.short });
    setQueue(rest.map((item) => ({ id: item.id, short: item.short })));
    setTotal(rest.length + 1);
  };

  const remember = (entry: Done) => setDone((current) => [...current.filter((existing) => existing.id !== entry.id), entry]);

  /** The question was answered, or put off, or closed: what became of it is kept, and the next one — if «Revisar todo» is going — opens. */
  const finish = (current: Asked, last: LastAnswer | undefined) => {
    if (last) {
      const stored = loadStoredProfile();
      const outcome: Outcome = stored.pending.some((entry) => entry.questionId === current.id && entry.state === "na") ? "aside" : putOffThisVisit(stored, current.id) ? "later" : "done";
      remember({ ...current, outcome, receipt: last.receipt, before: last.before });
    }
    const [next, ...rest] = queue;
    setAsking(next ?? null);
    setQueue(rest);
  };

  /** «Deshacer», of the last one only: it gives the profile back as it was before that answer, and an earlier answer would take the later ones with it. */
  const undo = (entry: Done) => {
    if (!entry.before) return;
    restoreProfile(entry.before);
    setDone((current) => current.filter((existing) => existing.id !== entry.id));
  };

  const settle = (item: ReviewItem, how: "have" | "still") => {
    const declined = item.declined;
    if (!declined) return;
    const before = loadStoredProfile();
    updateStoredProfile((draft) => void (how === "have" ? withdrawDeclined(draft, declined.id) : keepDeclined(draft, declined.id)));
    remember({ id: item.id, short: item.short, outcome: "done", receipt: declinedReceipt(declined, how), before });
  };

  const putOff = (item: ReviewItem) => {
    putOffReviewItem(item.id);
    remember({ id: item.id, short: item.short, outcome: "later", receipt: `Lo dejamos para después: te lo volvemos a mostrar ${inWeeks(ENGINE.currency.returnSnoozeDays)}.`, before: null });
  };

  const snoozed = returnState.snoozedUntil !== undefined && returnState.snoozedUntil > now.toISOString();
  const frame = `${ANCHOR} border border-rule bg-paper-2 p-5`;

  // --- The question, asked here ---------------------------------------------------------------------------

  if (asking) {
    return (
      <section id={SECTION_ID.review} ref={box} aria-labelledby="review-title" data-review-block data-review-asking={asking.id} className={`${frame} space-y-4`}>
        <h2 id="review-title" className={TITLE}>
          Para revisar
        </h2>
        {total > 1 ? <p className="text-xs text-ink-3">Pregunta {total - queue.length} de {total}</p> : null}
        <QuestionLoop
          key={asking.id}
          profile={profile}
          now={now}
          startWith={asking.id}
          rules={REVIEW_RULES}
          limit={1}
          embedded
          dismissLabel="Volver"
          onExhausted={(_, last) => finish(asking, last)}
        />
        <Button type="button" variant="ghost" onClick={() => { setAsking(null); setQueue([]); }}>
          Volver a la lista
        </Button>
      </section>
    );
  }

  if (items.length === 0 && done.length === 0) return null;

  // --- Nothing to settle now, or put off with «Ahora no»: a line ----------------------------------------

  const settled = done.filter((entry) => entry.outcome !== "later").map((entry) => entry.short);
  const left = [...new Set([...done.filter((entry) => entry.outcome === "later").map((entry) => entry.short), ...later.map((item) => item.short)])];
  const folded = !unfolded && (open.length === 0 || snoozed);
  const lastDone = done[done.length - 1];

  if (folded) {
    return (
      <section id={SECTION_ID.review} ref={box} aria-labelledby="review-title" data-review-block data-review-folded className={`${frame} flex flex-wrap items-center justify-between gap-x-4 gap-y-3`}>
        <div className="min-w-0 flex-[1_1_18rem] space-y-1">
          <h2 id="review-title" className={TITLE}>
            {open.length === 0 && settled.length > 0 ? "Revisado" : "Para revisar"}
          </h2>
          <p className="text-sm text-ink-2">
            {open.length > 0
              ? `${plural(open.length, "cosa", "cosas")} para revisar. Te lo volvemos a mostrar abierto ${whenWords(returnState.snoozedUntil ?? "", now)}.`
              : recapLine(settled, left)}
          </p>
          {/* The last answer is said with the line folded as well, and with its way back: the card that asked it is gone, and what it did would go with it. */}
          {open.length === 0 && lastDone ? (
            <div className="space-y-1 pt-1" data-review-last>
              <p className="text-xs text-ink-3">{lastDone.short.charAt(0).toUpperCase()}{lastDone.short.slice(1)}</p>
              <AnswerReceipt receipt={lastDone.receipt} onUndo={lastDone.before ? () => undo(lastDone) : undefined} />
            </div>
          ) : null}
          {/* Where a review ends, the calendar can be asked to bring it back: only when something was settled in this visit, and only with the switch on. */}
          {open.length === 0 && settled.length > 0 ? <ReminderOffer /> : null}
        </div>
        <Button type="button" variant="secondary" aria-expanded={false} onClick={() => setUnfolded(true)}>
          {open.length > 0 ? "Abrir" : "Ver"}
        </Button>
      </section>
    );
  }

  // --- The list ---------------------------------------------------------------------------------------

  return (
    <section id={SECTION_ID.review} ref={box} aria-labelledby="review-title" data-review-block className={`${frame} space-y-4`}>
      <div className="flex items-center justify-between gap-4">
        <h2 id="review-title" className={`${TITLE} flex items-center gap-2`}>
          Para revisar
          {open.length > 0 ? <Badge>{open.length}</Badge> : null}
        </h2>
        {open.length === 0 ? (
          <Button type="button" variant="ghost" aria-expanded onClick={() => setUnfolded(false)}>
            Cerrar
          </Button>
        ) : null}
      </div>

      {pause && open.length > 0 ? <p className="text-sm text-ink-3">{pauseLine(pause.since)}</p> : null}

      {done.length > 0 ? (
        <div className="space-y-3" data-review-done>
          {done.map((entry, index) => (
            <div key={entry.id} className="space-y-1">
              <p className="text-xs text-ink-3">{entry.short.charAt(0).toUpperCase()}{entry.short.slice(1)}</p>
              <AnswerReceipt receipt={entry.receipt} onUndo={index === done.length - 1 && entry.before ? () => undo(entry) : undefined} />
            </div>
          ))}
        </div>
      ) : null}

      {open.length > 0 ? (
        <ul className="divide-y divide-rule border-y border-rule">
          {open.map((item) => (
            <li key={item.id} data-review-item={item.id} data-review-kind={item.kind}>
              {item.declined ? <DeclinedRow item={item} onSettle={(how) => settle(item, how)} onPutOff={() => putOff(item)} /> : <Row item={item} onOpen={() => ask(item)} />}
            </li>
          ))}
        </ul>
      ) : null}

      {later.length > 0 ? (
        <div className="space-y-1" data-review-later>
          <p className={TITLE}>Para después</p>
          <ul className="divide-y divide-rule border-y border-rule">
            {later.map((item) => {
              // What the engine put off comes back with the next visit; a «no» that was put off, on the day the browser remembers.
              const until = returnState.putOff?.[item.id];
              const back = item.declined ? (until ? `Vuelve ${whenWords(until, now)}.` : "") : "Vuelve la próxima vez que vengas.";
              return (
                <li key={item.id} data-review-item={item.id} data-review-kind={item.kind}>
                  {item.declined ? <DeclinedRow item={item} back={back} onSettle={(how) => settle(item, how)} onPutOff={() => putOff(item)} /> : <Row item={item} back={back} onOpen={() => ask(item)} />}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {open.length > 0 ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {asksAnything.length > 1 ? (
              <Button type="button" variant="secondary" onClick={() => ask(asksAnything[0]!, asksAnything.slice(1))}>
                Revisar todo
              </Button>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                snoozeReturnReview();
                setUnfolded(false);
              }}
            >
              Ahora no
            </Button>
          </div>
          <p className="text-xs text-ink-3" data-review-put-off>
            Con «Ahora no» este bloque queda cerrado y te lo volvemos a mostrar abierto {inWeeks(ENGINE.currency.returnSnoozeDays)}.
          </p>
        </div>
      ) : null}
    </section>
  );
}

/** One thing to review that is answered by a question: the row says what, and a tap asks it here. */
function Row({ item, back, onOpen }: { item: ReviewItem; /** When it comes back, for what was put off. */ back?: string; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="flex min-h-11 w-full items-center justify-between gap-4 py-3 text-left transition-colors hover:text-ink motion-reduce:transition-none">
      <span className="min-w-0 flex-1">
        <span className="block wrap-break-word text-[15px] text-ink">{item.label}</span>
        {item.note ? <span className="mt-0.5 block wrap-break-word text-xs text-ink-3">{item.note}</span> : null}
        {back ? <span className="mt-0.5 block text-xs text-ink-3">{back}</span> : null}
      </span>
      <span aria-hidden className="shrink-0 font-solar text-xs tracking-[0.14em] text-ink-3 uppercase">
        Revisar →
      </span>
    </button>
  );
}

/** A «no» that a line now names: answered on its row, with three answers of the same weight. */
function DeclinedRow({ item, back, onSettle, onPutOff }: { item: ReviewItem; back?: string; onSettle: (how: "have" | "still") => void; onPutOff: () => void }) {
  return (
    <div className="space-y-3 py-3">
      <div className="min-w-0">
        <p className="wrap-break-word text-[15px] text-ink">{item.label}</p>
        {item.note ? <p className="mt-0.5 wrap-break-word text-xs text-ink-3">{item.note}</p> : null}
        {back ? <p className="mt-0.5 text-xs text-ink-3">{back}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label={`${item.label}`}>
        <Button type="button" variant="secondary" onClick={() => onSettle("have")}>
          Ya lo tengo
        </Button>
        <Button type="button" variant="secondary" onClick={() => onSettle("still")}>
          Sigue siendo no
        </Button>
        <Button type="button" variant="secondary" onClick={onPutOff}>
          Ahora no
        </Button>
      </div>
    </div>
  );
}
