"use client";

import { useId } from "react";
import { Button } from "@/components/ui";
import type { Correction, CorrectionKind } from "@/lib/cv/corrections";

/**
 * The card of what the person changed by hand in a CV that the profile does not say (O11): one card, after the editing and never during it, and for each
 * thing the same three answers with the same weight — «Guardar en el perfil», «Solo en este CV», «Era un error» —, because none of them is the one to
 * push towards: a number written «para esta oferta» is exactly what must not be made true by being asked. Each says where it goes before it is chosen.
 */

const KIND: Record<CorrectionKind, { label: string; saves: string }> = {
  tool: { label: "Herramienta", saves: "Si la guardás, queda entre tus habilidades." },
  credential: { label: "Credencial", saves: "Si la guardás, queda entre tus certificaciones." },
  figure: { label: "Cifra", saves: "Si la guardás, te preguntamos de dónde sale y queda en tu perfil." },
  role: { label: "Puesto", saves: "Si lo guardás, queda como un desacuerdo para que lo revises en tu perfil: no cambia el puesto que tenés." },
};

const things = (count: number): string => (count === 1 ? "1 cosa" : `${count} cosas`);

/** «En este CV agregaste 2 cosas que tu perfil no tiene.» — and, for a title that the profile says another way, what changed. A count of what they did and nothing about what it is worth. */
export function correctionsTitle(list: readonly Pick<Correction, "kind">[]): string {
  const changed = list.filter((entry) => entry.kind === "role").length;
  const added = list.length - changed;
  if (added > 0 && changed > 0) return `En este CV agregaste ${things(added)} que tu perfil no tiene y cambiaste ${things(changed)} que tu perfil dice distinto.`;
  if (changed > 0) return `En este CV cambiaste ${things(changed)} que tu perfil dice distinto.`;
  return `En este CV agregaste ${things(added)} que tu perfil no tiene.`;
}

export function CorrectionsCard({
  corrections,
  canSave,
  onSave,
  onHere,
  onMistake,
  problem,
}: {
  corrections: readonly Correction[];
  /** Whether «Guardar en el perfil» can be done now: a number is saved by being asked about, and that needs a job to ask about. */
  canSave: (correction: Correction) => boolean;
  onSave: (correction: Correction) => void;
  onHere: (correction: Correction) => void;
  onMistake: (correction: Correction) => void;
  /** What could not be done, said where it was asked for. */
  problem?: { key: string; message: string } | null;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} data-corrections className="space-y-4 border border-rule bg-paper-2 p-5 sm:p-6">
      <p className="font-solar text-[12.5px] font-bold tracking-[0.18em] text-ink-3 uppercase">Lo que cambiaste a mano</p>
      <h2 id={headingId} className="text-[19px] leading-snug text-ink">
        {correctionsTitle(corrections)}
      </h2>
      <ul className="space-y-5">
        {corrections.map((correction) => (
          <li key={correction.key} data-correction={correction.kind} className="space-y-2">
            <p className="text-[15px] text-ink">
              <span className="mr-2 font-solar text-[12.5px] font-bold tracking-[0.18em] text-ink-3 uppercase">{KIND[correction.kind].label}</span>
              {correction.text}
              {correction.kind === "credential" && correction.value ? <span className="text-ink-3"> · {correction.value}</span> : null}
            </p>
            {correction.against ? <p className="text-sm text-ink-3">Tu perfil dice «{correction.against.current}».</p> : null}
            <blockquote className="border-l-2 border-oro-soft pl-3 text-[14.5px] leading-snug wrap-break-word text-ink-2">{correction.line}</blockquote>
            <div className="flex flex-wrap gap-2">
              {canSave(correction) ? (
                <Button variant="secondary" onClick={() => onSave(correction)}>
                  Guardar en el perfil
                </Button>
              ) : null}
              <Button variant="secondary" onClick={() => onHere(correction)}>
                Solo en este CV
              </Button>
              <Button variant="secondary" onClick={() => onMistake(correction)}>
                Era un error
              </Button>
            </div>
            {canSave(correction) ? <p className="text-sm text-ink-3">{KIND[correction.kind].saves}</p> : null}
            {problem?.key === correction.key ? (
              <p role="alert" className="text-sm text-ink-2">
                {problem.message}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="text-sm text-ink-3">Lo que dejes solo en este CV no cambia tu perfil, y no se vuelve a preguntar para este CV.</p>
    </section>
  );
}
