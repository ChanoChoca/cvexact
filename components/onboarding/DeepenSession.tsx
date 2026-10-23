"use client";

import { useEffect, useState } from "react";
import { Tabs } from "@/components/ui";
import { useMediaQuery } from "@/components/ui/useMediaQuery";
import { BaseCvPreview } from "@/components/cv/BaseCvPreview";
import { isPreviewReady, previewFactRefs, type PreviewFactRef } from "@/lib/cv/from-profile";
import { ENGINE } from "@/lib/onboarding/config";
import { RETURN_RULES, isAskable, nextQuestion, type NextQuestion } from "@/lib/onboarding/gaps";
import { undoLastAnswer, type LastAnswer } from "@/lib/onboarding/last-answer";
import { resumeCycle } from "@/lib/onboarding/resume";
import { beginSession, extendSession, isSessionFresh, sessionOf } from "@/lib/onboarding/session";
import { useEngineSignals } from "@/lib/onboarding/use-signals";
import type { StoredProfile } from "@/lib/schemas/profile-v2";
import { useApplicationsReady } from "@/lib/storage/hooks";
import { updateStoredProfile } from "@/lib/storage/local";
import { useExperiment } from "@/lib/use-experiment";
import { ProfilePanel } from "./ProfilePanel";
import { AiFollowUpToggle } from "./AiFollowUpToggle";
import { QuestionLoop } from "./QuestionLoop";
import { SessionClose } from "./SessionClose";

/**
 * S7, S7b and S8: the onboarding's own wrapper around `QuestionLoop` — the
 * side panel (running detail, or the CV it adds up to), the mobile tabs, and
 * S8 (`SessionClose`) once there is nothing left to ask or the person says
 * "Ahora no". `/postular`'s metrics prompt is `QuestionLoop` without any of
 * this: one job, no panel, nothing to close into.
 */
export function DeepenSession({
  profile,
  onFinish,
  only,
  startWith,
  returning,
}: {
  profile: StoredProfile;
  /** `then`: where to go once it is over, when the way out was not "Terminar por hoy" — a CV for an offer, say. */
  onFinish: (then?: string) => void;
  /** Ask only about this job. */
  only?: string | undefined;
  /** A question to ask first, by its id: what a pending item opens. */
  startWith?: string | undefined;
  /** The review of what changed since the last time: a few questions about time, and nothing else. */
  returning?: boolean | undefined;
}) {
  const [now] = useState(() => new Date());
  // A visit long after the last is a new session, with its budget: begun before anything is asked.
  const fresh = isSessionFresh(profile, now);
  useEffect(() => {
    if (!fresh) updateStoredProfile((draft) => void beginSession(draft));
  }, [fresh]);
  // The offers they analysed, which one of the questions is about (O10): waited for before deciding there is nothing to ask — but only while that
  // question is switched on, so that with it off nothing waits for anything.
  const asksAboutOffers = useExperiment("repeated_requirement");
  const offersReady = useApplicationsReady();
  if (!fresh || (asksAboutOffers && !offersReady)) return <p className="text-sm text-ink-3">Preparando las preguntas…</p>;
  return <Session profile={profile} now={now} onFinish={onFinish} only={only} startWith={startWith} returning={returning} />;
}

