import "server-only";

import { getIp } from "better-auth/api";
import type { BetterAuthOptions } from "better-auth";

/**
 * Where the client IP comes from, in one place: Better Auth's rate limiter and
 * the anonymous `quotaSubject` have to key on exactly the same address.
 *
 * The parsing is Better Auth's own `getIp` — it validates IPv4/IPv6, collapses
 * IPv6 to a /64, and with `trustedProxies` walks the forwarded chain right to
 * left to the first untrusted hop. When it cannot be sure it returns null
 * instead of the leftmost entry, which is the one any client can write.
 *
 * Which header to believe is declared *per deployment*, because that is what
 * decides whether it can be trusted at all:
 *
 *   - compose + Caddy: plain `X-Forwarded-For`. Caddy sets it itself and
 *     overwrites whatever the client sent, so it arrives single-valued.
 *   - k3s + Cloudflare (orange cloud): the visitor's address travels only in
 *     `CF-Connecting-IP`. The HAProxy ingress deletes the incoming
 *     X-Forwarded-For and writes its own with the Cloudflare edge address.
 *     Cloudflare always overwrites CF-Connecting-IP, and the origin should not
 *     be reachable around it — see the Ingress allow-list in tu despliegue.
 *
 * Hence the conservative default: without CLIENT_IP_HEADERS, only
 * X-Forwarded-For. Believing `cf-connecting-ip` where Cloudflare is not in
 * front would let the client pick its own rate-limit and quota key.
 */
function list(value: string | undefined): string[] | undefined {
  const items = value
    ?.split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return items?.length ? items : undefined;
}

export const ipAddressConfig = {
  ipAddressHeaders: list(process.env.CLIENT_IP_HEADERS) ?? ["x-forwarded-for"],
  trustedProxies: list(process.env.TRUSTED_PROXIES) ?? [],
} satisfies NonNullable<BetterAuthOptions["advanced"]>["ipAddress"];

/**
 * The client IP, or the `unknown` sentinel when no trustworthy one resolves.
 *
 * Sharing one bucket among the unidentifiable is deliberate: better that than
 * inventing an address for them. In dev and test Better Auth resolves to
 * 127.0.0.1 on its own, so the sentinel barely shows up outside production.
 */
export function clientIp(headers: Headers): string {
  return getIp(headers, { advanced: { ipAddress: ipAddressConfig } }) ?? "unknown";
}
