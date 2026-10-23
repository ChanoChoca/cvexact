import "server-only";

import { NextResponse } from "next/server";

/**
 * Keeps a route that only the cluster's own CronJobs call from being reachable
 * from the internet.
 *
 * `proxy.ts` is not what does this, and it was assumed to be. Its
 * `X-Origin-Auth` check tells "arrived through Cloudflare" apart from "arrived
 * straight at the node" — nothing more. The Transform Rule that stamps the
 * header stamps it on *all* public traffic (`.env.example`, "a todo el tráfico
 * del dominio"), so every visitor carries it. Verified on 2026-09-18: a public
 * `GET` to `/api/tracker/cron` answered 405 (it reached the route) instead of
 * 403. The routes this guards used to say "internal-only" in a comment and
 * enforce it with nothing.
 *
 * What separates a CronJob from a visitor is the path. The CronJobs call
 * `INTERNAL_APP_URL` (`http://cvexact`, the Service), which never touches
 * Cloudflare, so their requests carry no `cf-ray`. Every request Cloudflare
 * proxies carries one, and a client cannot strip it off — Cloudflare sets it on
 * the way in. Refusing anything with a `cf-ray` therefore refuses exactly the
 * public internet. Requests that skip Cloudflare altogether are `proxy.ts`'s to
 * refuse, for lack of the secret; the two checks cover different halves.
 *
 * Not a shared secret, on purpose: a second one would need adding to the Secret,
 * to two scripts and to a rollout, and would still be one more value that can
 * leak. This needs nothing to configure.
 *
 * It fails open in one situation: if the site stops being proxied by Cloudflare,
 * public traffic no longer carries `cf-ray` and this stops refusing it. `proxy.ts`
 * has the same assumption built in (no Cloudflare, no `X-Origin-Auth`, everything
 * 403s), so that change would be noticed on the first request — but it is the
 * thing to revisit if the topology ever moves.
 *
 * `/api/tracker/email/ingest` does NOT use this: its caller, the email Worker,
 * comes in by the public URL like a visitor and there is nothing here to tell
 * them apart. See the comment on that route.
 *
 * Returns null when the caller may proceed, following `lib/api/guards.ts`.
 */
export function rejectIfViaPublicEdge(request: Request): NextResponse | null {
  if (!request.headers.has("cf-ray")) return null;

  // Same minimal body and the same log line as `proxy.ts`: nothing that
  // describes how the check works, but a trace of who knocked.
  console.warn(
    `[internal-only] rechazado desde el borde público: ${request.method} ${new URL(request.url).pathname}`,
  );
  return new NextResponse("Forbidden", { status: 403 });
}