function Session({
  profile,
  now,
  onFinish,
  only,
  startWith,
  returning,
}: {
  profile: StoredProfile;
  now: Date;
  onFinish: (then?: string) => void;
  only: string | undefined;
  startWith: string | undefined;
  returning: boolean | undefined;
}) {
  /**
   * What the review of what changed asks about — time, at most three — until the person asks for more: «Seguir un rato» goes on with the
   * engine's own questions, whose budget starts again, and not with a review that has said what it had to.
   */
  const [scoped, setScoped] = useState(Boolean(returning));
  const scope = scoped ? { rules: RETURN_RULES, limit: ENGINE.currency.returnQuestions } : {};
  const signals = useEngineSignals(profile, now);
  /**
   * `null` while the loop is showing a question; a `NextQuestion` once it is
   * not, for S8. Seeded by the same check `QuestionLoop` runs internally,
   * computed once up front — not learned a render later through
   * `onExhausted` — so a profile with nothing left to ask opens straight on
   * S8 instead of flashing an empty loop first. A question asked for by name
   * opens the loop whatever the budget says, if it can still be asked — and so does achievements left
   * half told, which are not a question the engine finds any more once the first of them was saved.
   */
  const [closedAt, setClosedAt] = useState<NextQuestion | null>(() => {
    if (startWith && isAskable(profile, startWith, now, signals)) return null;
    if (!startWith && resumeCycle(profile, only)) return null;
    const first = nextQuestion(profile, sessionOf(profile), now, { ...(only ? { only } : {}), ...scope, signals });
    return first.kind === "gap" ? null : first;
  });
  /** The answer that ended the stretch, with the way to take it back: said on the close, where there is no next question to say it on. */
  const [last, setLast] = useState<LastAnswer | null>(null);
  // Asked for once, on the way in: "Seguir un rato" starts the loop again, and it must not
  // put back a question that was just put off.
  const [pinned, setPinned] = useState(startWith);
  const [highlight, setHighlight] = useState<string[]>([]);
  const [tab, setTab] = useState<"question" | "profile">("question");
  /** Beside each other, there are no tabs and the two halves are one page. */
  const sideBySide = useMediaQuery("(min-width: 1024px)");
  /** Inside the "Tu perfil" pane: the running detail, or the CV it adds up to. */
  const [panelView, setPanelView] = useState<"detail" | "cv">("detail");
  /** A line tapped in the CV view — switches back to the detail view, on the fact it names. */
  const [factFocus, setFactFocus] = useState<PreviewFactRef | null>(null);

  if (closedAt) {
    // What is left to ask, said as the engine would ask it and not as the review would: the review has asked its few, and «Seguir un rato» is for the rest.
    const left = scoped ? nextQuestion(profile, { ...sessionOf(profile), askedThisSession: 0, askedQuick: 0, askedByExperience: {} }, now, { ...(only ? { only } : {}), signals }) : closedAt;
    return (
      <SessionClose
        profile={profile}
        next={left}
        now={now}
        last={last}
        review={scoped}
        onUndoLast={() => {
          if (!last) return;
          // The profile as it was, and the question that was answered is asked again: nothing about it was settled.
          undoLastAnswer(last);
          setLast(null);
          setHighlight([]);
          setClosedAt(null);
        }}
        onContinue={() => {
          updateStoredProfile((draft) => extendSession(draft));
          setLast(null);
          setHighlight([]);
          setPinned(undefined);
          setScoped(false);
          setClosedAt(null);
        }}
        onFinish={onFinish}
      />
    );
  }

  return (
    <div data-panel="wide" className="space-y-6">
      <div className="lg:hidden">
        <Tabs
          label="Qué ver"
          activeId={tab}
          onChange={setTab}
          tabs={[
            { id: "question", label: "Pregunta", domId: "deepen-tab-question", controls: "deepen-panel-question" },
            { id: "profile", label: "Tu perfil", domId: "deepen-tab-profile", controls: "deepen-panel-profile" },
          ]}
        />
      </div>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div
          id="deepen-panel-question"
          {...(sideBySide ? {} : { role: "tabpanel", "aria-labelledby": "deepen-tab-question" })}
          className={tab === "profile" ? "hidden space-y-6 lg:block" : "space-y-6"}
        >
          <QuestionLoop
            profile={profile}
            now={now}
            only={only}
            startWith={pinned}
            {...(scoped ? { rules: RETURN_RULES, limit: ENGINE.currency.returnQuestions } : {})}
            showRemaining
            onShowProfile={() => setTab("profile")}
            onHighlight={setHighlight}
            onExhausted={(next, lastAnswer) => {
              setClosedAt(next);
              setLast(lastAnswer ?? null);
            }}
            dismissLabel="Dejar por hoy"
          />
          <AiFollowUpToggle profile={profile} />
        </div>
        <div
          id="deepen-panel-profile"
          {...(sideBySide ? {} : { role: "tabpanel", "aria-labelledby": "deepen-tab-profile" })}
          className={tab === "profile" ? "" : "hidden lg:block"}
        >
          <div className="lg:sticky lg:top-6 lg:space-y-4">
            {isPreviewReady(profile) ? (
              // Two ways of looking at the same panel, and which one is showing is said: a button that only changes colour tells it to nobody who cannot see it.
              <div role="group" aria-label="Qué mostrar" className="flex gap-1 border-b border-rule text-sm">
                {(["detail", "cv"] as const).map((view) => (
                  <button
                    key={view}
                    type="button"
                    aria-pressed={panelView === view}
                    onClick={() => setPanelView(view)}
                    className={
                      "px-3 py-2 transition-colors motion-reduce:transition-none pointer-coarse:min-h-11 " +
                      (panelView === view ? "border-b-2 border-solar-g4 text-ink" : "text-ink-3 hover:text-ink")
                    }
                  >
                    {view === "detail" ? "Tu perfil" : "Tu CV"}
                  </button>
                ))}
              </div>
            ) : null}
            {panelView === "cv" && isPreviewReady(profile) ? (
              <BaseCvPreview
                profile={profile}
                factRefs={previewFactRefs(profile)}
                onFactClick={(ref) => {
                  setFactFocus(ref);
                  setPanelView("detail");
                }}
              />
            ) : (
              <ProfilePanel profile={profile} highlight={highlight} focusId={factFocus?.factId} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
