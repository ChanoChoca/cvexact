import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FakeStorage,
  fillUntilFree,
  historyOfSize,
  installBrowser,
  QUOTA_CHARS,
  realisticApplication,
  uninstallBrowser,
} from "./helpers/browser-storage";
import { templateCV } from "@/lib/fixtures/template-cv";

/**
 * The incident, reproduced.
 *
 * In production the CV route finished — a `done` frame with a complete CV,
 * already charged — and the page said «Ocurrió un error inesperado». The CV
 * reached the browser; saving it failed, because a history of ~200
 * applications had filled the 5 MiB localStorage gives an origin, and the save
 * sat in the same `try` as the model call. The CV was lost and the only button
 * on screen asked the model for another one.
 *
 * What must hold now, with the same full store:
 * 1. the generated CV is kept — in memory, on screen, marked «sin guardar»,
 *    with a waiting copy somewhere a reload can find it;
 * 2. retrying the save never calls the provider again;
 * 3. once there is room, the retry stores it, and the provider was still
 *    called exactly once.
 *
 * Built from the pieces `Wizard.tsx` runs, in its order: the stream with its
 * idempotency key, `applyCvResult`, `saveApplication`.
 */

type Local = typeof import("@/lib/storage/local");

async function load() {
  vi.resetModules();
  const local: Local = await import("@/lib/storage/local");
  const { streamGenerator } = await import("@/lib/api/stream-client");
  const generation = await import("@/lib/applications/generation");
  const pending = await import("@/lib/applications/pending");
  return { local, streamGenerator, generation, pending };
}

