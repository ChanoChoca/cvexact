"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Alert, Button } from "@/components/ui";
import type { InventedFigure } from "@/lib/ai/verify";
import { roleForField, withoutFigureLine } from "@/lib/cv/invented";
import type { CVDocument } from "@/lib/schemas/cv";
import type { Profile } from "@/lib/schemas/profile";

/** A line, as much of it as is needed to know which one it is. */
const LINE_MAX = 140;
const shortLine = (line: string) => (line.length > LINE_MAX ? `${line.slice(0, LINE_MAX - 1).trimEnd()}…` : line);

/**
 * The numbers a CV says that the profile does not (`inventedFigures`), each with the two things that can be done about it.
 *
 * A figure is the one thing on a CV that is asked about at the interview, and the one the model is told never to make up. When
 * it does, this says which — in the line it is in — and does not leave it as a sentence to act on by hand: if the number is
 * real, it is asked for where every figure is (a question about that job, the one that already puts it in the profile with where
 * it came from), and if it is not, its line comes out of the CV, which can be taken back (`Restaurar`). A line that cannot come
 * out without taking more with it — all of the summary, a list that would lose its section — is left to the editor.
 *
 * Nothing here writes the profile: a figure goes in only when the person gives it.
 */
export function InventedFigures({
  cv,
  profile,
  invented,
  now,
  canAsk,
  onAsk,
  onEdit,
}: {
  cv: CVDocument;
  profile: Profile;
  invented: readonly InventedFigure[];
  now: Date;
  /** Whether a question about that job can be asked: the engine has something left to ask it. */
  canAsk: (roleId: string) => boolean;
  /** «Es real»: ask about that job, for that figure. */
  onAsk: (roleId: string, figure: string) => void;
  /** «Quitar»: the CV, without that line. */
  onEdit: (next: CVDocument) => void;
}) {
  const items = useMemo(
    () =>
      invented.map((found) => ({
        found,
        roleId: roleForField(cv, profile, found.field, now),
        without: withoutFigureLine(cv, found.field, found.figure),
      })),
    [cv, profile, invented, now],
  );
  if (items.length === 0) return null;

  return (
    <Alert tone="bad" title={items.length === 1 ? "1 cifra de este CV no figura en tu perfil" : `${items.length} cifras de este CV no figuran en tu perfil`}>
      <p className="text-xs">Un número que no cargaste vos es lo primero que se pregunta en una entrevista. Si es real, cargalo; si no, sacalo.</p>
      <ul className="mt-3 space-y-3">
        {items.map(({ found, roleId, without }) => (
          <li key={`${found.field}|${found.figure}`}>
            <p>
              El CV dice <span className="font-semibold text-ink">«{found.raw}»</span> en: «{shortLine(found.line)}»
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {roleId && canAsk(roleId) ? (
                <Button type="button" variant="secondary" compact onClick={() => onAsk(roleId, found.raw)}>
                  Es real: cargarla en mi perfil
                </Button>
              ) : (
                // Nothing left to ask about that job — or no job to name: where to put it is the profile's own page, at its jobs.
                <Link href="/perfil#experiencia" className="inline-flex items-center text-xs underline underline-offset-4 hover:text-ink pointer-coarse:min-h-11">
                  Es real: cargarla en mi perfil
                </Link>
              )}
              {without ? (
                <Button type="button" variant="ghost" compact onClick={() => onEdit(without)}>
                  {found.field === "summary" ? "Quitar esa frase" : "Quitar esa línea"}
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </Alert>
  );
}
