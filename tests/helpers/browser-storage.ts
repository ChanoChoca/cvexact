import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { applicationSchema, type Application } from "@/lib/storage/application";
import { templateCV } from "@/lib/fixtures/template-cv";
import { cvDocumentSchema } from "@/lib/schemas/cv";
import { inferredSkillSchema, jobAnalysisSchema } from "@/lib/schemas/job";

/**
 * A browser for the storage tests: localStorage and sessionStorage that enforce
 * a real quota and fail the way browsers do, and — when asked — a fresh
 * IndexedDB (fake-indexeddb) per test.
 *
 * Not a test file itself (vitest only collects `*.test.ts`).
 */

/** What every browser gives localStorage per origin, in the characters the incident measured. */
export const QUOTA_CHARS = 5 * 1024 * 1024;

export class FakeStorage {
  private readonly map = new Map<string, string>();
  /** Every successful `setItem`, by key — to count writes. */
  readonly writes = new Map<string, number>();

  constructor(public quota = QUOTA_CHARS) {}

  get length(): number {
    return this.map.size;
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    const text = String(value);
    const previous = this.map.get(key);
    const next = this.used() - (previous === undefined ? 0 : key.length + previous.length) + key.length + text.length;
    if (next > this.quota) {
      // What Chrome throws, name and message.
      throw new DOMException(
        `Failed to execute 'setItem' on 'Storage': Setting the value of '${key}' exceeded the quota.`,
        "QuotaExceededError",
      );
    }
    this.map.set(key, text);
    this.writes.set(key, (this.writes.get(key) ?? 0) + 1);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  used(): number {
    let total = 0;
    for (const [key, value] of this.map) total += key.length + value.length;
    return total;
  }
}

type Globals = { window?: unknown; indexedDB?: unknown; IDBKeyRange?: unknown };

export function installBrowser(
  options: { local?: FakeStorage; session?: FakeStorage; indexedDB?: boolean } = {},
): { local: FakeStorage; session: FakeStorage } {
  const local = options.local ?? new FakeStorage();
  const session = options.session ?? new FakeStorage();
  const globals = globalThis as unknown as Globals;
  globals.window = {
    localStorage: local,
    sessionStorage: session,
    addEventListener() {},
    removeEventListener() {},
  };
  if (options.indexedDB) {
    globals.indexedDB = new IDBFactory();
    globals.IDBKeyRange = IDBKeyRange;
  } else {
    delete globals.indexedDB;
    delete globals.IDBKeyRange;
  }
  return { local, session };
}

export function uninstallBrowser(): void {
  const globals = globalThis as unknown as Globals;
  delete globals.window;
  delete globals.indexedDB;
  delete globals.IDBKeyRange;
}

const filler = "lorem ipsum dolor sit amet consectetur adipiscing elit ";
const pad = (label: string, chars: number) => `${label} ${filler.repeat(Math.ceil(chars / filler.length))}`.slice(0, chars);

/**
 * An application shaped like a real one — the proportions of the export this
 * was measured on (~24 K characters: posting, analysis, skills, a CV with its
 * coverage report) — made of synthetic text that passes `applicationSchema`.
 * `legacyCopy` adds the duplicate `cvOriginal` every build before this one wrote.
 */
export function realisticApplication(
  index: number,
  options: { legacyCopy?: boolean; createdAt?: string } = {},
): Application {
  const createdAt = options.createdAt ?? new Date(Date.UTC(2026, 7, 1) + index * 60_000).toISOString();
  const analysis = jobAnalysisSchema.parse({
    title: `Puesto ${index}`,
    company: `Empresa ${index}`,
    language: "es",
    domain: "software",
    relevance: "direct",
    relevanceReason: pad("Coincide", 220),
    requirements: Array.from({ length: 14 }, (_, i) => ({
      text: pad(`Requisito ${i}`, 90),
      kind: i % 3 === 0 ? "soft" : "hard",
    })),
    responsibilities: Array.from({ length: 6 }, (_, i) => pad(`Responsabilidad ${i}`, 110)),
    keywords: Array.from({ length: 20 }, (_, i) => `palabra${i}`),
  });
  const inferredSkills = Array.from({ length: 12 }, (_, i) =>
    inferredSkillSchema.parse({
      skill: `Skill ${i}`,
      derivedFrom: `Experiencia ${i}`,
      confidence: "high",
      rationale: pad(`Porque ${i}`, 150),
    }),
  );
  const cv = cvDocumentSchema.parse({
    ...templateCV,
    coverage: {
      requirements: Array.from({ length: 14 }, (_, i) => ({
        requirement: pad(`Requisito ${i}`, 90),
        covered: i % 4 !== 0,
        evidence: pad(`Evidencia ${i}`, 160),
        inferred: false,
      })),
      omitted: [],
    },
  });
  return applicationSchema.parse({
    id: `app-${String(index).padStart(4, "0")}`,
    createdAt,
    updatedAt: createdAt,
    jobText: pad(`Aviso ${index}`, 2800),
    label: `Puesto ${index} · Empresa ${index}`,
    analysis,
    inferredSkills,
    cv,
    findings: [],
    provider: "cloudflare",
    model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    ...(options.legacyCopy ? { cvOriginal: cv, cvEdited: false } : {}),
  });
}

/**
 * Takes a store to `freeChars` of room left, with a key the app itself keeps
 * (production had ~60 K of derived cache and ~6 K of profile beside the
 * history, and ~6 K free when the CV would not fit).
 */
export function fillUntilFree(storage: FakeStorage, freeChars: number, key = "cvexact.derived.v1"): void {
  storage.removeItem(key);
  const room = storage.quota - storage.used() - key.length - freeChars;
  if (room <= 2) return;
  storage.setItem(key, JSON.stringify("x".repeat(room - 2)));
}

/**
 * Applications until the array reaches `targetChars` — a history like the one
 * that filled production. With `legacyCopy` (the default, as production had it)
 * each carries the duplicate `cvOriginal`, which the lossless compaction on
 * load removes; without it, the history is already as small as it gets.
 */
export function historyOfSize(targetChars: number, options: { legacyCopy?: boolean } = {}): Application[] {
  const history: Application[] = [];
  let size = 2;
  for (let index = 0; size < targetChars; index++) {
    const app = realisticApplication(index, { legacyCopy: options.legacyCopy ?? true });
    history.push(app);
    size += JSON.stringify(app).length + 1;
  }
  return history;
}
