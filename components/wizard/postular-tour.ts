/**
 * The tour of Postular («Guiame»), without React: its four steps, what each one points at, where it stands given what the page shows, and how far to scroll to
 * bring what it points at into sight. The card that says it is `PostularGuide.tsx`; what it points at is a `data-tour` in the wizard.
 */

/** The address «Guiame» leads to: Postular, with the tour on. */
export const TOUR_PARAM = "guia";
export const TOUR_HREF = `/postular?${TOUR_PARAM}=1`;

/**
 * The step the tour is on, kept for the tab. The wizard changes the address when it saves the CV (`/postular?app=…`), which takes `guia` with it, and a reload
 * must not lose the place either.
 */
export const TOUR_KEY = "cvexact.postularTour.v1";

/** What it takes to have a CV for an offer, in the order it is done: what «Tu perfil está listo» and the card of the profile say before the tour is on. */
export const GENERATE_STEPS: ReadonlyArray<{ title: string; detail: string }> = [
  { title: "Pegás el aviso", detail: "En Postular, el aviso al que te querés postular." },
  { title: "Revisás lo que armamos", detail: "Un CV con lo que hay en tu perfil, para que lo mires y lo ajustes." },
  { title: "Lo bajás en PDF o Word", detail: "Cuando te guste cómo quedó." },
];

/** The least a posting can say for the wizard to generate from it (`canGenerate`, `Wizard.tsx`): the first step is done when that much is pasted. */
export const POSTING_MIN = 30;
export const postingIsEnough = (text: string): boolean => text.replace(/\s+/g, " ").trim().length >= POSTING_MIN;

/** One thing a step can point at: the `data-tour` of a part of the page, and what is said about it. */
export type TourStop = {
  target: string;
  title: string;
  text: string;
  /** What stands in place of «Siguiente» while there is nothing yet to go on to. */
  then?: string;
  /** Whether the work of the step is done, on the part it points at: the tour goes on by itself, after a pause, once it is (and the step has no «Siguiente»). */
  ready?: (part: Element) => boolean;
};

/**
 * The four steps, each with what it can point at, in the order it prefers. «Generar CV» points at the key first when one is missing (`AiKeyPrompt`): pressing
 * the button without one answers «no hay IA» only after, and the key is two minutes away.
 */
export const TOUR: ReadonlyArray<ReadonlyArray<TourStop>> = [
  [
    {
      target: "aviso",
      title: "Pegá el aviso",
      text: "Copiá el aviso completo y pegalo acá. Cuanto más texto, mejor se adapta el CV.",
      // «Generar CV» is on the page before anything is pasted, so the next step would be offered at once.
      then: "Seguimos cuando pegues el aviso.",
      ready: (part) => postingIsEnough((part as HTMLTextAreaElement).value ?? ""),
    },
  ],
  [
    {
      target: "clave",
      title: "Primero, una key",
      text: "Hace falta una key para que la IA escriba tu CV. Armala acá: lleva dos minutos.",
      then: "Seguimos cuando la tengas.",
    },
    {
      target: "generar",
      title: "Generá tu CV",
      text: "Apretá «Generar CV». Lo armamos con lo que hay en tu perfil.",
      then: "Seguimos cuando termine de armarse.",
    },
  ],
  [
    {
      target: "revision",
      title: "Revisá lo que armamos",
      text: "Leé el CV completo y fijate que cada dato sea cierto. Si marcamos algo, está arriba.",
    },
  ],
  [
    {
      target: "descargas",
      title: "Bajalo en PDF o Word",
      text: "Cuando te guste cómo quedó. Antes, si querés, lo editás a mano.",
    },
  ],
];

/** Whether the page has a part with this `data-tour`. */
export type Here = (target: string) => boolean;

/** What a step points at right now: the first thing it can point at that is on the page. */
export function stopOf(step: number, here: Here): TourStop | null {
  return TOUR[step - 1]?.find((stop) => here(stop.target)) ?? null;
}

/**
 * Where the tour stands once the page is as it is. Where it was, if that step still has something to point at. If not, on to the next step that has: the CV was
 * just written and the paste box is gone. And over (`null`) if the page went back to before it —a new posting was started—, because the tour goes one way.
 * With nothing at all on the page (it is loading, or the address is changing) it stays where it was.
 */
export function settleStep(step: number, here: Here): number | null {
  if (stopOf(step, here)) return step;
  for (let ahead = step + 1; ahead <= TOUR.length; ahead++) if (stopOf(ahead, here)) return ahead;
  for (let behind = 1; behind < step; behind++) if (stopOf(behind, here)) return null;
  return step;
}

/**
 * How far to scroll (px, down is positive) so that a part of the page stands between `top` and `bottom` —under the bar of the app and over the card—: none if it
 * already does, centred if it fits, and with its top at the top if it is taller than the room there is.
 */
export function revealDelta(rect: { top: number; bottom: number }, top: number, bottom: number): number {
  if (rect.top >= top && rect.bottom <= bottom) return 0;
  const spare = Math.max(0, bottom - top - (rect.bottom - rect.top));
  return Math.round(rect.top - top - spare / 2);
}

/** The step the tab left the tour on, or `null` if it is not on. */
export function loadStep(): number | null {
  try {
    const step = Number(window.sessionStorage.getItem(TOUR_KEY));
    return Number.isInteger(step) && step >= 1 && step <= TOUR.length ? step : null;
  } catch {
    return null;
  }
}

/** Keeps the step for the tab, or forgets it (`null`). A browser that will not keep it has a tour that lasts as long as the page, which is all it needed. */
export function saveStep(step: number | null): void {
  try {
    if (step === null) window.sessionStorage.removeItem(TOUR_KEY);
    else window.sessionStorage.setItem(TOUR_KEY, String(step));
  } catch {
    // The tour goes on, only it will not survive a reload.
  }
}
