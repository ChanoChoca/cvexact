"use client";

import { useId, useState } from "react";
import { Badge, Button, CollapsibleCard, Select, Textarea } from "@/components/ui";
import { EntryFormFields } from "@/components/onboarding/EntryFormFields";
import { ProvenanceBadge } from "@/components/onboarding/ProvenanceBadge";
import { addEntry, blankForm, ENTRY_LABELS, isFilled } from "@/lib/onboarding/entries";
import { needsAttention, removeEducation, settleEducationDoubts } from "@/lib/onboarding/review";
import { editFieldAt, isBlankList } from "@/lib/profile/edit";
import { formatRange, studiesByRecency } from "@/lib/profile/timeline";
import type { StoredEducation, StoredProfile } from "@/lib/schemas/profile-v2";
import { DateCell, LABEL, TextCell, edit, useKept } from "./cells";
import { StudyDoubts } from "./Doubts";
import { EntityCard } from "./EntityCard";
import { BackingNote, EvidenceBlock } from "./EvidenceBlock";
import { ImproveSection } from "./ImproveSection";
import { useRemoval, type OnRemoved } from "./removal";
import { ANCHOR, SECTION_ID } from "@/components/profile/anchors";
import { FoldStatus } from "./ReviewedNote";

const STATUSES = [
  { value: "completed", label: "Completado" },
  { value: "in_progress", label: "En curso" },
  { value: "incomplete", label: "Incompleto" },
] as const;

/**
 * What stands out of a study, one point to a line: subjects or papers, a thesis, a grade. Written here or answered to the question
 * that asks it (`study_highlights`); either way it is the person's words, read by the CV beside the degree.
 */
function HighlightsCell({ entry, path }: { entry: StoredEducation; path: string[] }) {
  const id = useId();
  const [text, setText] = useState(entry.highlights.value.join("\n"));
  return (
    <div className="sm:col-span-2">
      <label htmlFor={id} className={`mb-1 block ${LABEL}`}>
        Destacados
      </label>
      <Textarea
        id={id}
        rows={3}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
          edit((draft) => void editFieldAt(draft, [...path, "highlights"], lines, isBlankList));
          setText(lines.join("\n"));
        }}
      />
      <p className="mt-1 text-xs text-ink-3">Materias o trabajos que te salieron mejor, una tesis, el promedio si querés que se vea: una cosa por línea.</p>
    </div>
  );
}

