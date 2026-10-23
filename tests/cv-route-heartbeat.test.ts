import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backendProfile } from "./fixtures";
import { templateCV } from "@/lib/fixtures/template-cv";

/**
 * El `keepalive` de la ruta de CV.
 *
 * La ruta se queda muda durante una llamada de CV entera — hasta 90s,
 * `LARGE_ATTEMPT_TIMEOUT_MS` — y el `timeout server` de HAProxy mide
 * *inactividad*, no primer byte. En producción eso cortaba el stream a mitad de
 * la generación, con el pod trabajando y sin ningún fallo en el log: el cliente
 * veía "la respuesta se cortó" y el servidor no tenía nada que contar. El frame
 * existe para el cable, no para el lector, así que lo que hay que fijar es que
 * salga *mientras* una llamada sigue en vuelo, que deje de salir cuando el
 * stream termina, y que no le quite nada a lo que la ruta hace al terminar:
 * mandar el `done` y guardarlo bajo la clave de idempotencia.
 */

const analyzeJob = vi.fn();
const inferSkills = vi.fn();
const buildCV = vi.fn();

vi.mock("@/lib/api/context", () => ({
  openRequest: async () => ({
    tier: "byok",
    chain: {
      candidates: [],
      used: {},
      failed: new Set(),
      switches: [],
      deadlineAt: Date.now() + 180_000,
    },
    grant: { release: async () => {} },
  }),
  failureMessage: () => ({ message: "se cortó", status: 502 }),
}));

vi.mock("@/lib/ai/pipeline", () => ({
  analyzeJob: (...args: unknown[]) => analyzeJob(...args),
  inferSkills: (...args: unknown[]) => inferSkills(...args),
  buildCV: (...args: unknown[]) => buildCV(...args),
  sumTelemetry: () => ({}),
}));

vi.mock("@/lib/ai/practical", () => ({
  withProfilePractical: (value: unknown) => value,
  withoutOffFieldCredentials: (value: unknown) => value,
}));

vi.mock("@/lib/ai/preflight", () => ({ blockingExclusions: () => [] }));

vi.mock("@/lib/ai/verify", () => ({
  cvGaps: () => [],
  gapCount: () => 0,
  hasGaps: () => false,
  verifyCV: () => [],
}));

const { POST } = await import("@/app/api/generate/cv/route");
const cache = await import("@/lib/generation/result-cache");

const KEY = "5d0c9a8e-7b6f-4a3e-9d2c-1b0a9f8e7d6c";

const BODY = {
  profile: backendProfile,
  jobText: "Pegá el texto de la oferta completo, con requisitos y responsabilidades detalladas.",
  rejectedSkills: [],
  acknowledgeExclusions: true,
};

const post = (headers: Record<string, string> = {}, body: unknown = BODY) =>
  POST(
    new Request("https://cvexact.test/api/generate/cv", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );

/** Reads the whole stream, moving the fake clock between reads. */
async function readAll(response: Response, maxSteps = 20): Promise<{ frames: Array<{ type: string }>; text: string }> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (let step = 0; step < maxSteps; step += 1) {
    await vi.advanceTimersByTimeAsync(15_000);
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  const frames = text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string });
  return { frames, text };
}

beforeEach(() => {
  vi.useFakeTimers();
  analyzeJob.mockReset().mockResolvedValue({ relevance: "direct", language: "es", requirements: [], keywords: [] });
  inferSkills.mockReset().mockResolvedValue([]);
  // By default the document never arrives: exactly the silent stretch the
  // heartbeat exists to cover.
  buildCV.mockReset().mockImplementation(() => new Promise(() => {}));
});

afterEach(() => {
  cache.setResultStoreForTests(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("POST /api/generate/cv", () => {
  it("manda un keepalive mientras la generación sigue en vuelo", async () => {
    const response = await post();
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";

    // Cada `advanceTimersByTimeAsync` corre lo pendiente y dispara el intervalo,
    // así que la lectura posterior nunca queda bloqueada esperando datos.
    for (let i = 0; i < 5 && !text.includes('"keepalive"'); i += 1) {
      await vi.advanceTimersByTimeAsync(15_000);
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }

    expect(text).toContain('"type":"keepalive"');
    await reader.cancel();
  });

  it("deja de mandarlos cuando el stream termina, aunque haya terminado en error", async () => {
    buildCV.mockImplementation(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error("se cortó")), 40_000)),
    );
    const { frames } = await readAll(await post());

    expect(frames.some((frame) => frame.type === "keepalive")).toBe(true);
    expect(frames.at(-1)?.type).toBe("error");
    // The interval is gone: nothing left scheduled to write onto a closed stream.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("entrega el CV después de los keepalive, y lo guarda bajo la clave de idempotencia", async () => {
    const store = cache.memoryResultStore();
    cache.setResultStoreForTests(store);
    buildCV.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ ...templateCV }), 40_000)),
    );

    const { frames } = await readAll(await post({ "x-cvp-idempotency-key": KEY }));
    const done = frames.findIndex((frame) => frame.type === "done");

    expect(done).toBeGreaterThan(-1);
    // Kept alive through the silent stretch, and quiet after the answer.
    expect(frames.slice(0, done).filter((frame) => frame.type === "keepalive").length).toBeGreaterThanOrEqual(2);
    expect(frames.slice(done + 1)).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);

    const kept = await cache.readForRecovery(KEY);
    expect(kept).toMatchObject({ status: "done", kind: "cv", payload: { jobText: BODY.jobText } });
  });
});

