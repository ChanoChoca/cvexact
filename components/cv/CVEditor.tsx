"use client";

import { useEffect, useRef } from "react";
import { Alert, Button, Card, Input, SectionTitle, Textarea } from "@/components/ui";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import {
  canMoveSection,
  moveSection,
  removalCost,
  removeActivity,
  removeItem,
  removeItemBullet,
  removePair,
  removeProject,
  removeSection,
  removeSectionBullet,
  setActivity,
  setItemBullet,
  setPair,
  setProject,
  setRole,
  setSectionBullet,
  setSectionTitle,
  setSummary,
} from "@/lib/cv/edit";
import { profileJobFor } from "@/lib/cv/invented";
import type { CVDocument } from "@/lib/schemas/cv";
import type { Profile } from "@/lib/schemas/profile";

/**
 * Hand-editing of a generated CV, beside the preview.
 *
 * `components/cv/CVDocument.tsx` is deliberately not involved: it is the
 * printable document, its CSS is a transcription of `public/plantilla-cv.html`,
 * and `lib/docx/cv-docx.ts` is written against the same structure. Putting
 * inputs inside it would make all three answer to the editor. So this is a
 * separate panel over the same data, and the preview simply re-renders.
 *
 * Every control writes through `lib/cv/edit.ts` and the parent commits. Nothing
 * here validates or normalises — `commit` does both, in one place.
 *
 * Open/closed is the parent's state, not this component's: the button that
 * opens it belongs in the row of actions above the preview, beside the two
 * downloads, and a trigger cannot live outside the component that owns the flag.
 */

/** Section headings other than `pairs` are fixed by the template. */
const EDITABLE_TITLE = new Set(["pairs"]);

function Row({
  value,
  rows = 2,
  onChange,
  onRemove,
  removeWarning,
}: {
  value: string;
  rows?: number;
  onChange: (text: string) => void;
  onRemove: () => void;
  removeWarning?: string;
}) {
  const confirm = useConfirm();
  return (
    <div className="flex items-start gap-2">
      <Textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1"
      />
      <Button
        variant="ghost"
        className="px-2 py-1 text-xs"
        title={removeWarning ?? "Quitar esta línea"}
        onClick={async () => {
          if (removeWarning && !(await confirm(removeWarning))) return;
          onRemove();
        }}
      >
        Quitar
      </Button>
    </div>
  );
}

/** What the profile says of a job, to compare a rewritten line with the words it came from. */
function WhatYouWrote({ lines }: { lines: readonly string[] }) {
  if (lines.length === 0) return null;
  return (
    <details className="text-sm text-ink-3">
      <summary className="cursor-pointer underline decoration-white/20 underline-offset-4 hover:text-ink">Lo que escribiste</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {lines.map((line, at) => (
          <li key={at}>{line}</li>
        ))}
      </ul>
    </details>
  );
}

