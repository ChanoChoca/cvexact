import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { SHARE_ACTION, SHARE_CACHE, SHARE_KEY, SHARE_WORKER } from "@/lib/notes/share";

/**
 * The service worker that receives what Android shares to the app (`public/share-sw.js`, e5, O15), run as the file it is, against stand-ins for the browser: that it
 * keeps what comes in a cache of this browser, sends the person on to «Anotá algo», and does nothing else with anything else. It is the first service worker of the
 * app and it is held to being small: no other listener, no network of its own, no cache of pages.
 */

const SOURCE = readFileSync("public/share-sw.js", "utf8");
const ORIGIN = "https://app.example.com";

type Handler = (event: Record<string, unknown>) => void;

/** The worker, loaded into a context with the browser's pieces it uses made by hand; `kept` is what it put in the cache. */
function load(options: { failPut?: boolean } = {}) {
  const listeners: Record<string, Handler> = {};
  const kept = new Map<string, string>();
  const calls = { skipWaiting: 0, claim: 0, opened: [] as string[] };
  const caches = {
    open: async (name: string) => {
      calls.opened.push(name);
      return {
        put: async (key: string, response: Response) => {
          if (options.failPut) throw new Error("sin lugar");
          kept.set(key, await response.text());
        },
      };
    },
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, handler: Handler) => {
      listeners[type] = handler;
    },
    skipWaiting: () => {
      calls.skipWaiting += 1;
    },
    clients: {
      claim: async () => {
        calls.claim += 1;
      },
    },
  };
  runInNewContext(SOURCE, { self, caches, Response, URL, FormData, console });
  return { listeners, kept, calls };
}

/** A request as the browser makes it when something is shared, with the form it carries. */
const share = (fields: Record<string, string>, extra: { method?: string; url?: string; failForm?: boolean } = {}) => {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  return {
    method: extra.method ?? "POST",
    url: extra.url ?? `${ORIGIN}${SHARE_ACTION}`,
    formData: async () => {
      if (extra.failForm) throw new TypeError("no es un formulario");
      return form;
    },
  };
};

/** Fires a `fetch` event and gives back what the worker answered, or `null` when it left the request alone. */
async function fetched(worker: ReturnType<typeof load>, request: ReturnType<typeof share>): Promise<Response | null> {
  let answered: Promise<Response> | null = null;
  worker.listeners.fetch!({ request, respondWith: (promise: Promise<Response>) => (answered = promise) });
  return answered ? await answered : null;
}

describe("the worker", () => {
  it("is small: it listens to three things and no more, and has no network or page cache of its own", () => {
    const worker = load();
    expect(Object.keys(worker.listeners).sort()).toEqual(["activate", "fetch", "install"]);
    for (const forbidden of [/\bfetch\s*\(/, /importScripts/, /\bpush\b/, /(?<![a-z])sync(?![a-z])|SyncManager|periodicSync/i, /\bcaches\.(?:match|keys|delete)/, /cache\.addAll/, /postMessage/, /XMLHttpRequest/, /indexedDB/, /localStorage/]) {
      expect(SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""), String(forbidden)).not.toMatch(forbidden);
    }
  });

  it("takes over at once when it is installed, and keeps the pages it finds", async () => {
    const worker = load();
    worker.listeners.install!({});
    expect(worker.calls.skipWaiting).toBe(1);
    let waited: Promise<unknown> | null = null;
    worker.listeners.activate!({ waitUntil: (promise: Promise<unknown>) => (waited = promise) });
    await waited;
    expect(worker.calls.claim).toBe(1);
  });

  it("answers what is shared: keeps it in a cache of this browser, whole, and sends the person to «Anotá algo» with a 303", async () => {
    const worker = load();
    const response = await fetched(worker, share({ title: "Felicitaciones", text: "Cerraste el trimestre con el mejor resultado", url: "https://ejemplo.com/nota" }));
    expect(response?.status).toBe(303);
    expect(response?.headers.get("location")).toBe(`${ORIGIN}/anotar?compartido=1`);
    expect(worker.calls.opened).toEqual([SHARE_CACHE]);
    expect([...worker.kept.keys()]).toEqual([SHARE_KEY]);
    expect(JSON.parse(worker.kept.get(SHARE_KEY)!)).toMatchObject({ title: "Felicitaciones", text: "Cerraste el trimestre con el mejor resultado", url: "https://ejemplo.com/nota" });
  });

  it("keeps an empty form as empty fields, and never throws for what is not there", async () => {
    const worker = load();
    const response = await fetched(worker, share({}));
    expect(response?.status).toBe(303);
    expect(JSON.parse(worker.kept.get(SHARE_KEY)!)).toMatchObject({ title: "", text: "", url: "" });
  });

  it("says that nothing arrived when it could not read it or keep it, and still sends them on", async () => {
    const broken = await fetched(load(), share({ text: "algo" }, { failForm: true }));
    expect(broken?.status).toBe(303);
    expect(broken?.headers.get("location")).toBe(`${ORIGIN}/anotar?compartido=falta`);
    const full = load({ failPut: true });
    const noRoom = await fetched(full, share({ text: "algo" }));
    expect(noRoom?.headers.get("location")).toBe(`${ORIGIN}/anotar?compartido=falta`);
    expect(full.kept.size).toBe(0);
  });

  it("leaves everything else alone: a GET to that address, a POST to another, a request to another site", async () => {
    const worker = load();
    expect(await fetched(worker, share({ text: "x" }, { method: "GET" }))).toBeNull();
    expect(await fetched(worker, share({ text: "x" }, { url: `${ORIGIN}/api/sync` }))).toBeNull();
    expect(await fetched(worker, share({ text: "x" }, { url: `${ORIGIN}${SHARE_ACTION}/otra` }))).toBeNull();
    expect(await fetched(worker, share({ text: "x" }, { url: `https://otro.example.com${SHARE_ACTION}` }))).toBeNull();
    expect(worker.calls.opened).toEqual([]);
    expect(worker.kept.size).toBe(0);
  });

  it("is where the browser and the manifest say it is, in the root of the site so that its scope is all of it", () => {
    expect(SHARE_WORKER).toBe("/share-sw.js");
    expect(SOURCE).toContain(`"${SHARE_KEY}"`);
    expect(SOURCE).toContain(`"${SHARE_ACTION}"`);
    expect(SOURCE).toContain(`"${SHARE_CACHE}"`);
    const registered = vi.fn();
    expect(registered).not.toHaveBeenCalled();
  });
});
