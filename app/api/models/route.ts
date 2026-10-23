import { NextResponse } from "next/server";
import { listModels } from "@/lib/ai/model-list";
import { isProviderId, ProviderConfigError, redactKeys } from "@/lib/ai/provider";
import { BYOK_HEADERS } from "@/lib/api/context";
import { enforceRateLimit } from "@/lib/api/guards";

export const runtime = "nodejs";

/**
 * What the user's own key serves, for the model field in Ajustes.
 *
 * Not routed through `openRequest` like the generation endpoints: listing a
 * catalogue is not a generation and must not spend a quota grant or resolve a
 * `ModelChoice` — the whole point is that the model currently configured may
 * be one the provider no longer has.
 *
 * The key arrives in a header for the same reason it does there: headers stay
 * out of logged and persisted request bodies. It is used for one GET and
 * dropped. The provider comes from the closed set in `./provider-catalog.ts`,
 * so the URL being fetched is never anything the caller chose.
 */
export async function GET(request: Request) {
  // Unauthenticated, and every call is an outbound request to somebody else's
  // API. Ours is not the bill, but the connections and the egress are, and a
  // provider that starts rate-limiting *us* would take the settings page down
  // for everyone.
  const limited = await enforceRateLimit("models", request.headers, { window: 600, max: 60 });
  if (limited) return limited;

  const provider = request.headers.get(BYOK_HEADERS.provider)?.trim();
  const apiKey = request.headers.get(BYOK_HEADERS.key)?.trim();
  // Only Cloudflare reads this; `listModels` ignores it for everyone else. A
  // missing one is not rejected here — the reader says what is missing, in the
  // same sentence the settings page shows for a half-filled row.
  const accountId = request.headers.get(BYOK_HEADERS.account)?.trim();

  if (!isProviderId(provider)) {
    return NextResponse.json({ error: "Proveedor desconocido." }, { status: 400 });
  }
  if (!apiKey) {
    return NextResponse.json(
      { error: "Necesitás una API key para ver los modelos del proveedor." },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json({ models: await listModels(provider, apiKey, accountId) });
  } catch (error) {
    if (error instanceof ProviderConfigError) {
      return NextResponse.json({ error: error.message }, { status: error.status ?? 400 });
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error("[models] unexpected failure:", redactKeys(message));
    return NextResponse.json(
      { error: "No pudimos consultar los modelos del proveedor." },
      { status: 500 },
    );
  }
}
