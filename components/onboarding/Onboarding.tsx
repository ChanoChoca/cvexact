"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui";
import { focusHeading } from "@/components/ui/focusHeading";
import { CorruptNotice } from "@/components/profile/CorruptNotice";
import { TOUR_PARAM } from "@/components/wizard/postular-tour";
import { afterGuidedStep, afterImportStep, nextStep, previousStep, resumeStep, routeOfSources, type Step } from "@/lib/onboarding/flow";
import { readCleanly } from "@/lib/onboarding/review";
import { searchWithStep } from "@/lib/onboarding/step-url";
import type { OnboardingRoute, StoredProfile } from "@/lib/schemas/profile-v2";
import { isBlankProfile } from "@/lib/schemas/profile-v2";
import { welcomeBack } from "@/lib/profile/tasks";
import { useHydrated, useStoredProfile } from "@/lib/storage/hooks";
import { loadStoredProfile, updateStoredProfile } from "@/lib/storage/local";
import { FirstValueStep } from "./FirstValueStep";
import { GuidedProfile } from "./GuidedProfile";
import { IntakeStep } from "./IntakeStep";

/** The steps that are the middle of the flow: where "Retomamos donde lo dejaste" makes sense. Not the first screen, which has nothing to resume. */
const RESUMED_STEPS: ReadonlySet<Step> = new Set(["steps", "firstValue"]);

/**
 * The first-run flow: which screen is showing is a function of what is saved, so
 * a reload, a closed tab or a link opened on another device all land in the same
 * place. Every choice writes to the profile the moment it is made — there is no
 * "save" here, and no moment at which leaving loses anything.
 */
