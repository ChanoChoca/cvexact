import "server-only";

import { NextResponse } from "next/server";
import { requiresVerification, type SessionUser } from "@/lib/auth";
import { consume, rateLimitKey, type RateLimitRule } from "@/lib/rate-limit";

/**
 * The two refusals that are not about quota, shaped the way the client already
 * reads refusals: an `error` to show and a `reason` to branch on, exactly like
 * `denialMessage` in `lib/api/context.ts`. A new envelope per route is how a UI
 * ends up rendering "undefined" at the one moment it matters.
 */

/**
 * 403s a signed-in user who has not confirmed their address yet.
 *
 * Returns null — carry on — when there is nothing to enforce: signed out,
 * already verified, or no mailer configured, in which case no link was ever
 * sent and the requirement would be ours to have failed, not theirs.
 */
export function requireVerifiedEmail(user: SessionUser | null): NextResponse | null {
  if (!requiresVerification(user)) return null;

  return NextResponse.json(
    {
      error:
        "Confirmá tu correo para usar esta función. Te mandamos un enlace cuando " +
        "creaste la cuenta; podés pedir otro desde Cuenta.",
      reason: "email_unverified",
    },
    { status: 403 },
  );
}

/**
 * Counts this request against `name`'s budget and 429s if it is over.
 *
 * Returns null when the request may proceed. Callers put this *before* any work
 * worth limiting — and, in the generation path, before quota is reserved, so a
 * request refused here never spends a credit.
 */
export async function enforceRateLimit(
  name: string,
  headers: Headers,
  rule: RateLimitRule,
  userId?: string,
): Promise<NextResponse | null> {
  const result = await consume(rateLimitKey(name, headers, userId), rule);
  if (result.ok) return null;

  return NextResponse.json(
    {
      error: "Estás haciendo demasiadas solicitudes seguidas. Esperá un momento y probá de nuevo.",
      reason: "rate_limited",
    },
    {
      status: 429,
      headers: { "retry-after": String(result.retryAfterSeconds) },
    },
  );
}
