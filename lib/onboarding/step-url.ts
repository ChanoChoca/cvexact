import type { Step } from "@/lib/onboarding/flow";

/**
 * The step the first-run flow is on, written in the address.
 *
 * Every step shares `/perfil/empezar`, and the step is worked out from what is saved, so from outside — a browser's
 * history, a page counter that follows the address — a person who is filling in their profile looks the same as one who has
 * only just arrived. With the step in the address (`?paso=paso-a-paso`) a measurement that only follows the address, which is
 * what Google Analytics does if it is ever switched on and accepted, can tell the steps apart without a single event of our
 * own. Nothing is added to what is sent: the address was already part of it.
 *
 * It is only ever written, never read. The step is what the profile says it is — a link carrying `?paso=` cannot move
 * anyone to a step they have not reached — and a reload, a closed tab and a link opened on another device all land
 * where they did before. So a step that no longer exists has no word here: someone who saved one is put on the step that took
 * its place (`resumeStep`), and that step's word is the one the address gets.
 */

/** The step as it reads in the address. */
export const STEP_SLUG: Record<Step, string> = {
  start: "inicio",
  steps: "paso-a-paso",
  firstValue: "primer-valor",
  done: "listo",
};

/** The query parameter that carries it. */
export const STEP_PARAM = "paso";

/** `search` (`?ruta=linkedin`, or nothing) with the step in it, and what it already carried left alone. */
export function searchWithStep(search: string, step: Step): string {
  const params = new URLSearchParams(search);
  params.set(STEP_PARAM, STEP_SLUG[step]);
  return `?${params.toString()}`;
}
