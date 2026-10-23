import "server-only";

/**
 * The visitor's country, when Cloudflare says so — read off `CF-IPCountry`,
 * never looked up from the IP by us and never stored.
 *
 * Trusted on the same terms `lib/client-ip.ts` trusts `CF-Connecting-IP`:
 * only when the deployment declares Cloudflare is in front
 * (`CLIENT_IP_HEADERS` names `cf-connecting-ip`). Anywhere else the header is
 * just something the client typed, and letting it pick the feed order would be
 * harmless but meaningless — so it is ignored instead of believed.
 *
 * `XX` (no data) and `T1` (Tor) are Cloudflare's own non-country values.
 */
const NOT_A_COUNTRY = new Set(["XX", "T1"]);

export function clientCountry(headers: Headers): string | null {
  const behindCloudflare = (process.env.CLIENT_IP_HEADERS ?? "")
    .toLowerCase()
    .split(",")
    .some((name) => name.trim() === "cf-connecting-ip");
  if (!behindCloudflare) return null;

  const code = headers.get("cf-ipcountry")?.trim().toUpperCase();
  if (!code || !/^[A-Z]{2}$/.test(code) || NOT_A_COUNTRY.has(code)) return null;
  return code;
}
