"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui";
import { AiKeyPrompt } from "@/components/ai/AiKeyPrompt";
import { TOUR_HREF } from "@/components/wizard/postular-tour";
import { useAiAvailability } from "@/lib/ai/availability";
import { readReceipts } from "@/lib/onboarding/review";
import type { StoredProfile } from "@/lib/schemas/profile-v2";
import { useWithoutAi } from "@/lib/storage/ai-choice";
import { GenerateStepList } from "./GenerateStepList";
import { StepShell } from "./StepShell";

/**
 * S5: the profile is ready, and what to do with it. It says what was read when something was —one line per document, as the review said it— and then the
 * three things it takes to have a CV for an offer, and that the model that writes it needs a key (`AiKeyPrompt`), before it is asked for in Postular.
 *
 * Both ways on leave the flow: «Guiame paso a paso» to Postular with its tour on (`postular-tour.ts`), «Lo hago yo» to the profile. After a document they show from the start —the tour
 * asks for the key at its second step when there is none—; after the profile was built by hand they wait for there to be an AI (`Ways`). Keeping the profile (an account, a copy) is not asked here: it is
 * in the buttons of the profile and in «Mis datos» in Ajustes, and not a condition of having seen this.
 */
export function FirstValueStep({ profile, onFinish }: { profile: StoredProfile; onFinish: (to: typeof TOUR_HREF | "/perfil") => void }) {
  const receipts = readReceipts(profile);

  return (
    <StepShell
      title="Tu perfil está listo"
      intro={
        receipts.length > 0 ? (
          <>
            {receipts.map((receipt) => (
              <span key={receipt.sourceId} className="block">
                Leímos «{receipt.name}»: {receipt.text}.
              </span>
            ))}
          </>
        ) : undefined
      }
    >
      <GenerateStepList />

      {/* What the CV for an offer needs, said before it is asked for: it is written by a model, and the model needs a key. */}
      <AiKeyPrompt>Para armar el CV de cada aviso necesitás una key.</AiKeyPrompt>

      <Ways waitForAi={profile.sources.length === 0}>
        <Button onClick={() => onFinish(TOUR_HREF)}>Guiame paso a paso</Button>
        <Button variant="secondary" onClick={() => onFinish("/perfil")}>
          Lo hago yo
        </Button>
      </Ways>
    </StepShell>
  );
}

/**
 * The ways on. With `waitForAi` —nothing was read, the profile was built by hand— they are not there until the CV for an offer can be written: a key of the person's own or a plan that
 * includes the AI. «Sigo sin IA» is an answer too, and leaves them: the profile and its CV work without one. While the server has not said (`ai` is null) they are not there either, so that
 * they do not come and go.
 * shortcut: a server that never answers leaves a key-less person here with the navigation bar as the only way out; upgrade: a longest wait.
 */
function Ways({ waitForAi, children }: { waitForAi: boolean; children: ReactNode }) {
  const ai = useAiAvailability();
  const withoutAi = useWithoutAi();
  if (waitForAi && !withoutAi && (!ai || ai.tone === "bad")) return null;
  return <div className="flex flex-wrap items-center gap-3">{children}</div>;
}
