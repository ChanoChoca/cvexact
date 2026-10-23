import { afterEach, describe, expect, it, vi } from "vitest";
import { installBrowser, realisticApplication, uninstallBrowser } from "./helpers/browser-storage";
import { templateCV } from "@/lib/fixtures/template-cv";

/**
 * The browser's half of the server-kept results (A5): a generation names itself
 * with an idempotency key, and a result that never reached storage — a cut
 * connection after the server finished, a closed tab — is fetched again by that
 * key instead of being generated, and paid for, twice.
 */

const analysis = {
  title: "Analista",
  company: "Acme",
  location: "",
  workMode: "remote",
  seniority: "mid",
  language: "es",
  domain: "datos",
  relevance: "direct",
  relevanceReason: "Coincide.",
  requirements: [],
  responsibilities: [],
  keywords: [],
  embeddedQuestions: [],
  emailSubject: "",
  applicationEmail: "",
};

const cvResult = { cv: templateCV, analysis, inferredSkills: [], findings: [], meta: { provider: "cloudflare", modelId: "m" } };

afterEach(() => {
  uninstallBrowser();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function load() {
  vi.resetModules();
  const local = await import("@/lib/storage/local");
  const pending = await import("@/lib/applications/pending");
  const recovery = await import("@/lib/applications/recovery");
  const generation = await import("@/lib/applications/generation");
  const { ApiError } = await import("@/lib/api/client");
  return { local, pending, recovery, generation, ApiError };
}

function resultServer(results: Record<string, { status: number; body?: unknown }>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = new Headers(init?.headers).get("x-cvp-idempotency-key") ?? "";
    const found = results[key] ?? { status: 404 };
    return new Response(found.body === undefined ? "{}" : JSON.stringify(found.body), { status: found.status });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("recuperar al abrir la app lo que se generó y no se guardó", () => {
  it("crea el CV que no llegó a guardarse, con el id que iba a tener", async () => {
    installBrowser({ indexedDB: true });
    const { local, pending, recovery } = await load();
    const marker = pending.beginPendingGeneration("cv", "nueva");
    resultServer({ [marker.key]: { status: 200, body: { kind: "cv", value: cvResult, jobText: "Aviso de Acme" } } });

    expect(await recovery.recoverPendingGenerations()).toBe(1);
    const app = local.getApplication("nueva");
    expect(app?.cv).toBeDefined();
    expect(app?.jobText).toBe("Aviso de Acme");
    // Con un CV hecho, la pregunta por las skills deducidas ya no se repite en una regeneración.
    expect(app?.skillsReviewed).toBe(true);
    expect(pending.listPendingGenerations()).toHaveLength(0);
  });

  it("no crea una postulación sin CV con lo que era una pregunta, no un CV", async () => {
    installBrowser({ indexedDB: true });
    const { local, pending, recovery } = await load();
    const marker = pending.beginPendingGeneration("cv", "nueva");
    const skillReview = [{ skill: "Git", derivedFrom: "GitHub Actions", confidence: "high", rationale: "—" }];
    resultServer({ [marker.key]: { status: 200, body: { kind: "cv", value: { analysis, inferredSkills: skillReview, skillReview }, jobText: "Aviso de Acme" } } });

    expect(await recovery.recoverPendingGenerations()).toBe(0);
    expect(local.getApplication("nueva")).toBeUndefined();
    expect(pending.listPendingGenerations()).toHaveLength(0);
  });

  it("no pisa una postulación que cambió después de que empezó esa generación", async () => {
    installBrowser({ indexedDB: true });
    const { local, pending, recovery } = await load();
    const marker = pending.beginPendingGeneration("email", "a1");
    // The person kept working after asking for the email.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await local.saveApplication({ ...realisticApplication(1), id: "a1", notes: "editada después" });
    resultServer({
      [marker.key]: { status: 200, body: { kind: "email", value: { email: { subject: "x", body: "y", language: "es" } } } },
    });

    await recovery.recoverPendingGenerations();
    expect(local.getApplication("a1")?.email).toBeUndefined();
    expect(local.getApplication("a1")?.notes).toBe("editada después");
    expect(pending.listPendingGenerations()).toHaveLength(0);
  });

  it("descarta lo que el servidor no tiene, y espera lo que todavía está generando", async () => {
    installBrowser({ indexedDB: true });
    const { pending, recovery } = await load();
    const gone = pending.beginPendingGeneration("cv", "x");
    const running = pending.beginPendingGeneration("cv", "y");
    resultServer({ [running.key]: { status: 409 } });

    await recovery.recoverPendingGenerations();
    expect(pending.listPendingGenerations().map((entry) => entry.key)).toEqual([running.key]);
    expect(pending.listPendingGenerations().some((entry) => entry.key === gone.key)).toBe(false);
  });
});

describe("un corte de red después de que el servidor terminó", () => {
  it("se recupera por clave sin volver a generar", async () => {
    installBrowser({ indexedDB: true });
    const { generation, ApiError } = await load();
    const key = crypto.randomUUID();
    const fetchMock = resultServer({ [key]: { status: 200, body: { kind: "cv", value: cvResult } } });

    let generations = 0;
    const result = await generation.generateWithRecovery(async () => {
      generations += 1;
      throw new ApiError("La respuesta se cortó antes de terminar. Probá de nuevo.", 502);
    }, key);

    expect(result).toEqual(cvResult);
    expect(generations).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("no intenta recuperar lo que el servidor rechazó", async () => {
    installBrowser({ indexedDB: true });
    const { generation, ApiError } = await load();
    const fetchMock = resultServer({});
    await expect(
      generation.generateWithRecovery(async () => {
        throw new ApiError("Key rechazada.", 401);
      }, crypto.randomUUID()),
    ).rejects.toThrow("Key rechazada.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
