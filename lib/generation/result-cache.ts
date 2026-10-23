import "server-only";

import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { and, eq, lt, ne, or } from "drizzle-orm";
import { databaseConfigured, getDb, schema } from "@/lib/db";
import { RESULT_TTL_MS, type GenerationKind } from "./idempotency";

/**
 * The server's copy of each document generation's result, for a day, under the
 * idempotency key the browser sent (`lib/generation/idempotency.ts`).
 *
 * Why the server keeps anything at all, when everything else a user makes
 * lives in their browser: the route charges for a CV (`settle("success")`)
 * before it sends it, and the browser can lose it after that — a connection that
 * drops between the two, a browser that refuses to store it (the incident this
 * was built for), a tab closed before the save. Each of those used to cost a
 * second generation, and a second charge, to get the same document back. With
 * the key, the browser asks for the one it already paid for.
 *
 * What is stored makes that cheap to accept:
 * - never the key, only its SHA-256;
 * - the result encrypted (AES-256-GCM) with a key derived from the idempotency
 *   key by HKDF — so this table, its backups and whoever can read them hold
 *   ciphertext nobody can open without the browser that asked;
 * - nothing that names a person or an account;
 * - gone after `RESULT_TTL_MS`, by `expires_at` (read) and by
 *   `scripts/prune.mjs` plus an occasional sweep here (disk).
 *
 * Every call is best-effort and bounded: a database that is slow, absent
 * (`databaseConfigured` false in development) or failing turns this off for
 * that request, and the generation goes on exactly as it did before this
 * existed. It is a safety net, never the reason a CV arrives late or not at all.
 */

/** A running row older than this belongs to a request that died, and is taken over. */
export const RUNNING_STALE_MS = 3 * 60 * 1000;

/** Past this, a store call is abandoned — see above. */
const STORE_TIMEOUT_MS = 2_000;

const INFO = "cvexact.generation-result.v1";

export type StoredPayload = { value: unknown; jobText?: string };

export type ResultRow = {
  keyHash: string;
  kind: string;
  bodyHash: string;
  status: string;
  ciphertext: string | null;
  iv: string | null;
  createdAt: Date;
  expiresAt: Date;
};

/** Where rows live: Postgres in production, memory in the tests. */
export interface ResultStore {
  get(keyHash: string): Promise<ResultRow | null>;
  /** Inserts a running row, or takes over one that is done or stale. False when a fresh running row holds the key. */
  claim(row: ResultRow, staleBefore: Date): Promise<boolean>;
  /** Stores a finished result, whether or not the key was claimed first. */
  complete(row: ResultRow): Promise<void>;
  /** Drops a claim that produced nothing. Never touches a finished row. */
  release(keyHash: string): Promise<void>;
  purgeExpired(now: Date): Promise<void>;
}

const postgresStore: ResultStore = {
  async get(keyHash) {
    const table = schema.generationResult;
    const [row] = await getDb().select().from(table).where(eq(table.keyHash, keyHash)).limit(1);
    return row ?? null;
  },
  async claim(row, staleBefore) {
    const table = schema.generationResult;
    const claimed = await getDb()
      .insert(table)
      .values(row)
      .onConflictDoUpdate({
        target: table.keyHash,
        set: {
          kind: row.kind,
          bodyHash: row.bodyHash,
          status: "running",
          ciphertext: null,
          iv: null,
          createdAt: row.createdAt,
          expiresAt: row.expiresAt,
        },
        // Only a finished row, or a claim that has gone stale, is taken over;
        // a fresh one belongs to a request still working on this very key.
        setWhere: or(ne(table.status, "running"), lt(table.createdAt, staleBefore)),
      })
      .returning({ keyHash: table.keyHash });
    return claimed.length > 0;
  },
  async complete(row) {
    const table = schema.generationResult;
    await getDb()
      .insert(table)
      .values(row)
      .onConflictDoUpdate({
        target: table.keyHash,
        set: {
          kind: row.kind,
          bodyHash: row.bodyHash,
          status: row.status,
          ciphertext: row.ciphertext,
          iv: row.iv,
          expiresAt: row.expiresAt,
        },
      });
  },
  async release(keyHash) {
    const table = schema.generationResult;
    await getDb()
      .delete(table)
      .where(and(eq(table.keyHash, keyHash), eq(table.status, "running")));
  },
  async purgeExpired(now) {
    const table = schema.generationResult;
    await getDb().delete(table).where(lt(table.expiresAt, now));
  },
};

/** The same contract in memory, for the tests. */
export function memoryResultStore(): ResultStore & { rows: Map<string, ResultRow> } {
  const rows = new Map<string, ResultRow>();
  return {
    rows,
    async get(keyHash) {
      return rows.get(keyHash) ?? null;
    },
    async claim(row, staleBefore) {
      const current = rows.get(row.keyHash);
      if (current && current.status === "running" && current.createdAt >= staleBefore) return false;
      rows.set(row.keyHash, row);
      return true;
    },
    async complete(row) {
      rows.set(row.keyHash, { ...(rows.get(row.keyHash) ?? row), ...row });
    },
    async release(keyHash) {
      if (rows.get(keyHash)?.status === "running") rows.delete(keyHash);
    },
    async purgeExpired(now) {
      for (const [key, row] of rows) if (row.expiresAt < now) rows.delete(key);
    },
  };
}

