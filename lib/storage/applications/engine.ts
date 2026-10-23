import type { Application } from "../application";
import type { AppDatabase, QuarantineRow } from "../db";
import { storageWriteError } from "../errors";
import { APPLICATIONS_KEY } from "./keys";
import { SNAPSHOT_KEY } from "./snapshot";

/**
 * Where applications are durably kept, behind one interface so the store above
 * never needs to know which it got.
 *
 * Every method rejects with a `StorageWriteError` when the browser refuses the
 * write, and never leaves a half-written state: one IndexedDB transaction, or one
 * `setItem` — which is itself all or nothing.
 */
export interface ApplicationsEngine {
  readonly kind: "indexeddb" | "legacy";
  /** Every stored row, unvalidated: telling valid from invalid is the store's job. */
  list(): Promise<unknown[]>;
  /** The stored rows for these ids, `undefined` where there is none. */
  getMany(ids: readonly string[]): Promise<unknown[]>;
  put(app: Application): Promise<void>;
  remove(ids: readonly string[]): Promise<void>;
  /** Everything replaced in one step — a restore or a download from the account. */
  replaceAll(apps: readonly Application[]): Promise<void>;
  clear(): Promise<void>;
  /**
   * Keeps rows that do not validate, out of sight. `removeFromStore` also takes
   * them out of the applications table — for rows that were found there; never
   * for rows arriving from a file, whose ids may belong to valid applications.
   */
  quarantine(
    rows: ReadonlyArray<{ id: string | undefined; raw: unknown; reason: string }>,
    options?: { removeFromStore?: boolean; source?: string },
  ): Promise<void>;
}

export class IndexedDbApplicationsEngine implements ApplicationsEngine {
  readonly kind = "indexeddb" as const;

  constructor(readonly db: AppDatabase) {}

  async list(): Promise<unknown[]> {
    return this.db.applications.toArray();
  }

  async getMany(ids: readonly string[]): Promise<unknown[]> {
    return this.db.applications.bulkGet([...ids]);
  }

  async put(app: Application): Promise<void> {
    try {
      await this.db.applications.put(app);
    } catch (error) {
      throw storageWriteError(error);
    }
  }

  /**
   * Also takes the ids out of the pre-migration snapshot, in the same
   * transaction: someone who deletes an application was told it is gone, and a
   * copy left in a table they cannot see would make that untrue.
   */
  async remove(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const gone = new Set(ids);
    try {
      await this.db.transaction("rw", [this.db.applications, this.db.legacySnapshot], async () => {
        await this.db.applications.bulkDelete([...ids]);
        const snapshot = await this.db.legacySnapshot.get(SNAPSHOT_KEY);
        if (snapshot) {
          const items = snapshot.items.filter(
            (item) => !(item && typeof item === "object" && gone.has((item as { id?: unknown }).id as string)),
          );
          if (items.length !== snapshot.items.length) {
            await this.db.legacySnapshot.put({ ...snapshot, items });
          }
        }
      });
    } catch (error) {
      throw storageWriteError(error);
    }
  }

  async replaceAll(apps: readonly Application[]): Promise<void> {
    try {
      await this.db.transaction("rw", this.db.applications, async () => {
        await this.db.applications.clear();
        await this.db.applications.bulkPut([...apps]);
      });
    } catch (error) {
      throw storageWriteError(error);
    }
  }

  /** «Eliminar todas»: the pre-migration snapshot goes too, for the reason `remove` filters it. */
  async clear(): Promise<void> {
    try {
      await this.db.transaction("rw", [this.db.applications, this.db.legacySnapshot], async () => {
        await this.db.applications.clear();
        await this.db.legacySnapshot.clear();
      });
    } catch (error) {
      throw storageWriteError(error);
    }
  }

