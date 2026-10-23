import { browser } from "wxt/browser";

/**
 * Todo lo que habla con la API de cvexact, en un solo lugar. El popup
 * (`entrypoints/popup/main.ts`) no hace `fetch` directo — así el manejo del
 * token y de errores queda en un sólo sitio.
 */

export type StoredAuth = { apiUrl: string; token: string };

const STORAGE_KEY = "cvexact_auth";

export async function getAuth(): Promise<StoredAuth | null> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  const auth = result[STORAGE_KEY] as StoredAuth | undefined;
  return auth ?? null;
}

export async function setAuth(auth: StoredAuth): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: auth });
}

export async function clearAuth(): Promise<void> {
  await browser.storage.local.remove(STORAGE_KEY);
}

export class ApiError extends Error {}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const auth = await getAuth();
  if (!auth) throw new ApiError("No hay cuenta conectada.");

  let response: Response;
  try {
    response = await fetch(`${auth.apiUrl.replace(/\/+$/, "")}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        authorization: `Bearer ${auth.token}`,
        "content-type": "application/json",
      },
    });
  } catch {
    throw new ApiError("No se pudo conectar con cvexact. ¿La URL es correcta?");
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(typeof body.error === "string" ? body.error : `Error ${response.status}.`);
  }
  return body as T;
}

export type ParsedJob = {
  jobTitle: string;
  company: string;
  location: string;
  remote: boolean | null;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  jdText: string;
  jsonld: unknown;
  employmentType: string | null;
  datePosted: string | null;
  validThrough: string | null;
  fromFallback: boolean;
  extractedFrom: "jsonld" | "microdata" | "site" | "site-post" | "generic";
  jobUrl: string;
  /** Otros puestos detectados en la misma publicación — ver
   *  `lib/tracker/jsonld.ts`. Sólo presente con `extractedFrom === "site-post"`
   *  y más de un candidato. */
  jobTitleCandidates?: string[];
  /** Empresa/ubicación mencionadas en prosa sin certeza — nunca reemplazan a
   *  `company`/`location`, sólo se ofrecen cuando esos campos quedaron
   *  vacíos (ver `lib/tracker/site-rules/linkedin-post.ts`). */
  suggestedCompany?: string;
  suggestedLocation?: string;
};

/** El HTML ya lo trajo `readPageHtml` en `entrypoints/popup/main.ts`, vía
 *  `browser.scripting.executeScript` sobre la pestaña activa —
 *  `document.documentElement.outerHTML`, leído del propio navegador, nunca
 *  de un fetch nuestro— esto sólo lo manda a interpretar. No hay
 *  `content_scripts` en el manifiesto (ver `wxt.config.ts`): nada corre en
 *  la página hasta que se aprieta "Capturar este aviso". */
export function parseHtml(html: string, url: string): Promise<ParsedJob> {
  return apiFetch<ParsedJob>("/api/tracker/parse-html", {
    method: "POST",
    body: JSON.stringify({ html, url }),
  });
}

export type TrackedApplication = { id: string; status: string; jobTitle: string | null } | null;

export function lookupByUrl(url: string): Promise<{ application: TrackedApplication }> {
  return apiFetch<{ application: TrackedApplication }>(
    `/api/tracker/applications/lookup?url=${encodeURIComponent(url)}`,
  );
}

export type CreateApplicationInput = {
  jobTitle?: string;
  company?: string;
  location?: string;
  remote?: boolean;
  salaryMin?: number;
  salaryMax?: number;
  currency?: string;
  jdText?: string;
  jdJsonld?: unknown;
  jobUrl?: string;
  source?: string;
  status?: "guardado" | "postulado";
  appliedAt?: string;
};

export function createApplication(
  input: CreateApplicationInput,
): Promise<{ application: { id: string }; duplicates: unknown[] }> {
  return apiFetch("/api/tracker/applications", { method: "POST", body: JSON.stringify(input) });
}