let override: ResultStore | null = null;

/** Swaps the store, for the tests. `null` goes back to Postgres. */
export function setResultStoreForTests(store: ResultStore | null): void {
  override = store;
}

function activeStore(): ResultStore | null {
  if (override) return override;
  return databaseConfigured ? postgresStore : null;
}

function bounded<T>(promise: Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), STORE_TIMEOUT_MS);
  });
  return Promise.race([promise.catch(() => fallback), timeout]).finally(() => clearTimeout(timer));
}

// --- Crypto -----------------------------------------------------------------------

/** Domain-separated, so this hash of a key is useful for nothing but finding its row. */
export function hashKey(key: string): string {
  return createHash("sha256").update(`${INFO}:${key}`).digest("hex");
}

export function hashBody(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function derive(key: string): Buffer {
  return Buffer.from(hkdfSync("sha256", Buffer.from(key, "utf8"), Buffer.alloc(0), INFO, 32));
}

export function sealResult(key: string, payload: StoredPayload): { ciphertext: string; iv: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derive(key), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final(), cipher.getAuthTag()]);
  return { ciphertext: body.toString("base64"), iv: iv.toString("base64") };
}

/** Null for a wrong key or a tampered row: GCM authenticates, it does not guess. */
export function openResult(key: string, ciphertext: string, iv: string): StoredPayload | null {
  try {
    const data = Buffer.from(ciphertext, "base64");
    const decipher = createDecipheriv("aes-256-gcm", derive(key), Buffer.from(iv, "base64"));
    decipher.setAuthTag(data.subarray(data.length - 16));
    const plain = Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]);
    return JSON.parse(plain.toString("utf8")) as StoredPayload;
  } catch {
    return null;
  }
}

// --- What the routes call ---------------------------------------------------------

/**
 * A finished result for exactly this request — same key, same kind, same body —
 * or null. What lets a retry of a request the server already answered be
 * answered again without reserving a grant or asking any model.
 */
export async function findReplay(
  key: string,
  kind: GenerationKind,
  bodyHash: string,
  now = new Date(),
): Promise<StoredPayload | null> {
  const store = activeStore();
  if (!store) return null;
  const row = await bounded(store.get(hashKey(key)), null);
  if (!row || row.status !== "done" || row.kind !== kind || row.bodyHash !== bodyHash) return null;
  if (row.expiresAt <= now || !row.ciphertext || !row.iv) return null;
  return openResult(key, row.ciphertext, row.iv);
}

/**
 * Marks the key as being generated. `busy` when another request is generating
 * under it right now; `unavailable` when there is nowhere to keep anything,
 * which the route treats like `claimed` — it generates, just without the net.
 */
export async function claimGeneration(
  key: string,
  kind: GenerationKind,
  bodyHash: string,
  now = new Date(),
): Promise<"claimed" | "busy" | "unavailable"> {
  const store = activeStore();
  if (!store) return "unavailable";
  // Now and then, sweep what has expired: the daily prune is the real cleanup,
  // this keeps the table small between runs on a busy day.
  if (Math.random() < 0.05) void bounded(store.purgeExpired(now), undefined);
  const row: ResultRow = {
    keyHash: hashKey(key),
    kind,
    bodyHash,
    status: "running",
    ciphertext: null,
    iv: null,
    createdAt: now,
    expiresAt: new Date(now.getTime() + RESULT_TTL_MS),
  };
  const outcome = await bounded(
    store.claim(row, new Date(now.getTime() - RUNNING_STALE_MS)).then((ok) => (ok ? "claimed" : "busy")),
    "unavailable" as const,
  );
  return outcome;
}

/** Keeps a finished result. Bounded, and silent on failure. */
export async function storeResult(
  key: string,
  kind: GenerationKind,
  bodyHash: string,
  payload: StoredPayload,
  now = new Date(),
): Promise<void> {
  const store = activeStore();
  if (!store) return;
  const sealed = sealResult(key, payload);
  await bounded(
    store.complete({
      keyHash: hashKey(key),
      kind,
      bodyHash,
      status: "done",
      ...sealed,
      createdAt: now,
      expiresAt: new Date(now.getTime() + RESULT_TTL_MS),
    }),
    undefined,
  );
}

/** A claim that produced nothing: let the key be used again at once. */
export async function releaseGeneration(key: string): Promise<void> {
  const store = activeStore();
  if (!store) return;
  await bounded(store.release(hashKey(key)), undefined);
}

/** For `GET /api/generate/result`: by key alone, whatever the body was. */
export async function readForRecovery(
  key: string,
  now = new Date(),
): Promise<{ status: "done"; kind: GenerationKind; payload: StoredPayload } | { status: "running" } | null> {
  const store = activeStore();
  if (!store) return null;
  const row = await bounded(store.get(hashKey(key)), null);
  if (!row || row.expiresAt <= now) return null;
  if (row.status === "running") {
    return row.createdAt.getTime() >= now.getTime() - RUNNING_STALE_MS ? { status: "running" } : null;
  }
  if (!row.ciphertext || !row.iv) return null;
  const payload = openResult(key, row.ciphertext, row.iv);
  return payload ? { status: "done", kind: row.kind as GenerationKind, payload } : null;
}
