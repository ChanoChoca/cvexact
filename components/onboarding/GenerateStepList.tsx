import { GENERATE_STEPS } from "@/components/wizard/postular-tour";

/** The three things it takes to have a CV for an offer, numbered: said by «Tu perfil está listo» and by the card the profile offers after the first reading. */
export function GenerateStepList() {
  return (
    <ol className="space-y-4" aria-label="Para tener un CV a medida de un aviso">
      {GENERATE_STEPS.map((step, index) => (
        <li key={step.title} className="flex items-start gap-4">
          <span aria-hidden className="font-solar flex size-8 shrink-0 items-center justify-center border border-rule text-sm font-bold text-ink-2">
            {index + 1}
          </span>
          <div>
            <p className="text-[16px] text-ink">{step.title}</p>
            <p className="text-sm text-ink-2">{step.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