function ndjson(...frames: unknown[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const frame of frames) controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

const analysis = {
  title: "Analista de datos",
  company: "Acme",
  location: "",
  workMode: "remote",
  seniority: "mid",
  language: "es",
  domain: "datos",
  relevance: "direct",
  relevanceReason: "Coincide con la experiencia.",
  requirements: [{ text: "SQL", kind: "hard", excluding: false }],
  responsibilities: [],
  keywords: ["SQL"],
  embeddedQuestions: [],
  emailSubject: "",
  applicationEmail: "",
};

const done = {
  type: "done",
  value: {
    cv: templateCV,
    analysis,
    inferredSkills: [],
    findings: [],
    meta: {
      tier: "byok",
      provider: "cloudflare",
      modelId: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      model: "Cloudflare Workers AI · @cf/meta/llama-3.3-70b-instruct-fp8-fast (key propia)",
    },
  },
};

afterEach(() => {
  uninstallBrowser();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("un CV generado cuando el navegador no tiene lugar para guardarlo", () => {
  it("se conserva, se reintenta guardar sin volver a llamar al proveedor, y se guarda al liberar espacio", async () => {
    // The production state: ~5,17 M characters of applications in a
    // localStorage that holds 5,24 M, no IndexedDB to move them to. Already
    // compact, so the lossless compaction on load cannot make room by itself
    // (that it can, for a history like production's, is the next test's point).
    const history = historyOfSize(5_165_000, { legacyCopy: false });
    const local = new FakeStorage(QUOTA_CHARS);
    local.setItem("cvexact.applications.v1", JSON.stringify(history));
    // Less room than one generated CV with its analysis takes (~3 900 here),
    // on its own — not counting on the pending-generation marker to fill the
    // difference.
    fillUntilFree(local, 3_000);
    const session = new FakeStorage(QUOTA_CHARS);
    installBrowser({ local, session });
    expect(QUOTA_CHARS - local.used()).toBe(3_000);

    const fetchMock = vi.fn(async () =>
      ndjson(
        { type: "stage", stage: "analyzing" },
        { type: "stage", stage: "writing" },
        { type: "keepalive" },
        { type: "stage", stage: "checking" },
        done,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { local: store, streamGenerator, generation, pending } = await load();
    expect(await store.listApplications()).toHaveLength(history.length);

    // The Wizard's first-CV path: the id and the idempotency key before the request.
    const id = crypto.randomUUID();
    const marker = pending.beginPendingGeneration("cv", id);
    const result = await generation.generateWithRecovery(
      () => streamGenerator<import("@/lib/applications/generation").CVResponse>("/api/generate/cv", {}, { idempotencyKey: marker.key }),
      marker.key,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(new Headers(init.headers).get("x-cvp-idempotency-key")).toBe(marker.key);

    const jobText = "Buscamos analista de datos con SQL.";
    const app = generation.applyCvResult(store.newApplication(jobText, "Postulación", id), result, jobText);

    // 1. The save is refused — and the CV is not lost.
    const outcome = await store.saveApplication(app);
    expect(outcome).toEqual({ ok: false, kind: "quota" });
    expect(store.getApplication(id)?.cv).toBeDefined();
    const { getApplicationsStatus } = await import("@/lib/storage/applications/store");
    const unsaved = getApplicationsStatus().unsaved;
    expect(unsaved).toHaveLength(1);
    expect(unsaved[0]).toMatchObject({ id, kind: "quota" });
    // localStorage is full, so the waiting copy went to sessionStorage.
    expect(unsaved[0]!.rescued).toBe("session");
    expect(session.getItem("cvexact.unsaved.v1")).toContain(id);
    // The message is about storage, never «Ocurrió un error inesperado».
    const { STORAGE_MESSAGES } = await import("@/lib/storage/errors");
    expect(STORAGE_MESSAGES.quota).not.toMatch(/inesperado/);

    // 2. Retrying the save, still without room: nothing reaches the provider.
    const retried = await store.retryUnsavedApplications();
    expect(retried).toEqual([{ ok: false, kind: "quota" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 3. Room made the way the UI offers it — the person deletes old ones.
    const deleted = await store.deleteApplications(history.slice(0, 5).map((a) => a.id));
    expect(deleted.ok).toBe(true);
    const saved = await store.retryUnsavedApplications();
    expect(saved).toEqual([{ ok: true }]);
    expect(getApplicationsStatus().unsaved).toHaveLength(0);
    expect(session.getItem("cvexact.unsaved.v1")).toBeNull();
    expect(local.getItem("cvexact.applications.v1")).toContain(id);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sobrevive a una recarga mientras espera, y se guarda solo cuando hay lugar", async () => {
    const history = historyOfSize(5_165_000, { legacyCopy: false });
    const local = new FakeStorage(QUOTA_CHARS);
    local.setItem("cvexact.applications.v1", JSON.stringify(history));
    fillUntilFree(local, 4_000);
    const session = new FakeStorage(QUOTA_CHARS);
    installBrowser({ local, session });

    let { local: store } = await load();
    await store.listApplications();
    // Production-sized: ~24 K, against the ~4 K left.
    const app = { ...realisticApplication(9_999), id: "recuperada" };
    expect((await store.saveApplication(app)).ok).toBe(false);

    // A reload: a fresh page over the same browser storage.
    ({ local: store } = await load());
    const afterReload = await store.listApplications();
    expect(afterReload.find((a) => a.id === "recuperada")?.cv).toBeDefined();

    // Room appears (another tab, the person, anything); the next retry stores it.
    local.setItem("cvexact.applications.v1", JSON.stringify(history.slice(10)));
    const [outcome] = await store.retryUnsavedApplications();
    expect(outcome).toEqual({ ok: true });
    expect(local.getItem("cvexact.applications.v1")).toContain("recuperada");
  });

  it("sin IndexedDB, compactar sin pérdida al cargar ya hace lugar en un historial como el de producción", async () => {
    // Production's shape: every application carries `cvOriginal`, identical to `cv`.
    const history = historyOfSize(5_165_000);
    const local = new FakeStorage(QUOTA_CHARS);
    local.setItem("cvexact.applications.v1", JSON.stringify(history));
    installBrowser({ local });
    const before = local.used();

    const { local: store } = await load();
    const loaded = await store.listApplications();
    expect(loaded).toHaveLength(history.length);
    // Nothing was lost: every application still has its CV, and only the
    // duplicate went.
    expect(loaded.every((a) => a.cv && a.cvOriginal === undefined)).toBe(true);
    expect(local.used()).toBeLessThan(before * 0.8);

    const app = { ...store.newApplication("Aviso", "Nueva", "nueva"), cv: templateCV };
    expect(await store.saveApplication(app)).toEqual({ ok: true });
  });

  it("con IndexedDB, el mismo historial se muda y el CV nuevo se guarda sin problema", async () => {
    const history = historyOfSize(5_165_000);
    const local = new FakeStorage(QUOTA_CHARS);
    local.setItem("cvexact.applications.v1", JSON.stringify(history));
    installBrowser({ local, indexedDB: true });

    const { local: store } = await load();
    expect(await store.listApplications()).toHaveLength(history.length);
    // The move freed localStorage for everything else.
    expect(local.has("cvexact.applications.v1")).toBe(false);
    expect(local.used()).toBeLessThan(10_000);

    const app = { ...store.newApplication("Aviso", "Nueva", "nueva"), cv: templateCV };
    expect(await store.saveApplication(app)).toEqual({ ok: true });
    expect(await store.listApplications()).toHaveLength(history.length + 1);
  });
});
