"use client";

import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  CollapsibleCard,
  Field,
  SectionTitle,
  Input,
  Select,
  Spinner,
  Tabs,
  Textarea,
  cx,
} from "@/components/ui";
import { ApiError, callGenerator, hasUntriedKeys, type DenialReason } from "@/lib/api/client";
import { streamGenerator } from "@/lib/api/stream-client";
import { LimitReached, denialOf } from "@/components/billing/LimitReached";
import { DownloadPdfButton } from "@/components/cv/DownloadPdfButton";
import { RepeatableList } from "@/components/profile/parts";
import type { Application, SaveOutcome } from "@/lib/storage/local";
import {
  EXTRA_ENDPOINT,
  generateWithRecovery,
  isRecoverableFailure,
  type ExtraKind,
} from "@/lib/applications/generation";
import { beginPendingGeneration, resolvePendingGeneration } from "@/lib/applications/pending";
import type { Finding } from "@/lib/ai/verify";
import type { Profile } from "@/lib/schemas/profile";
import type {
  AnswerWithLimit,
  AnswersWithLimits,
  CoverEmail,
  EmailLength,
  EmailTone,
  InterviewPrep,
  VideoScript,
} from "@/lib/schemas/outputs";
import { VIDEO_MAX_SECONDS, VIDEO_MIN_SECONDS } from "@/lib/schemas/outputs";
import { countWords, parseQuestionLimit } from "@/lib/ai/question-limits";
import { formatClock, startTimes } from "@/lib/video/timeline";

/**
 * The artifacts that sit around the CV: the application form's questions, the
 * email the CV is attached to, interview preparation, and the script for the
 * presentation video some postings ask the candidate to record.
 *
 * They all reuse the cached job analysis and the generated CV, so they cost one
 * model call each and cannot contradict the CV the employer already has.
 */

type Tab = "answers" | "email" | "interview" | "video";

const TABS: { id: Tab; label: string }[] = [
  { id: "answers", label: "Preguntas del formulario" },
  { id: "email", label: "Email de presentación" },
  { id: "interview", label: "Preparar la entrevista" },
  { id: "video", label: "Video de presentación" },
];

export function ExtrasPanel({
  application,
  profile,
  onSaved,
}: {
  application: Application;
  profile: Profile;
  onSaved: (patch: Partial<Application>) => Promise<SaveOutcome>;
}) {
  const [tab, setTab] = useState<Tab>("answers");

  return (
    <Card>
      <SectionTitle>Y además</SectionTitle>

      {/* Four full-length Spanish labels wrap to three or four lines at
          phone width; a horizontal scroll keeps the tablist to one line and
          still reaches every tab, the same trade the rest of the app makes
          with `overflow-x-auto` on anything that cannot shrink further. */}
      <div className="mb-5">
        <Tabs
          label="Y además"
          activeId={tab}
          onChange={setTab}
          tabs={TABS.map((entry) => ({
            ...entry,
            domId: `extras-tab-${entry.id}`,
            controls: `extras-panel-${entry.id}`,
          }))}
        />
      </div>

      {TABS.map((entry) => (
        <div
          key={entry.id}
          role="tabpanel"
          id={`extras-panel-${entry.id}`}
          aria-labelledby={`extras-tab-${entry.id}`}
          hidden={tab !== entry.id}
        >
          {tab === entry.id ? (
            entry.id === "answers" ? (
              <AnswersTab application={application} profile={profile} onSaved={onSaved} />
            ) : entry.id === "email" ? (
              <EmailTab application={application} profile={profile} onSaved={onSaved} />
            ) : entry.id === "interview" ? (
              <InterviewTab application={application} profile={profile} onSaved={onSaved} />
            ) : (
              <VideoTab application={application} profile={profile} onSaved={onSaved} />
            )
          ) : null}
        </div>
      ))}
    </Card>
  );
}

/**
 * Shared submit plumbing: busy state, error surfacing, cancellation, retry,
 * and persistence — for the four generators in this panel, none of which had
 * any of the last three until now. That gap mattered in two ways: a 429 quota
 * refusal rendered as a plain red `Alert` instead of `LimitReached` (exactly
 * the failure mode its own docstring argues against), and there was no way to
 * stop or retry a call short of leaving the tab.
 */
