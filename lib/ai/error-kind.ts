/**
 * The closed taxonomy of generation failures, shared by the classifier in
 * `./pipeline.ts` and everything downstream that reads it: the switch events a
 * route reports, the attempts the browser stores, the notes Ajustes keeps, and
 * the headline it renders.
 *
 * It lives in its own module rather than in `./provider-catalog.ts` because it
 * is not a provider fact: the catalogue holds what a key serves and what the
 * settings form needs, while this is how a failure of ours is named. It imports
 * nothing, so either side of the app can use it.
 *
 * `kind` and `status` answer different questions and both travel. `status` is
 * the transport-shaped classification every *policy* is keyed by — cooldowns in
 * `lib/ai/cooldown.ts`, trust windows and skip-on-sight in
 * `lib/storage/local.ts` — and it stays that way. `kind` is what the UI names,
 * so it does not have to infer meaning from an HTTP code two different failures
 * can share: a 400 is both a retired model and a model outside the user's plan,
 * and those want different words.
 *
 * A kind is added when something downstream needs to act on the distinction,
 * not to mirror a status. `request_too_large` covers three sites (the plan's
 * per-minute ceiling, an output ceiling learned earlier in the request, and a
 * response cut off by length) because their message and remedy are the same;
 * `model_retired` covers every wording of "that id is gone" for the same
 * reason. The day the copy or a policy has to differ, the split is a new member
 * here plus its headline — which `KIND_HEADLINE` in the settings page forces on
 * whoever adds it.
 */
export const GENERATION_ERROR_KINDS = [
  "key_rejected",
  "no_credit",
  "request_too_large",
  "rate_limited",
  "model_retired",
  "model_not_in_plan",
  "overloaded",
  "timeout",
  "cancelled",
  "unclassified",
] as const;

export type GenerationErrorKind = (typeof GENERATION_ERROR_KINDS)[number];

/**
 * Whether a value read from storage is one of the kinds this version knows.
 *
 * Same shape as `isProviderId` and `isApplicationStatus`, and needed for the
 * same reason: the notes live in `localStorage`, which is shared between
 * versions and editable by hand, so a kind written by a newer release has to be
 * recognised as *not ours* rather than trusted to be.
 */
export function isGenerationErrorKind(value: unknown): value is GenerationErrorKind {
  return (
    typeof value === "string" && (GENERATION_ERROR_KINDS as readonly string[]).includes(value)
  );
}
