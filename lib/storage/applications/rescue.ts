import type { Application } from "../application";
import type { StorageErrorKind } from "../errors";
import { RESCUE_KEY } from "./keys";

/**
 * Where an application goes when its real store refused it.
 *
 * The applications store keeps it in memory either way, so the page that has it
 * open never loses it. This is for the page that does not: a reload, a crash, a
 * closed tab. localStorage first, because it outlives the tab; sessionStorage
 * when localStorage is itself full — it has a quota of its own, and it at least
 * survives a reload of the same tab. When neither takes it, the caller is told
 * so, and the UI says «si cerrás esta pestaña se pierde: descargalo».
 *
 * Only what failed is kept here, and only its latest version: this is a waiting
 * room, not a second store.
 */

export type RescueWhere = "local" | "session" | "none";

type RescueEntry = { app: Application; kind: StorageErrorKind; at: string };
type RescueMap = Record<string, RescueEntry>;

function storages(): Array<[Exclude<RescueWhere, "none">, Storage]> {
  if (typeof window === "undefined") return [];
  const found: Array<[Exclude<RescueWhere, "none">, Storage]> = [];
  try {
    found.push(["local", window.localStorage]);
  } catch {
    // Access itself can throw when site data is blocked.
  }
  try {
    found.push(["session", window.sessionStorage]);
  } catch {
    // As above.
  }
  return found;
}

function readMap(storage: Storage): RescueMap {
  try {
    const raw = storage.getItem(RESCUE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as RescueMap) : {};
  } catch {
    return {};
  }
}

function writeMap(storage: Storage, map: RescueMap): boolean {
  try {
    if (Object.keys(map).length === 0) storage.removeItem(RESCUE_KEY);
    else storage.setItem(RESCUE_KEY, JSON.stringify(map));
    return true;
  } catch {
    return false;
  }
}

/** Keeps the latest version of an application its store refused. Returns where it went. */
export function rescueApplication(app: Application, kind: StorageErrorKind): RescueWhere {
  const at = new Date().toISOString();
  for (const [where, storage] of storages()) {
    const map = readMap(storage);
    map[app.id] = { app, kind, at };
    if (writeMap(storage, map)) {
      // One copy, not two: an older one left in the other storage would win a
      // tie it should lose, or linger after this one is saved for real.
      for (const [otherWhere, other] of storages()) {
        if (otherWhere === where) continue;
        const otherMap = readMap(other);
        if (app.id in otherMap) {
          delete otherMap[app.id];
          writeMap(other, otherMap);
        }
      }
      return where;
    }
  }
  return "none";
}

/** Everything waiting, newest version of each, with why it is waiting and where it was found. */
export function readRescuedApplications(): Array<{
  app: Application;
  kind: StorageErrorKind;
  where: Exclude<RescueWhere, "none">;
}> {
  const found = new Map<string, { app: Application; kind: StorageErrorKind; where: Exclude<RescueWhere, "none"> }>();
  for (const [where, storage] of storages()) {
    for (const entry of Object.values(readMap(storage))) {
      if (!entry || typeof entry !== "object" || !entry.app || typeof entry.app.id !== "string") continue;
      const current = found.get(entry.app.id);
      if (!current || current.app.updatedAt < entry.app.updatedAt) {
        found.set(entry.app.id, { app: entry.app, kind: entry.kind ?? "unknown", where });
      }
    }
  }
  return [...found.values()];
}

/** The application is safely stored now, or deleted: nothing to wait for. */
export function forgetRescuedApplication(id: string): void {
  for (const [, storage] of storages()) {
    const map = readMap(storage);
    if (!(id in map)) continue;
    delete map[id];
    writeMap(storage, map);
  }
}

export function forgetAllRescuedApplications(): void {
  for (const [, storage] of storages()) {
    try {
      storage.removeItem(RESCUE_KEY);
    } catch {
      // Nothing to remove from a store that cannot be reached.
    }
  }
}
