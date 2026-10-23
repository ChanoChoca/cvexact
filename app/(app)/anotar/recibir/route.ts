import { experimentOnServer } from "@/lib/experiments";

/**
 * What the system sends when something is shared to the app (`share_target` in `app/manifest.ts`, e5, O15) and the service worker that answers it is not there to:
 * it never was registered, or the browser dropped it. The text of what was shared is in the body of this request, and this does not read it — it was never ours
 * to have — and sends the person on to «Anotá algo» to paste it, with a word that it did not arrive. (With the worker active, this is not reached at all: the
 * request is answered inside the phone.)
 *
 * Only exists while «Anotá algo» is switched on in the build; off, there is nothing here.
 */

const GONE = "/anotar?compartido=falta";

// A relative `Location`, which the browser resolves against the address it asked: the server behind a proxy does not know the one it was reached by.
const seeOther = () => new Response(null, { status: 303, headers: { Location: GONE } });
const nothing = () => new Response(null, { status: 404 });

export function POST(): Response {
  return experimentOnServer("note_capture") ? seeOther() : nothing();
}

export function GET(): Response {
  return experimentOnServer("note_capture") ? seeOther() : nothing();
}
