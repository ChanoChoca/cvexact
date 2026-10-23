"use client";

import { Button } from "@/components/ui";
import { saveBuilder } from "@/lib/onboarding/resume";
import { updateStoredProfile } from "@/lib/storage/local";

/**
 * A profile with nothing in it: for someone who chose "Ir a mi perfil vacío" at the start, or who
 * took everything out. Under it are six empty sections, and a blank form is the hardest place
 * to begin from — this says where to, three ways, none of which asks them to fill in everything.
 *
 * The first two take up the first-run flow again where it would have been: marking it not done
 * is all it takes, because the profile page sends a profile nobody has begun back to it. The third
 * is on this page: `onAddJob` opens the form of the experience section, with the cursor in it.
 */
export function EmptyProfile({ onAddJob }: { onAddJob: () => void }) {
  const restart = (step: "start" | "steps") =>
    updateStoredProfile((draft) => {
      draft.onboarding.done = false;
      draft.onboarding.step = step;
      if (step === "steps") {
        draft.onboarding.route = "scratch";
        // From the first part, not from the one a profile since emptied was left on.
        saveBuilder(draft, 0);
      }
    });

  return (
    <section aria-labelledby="empty-title" className="space-y-4 border border-rule bg-paper-2 p-5">
      <div className="space-y-1">
        <h2 id="empty-title" className="text-[17px] text-ink">
          Tu perfil está vacío
        </h2>
        <p className="text-sm text-ink-2">Podés empezar de tres formas. Ninguna te obliga a cargarlo todo hoy.</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => restart("start")}>Subir mi CV o mi LinkedIn</Button>
        <Button variant="secondary" onClick={() => restart("steps")}>
          Que me guíen paso a paso
        </Button>
        <Button variant="secondary" onClick={onAddJob}>
          Agregar un trabajo
        </Button>
      </div>
    </section>
  );
}