describe("POST /api/generate/cv — lo que el modelo no decide", () => {
  it("entrega el CV con lo que el perfil da: ni más viñetas por puesto ni un proyecto que no es suyo", async () => {
    buildCV.mockImplementation(async () => ({
      ...templateCV,
      sections: [
        {
          kind: "experience",
          title: "EXPERIENCIA PROFESIONAL",
          items: [{ company: "Flash Page", role: "Software Engineer", location: "", dateRange: "2024", bullets: ["1.", "2.", "3.", "4.", "5.", "6.", "7."] }],
        },
        {
          kind: "projects",
          title: "PROYECTOS",
          items: [
            { ref: "P1", name: "Turnero", description: "Lideré todo el desarrollo.", url: "https://otro.example.com" },
            { ref: "P9", name: "Sistema inventado", description: "", url: "" },
          ],
        },
      ],
    }));
    const profile = { ...backendProfile, projects: [{ id: "p1", name: "Turnero", description: "Agenda de turnos.", url: "turnero.app", tags: [] }] };

    const { frames } = await readAll(await post({}, { ...BODY, profile }));
    const done = frames.find((frame) => frame.type === "done") as unknown as {
      value: { cv: { sections: Array<{ kind: string; items: Array<Record<string, unknown>> }> } };
    };

    const section = (kind: string) => done.value.cv.sections.find((s) => s.kind === kind);
    // backendProfile gives its one role three tasks.
    expect(section("experience")!.items[0]!.bullets).toEqual(["1.", "2.", "3."]);
    expect(section("projects")!.items).toEqual([{ ref: "P1", name: "Turnero", description: "Agenda de turnos.", url: "https://turnero.app" }]);
    // The model left the studies out; the profile's go in rather than a second call asking for them.
    expect(section("education")!.items[0]).toMatchObject({ institution: expect.stringContaining("Noroeste"), degree: "Analista de Sistemas" });
  });
});

describe("POST /api/generate/cv — las skills deducidas que pide el aviso", () => {
  const git = { skill: "Git", derivedFrom: "GitHub Actions", confidence: "high" as const, rationale: "Usa GitHub Actions." };
  const analysis = {
    title: "Backend Developer",
    company: "",
    location: "",
    workMode: "remote",
    domain: "software",
    seniority: "mid",
    relevance: "direct",
    relevanceReason: "—",
    language: "es",
    keywords: ["Git"],
    requirements: [],
    responsibilities: [],
  };
  const done = (frames: Array<{ type: string }>) =>
    frames.find((frame) => frame.type === "done") as unknown as { value: { cv?: unknown; skillReview?: Array<{ skill: string }>; inferredSkills?: unknown[] } };

  beforeEach(() => {
    analyzeJob.mockResolvedValue(analysis);
    inferSkills.mockResolvedValue([git]);
    buildCV.mockImplementation(async () => ({ ...templateCV }));
  });

  it("frena antes del CV y devuelve lo que preguntar, con el análisis y las skills para la segunda vuelta", async () => {
    const { frames } = await readAll(await post());

    expect(done(frames).value).toMatchObject({ skillReview: [{ skill: "Git" }], analysis: { title: "Backend Developer" }, inferredSkills: [{ skill: "Git" }] });
    expect(done(frames).value.cv).toBeUndefined();
    expect(buildCV).not.toHaveBeenCalled();
  });

  it("no frena cuando la persona ya las revisó: con skillsReviewed escribe el CV", async () => {
    const { frames } = await readAll(await post({}, { ...BODY, skillsReviewed: true }));

    expect(done(frames).value.skillReview).toBeUndefined();
    expect(done(frames).value.cv).toBeDefined();
    expect(buildCV).toHaveBeenCalledTimes(1);
  });

  it("no frena por una que el perfil ya dice, ni por una que la persona vetó", async () => {
    const stated = { ...backendProfile, skills: [...backendProfile.skills, "Git"] };
    expect(done((await readAll(await post({}, { ...BODY, profile: stated }))).frames).value.cv).toBeDefined();

    buildCV.mockClear();
    expect(done((await readAll(await post({}, { ...BODY, rejectedSkills: ["git"] }))).frames).value.cv).toBeDefined();
  });

  it("no frena cuando el aviso no pide ninguna de las deducidas", async () => {
    inferSkills.mockResolvedValue([{ skill: "Poda de arbustos", derivedFrom: "jardinería", confidence: "medium", rationale: "—" }]);
    expect(done((await readAll(await post())).frames).value.cv).toBeDefined();
  });
});

describe("POST /api/generate/cv — las hojas", () => {
  beforeEach(() => {
    buildCV.mockImplementation(async () => ({ ...templateCV }));
  });

  it("le pasa al generador las dos hojas que la persona permitió, y solo esas", async () => {
    await readAll(await post({}, { ...BODY, sheets: 2 }));
    expect(buildCV.mock.calls[0]![1]).toMatchObject({ sheets: 2 });

    buildCV.mockClear();
    await readAll(await post({}, { ...BODY, sheets: 3 }));
    expect(buildCV.mock.calls[0]![1].sheets).toBeUndefined();

    buildCV.mockClear();
    await readAll(await post());
    expect(buildCV.mock.calls[0]![1].sheets).toBeUndefined();
  });
});