  async quarantine(
    rows: ReadonlyArray<{ id: string | undefined; raw: unknown; reason: string }>,
    options: { removeFromStore?: boolean; source?: string } = {},
  ): Promise<void> {
    if (rows.length === 0) return;
    const at = new Date().toISOString();
    const entries: QuarantineRow[] = rows.map((row) => ({
      source: options.source ?? "indexeddb:applications",
      reason: row.reason,
      raw: row.raw,
      at,
    }));
    const ids = options.removeFromStore
      ? rows.map((row) => row.id).filter((id): id is string => typeof id === "string")
      : [];
    try {
      await this.db.transaction("rw", [this.db.applications, this.db.quarantine], async () => {
        await this.db.quarantine.bulkAdd(entries);
        if (ids.length > 0) await this.db.applications.bulkDelete(ids);
      });
    } catch (error) {
      throw storageWriteError(error);
    }
  }
}

/**
 * The array under one localStorage key, exactly as every build before this one
 * kept it — for browsers where IndexedDB is missing, blocked, or never answers.
 *
 * Rows it cannot read are carried through every write untouched. The code this
 * replaces wrote back only what validated, so one malformed row vanished the
 * next time anything was saved; here it stays until someone can look at it.
 */
export class LegacyApplicationsEngine implements ApplicationsEngine {
  readonly kind = "legacy" as const;

  constructor(private readonly key: string = APPLICATIONS_KEY) {}

  private storage(): Storage | null {
    try {
      return typeof window === "undefined" ? null : window.localStorage;
    } catch {
      return null;
    }
  }

  private readItems(): unknown[] {
    const storage = this.storage();
    if (!storage) return [];
    let raw: string | null = null;
    try {
      raw = storage.getItem(this.key);
    } catch {
      return [];
    }
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Falls through to setting it aside.
    }
    // Unreadable as a whole. Set aside once before anything writes over it — the
    // same rule `quarantineProfile` in `local.ts` follows for the profile.
    try {
      if (storage.getItem(`${this.key}.corrupt`) === null) storage.setItem(`${this.key}.corrupt`, raw);
    } catch {
      // Nowhere to put it. The next write still replaces only this key.
    }
    return [];
  }

  private writeItems(items: readonly unknown[]): void {
    const storage = this.storage();
    if (!storage) throw storageWriteError(new DOMException("localStorage no disponible", "SecurityError"));
    try {
      storage.setItem(this.key, JSON.stringify(items));
    } catch (error) {
      throw storageWriteError(error);
    }
  }

  private static idOf(item: unknown): string | undefined {
    if (!item || typeof item !== "object") return undefined;
    const id = (item as { id?: unknown }).id;
    return typeof id === "string" ? id : undefined;
  }

  async list(): Promise<unknown[]> {
    return this.readItems();
  }

  async getMany(ids: readonly string[]): Promise<unknown[]> {
    const items = this.readItems();
    return ids.map((id) => items.find((item) => LegacyApplicationsEngine.idOf(item) === id));
  }

  async put(app: Application): Promise<void> {
    // Read at the moment of the write, not from memory: another tab may have
    // added rows since this one loaded, and writing a stale array would drop them.
    const items = this.readItems();
    const index = items.findIndex((item) => LegacyApplicationsEngine.idOf(item) === app.id);
    if (index === -1) items.unshift(app);
    else items[index] = app;
    this.writeItems(items);
  }

  async remove(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const gone = new Set(ids);
    const items = this.readItems();
    const kept = items.filter((item) => !gone.has(LegacyApplicationsEngine.idOf(item) ?? ""));
    if (kept.length !== items.length) this.writeItems(kept);
  }

  async replaceAll(apps: readonly Application[]): Promise<void> {
    this.writeItems(apps);
  }

  async clear(): Promise<void> {
    this.writeItems([]);
  }

  /** Nothing to move them to without IndexedDB: they stay in the array, untouched. */
  async quarantine(): Promise<void> {}

  /**
   * Rewrites every row through `transform`, in one write. For the lossless
   * compaction on load (`normalizeStoredApplication`), which is how a browser
   * stuck on this engine gets back the 30 % that duplicate `cvOriginal` took.
   */
  rewrite(transform: (item: unknown) => unknown): boolean {
    const items = this.readItems();
    let changed = false;
    const next = items.map((item) => {
      const result = transform(item);
      if (result !== item) changed = true;
      return result;
    });
    if (!changed) return false;
    this.writeItems(next);
    return true;
  }
}
