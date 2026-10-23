"use client";

import { useState } from "react";
import { Button, ButtonLink } from "@/components/ui";
import { GenerateStepList } from "@/components/onboarding/GenerateStepList";
import { TOUR_HREF, TOUR_PARAM } from "@/components/wizard/postular-tour";

/**
 * What a first reading with something marked offers, once: the way to a CV for an offer. «Tu perfil está listo» is where a clean reading is told this; a marked one goes straight to the profile,
 * which is where what is marked is looked at, so it is told here, over the sections. «Guiame paso a paso» is the tour of Postular (`postular-tour.ts`); «Ahora no» puts the card away and takes `guia`
 * out of the address, so that a reload does not offer it again.
 */
export function FirstCvCard() {
  const [shown, setShown] = useState(true);
  if (!shown) return null;

  const dismiss = () => {
    setShown(false);
    const url = new URL(window.location.href);
    url.searchParams.delete(TOUR_PARAM);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  };

  return (
    <section aria-labelledby="first-cv-title" className="space-y-4 border border-rule bg-paper-2 p-5">
      <h2 id="first-cv-title" className="font-solar text-[12.5px] font-bold tracking-[0.18em] text-ink-3 uppercase">
        Armá tu primer CV
      </h2>
      <p className="text-sm text-ink-2">
        Con lo que leímos ya podés armar un CV para un aviso. Lo que quedó «Para revisar» lo mirás cuando quieras: Postular te avisa si el CV lo usa.
      </p>
      <GenerateStepList />
      <div className="flex flex-wrap items-center gap-3">
        <ButtonLink href={TOUR_HREF}>Guiame paso a paso</ButtonLink>
        <Button variant="secondary" onClick={dismiss}>
          Ahora no
        </Button>
      </div>
    </section>
  );
}
