"use client";

import { Checkbox } from "@/components/ui";
import { useAiAvailability } from "@/lib/ai/availability";
import type { StoredProfile } from "@/lib/schemas/profile-v2";
import { updateStoredProfile } from "@/lib/storage/local";

/**
 * «Que mi IA elija la próxima pregunta»: an experiment, off for everyone, for the questions.
 *
 * Offered only to whoever has a key of their own — it is the one thing here that sends a person's own words to a model *about
 * which question to ask*, and it is not worth a line to someone who could not use it. Said in the words of what it does and what it
 * does not: the model picks among our fixed questions and writes nothing, what they answered goes to their own provider with the
 * details the product does not use struck out first, and with it off nothing changes. It is the person's own choice, kept in their
 * profile, and it is also what the local counters (`followup_ai_*`) are about, if they want to see whether it did anything for them.
 */
export function AiFollowUpToggle({ profile }: { profile: StoredProfile }) {
  const ai = useAiAvailability();
  if (!ai?.byok) return null;
  return (
    <div className="space-y-1.5 border-t border-rule pt-4 text-sm text-ink-2" data-ai-follow-up>
      <Checkbox
        checked={Boolean(profile.onboarding.aiFollowUp)}
        onChange={(event) =>
          updateStoredProfile((draft) => {
            if (event.target.checked) draft.onboarding.aiFollowUp = true;
            else delete draft.onboarding.aiFollowUp;
          })
        }
        label="Que mi IA elija la próxima pregunta (experimento)"
      />
      <p className="text-xs text-ink-3">
        Después de cada respuesta, tu IA elige cuál de nuestras preguntas fijas sigue, o ninguna. No escribe nada por vos. Lo que contestaste va a tu proveedor, sin los datos
        personales que no usamos. Si lo dejás apagado, nada cambia.
      </p>
    </div>
  );
}