function useGenerator<T>(
  kind: ExtraKind,
  applicationId: string,
  onSaved: (patch: Partial<Application>) => Promise<SaveOutcome>,
  options: {
    /**
     * Interview preparation is the one generation too long for a proxy to hold
     * open with no bytes — it streams, like the CV, and its route narrates the
     * stages and provider fallbacks in frames. The rest answer a JSON body.
     */
    stream?: boolean;
    /** See `streamGenerator` — the interview tab narrates its `switch` frames. */
    onFrame?: (frame: { type: string } & Record<string, unknown>) => void;
  } = {},
) {
  const endpoint = EXTRA_ENDPOINT[kind];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A refusal over quota is a fork in the road, not a red toast. */
  const [denied, setDenied] = useState<DenialReason | null>(null);
  const abort = useRef<AbortController | null>(null);
  /** What the last call actually sent, so "Reintentar" need not repeat the caller. */
  const lastCall = useRef<{ body: unknown; toPatch: (result: T) => Partial<Application> } | null>(
    null,
  );
  /** See `retryKeyRef` in `Wizard.tsx`: a connection that failed after the server may have finished retries under the same key. */
  const retryKey = useRef<string | null>(null);

  /**
   * `continuing` is never set by a caller — only by this function calling
   * itself once, when the chain ran out of budget with keys still unspent.
   * `callGenerator` has already sunk every candidate this request touched to
   * the end of Ajustes' order by the time the `catch` below sees the error
   * (see `recordProviderNotes` in `@/lib/api/client`), so the retry reaches
   * keys the first attempt never tried. Capped at one continuation, the same
   * cap `Wizard.tsx`'s `generate` applies to the CV.
   */
  const attempt = async (
    body: unknown,
    toPatch: (result: T) => Partial<Application>,
    continuing?: boolean,
    reuseKey?: string | null,
  ): Promise<void> => {
    const controller = new AbortController();
    abort.current = controller;
    const pending = beginPendingGeneration(kind, applicationId, reuseKey ?? undefined);
    retryKey.current = null;

    // Only the model call is in here — the same split `Wizard.tsx` makes, for
    // the same reason: storing the result used to share this `try`, so a
    // browser that refused the save turned a finished answer into «Ocurrió un
    // error inesperado» and a «Reintentar» that paid for it again.
    let result: T;
    try {
      result = await generateWithRecovery(
        () =>
          options.stream
            ? streamGenerator<T>(endpoint, body, {
                signal: controller.signal,
                onFrame: options.onFrame,
                idempotencyKey: pending.key,
              })
            : callGenerator<T>(endpoint, body, controller.signal, { idempotencyKey: pending.key }),
        pending.key,
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        resolvePendingGeneration(pending.key);
        return;
      }
      if (isRecoverableFailure(err)) retryKey.current = pending.key;
      else resolvePendingGeneration(pending.key);
      if (!continuing && hasUntriedKeys(err)) {
        await attempt(body, toPatch, true);
        return;
      }
      const denial = denialOf(err);
      if (denial) setDenied(denial);
      else setError(err instanceof ApiError ? err.message : "Ocurrió un error inesperado.");
      return;
    }

    // On screen before this resolves, whatever the browser decides about
    // keeping it; a refusal is shown by the Wizard's «sin guardar» notice.
    const outcome = await onSaved(toPatch(result));
    if (outcome.ok) resolvePendingGeneration(pending.key);
  };

  const run = async (
    body: unknown,
    toPatch: (result: T) => Partial<Application>,
    reuseKey?: string | null,
  ) => {
    setBusy(true);
    setError(null);
    setDenied(null);
    lastCall.current = { body, toPatch };
    try {
      await attempt(body, toPatch, false, reuseKey);
    } finally {
      abort.current = null;
      setBusy(false);
    }
  };

  const retry = () => {
    if (lastCall.current) void run(lastCall.current.body, lastCall.current.toPatch, retryKey.current);
  };

  const cancel = () => abort.current?.abort();

  return { busy, error, denied, setDenied, run, retry, cancel };
}

