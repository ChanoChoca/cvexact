import "server-only";

/**
 * Facts about the product that no payment gateway owns.
 *
 * The pack is one product. What it grants must not depend on how it was paid
 * for, so this lives outside any gateway module rather than inside one that
 * would otherwise end up in charge of a number that is not its business.
 */

/**
 * How many credits a pack grants, in the units of `ACTION_COST`.
 *
 * Ten complete applications, at `APPLICATION_COST` of 6. Sized against what it
 * costs to serve rather than against what looks generous: on `SERVICE_PRO_MODEL`
 * a complete application runs somewhere between ten and forty US cents, so a
 * pack costs one to four dollars to honour — against a price this audience can
 * actually pay. It was thirty applications, which at the top of that range cost
 * more to serve than the pack is worth.
 *
 * That range was measured on Gemini, which is no longer what serves it — see
 * `SERVICE_PROVIDER` in `lib/ai/provider.ts`. Together's per-token price for
 * the models pinned there is the same order of magnitude, so the sizing holds,
 * but it is a measurement with a vendor attached and worth re-taking off a real
 * month of `generation_usage` rather than trusted indefinitely.

 *
 * Ten is also a number someone can evaluate: "does that cover this search?".
 * Thirty is a number that means nothing.
 */
export function packCredits(): number {
  const configured = Number(process.env.PACK_CREDITS);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 60;
}

/** Where this installation lives, for the URLs a gateway sends the user back to. */
export function publicUrl(): string {
  return process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
}
