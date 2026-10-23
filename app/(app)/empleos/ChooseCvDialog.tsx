"use client";

import { Modal } from "@/components/ui/Modal";
import type { Application } from "@/lib/storage/local";

/**
 * "Ya me postulé" encontró más de un CV local que podría corresponder al
 * aviso — el único caso en el que ese botón para a pedir algo antes de
 * crear la postulación. Nunca bloquea: "Ninguno de estos" sigue creando la
 * postulación, sin CV vinculado.
 */
export function ChooseCvDialog({
  matches,
  onChoose,
  onSkip,
}: {
  matches: Application[];
  onChoose: (application: Application) => void;
  onSkip: () => void;
}) {
  return (
    <Modal open onClose={onSkip} labelledBy="choose-cv-title" className="max-w-md p-5">
      <p id="choose-cv-title" className="mb-3 font-solar text-[12.5px] font-bold tracking-[0.18em] text-ink-3 uppercase">
        ¿Cuál CV usaste?
      </p>
      <ul className="space-y-2">
        {matches.map((application) => (
          <li key={application.id}>
            <button
              type="button"
              onClick={() => onChoose(application)}
              className="w-full border border-rule px-3 py-2 text-left text-sm text-ink-2 hover:bg-paper-2 hover:text-ink"
            >
              {application.label || application.analysis?.title || "Sin título"}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onSkip} className="mt-3 text-sm text-ink-3 hover:text-ink">
        Ninguno de estos
      </button>
    </Modal>
  );
}