/**
 * The denial/error tail every tab's generator renders, pulled out once so the
 * four tabs cannot drift out of sync the way they had before this existed —
 * three of them rendered a plain `Alert` for a quota refusal that should have
 * been `LimitReached`, and none of them offered a retry.
 */
function GeneratorStatus({
  error,
  denied,
  onRetry,
  onResolved,
}: {
  error: string | null;
  denied: DenialReason | null;
  onRetry: () => void;
  onResolved: () => void;
}) {
  if (denied) return <LimitReached reason={denied} onResolved={onResolved} />;
  if (!error) return null;
  return (
    <Alert tone="bad">
      {error}{" "}
      <button
        type="button"
        onClick={onRetry}
        className="underline underline-offset-4 hover:text-ink"
      >
        Reintentar
      </button>
    </Alert>
  );
}

function CopyButton({ text, label = "Copiar" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "Copiado" : label}
    </Button>
  );
}

// --- Application form questions -----------------------------------------------

/**
 * The verifier's findings for one answer, matched by the `answers[n]` prefix
 * `auditAnswers` writes into `field`.
 *
 * Shown against the answer itself rather than gathered into a `FindingsPanel`
 * like the CV's: there are up to thirty answers here and each is copied into a
 * form on its own, so "esta respuesta dice 0 años" is only actionable next to
 * the answer it is about.
 */
function findingsFor(findings: Finding[] | undefined, index: number): Finding[] {
  return (findings ?? []).filter((f) => f.field.startsWith(`answers[${index}]`));
}

/**
 * The form limit next to a live count of what was written.
 *
 * The employer's input box is the one reader that cuts an answer off, so the
 * count sits beside the copy button: visible at the moment of pasting, counted
 * the same way the server's `answerLimitGaps` counted it. Green means it fits;
 * red means the paste will fail or come out cut.
 */
function LimitNote({ entry }: { entry: AnswerWithLimit }) {
  const max = entry.maxChars ?? entry.maxWords;
  if (!max) return null;
  const isChars = entry.maxChars !== undefined;
  const text = entry.answer || entry.shortAnswer;
  const used = isChars ? text.length : countWords(text);
  const over = used > max;
  return (
    <p className={cx("mt-1 text-xs", over ? "font-medium text-red-300" : "text-ink-3")}>
      Máximo {max} {isChars ? "caracteres" : "palabras"} · {used}
      {over ? " — recortala antes de pegarla" : ""}
    </p>
  );
}

type QuestionRow = {
  id: string;
  text: string;
  /** Typed by the user next to the question; `null` uses the parsed/default limit. */
  maxChars: number | null;
}

/** A blank row: nothing is preset because only the user knows the question. */
const createQuestionRow = (): QuestionRow => ({
  id: crypto.randomUUID(),
  text: "",
  maxChars: null,
});

