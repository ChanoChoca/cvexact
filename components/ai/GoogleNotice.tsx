"use client";

import { useState } from "react";
import { Alert } from "@/components/ui";
import {
  GOOGLE_EUROPE,
  GOOGLE_FREE_FACTS,
  GOOGLE_PAID_FACTS,
  GOOGLE_TERMS_IN_FORCE,
  GOOGLE_TERMS_URL,
  UNDER_EIGHTEEN,
  WHAT_WE_DO,
} from "@/lib/ai/google-terms";

/**
 * What Google says of its free tier, said where a Google key is made or pasted (`lib/ai/google-terms.ts` has the sentences, and the ones of the
 * terms they come from). Three places: the guided setup, before the steps; the row of Ajustes where a key of Google's is kept; and the photo
 * of a CV, which is the one reading that cannot have anything taken out of it first.
 *
 * It says what Google says, to the person it is about, and what this product does and does not do about it. It does not say what to choose:
 * the ways out come next to it as equal choices (`ByokSetup`), and none of them is a nudge.
 *
 * It is read before a key is made, so it is short where it matters: what Google asks of whoever uses the key —18 years, nothing personal— comes first, then what it does with
 * what is sent, each in the sentence of the terms it comes from, and the rest —what this product does about it, who Google treats differently, the day of the terms— is
 * one tap away under «Qué mandamos y qué no». Where the key already exists the notice folds into a line (`GoogleRowNotice`): the same words, said once.
 */

const LINK = "underline decoration-current/40 underline-offset-4 hover:decoration-current pointer-coarse:-my-3 pointer-coarse:inline-block pointer-coarse:py-3";

/** The link to the terms, to read what Google wrote and not what is said of it. */
export function GoogleTermsLink() {
  return (
    <a href={GOOGLE_TERMS_URL} target="_blank" rel="noopener noreferrer" className={LINK}>
      Ver los términos de Google ↗
    </a>
  );
}

/** What Google asks of whoever uses the free tier comes before what it does with what is sent: the order of what a person needs to know to decide, and not the terms'. */
const ASKS_FIRST: readonly string[] = ["adults", "personal"];
const rank = (id: string) => {
  const at = ASKS_FIRST.indexOf(id);
  return at === -1 ? ASKS_FIRST.length : at;
};
const FREE_FACTS_IN_ORDER = [...GOOGLE_FREE_FACTS].sort((a, b) => rank(a.id) - rank(b.id));

/** The summary of a fold inside a notice: a line to tap, with the arrow turned when it is open. A named group, because notices sit inside other folds. */
const FOLD_SUMMARY = "flex cursor-pointer list-none items-center gap-2 pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden";

/**
 * What the free tier asks and does, one thing each, in Google's sentences. For whoever is about to make the key (`underEighteen`), the one who is not yet of age is told
 * in the same line what to do: not to activate it, and that nothing here needs it.
 */
function FreeFacts({ underEighteen = false }: { underEighteen?: boolean }) {
  return (
    <ul className="mt-2 list-disc space-y-1 pl-5" data-google-facts>
      {FREE_FACTS_IN_ORDER.map((fact) => (
        <li key={fact.id}>
          {fact.says}
          {underEighteen && fact.id === "adults" ? ` ${UNDER_EIGHTEEN}` : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Before the steps of the guided setup: what the free tier asks and does, in Google's sentences, and the link to read them where they are written. What this product does about
 * them, who Google treats differently and the day the terms came into force are one tap away, so that what is read before deciding is read.
 */
export function GoogleSetupNotice() {
  return (
    <Alert tone="warn" title="Antes de usar la key gratuita de Google">
      <div className="space-y-3 text-[13.5px] leading-relaxed" data-google-notice="setup">
        <p>Según los términos de la API de Gemini, en su nivel gratuito:</p>
        <FreeFacts underEighteen />
        <p>
          <GoogleTermsLink />
        </p>
        <details className="group/fold border-t border-current/20 pt-1" data-google-fold>
          <summary className={FOLD_SUMMARY}>
            <span aria-hidden className="inline-block transition-transform group-open/fold:rotate-90 motion-reduce:transition-none">
              ▸
            </span>
            <span className="underline decoration-current/40 underline-offset-4">Qué mandamos y qué no</span>
          </summary>
          <div className="mt-2 space-y-2">
            <p>
              {WHAT_WE_DO.masked} {WHAT_WE_DO.travels}
            </p>
            <p>{GOOGLE_EUROPE.says}</p>
            <p>Los términos que leímos están en vigencia desde el {GOOGLE_TERMS_IN_FORCE}.</p>
          </div>
        </details>
      </div>
    </Alert>
  );
}

/**
 * In the row of Ajustes where a Google key is kept, whichever tier it is: the person made it and knows, and it says what changes with the other. Where the notice was already
 * read —the guided setup above it, or a key that is already in the row— it is a line that opens (`startFolded`): the same words, and not a second box of them. Read once, when it
 * appears: a notice that folds as the key is pasted under it would move the field the person is pasting in.
 */
export function GoogleRowNotice({ startFolded = false }: { startFolded?: boolean }) {
  const [folded] = useState(startFolded);
  const notice = (
    <Alert tone="warn" title="Sobre las condiciones de Google">
      <div className="space-y-2 text-[13px] leading-relaxed" data-google-notice="row">
        <p>
          Si tu key es del nivel gratuito (la que se arma sin tarjeta en Google AI Studio), según los términos de la API de Gemini, en vigencia desde el{" "}
          {GOOGLE_TERMS_IN_FORCE}:
        </p>
        <FreeFacts />
        <p>
          Con una key del nivel pago eso cambia: {GOOGLE_PAID_FACTS[0].says} {GOOGLE_PAID_FACTS[1].says}
        </p>
        <p>
          {WHAT_WE_DO.masked} {WHAT_WE_DO.travels}
        </p>
        <p>
          <GoogleTermsLink />
        </p>
      </div>
    </Alert>
  );
  if (!folded) return notice;
  return (
    <details className="group/fold border border-rule px-4 text-sm text-ink-2" data-google-notice-folded>
      <summary className={`${FOLD_SUMMARY} justify-between gap-3 py-2`}>
        <span>Condiciones de Google</span>
        <span className="underline decoration-current/40 underline-offset-4">
          <span className="group-open/fold:hidden">Ver las condiciones</span>
          <span className="hidden group-open/fold:inline">Ocultar las condiciones</span>
        </span>
      </summary>
      <div className="pt-1 pb-3">{notice}</div>
    </details>
  );
}

/** Over the button that reads a photo, for whoever has a key of Google's: the photo goes whole, and what Google says of what it is sent. */
export function GooglePhotoNotice() {
  return (
    <Alert tone="warn" title="Una de tus keys es de Google">
      <div className="space-y-2 text-[13px] leading-relaxed" data-google-notice="photo">
        <p>
          Una foto de un CV va entera, con todo lo que se ve —tu nombre, tu contacto, tu documento— y no podemos taparlo antes. Si tu key es del nivel
          gratuito, según los términos de la API de Gemini Google usa lo que le mandás para mejorar sus productos, personas suyas pueden leerlo y pide no
          mandar información personal. Con una key del nivel pago, Google dice que no lo usa para mejorar sus productos.
        </p>
        <p>
          Si preferís, copiá el texto de la foto y pegalo: de ese texto sí tapamos tu nombre y tu contacto antes de leerlo con tu IA.{" "}
          <GoogleTermsLink />
        </p>
      </div>
    </Alert>
  );
}