function EducationCard({ profile, entry, conflicts, onRemoved }: { profile: StoredProfile; entry: StoredEducation; conflicts: StoredProfile["conflicts"]; onRemoved: OnRemoved }) {
  const remove = useRemoval(onRemoved);
  const at = ["education", entry.id];
  // Changing a field by hand puts right the doubts it was about, and with the last one the study needs no «Está bien».
  const settle = (draft: StoredProfile) => void settleEducationDoubts(draft, entry.id);
  // With the profile's conflicts, as `ExperienceSection` and the hub's own count already ask it.
  const review = needsAttention(entry, conflicts);
  return (
    <EntityCard
      title={entry.degree.value || entry.institution.value}
      subtitle={[entry.degree.value ? entry.institution.value : "", formatRange(entry.start.value, entry.end.value)].filter(Boolean).join(" · ")}
      badges={
        <>
          {review ? <Badge tone="warn">Para revisar</Badge> : null}
          <ProvenanceBadge status={entry.institution.status} source={entry.institution.source} />
        </>
      }
    >
      <StudyDoubts entry={entry} />
      <div className="grid gap-5 sm:grid-cols-2">
        <TextCell label={ENTRY_LABELS.study.what} field={entry.degree} path={[...at, "degree"]} maxLength={160} after={settle} />
        <TextCell label={ENTRY_LABELS.study.where} field={entry.institution} path={[...at, "institution"]} maxLength={160} after={settle} />
        <DateCell label="Desde" field={entry.start} path={[...at, "start"]} after={settle} />
        <DateCell label="Hasta" field={entry.end} path={[...at, "end"]} after={settle} />
        <div>
          <label htmlFor={`status-${entry.id}`} className={`mb-1 block ${LABEL}`}>
            Estado
          </label>
          <Select
            id={`status-${entry.id}`}
            value={entry.status.value}
            onChange={(event) =>
              edit((draft) => {
                editFieldAt(draft, [...at, "status"], event.target.value as StoredEducation["status"]["value"], () => false);
                settle(draft);
              })
            }
          >
            {STATUSES.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </Select>
        </div>
        <TextCell label="Menciones" field={entry.honors} path={[...at, "honors"]} maxLength={300} />
        {/* Remounted when the points change from outside — an answer to the question — so the box shows them. */}
        <HighlightsCell key={entry.highlights.value.join("\n")} entry={entry} path={at} />
      </div>
      {/* What shows this study — the register of degrees, a page — when that is switched on: nothing is drawn otherwise. */}
      <EvidenceBlock profile={profile} target={{ kind: "education", id: entry.id }} />
      <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-4">
        <span className="flex-1" />
        <Button type="button" variant="danger" onClick={() => remove((draft) => removeEducation(draft, entry.id))}>
          Quitar
        </Button>
      </div>
    </EntityCard>
  );
}

/**
 * With `autoSave` there is no «Agregar» to press: the form is always open, and what it holds is given to the profile as it is left and kept in the form, so that a click that
 * missed a box costs nothing. «Agregar otros estudios» lets go of it and starts another. `drafting` is the study it holds in the profile, which the list leaves out.
 */
function AddStudy({ autoSave = false, drafting = null, onDraft }: { autoSave?: boolean; drafting?: string | null; onDraft?: (id: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => blankForm("study"));
  /** Counts the times the form was started over: a new one forgets the month a picker was left on. */
  const [round, setRound] = useState(0);
  const put = (draft: StoredProfile) => addEntry(draft, form, { newId: () => crypto.randomUUID(), now: new Date().toISOString() });
  const kept = useKept({ list: "education", id: drafting, setId: onDraft ?? (() => {}), signature: JSON.stringify(form), ready: isFilled(form), put });
  const startOver = () => {
    setForm(blankForm("study"));
    setRound((count) => count + 1);
  };
  if (!open && !autoSave) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        + Agregar estudios
      </Button>
    );
  }
  return (
    <>
      <form
        className="space-y-5 border border-rule p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (autoSave || !isFilled(form)) return;
          edit((draft) => void put(draft));
          startOver();
          setOpen(false);
        }}
        {...(autoSave ? { onBlur: kept.onBlur } : {})}
      >
        <div key={round}>
          <EntryFormFields form={form} onChange={(patch) => setForm({ ...form, ...patch })} whatLabel={ENTRY_LABELS.study.what} whereLabel={ENTRY_LABELS.study.where} datesOpen={autoSave} />
        </div>
        {autoSave ? null : (
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={!isFilled(form)}>
              Agregar
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
          </div>
        )}
      </form>
      {autoSave ? (
        // Outside the form, so that going to it from a box gives what is in the form to the profile first. Always there, so that giving it does not move it.
        <Button
          type="button"
          variant="secondary"
          disabled={!isFilled(form) && !drafting}
          onClick={() => {
            kept.save();
            kept.release();
            startOver();
          }}
        >
          + Agregar otros estudios
        </Button>
      ) : null}
    </>
  );
}

export function EducationSection({ profile, onRemoved, defaultOpen = false, autoSave = false }: { profile: StoredProfile; onRemoved: OnRemoved; defaultOpen?: boolean; /** The form to add a study has no «Agregar»: it is kept when the person leaves it, and its dates are in view. */ autoSave?: boolean }) {
  /** With `autoSave`: the study the form below is holding in the profile. It is not listed until the form lets go of it. */
  const [drafting, setDrafting] = useState<string | null>(null);
  const listed = profile.education.filter((entry) => entry.id !== drafting);
  return (
    <CollapsibleCard
      id={SECTION_ID.education}
      title="Formación"
      action={<FoldStatus review={profile.education.some((entry) => needsAttention(entry, profile.conflicts))} />}
      defaultOpen={defaultOpen}
      className={`space-y-4 ${ANCHOR}`}
    >
      <ImproveSection profile={profile} section="education" />
      {listed.length > 0 ? <BackingNote kind="education" /> : null}
      {listed.length === 0 ? <p className="border border-dashed border-rule px-4 py-6 text-center text-sm text-ink-3">Todavía no cargaste estudios.</p> : null}
      <div className="space-y-3">
        {/* By their dates, as the CV lists them; one still being done is the most recent. */}
        {studiesByRecency(listed).map((entry) => (
          <EducationCard key={entry.id} profile={profile} entry={entry} conflicts={profile.conflicts} onRemoved={onRemoved} />
        ))}
      </div>
      <AddStudy autoSave={autoSave} drafting={drafting} onDraft={setDrafting} />
    </CollapsibleCard>
  );
}