export function CVEditor({
  cv,
  onChange,
  onRestore,
  edited,
  error,
  open,
  onClose,
  profile,
}: {
  cv: CVDocument;
  onChange: (next: CVDocument) => void;
  /** Puts the generated CV back. Absent when nothing has been edited yet. */
  onRestore?: () => void;
  edited: boolean;
  /** What `commit` refused, when the last edit did not validate. */
  error?: string | null;
  open: boolean;
  onClose: () => void;
  /** The profile the CV was made from, for what each job says in it: shown beside the job to compare with, never edited here. */
  profile?: Profile;
}) {
  const confirm = useConfirm();
  const containerRef = useRef<HTMLDivElement>(null);
  /** Where focus was before this opened, so closing hands it back rather
   * than dropping it wherever the DOM happens to have left it. */
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      previouslyFocused.current = document.activeElement as HTMLElement | null;
      containerRef.current?.focus();
    } else {
      previouslyFocused.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const removalNote = (index: number) => {
    const cost = removalCost(cv, index);
    return cost?.removesSection
      ? `Si quitás esto la sección «${cv.sections[index]?.title}» desaparece del CV. ¿Seguro?`
      : undefined;
  };

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-label="Editar el CV a mano"
      tabIndex={-1}
      className="focus:outline-none"
    >
      <Card>
        <SectionTitle
          action={
            <div className="flex gap-2">
              {edited && onRestore ? (
                <Button variant="ghost" className="px-2 py-1 text-xs" onClick={onRestore}>
                  Restaurar el generado
                </Button>
              ) : null}
              <Button variant="ghost" className="px-2 py-1 text-xs" onClick={onClose}>
                Cerrar
              </Button>
            </div>
          }
        >
          Editar el CV
        </SectionTitle>

        <p className="mb-4 text-sm text-ink-2">
          Los cambios se ven en la vista previa y se guardan solos. Los títulos de experiencia,
          educación, proyectos y skills los fija la plantilla, así que no se editan.
        </p>

        {error ? (
          <div className="mb-4">
            <Alert tone="bad">{error} El último cambio no se guardó.</Alert>
          </div>
        ) : null}

        <div className="space-y-6">
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink-2">Resumen</p>
            <Textarea
              rows={4}
              value={cv.summary}
              onChange={(e) => onChange(setSummary(cv, e.target.value))}
            />
          </div>

          {cv.sections.map((section, index) => (
            <div key={index} className="border-t border-rule pt-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                {EDITABLE_TITLE.has(section.kind) ? (
                  <Input
                    value={section.title}
                    onChange={(e) => onChange(setSectionTitle(cv, index, e.target.value))}
                    className="w-full sm:max-w-xs text-sm font-medium"
                  />
                ) : (
                  <p className="text-sm font-medium text-ink-2">{section.title}</p>
                )}

                <div className="flex gap-1">
                  {/* `pairs` has no arrows: the schema puts it last on every parse. */}
                  {section.kind !== "pairs" ? (
                    <>
                      <Button
                        variant="ghost"
                        className="px-2 py-1 text-xs"
                        disabled={!canMoveSection(cv, index, -1)}
                        onClick={() => onChange(moveSection(cv, index, -1))}
                      >
                        ↑
                      </Button>
                      <Button
                        variant="ghost"
                        className="px-2 py-1 text-xs"
                        disabled={!canMoveSection(cv, index, 1)}
                        onClick={() => onChange(moveSection(cv, index, 1))}
                      >
                        ↓
                      </Button>
                    </>
                  ) : null}
                  <Button
                    variant="ghost"
                    className="px-2 py-1 text-xs"
                    onClick={async () => {
                      if (!(await confirm(`¿Quitar la sección «${section.title}» del CV?`))) return;
                      onChange(removeSection(cv, index));
                    }}
                  >
                    Quitar sección
                  </Button>
                </div>
              </div>

              {section.kind === "experience"
                ? section.items.map((item, i) => (
                    <div key={i} className="mb-4 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm text-ink-3">{item.company}</span>
                        <Input
                          value={item.role}
                          onChange={(e) => onChange(setRole(cv, index, i, e.target.value))}
                          className="w-full sm:max-w-xs text-sm"
                        />
                        <Button
                          variant="ghost"
                          className="px-2 py-1 text-xs"
                          onClick={async () => {
                            const note = removalNote(index);
                            if (note && !(await confirm(note))) return;
                            onChange(removeItem(cv, index, i));
                          }}
                        >
                          Quitar puesto
                        </Button>
                      </div>
                      {/* Dates and place are the profile's (`withProfileHistory`): said here so nobody looks for the box. */}
                      {item.dateRange || item.location ? (
                        <p className="text-xs text-ink-3">
                          {[item.dateRange, item.location].filter(Boolean).join(" · ")} — se toman de tu perfil.
                        </p>
                      ) : null}
                      {item.bullets.map((bullet, b) => (
                        <Row
                          key={b}
                          value={bullet}
                          onChange={(text) => onChange(setItemBullet(cv, index, i, b, text))}
                          onRemove={() => onChange(removeItemBullet(cv, index, i, b))}
                        />
                      ))}
                      <WhatYouWrote lines={(profile && profileJobFor(item.company, profile)?.bullets) || []} />
                    </div>
                  ))
                : null}

              {section.kind === "bullets"
                ? section.bullets.map((bullet, b) => (
                    <Row
                      key={b}
                      value={bullet}
                      onChange={(text) => onChange(setSectionBullet(cv, index, b, text))}
                      onRemove={() => onChange(removeSectionBullet(cv, index, b))}
                      removeWarning={removalNote(index)}
                    />
                  ))
                : null}

              {section.kind === "pairs"
                ? section.items.map((item, i) => (
                    <div key={i} className="mb-2 flex flex-wrap items-center gap-2">
                      <Input
                        value={item.label}
                        onChange={(e) => onChange(setPair(cv, index, i, { label: e.target.value }))}
                        className="w-full sm:max-w-40 text-sm"
                      />
                      <Input
                        value={item.value}
                        onChange={(e) => onChange(setPair(cv, index, i, { value: e.target.value }))}
                        className="flex-1 text-sm"
                      />
                      <Button
                        variant="ghost"
                        className="px-2 py-1 text-xs"
                        onClick={() => onChange(removePair(cv, index, i))}
                      >
                        Quitar
                      </Button>
                    </div>
                  ))
                : null}

              {section.kind === "projects"
                ? section.items.map((item, i) => (
                    <div key={i} className="mb-4 space-y-2">
                      <span className="text-sm text-ink-3">{item.name}</span>
                      <Row
                        value={item.description}
                        onChange={(text) => onChange(setProject(cv, index, i, text))}
                        onRemove={() => onChange(removeProject(cv, index, i))}
                        removeWarning={removalNote(index)}
                      />
                    </div>
                  ))
                : null}

              {section.kind === "activities"
                ? section.items.map((item, i) => (
                    <Row
                      key={i}
                      value={item.text}
                      onChange={(text) => onChange(setActivity(cv, index, i, text))}
                      onRemove={() => onChange(removeActivity(cv, index, i))}
                      removeWarning={removalNote(index)}
                    />
                  ))
                : null}

              {section.kind === "projects" ? (
                <p className="text-sm text-ink-3">
                  El nombre y el enlace de cada proyecto salen del perfil. Editalos ahí y volvé a generar.
                </p>
              ) : null}

              {section.kind === "education" ? (
                <p className="text-sm text-ink-3">
                  Los datos de tu formación salen del perfil. Editalos ahí y volvé a generar.
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
