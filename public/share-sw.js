/*
 * The one thing this service worker does: receive what Android shares to the app and keep it in this browser (e5, O15).
 *
 * Sharing to an installed web app is a POST to the address the manifest names (`share_target`). Left alone, that POST goes to our server — and with it
 * the text the person shared, to Cloudflare, to the server and to their logs. A service worker can answer it before it leaves the phone: it takes the
 * form, puts it in a cache of this browser, and sends the person on to the page that shows it — «Anotá algo», to be kept as a note or thrown away.
 *
 * It does nothing else. It has no `fetch` handler for any other request, no cache of pages or files, no push, no sync; a request that is not that POST
 * is none of its business and goes where it was going. `tests/share-worker.test.ts` runs this very file against stand-ins for the browser to hold that.
 *
 * Registered only when «Anotá algo» is switched on (`lib/notes/share.ts`), and a file in `public/` and not a route, so that its scope is the whole origin.
 */

const SHARE_CACHE = "cvexact-share-v1";
const SHARE_KEY = "/anotar/compartido";
const SHARE_PATH = "/anotar/recibir";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "POST") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname !== SHARE_PATH) return;
  event.respondWith(receive(request));
});

async function receive(request) {
  let kept = false;
  try {
    const form = await request.formData();
    const shared = {
      title: String(form.get("title") || ""),
      text: String(form.get("text") || ""),
      url: String(form.get("url") || ""),
      at: Date.now(),
    };
    const cache = await caches.open(SHARE_CACHE);
    await cache.put(SHARE_KEY, new Response(JSON.stringify(shared), { headers: { "content-type": "application/json" } }));
    kept = true;
  } catch {
    // There is nothing to say to anyone from here: the page says that nothing arrived.
  }
  return Response.redirect(new URL(kept ? "/anotar?compartido=1" : "/anotar?compartido=falta", self.location.origin).href, 303);
}
