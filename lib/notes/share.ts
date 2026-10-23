/**
 * Sharing to the app from another one, on Android (e5, O15; E4, 3d), without it passing through anyone: a service worker (`public/share-sw.js`) answers the
 * POST that the system makes to the address of the manifest's `share_target`, keeps what came in a cache of this browser, and sends the person to «Anotá
 * algo» to read it. This reads it back, once, and registers the worker — which the app does only when that is switched on.
 *
 * It is a convenience for whoever installed the app and nothing else: Safari and Firefox do not offer it, and neither do they get anything worse.
 */

export const SHARE_CACHE = "cvexact-share-v1";
export const SHARE_KEY = "/anotar/compartido";
/** Where the system sends what is shared (`app/manifest.ts`), and where the worker waits for it. */
export const SHARE_ACTION = "/anotar/recibir";
export const SHARE_WORKER = "/share-sw.js";

export type Shared = { title?: string; text?: string; url?: string };

/**
 * What was shared, as one text to write down: the title, the text and the address, each once. Android Chrome puts the address inside the text more often than
 * not, and an app that shares its own title as the text says it twice — neither is kept twice.
 */
export function sharedText({ title = "", text = "", url = "" }: Shared): string {
  const parts: string[] = [];
  const add = (value: string) => {
    const clean = value.trim();
    if (clean === "" || parts.some((part) => part.includes(clean))) return;
    // What came before and is part of this one is replaced by it.
    for (let index = parts.length - 1; index >= 0; index -= 1) if (clean.includes(parts[index]!)) parts.splice(index, 1);
    parts.push(clean);
  };
  add(title);
  add(text);
  add(url);
  return parts.join("\n");
}

/** Registers the worker that receives what is shared. Never throws and says whether it could: a browser without one has nothing to register. */
export async function registerShareWorker(): Promise<boolean> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return false;
  try {
    await navigator.serviceWorker.register(SHARE_WORKER, { scope: "/" });
    return true;
  } catch {
    return false;
  }
}

/** What the worker kept, taken out so that it is read once, and `null` when nothing is there. */
export async function takeShared(): Promise<string | null> {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open(SHARE_CACHE);
    const found = await cache.match(SHARE_KEY);
    if (!found) return null;
    await cache.delete(SHARE_KEY);
    const shared = (await found.json()) as Shared;
    const text = sharedText(shared);
    return text === "" ? null : text;
  } catch {
    return null;
  }
}