function AnswersTab({
  application,
  profile,
  onSaved,
}: {
  application: Application;
  profile: Profile;
  onSaved: (patch: Partial<Application>) => Promise<SaveOutcome>;
}) {
  // Questions embedded in the posting are pre-filled; most of the time the user
  // is pasting them from the employer's form instead. With none of either, one
  // empty row is already waiting — its text is deliberately unset because only
  // the user knows the question, and the textarea's placeholder is what guides
  // the fill. The row titles stay static (#1, #2, …): the question is already
  // visible in its textarea, and echoing whatever is typed up in the header too
  // just re-wraps one string into two places on every keystroke.
  const [rows, setRows] = useState<QuestionRow[]>(() => {
    const embedded = (application.analysis?.embeddedQuestions ?? []).map((text) => ({
      id: crypto.randomUUID(),
      text,
      maxChars: null,
    }));
    if (embedded.length > 0) return embedded;
    return [createQuestionRow()];
  });
  const { busy, error, denied, setDenied, run, retry, cancel } = useGenerator<{
    answers: AnswersWithLimits;
    findings: Finding[];
  }>("answers", application.id, onSaved);

  // The employer's own character counter never travels with a pasted
  // question — it lives beside the input box in their HTML, not in the text
  // — so the limit is typed here instead of parsed out of the paste.
  const activeRows = rows.filter((r) => r.text.trim());
  const questions = activeRows.map((r) => r.text.trim());
  const questionLimits = activeRows.map((r) => r.maxChars);

  return (
    <div className="space-y-4">
      <RepeatableList
        items={rows}
        onChange={setRows}
        create={createQuestionRow}
        addLabel="Agregar pregunta"
        emptyLabel="Agregá las preguntas del formulario."
        max={30}
        renderItem={(item, update) => {
          // The pasted question often states the cap the employer's form puts
          // on the answer ("máx. 300 caracteres"). Showing it as the limit
          // field's placeholder surfaces what generation will already use —
          // `parseQuestionLimits` strips and applies it regardless — without
          // presetting the field, which stays empty until the user types over
          // it (an explicit value wins, see `parseQuestionLimits`).
          const parsed = parseQuestionLimit(item.text).limit;
          return (
            <div className="flex items-start gap-3">
              <Field label="Pregunta" className="flex-1">
                <Textarea
                  rows={2}
                  value={item.text}
                  onChange={(e) => update({ text: e.target.value })}
                  placeholder="¿Por qué querés trabajar con nosotros?"
                />
              </Field>
              <Field label="Límite" hint="Opcional" className="w-28 shrink-0">
                <Input
                  type="number"
                  min={1}
                  max={100000}
                  value={item.maxChars ?? ""}
                  onChange={(e) =>
                    update({ maxChars: e.target.value ? Number(e.target.value) : null })
                  }
                  placeholder={
                    parsed
                      ? `Ej.: ${parsed.max} ${parsed.unit === "words" ? "palabras" : "caracteres"}`
                      : "Sin límite"
                  }
                />
              </Field>
            </div>
          );
        }}
      />

      <div className="flex items-center gap-3">
        <Button
          disabled={busy || questions.length === 0}
          onClick={() =>
            run(
              {
                profile,
                analysis: application.analysis,
                cv: application.cv,
                inferredSkills: application.inferredSkills,
                questions,
                questionLimits,
              },
              // Written together, so a reopened application never shows answers
              // without the check that was run on them.
              (result) => ({ answers: result.answers, answersFindings: result.findings }),
            )
          }
        >
          {busy ? <Spinner /> : null}
          {busy ? "Respondiendo…" : `Responder ${questions.length || ""}`.trim()}
        </Button>
        {busy ? (
          <Button variant="secondary" type="button" onClick={cancel}>
            Parar
          </Button>
        ) : null}
      </div>

      <GeneratorStatus
        error={error}
        denied={denied}
        onRetry={retry}
        onResolved={() => setDenied(null)}
      />

      {application.answers ? (
        <div className="space-y-4 border-t border-rule pt-4">
          {application.answers.answers.map((entry, index) => (
            <div key={index}>
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium text-ink">{entry.question}</p>
                <CopyButton text={entry.answer} />
              </div>
              {entry.shortAnswer ? (
                <p className="mt-1 text-sm font-semibold text-oro">
                  {entry.shortAnswer}
                </p>
              ) : null}
              <p className="mt-1 whitespace-pre-wrap text-sm text-ink-2">
                {entry.answer}
              </p>
              {entry.maxChars || entry.maxWords ? <LimitNote entry={entry} /> : null}
              {entry.needsUserInput ? (
                <p className="mt-1 text-xs text-amber-300">
                  Revisá esta respuesta: tu perfil no tiene el dato y es un borrador.
                </p>
              ) : null}
              {findingsFor(application.answersFindings, index).map((finding, i) => (
                <p
                  key={i}
                  className={cx(
                    "mt-1 text-xs",
                    finding.severity === "error" ? "text-red-300" : "text-amber-300",
                  )}
                >
                  {finding.detail}
                </p>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// --- Cover email --------------------------------------------------------------

/**
 * `encodeURIComponent` is right for every part of a compose URL except the
 * address itself, where it turns the "@" into "%40" — legal per RFC 6068, but
 * not every mail client percent-decodes the recipient before looking it up.
 */
function composeParts(to: string, subject: string, body: string) {
  return {
    address: encodeURIComponent(to).replaceAll("%40", "@"),
    subject: encodeURIComponent(subject),
    body: encodeURIComponent(body),
  };
}

function mailtoHref(to: string, subject: string, body: string): string {
  const parts = composeParts(to, subject, body);
  return `mailto:${parts.address}?subject=${parts.subject}&body=${parts.body}`;
}

/** Gmail's compose screen on the web: the same fields, opened in a tab. */
function gmailHref(to: string, subject: string, body: string): string {
  const parts = composeParts(to, subject, body);
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${parts.address}&su=${parts.subject}&body=${parts.body}`;
}

/** Outlook on the web: its deeplink compose serves personal and work accounts. */
function outlookHref(to: string, subject: string, body: string): string {
  const parts = composeParts(to, subject, body);
  return `https://outlook.office.com/mail/deeplink/compose?to=${parts.address}&subject=${parts.subject}&body=${parts.body}`;
}

/**
 * Nobody publishes a URL length limit for the webmail compose links — the
 * browsers take far more — but past roughly eight thousand characters the
 * links start truncating or failing silently, and percent-encoding inflates a
 * Spanish cover email fast (a space ×3, an accented letter ×6). Past the line
 * the webmail entries are disabled instead of handed a link that may arrive
 * cut; the Copy button beside the body is the fallback that never truncates.
 */
const WEBMAIL_URL_LIMIT = 8_000;

const MENU_ITEM =
  "flex w-full items-center px-3 py-2 text-left text-sm text-ink-2 hover:bg-paper-2";

/**
 * Where the send happens is the one thing a mailto: cannot offer: the OS picks
 * the handler, and a browser-only user lands in a desktop app they may not
 * use. The menu hands the same recipient, subject and body to each provider's
 * own compose screen in a new tab, and keeps the mailto: as the last entry
 * for whoever does send from a desktop client — there is no browser API to
 * pick a web mail handler, so the choice has to be shown.
 *
 * The open/close discipline is AccountMenu's: outside click and Escape close
 * it, opening moves focus into the menu and closing hands it back to the
 * trigger, so keyboard users are never dropped mid-tab-order.
 */
function EmailSendMenu({
  to,
  subject,
  body,
}: {
  to: string;
  subject: string;
  body: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  // Closing on an outside click and on Escape is what makes this behave like a
  // menu rather than a panel that has to be dismissed by its own button.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // A menu that opens without moving focus is invisible to anyone not
  // looking at the screen, and closing it must hand focus back to the
  // trigger — otherwise the next Tab jumps to wherever focus happened to be
  // sitting, which after a click is nowhere in particular.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      menu.current?.focus();
      wasOpen.current = true;
    } else if (wasOpen.current) {
      trigger.current?.focus();
      wasOpen.current = false;
    }
  }, [open]);

  // The mailto: entry opens in the same tab on purpose: the OS hands it to
  // the mail client and the browser page is done being useful.
  const entries = [
    { label: "Gmail", href: gmailHref(to, subject, body), web: true },
    { label: "Outlook", href: outlookHref(to, subject, body), web: true },
    { label: "App de correo", href: mailtoHref(to, subject, body), web: false },
  ];
  const tooLong = entries.some((e) => e.web && e.href.length > WEBMAIL_URL_LIMIT);

  return (
    <div ref={root} className="relative">
      <Button
        ref={trigger}
        variant="secondary"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        Abrir en…
      </Button>

      {open ? (
        <div
          ref={menu}
          role="menu"
          tabIndex={-1}
          className="absolute right-0 z-20 mt-1 w-60 overflow-hidden border border-rule bg-paper py-1 focus:outline-none"
        >
          {entries.map((entry) =>
            entry.web && tooLong ? (
              <span
                key={entry.label}
                role="menuitem"
                aria-disabled="true"
                className={cx(MENU_ITEM, "cursor-not-allowed text-ink-3/60 hover:bg-transparent")}
              >
                {entry.label}
              </span>
            ) : (
              <a
                key={entry.label}
                role="menuitem"
                href={entry.href}
                target={entry.web ? "_blank" : undefined}
                rel={entry.web ? "noreferrer noopener" : undefined}
                className={MENU_ITEM}
                onClick={() => setOpen(false)}
              >
                {entry.label}
              </a>
            ),
          )}
          {tooLong ? (
            <p className="px-3 py-2 text-xs text-amber-300">
              El cuerpo es muy largo para pasarlo por URL: usá «Copiar» y pegalo en el
              correo.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function EmailTab({
  application,
  profile,
  onSaved,
}: {
  application: Application;
  profile: Profile;
  onSaved: (patch: Partial<Application>) => Promise<SaveOutcome>;
}) {
  const [tone, setTone] = useState<EmailTone>("neutral");
  const [length, setLength] = useState<EmailLength>("short");
  const { busy, error, denied, setDenied, run, retry, cancel } = useGenerator<{
    email: CoverEmail;
  }>("email", application.id, onSaved);

  const email = application.email;
  // Published by the posting, not by the model. Shown as its own row because
  // whoever sends from Gmail or Outlook in a browser never sees the app's
  // compose links.
  const sendTo = application.analysis?.applicationEmail ?? "";

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tono">
          <Select value={tone} onChange={(e) => setTone(e.target.value as EmailTone)}>
            <option value="formal">Formal (de usted)</option>
            <option value="neutral">Neutro profesional</option>
            <option value="cercano">Cercano</option>
          </Select>
        </Field>
        <Field label="Largo">
          <Select
            value={length}
            onChange={(e) => setLength(e.target.value as EmailLength)}
          >
            <option value="short">Corto (2 párrafos)</option>
            <option value="medium">Medio (3 párrafos)</option>
          </Select>
        </Field>
      </div>

      <div className="flex items-center gap-3">
        <Button
          disabled={busy}
          onClick={() =>
            run(
              {
                profile,
                analysis: application.analysis,
                cv: application.cv,
                tone,
                length,
              },
              (result) => ({ email: result.email }),
            )
          }
        >
          {busy ? <Spinner /> : null}
          {busy ? "Escribiendo…" : email ? "Volver a escribir" : "Escribir el email"}
        </Button>
        {busy ? (
          <Button variant="secondary" type="button" onClick={cancel}>
            Parar
          </Button>
        ) : null}
      </div>

      <GeneratorStatus
        error={error}
        denied={denied}
        onRetry={retry}
        onResolved={() => setDenied(null)}
      />

      {email ? (
        <div className="space-y-3 border-t border-rule pt-4">
          {sendTo ? (
            <div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium uppercase tracking-wide text-ink-3">
                  Para
                </p>
                <CopyButton text={sendTo} />
              </div>
              <p className="mt-1 text-sm font-medium text-ink">{sendTo}</p>
            </div>
          ) : null}
          <div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-3">
                Asunto
              </p>
              <CopyButton text={email.subject} />
            </div>
            <p className="mt-1 text-sm font-medium text-ink">{email.subject}</p>
          </div>
          <div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-3">
                Cuerpo
              </p>
              <div className="flex gap-2">
                <CopyButton text={email.body} />
                <EmailSendMenu to={sendTo} subject={email.subject} body={email.body} />
              </div>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{email.body}</p>
          </div>
          <p className="text-xs text-ink-3">
            Acordate de adjuntar el PDF del CV antes de enviar.
          </p>
        </div>
      ) : null}
    </div>
  );
}

// --- Interview preparation ----------------------------------------------------

function InterviewTab({
  application,
  profile,
  onSaved,
}: {
  application: Application;
  profile: Profile;
  onSaved: (patch: Partial<Application>) => Promise<SaveOutcome>;
}) {
  const [context, setContext] = useState("");
  /**
   * The status line the frames narrate. The generation legitimately takes
   * minutes — a chain of candidates, any of which may be slow — and it used to
   * be a spinner with nothing behind it: the same wait the CV route's docstring
   * refuses to make the user guess at. `switch` names the delay; `stage` and
   * `keepalive` are wire noise as far as the screen is concerned.
   */
  const [status, setStatus] = useState<string | null>(null);
  const { busy, error, denied, setDenied, run, retry, cancel } = useGenerator<{
    interview: InterviewPrep;
  }>("interview", application.id, onSaved, {
    stream: true,
    onFrame: (frame) => {
      if (frame.type === "switch") {
        setStatus(`El proveedor anterior no respondió; probamos con ${String(frame.to)}.`);
      } else if (frame.type === "stage") {
        setStatus(null);
      }
    },
  });

  const interview = application.interview;

  return (
    <div className="space-y-4">
      <Field
        label="¿Sabés algo de la entrevista?"
        hint="Opcional: quién te entrevista, si es por videollamada, si es técnica o de RRHH, qué te dijeron."
      >
        <Textarea
          rows={3}
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder="Videollamada de 30 minutos con la responsable de RRHH. Me dijeron que van a preguntar por disponibilidad."
        />
      </Field>

      <div className="flex items-center gap-3">
        <Button
          disabled={busy}
          onClick={() => {
            setStatus(null);
            run(
              {
                profile,
                analysis: application.analysis,
                cv: application.cv,
                context,
              },
              (result) => ({ interview: result.interview }),
            );
          }}
        >
          {busy ? <Spinner /> : null}
          {busy
            ? "Preparando…"
            : interview
              ? "Volver a preparar"
              : "Preparar la entrevista"}
        </Button>
        {busy ? (
          <Button variant="secondary" type="button" onClick={cancel}>
            Parar
          </Button>
        ) : null}
      </div>

      {busy && status ? <p className="text-xs text-ink-3">{status}</p> : null}

      <GeneratorStatus
        error={error}
        denied={denied}
        onRetry={retry}
        onResolved={() => setDenied(null)}
      />

      {interview ? (
        <div className="space-y-4 border-t border-rule pt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-ink-2">
              {interview.sections.reduce((n, s) => n + s.questions.length, 0)} preguntas
              en {interview.sections.length} bloques.
            </p>
            <DownloadPdfButton
              payload={{ kind: "prep", data: interview }}
              fallbackHref={`/prep/${application.id}/print`}
            />
          </div>

          {interview.sections.map((section, index) => (
            <CollapsibleCard
              key={index}
              title={`${section.category} (${section.questions.length})`}
              defaultOpen={false}
            >
              <div className="space-y-3">
                {section.questions.map((entry, i) => (
                  <div key={i}>
                    <p className="text-sm font-medium text-ink">{entry.question}</p>
                    <p className="mt-1 text-sm text-ink-2">{entry.answer}</p>
                  </div>
                ))}
              </div>
            </CollapsibleCard>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// --- Presentation video -------------------------------------------------------

/** What the user takes away when they copy the whole thing. */
function transcript(video: VideoScript): string {
  const starts = startTimes(video.blocks);
  return video.blocks
    .map((block, index) => {
      const from = starts[index] ?? 0;
      const range = `${formatClock(from)}–${formatClock(from + block.seconds)}`;
      return `${range} · ${block.topic}\n${block.script}`;
    })
    .join("\n\n");
}

function VideoTab({
  application,
  profile,
  onSaved,
}: {
  application: Application;
  profile: Profile;
  onSaved: (patch: Partial<Application>) => Promise<SaveOutcome>;
}) {
  // Kept as strings so the fields can be emptied while being retyped; an empty
  // one reads as zero, which is what makes "0 min 45 s" typeable.
  const [minutes, setMinutes] = useState("2");
  const [seconds, setSeconds] = useState("0");
  const [topics, setTopics] = useState("");
  const { busy, error, denied, setDenied, run, retry, cancel } = useGenerator<{
    video: VideoScript;
  }>("video", application.id, onSaved);

  const durationSeconds = (Number(minutes) || 0) * 60 + (Number(seconds) || 0);
  const durationOk =
    durationSeconds >= VIDEO_MIN_SECONDS && durationSeconds <= VIDEO_MAX_SECONDS;

  const video = application.video;
  const starts = startTimes(video?.blocks ?? []);

  return (
    <div className="space-y-4">
      <Field
        label="¿Cuánto tiene que durar?"
        hint={
          durationOk
            ? "Poné exactamente lo que pide el aviso. Entre 20 segundos y 10 minutos."
            : "Tiene que estar entre 20 segundos y 10 minutos."
        }
      >
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={0}
            max={10}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            className="w-20"
            aria-label="Minutos"
          />
          <span className="text-sm text-ink-3">min</span>
          <Input
            type="number"
            min={0}
            max={59}
            value={seconds}
            onChange={(e) => setSeconds(e.target.value)}
            className="w-20"
            aria-label="Segundos"
          />
          <span className="text-sm text-ink-3">seg</span>
        </div>
      </Field>

      <Field
        label="¿Sobre qué te piden que hables?"
        hint="Opcional: pegá los temas o preguntas tal como los pide la empresa, uno por línea. Si lo dejás vacío, armamos la estructura habitual."
      >
        <Textarea
          rows={4}
          value={topics}
          onChange={(e) => setTopics(e.target.value)}
          placeholder={"Contanos brevemente sobre vos\n¿Por qué te interesa este puesto?\nContanos un logro del que estés orgulloso/a"}
        />
      </Field>

      <div className="flex items-center gap-3">
        <Button
          disabled={busy || !durationOk}
          onClick={() =>
            run(
              {
                profile,
                analysis: application.analysis,
                cv: application.cv,
                topics,
                durationSeconds,
              },
              (result) => ({ video: result.video }),
            )
          }
        >
          {busy ? <Spinner /> : null}
          {busy ? "Escribiendo…" : video ? "Volver a escribir" : "Escribir el guion"}
        </Button>
        {busy ? (
          <Button variant="secondary" type="button" onClick={cancel}>
            Parar
          </Button>
        ) : null}
      </div>

      <GeneratorStatus
        error={error}
        denied={denied}
        onRetry={retry}
        onResolved={() => setDenied(null)}
      />

      {video ? (
        <div className="space-y-4 border-t border-rule pt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-ink-2">
              {formatClock(video.totalSeconds)} en {video.blocks.length} bloques.
            </p>
            <div className="flex gap-2">
              <CopyButton text={transcript(video)} label="Copiar todo" />
              <DownloadPdfButton
                payload={{ kind: "video", data: video }}
                fallbackHref={`/video/${application.id}/print`}
                variant="secondary"
              />
            </div>
          </div>

          {video.blocks.map((block, index) => {
            const from = starts[index] ?? 0;
            // Scripts saved before outline blocks existed have no `mode` at
            // all — localStorage is read without revalidating, so the schema's
            // default never runs. Anything that is not "outline" is verbatim.
            const outline = block.mode === "outline";
            return (
              <div key={index} className="border border-rule bg-paper-2 p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-ink">
                    <span className="font-mono text-xs text-oro">
                      {formatClock(from)}–{formatClock(from + block.seconds)}
                    </span>{" "}
                    {block.topic}
                  </p>
                  <CopyButton text={block.script} />
                </div>

                {outline ? (
                  <p className="mt-2 text-xs font-medium uppercase tracking-wide text-ink-3">
                    Guía — no es texto para leer
                  </p>
                ) : null}
                <p
                  className={cx(
                    "mt-1 whitespace-pre-wrap text-sm",
                    outline ? "italic text-ink-2" : "text-ink",
                  )}
                >
                  {block.script}
                </p>

                {block.keyPoints.length > 0 ? (
                  <ul
                    className={cx(
                      "mt-2 list-disc space-y-1 pl-5",
                      // In an outline block the points are the content, not a
                      // reminder of it, so they are not the small print.
                      outline ? "text-sm text-ink" : "text-xs text-ink-2",
                    )}
                  >
                    {block.keyPoints.map((point, i) => (
                      <li key={i}>{point}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}

          {video.tips.length > 0 ? (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-ink-3">
                Antes de grabar
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-2">
                {video.tips.map((tip, i) => (
                  <li key={i}>{tip}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="text-xs text-ink-3">
            No lo leas de corrido: usá los puntos como guía y contalo con tus palabras.
          </p>
        </div>
      ) : null}
    </div>
  );
}
