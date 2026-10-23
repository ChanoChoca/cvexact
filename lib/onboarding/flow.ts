import type { ImportedSource, OnboardingRoute, StoredProfile } from "@/lib/schemas/profile-v2";

/**
 * The screens of the first-run flow, and how a person moves between them.
 *
 * There is one way in: at `start` a person brings what they have — a CV, a LinkedIn
 * profile, both — and a reading with nothing to look at twice goes straight to «listo»
 * (`firstValue`), while one with something marked goes to the profile (`afterImportStep`);
 * or they say they have nothing to bring, and are taken through the guided profile (`steps`):
 * four sections, one open at a time, that end in the same «listo». The state machine is pure so that
 * where someone resumes — after a reload, a closed tab, a link opened on another
 * device — is a function of what is saved, not of what happened to be on screen.
 */

export const STEPS = ["start", "steps", "firstValue", "done"] as const;
export type Step = (typeof STEPS)[number];

export const isStep = (value: string): value is Step => (STEPS as readonly string[]).includes(value);

export type FlowState = {
  route?: OnboardingRoute | undefined;
  /** What was brought was read with nothing to look at twice (`readCleanly`): the start goes on to «listo» and not to the profile. */
  clean?: boolean | undefined;
};

/**
 * Which way in a profile has come from, by the documents it was read from: a CV, a LinkedIn
 * profile or both. What a person said or wrote by hand is not a document, and leaves this
 * to whatever it already was.
 */
export function routeOfSources(sources: ReadonlyArray<Pick<ImportedSource, "kind">>): OnboardingRoute | undefined {
  const cv = sources.some((source) => source.kind === "cv");
  const linkedin = sources.some((source) => source.kind === "linkedin_pdf" || source.kind === "linkedin_csv");
  if (cv && linkedin) return "both";
  if (linkedin) return "linkedin";
  if (cv) return "cv";
  return undefined;
}

/**
 * Where a document that was just read goes. It has no review of its own: a reading with nothing to look at twice is done
 * and says so (`firstValue`), and one with something marked leaves the flow for the profile (`done`), where what is marked is
 * seen among the rest and fixed where it stands.
 */
export const afterImportStep = (clean: boolean): Step => (clean ? "firstValue" : "done");

/**
 * Where "continue" goes from here.
 *
 * `start` needs to know what was chosen: a document goes where its reading says (`afterImportStep`), and nothing to bring
 * goes to the guided profile. The guided profile ends in «listo», and «listo» leaves the flow.
 */
export function nextStep(step: Step, state: FlowState): Step {
  switch (step) {
    case "start":
      if (!state.route) return "start";
      return state.route === "scratch" ? "steps" : afterImportStep(state.clean === true);
    case "steps":
      return "firstValue";
    // Both ways on from «listo» leave the flow (to Postular, to the profile): the questions are the profile's now.
    case "firstValue":
    case "done":
      return "done";
  }
}

/** Where "back" goes, or null at the beginning. */
export function previousStep(step: Step): Step | null {
  switch (step) {
    case "steps":
      return "start";
    // Once the profile is said to be ready there is no going back over the screens before it:
    // what was answered is in the profile, and the profile is the place to change it.
    case "start":
    case "firstValue":
    case "done":
      return null;
  }
}

/**
 * What the profile has to show: not only jobs and studies. A document that brought only a skills list, a profile of
 * projects, a story whose sentences all sit in the tray — each is something to look at, add to and go on from; sending
 * them back to the start with nothing said is what a review of nothing would do, and there is something.
 */
export type Material = Pick<StoredProfile, "experience" | "education"> &
  Partial<Pick<StoredProfile, "projects" | "certifications" | "languages" | "skills" | "unassigned">>;

export function hasMaterial(profile: Material): boolean {
  return (
    profile.experience.length > 0 ||
    profile.education.length > 0 ||
    (profile.projects?.length ?? 0) > 0 ||
    (profile.certifications?.length ?? 0) > 0 ||
    (profile.languages?.length ?? 0) > 0 ||
    (profile.skills?.length ?? 0) > 0 ||
    (profile.unassigned?.length ?? 0) > 0
  );
}

/**
 * Where the guided profile ends: «listo», unless there is nothing for it to be ready with —every part skipped, or only a name— and then the profile, where the rest
 * is looked for: a profile with nothing in it is what `resumeStep` would send back to the steps, and «Terminar» would do nothing.
 */
export const afterGuidedStep = (profile: Material): Step => (hasMaterial(profile) ? "firstValue" : "done");

/** Where the material comes from, for a person who is past it with nothing to show for it. */
const entryOf = (route: OnboardingRoute | undefined): Step => (route === "scratch" ? "steps" : "start");

/**
 * Screens that used to exist, and where someone who left the flow on one is put instead — a tab
 * closed on "Tengo ambos" is not a reason to start over. The four ways in became one; the screens that asked
 * what moment they were in and how they would tell it, and the two ways of telling it (a story in a box, the lists one at a time),
 * became the guided profile; the review of what was read, the contact details and the questions that came
 * after it are the profile's now, where what is marked is looked at where it stands — and with nothing in the
 * profile to look at, the place the material comes from.
 */
function legacyStep(step: string, route: OnboardingRoute | undefined, hasEntries: boolean): Step | null {
  switch (step) {
    case "situation":
    case "mode":
    case "dump":
    case "objectiveEarly":
      return "steps";
    case "cv":
    case "linkedin":
    case "both":
    case "contact":
    case "review":
    case "objective":
    case "deepen":
      return hasEntries ? "done" : entryOf(route);
    default:
      return null;
  }
}

/**
 * The screen to show for what is saved. A finished flow is `done`; an unknown or
 * stale step starts over; and a step past the point of having anything to show —
 * «listo» for a profile with nothing in it — falls back to where the material comes from.
 */
export function resumeStep(profile: Pick<StoredProfile, "onboarding"> & Material): Step {
  const { onboarding } = profile;
  if (onboarding.done) return "done";
  const hasEntries = hasMaterial(profile);
  if (!isStep(onboarding.step)) return legacyStep(onboarding.step, onboarding.route, hasEntries) ?? "start";
  // A «done» saved by a flow that never ended is no place to be.
  if (onboarding.step === "done") return "start";
  if (onboarding.step === "firstValue" && !hasEntries) return entryOf(onboarding.route);
  return onboarding.step;
}
