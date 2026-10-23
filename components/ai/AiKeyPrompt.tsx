"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { AiStatus } from "@/components/ai/AiStatus";
import { ByokSetup } from "@/components/billing/ByokSetup";
import { Alert, Button } from "@/components/ui";
import { useAiAvailability } from "@/lib/ai/availability";
import { useWithoutAi } from "@/lib/storage/ai-choice";

const QUIET_LINK = "underline decoration-white/20 underline-offset-4 hover:text-ink pointer-coarse:-my-3 pointer-coarse:inline-block pointer-coarse:py-3";

/**
 * Whether the IA will work, said before it is asked for — and, when it will not, the way to make it work, right here.
 *
 * The first real barrier of the product is a key, and it used to turn up after the profile was loaded: the button that
 * writes a CV for an offer answers "no hay IA" only once it is pressed, and the screens that promise that CV did not
 * say a key was needed. With a key at hand this is one quiet line (`AiStatus`); without one it says what the key is
 * for and puts the two minutes it takes — Google's key, which is the one it teaches — in the page, instead of sending the
 * person to Ajustes to find the form.
 *
 * It says so when it worked, too: the availability flips the moment the key is saved, and a prompt that vanished then
 * would leave the person with no word that it had.
 *
 * It does not sell what it leads to. The key of Google has conditions —what is sent to its free tier is used by Google, and it is for people of 18 or older—, and the way
 * to them is this button: so what comes before them says that there are conditions, and not that the key is free. And it asks once: whoever said «Sigo sin IA» is not
 * offered the key again at every close of a session (`lib/storage/ai-choice.ts`), only told, in a line, what they can do without one and how to change their mind.
 */
export function AiKeyPrompt({ children, className, cvHere = false }: { children: ReactNode; className?: string | undefined; /** The CV the profile makes is on this page already. */ cvHere?: boolean }) {
  const ai = useAiAvailability();
  const withoutAi = useWithoutAi();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  // Unknown for a few hundred milliseconds while the server answers: nothing, rather than a guess that flips.
  if (!ai) return null;
  if (saved) {
    return (
      <div className={className}>
        <Alert tone="good" title="Listo">
          Ya podés usar la IA sin límite. La key queda guardada en este navegador; si cambiás de celular o de computadora, hay que volver a ponerla.
        </Alert>
      </div>
    );
  }
  if (ai.tone !== "bad") return <AiStatus className={className} />;

  // The two ways of having no AI are what the tour of Postular points at (`data-tour="clave"`) instead of «Generar CV».
  // Said «Sigo sin IA»: not offered again, and not forgotten either — what there is without one, and the way back, in a line.
  if (withoutAi && !open) {
    return (
      <div className={className} data-tour="clave">
        <p className="text-sm text-ink-3" data-ai-declined>
          Seguís sin IA: tu perfil y tu CV base funcionan igual.{" "}
          {cvHere ? null : (
            <>
              <Link href="/perfil#cv-base" className={QUIET_LINK}>
                Bajar mi CV base
              </Link>
              {" · "}
            </>
          )}
          <button type="button" onClick={() => setOpen(true)} className={QUIET_LINK}>
            Armar una key
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className={className} data-tour="clave">
      <Alert tone="info" title="Hace falta una key">
        <p>
          {children} La de Google se arma acá, en dos minutos, y antes te mostramos qué condiciones tiene.
        </p>
        {open ? (
          <div className="mt-4">
            <ByokSetup cvHere={cvHere} onDone={() => setSaved(true)} onCancel={() => setOpen(false)} />
          </div>
        ) : (
          <div className="mt-3">
            <Button variant="secondary" onClick={() => setOpen(true)}>
              Armar mi key
            </Button>
          </div>
        )}
      </Alert>
    </div>
  );
}