export function Onboarding({
  mailAvailable,
  turnstileSiteKey,
  initialRoute,
}: {
  /** Whether "Enviarme un enlace" can work at all — the server's `magicLink` plugin only loads with mail configured. */
  mailAvailable: boolean;
  turnstileSiteKey: string;
  /**
   * A way in chosen before arriving — from a link. `scratch` goes straight to the guided start, applied
   * once and only over a profile nobody has started; `linkedin` opens the LinkedIn guide (the phone
   * handing the task to a computer). The others are how everyone starts anyway.
   */
  initialRoute?: OnboardingRoute | undefined;
}) {
  const stored = useStoredProfile();
  const hydrated = useHydrated();
  const router = useRouter();
  // A document that could not be read, kept in memory to show beside the forms.
  const [reference, setReference] = useState<File | undefined>();
  // Where to go once the flow is done, when it was left by something other than "Terminar por hoy". A ref, set before the profile says `done`: the import
  // that leaves for the profile is an `await` away from the click, where React does not render a state and the profile's change together.
  const leaveTo = useRef<string | undefined>(undefined);
  const container = useRef<HTMLDivElement>(null);
  const lastStep = useRef<Step | null>(null);
  const [now] = useState(() => new Date());

  const step = resumeStep(stored);
  const state = { route: stored.onboarding.route };

  const goTo = (next: Step, extra?: (draft: StoredProfile["onboarding"]) => void) =>
    updateStoredProfile((draft) => {
      draft.onboarding.step = next;
      // The last step is how a flow ends: it is finished, not merely somewhere.
      if (next === "done") draft.onboarding.done = true;
      extra?.(draft.onboarding);
    });

  const startFromScratch = () =>
    goTo(nextStep("start", { route: "scratch" }), (o) => {
      o.route = "scratch";
    });

  // A link can ask for the guided start (`?ruta=scratch`). Applied once, and only over a profile
  // nobody has started.
  const applied = useRef(false);
  useEffect(() => {
    if (!hydrated || applied.current || initialRoute !== "scratch") return;
    applied.current = true;
    if (step === "start" && isBlankProfile(stored)) startFromScratch();
    // `startFromScratch` is rebuilt every render; what matters is that this runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, initialRoute]);

  // What was brought — a CV, LinkedIn, both — goes where its reading says (`afterImportStep`): which way in it was is read from what is now
  // in the profile, not asked, and not from how many files it took. A reading with something marked leaves for the profile, which says so.
  const afterImport = () => {
    const brought = loadStoredProfile();
    const clean = readCleanly(brought);
    // `guia` is the profile's card that offers the tour of Postular: the first reading is the only time it is offered.
    if (!clean) leaveTo.current = `/perfil?revisar=1&${TOUR_PARAM}=1`;
    goTo(afterImportStep(clean), (o) => {
      o.route = routeOfSources(brought.sources) ?? o.route;
    });
  };

  // Each step starts at the top: on a phone the last one may have been scrolled to its foot.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);

  // The step, written in the address — `?paso=paso-a-paso` — so that whatever only follows the address can tell the steps
  // apart. Only written, never read: the step is what the profile says it is. `replaceState`, so that going back does
  // not walk through addresses that no longer lead to a different screen. Next folds it into its router (see the
  // guide on shallow routing), so nothing about the page reloads.
  useEffect(() => {
    if (!hydrated || step === "done") return;
    const search = searchWithStep(window.location.search, step);
    if (search !== window.location.search) window.history.replaceState(null, "", `${window.location.pathname}${search}${window.location.hash}`);
  }, [hydrated, step]);

  // A step that replaces the last is a new page to whoever cannot see it change, so focus goes to
  // its heading. Not the step the page opened on, resumed or not: that is what they came for.
  useEffect(() => {
    if (!hydrated) return;
    const changed = lastStep.current !== null && lastStep.current !== step;
    lastStep.current = step;
    if (changed) focusHeading(container.current?.querySelector<HTMLElement>("h1, h2"));
  }, [hydrated, step]);

  // A finished flow has nothing to show: the profile is the page — or wherever it was left for.
  useEffect(() => {
    if (!hydrated || step !== "done") return;
    // A screen from before that the profile took the place of (`resumeStep`) ends the flow too: marked, so that nothing asks to go on with it again.
    if (!loadStoredProfile().onboarding.done) updateStoredProfile((draft) => void (draft.onboarding.done = true));
    router.replace(leaveTo.current ?? "/perfil");
  }, [hydrated, step, router]);

  const back = () => {
    const previous = previousStep(step);
    if (previous) goTo(previous);
  };

  if (!hydrated) return <p className="text-sm text-ink-3">Cargando…</p>;
  if (step === "done") return <p className="text-sm text-ink-3">Abriendo tu perfil…</p>;

  // By hand is starting from nothing: a document that could not be read leaves no more behind than none at all.
  const byHand = (file?: File) => {
    setReference(file);
    startFromScratch();
  };

  const finishGuided = () => goTo(afterGuidedStep(stored));

  // Back after a while, in the middle of it: said where this is and what was still to do, so it is not worked out from the screen.
  const welcome = RESUMED_STEPS.has(step) ? welcomeBack(stored, now) : null;

  return (
    <div ref={container} className="space-y-10">
      <CorruptNotice />
      {welcome ? <Alert tone="info">{welcome}</Alert> : null}
      {renderStep()}
    </div>
  );

  function renderStep() {
    switch (step) {
      case "start":
        return (
          <IntakeStep
            mailAvailable={mailAvailable}
            turnstileSiteKey={turnstileSiteKey}
            guideOpen={initialRoute === "linkedin"}
            onImported={afterImport}
            onScratch={startFromScratch}
            onManual={byHand}
          />
        );
      case "steps":
        return <GuidedProfile profile={stored} reference={reference} onBack={back} onDone={finishGuided} />;
      case "firstValue":
        return (
          <FirstValueStep
            profile={stored}
            onFinish={(then) => {
              // The questions stay in the profile as what there is left to ask, for whenever the person comes back to them.
              leaveTo.current = then;
              goTo(nextStep("firstValue", state));
            }}
          />
        );
      default:
        return null;
    }
  }
}
