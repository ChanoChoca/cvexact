"use client";

import type { Sheets } from "@/lib/cv/sheets";

/**
 * «Permitir 2 hojas»: the one place the person says how many sheets this CV may take.
 *
 * One is the promise and the default. The choice is offered only to a career of ten years or more (`canAllowTwoSheets`) — and to
 * whoever already took it, so that going back is always one tap — and it is theirs: nothing here, in the prompt or in the fit, chooses it
 * for them. It changes what the page is judged against and what «Generar otra versión» is told to write; it does not rewrite the CV on
 * screen.
 */
export function SheetsControl({ sheets, offered, onChange }: { sheets: Sheets; offered: boolean; onChange: (sheets: Sheets) => void }) {
  if (sheets === 1 && !offered) return null;
  const two = sheets === 2;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2" data-sheets={sheets}>
      <p className="max-w-prose">
        {two
          ? "Tu CV puede ocupar 2 hojas. «Generar otra versión» lo escribe con más de lo que hiciste."
          : "Tus fechas llegan a 10 años de trabajo o más: si lo necesitás, el CV puede ocupar 2 hojas."}
      </p>
      <button type="button" onClick={() => onChange(two ? 1 : 2)} className="underline underline-offset-4 hover:text-ink">
        {two ? "Volver a 1 hoja" : "Permitir 2 hojas"}
      </button>
    </div>
  );
}
