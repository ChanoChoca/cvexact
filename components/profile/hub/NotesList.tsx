"use client";

import { useState } from "react";
import { Button, Checkbox, Select } from "@/components/ui";
import { isUsed, namesJob, noteSentences, passableJobs, passNoteToJob, roleIsDistinct, usedSentences } from "@/lib/onboarding/notes";
import { removeNote } from "@/lib/onboarding/review";
import { isCaptured, settleNote, unsortedLine, unsortedNotes } from "@/lib/profile/capture";
import type { Note, StoredProfile } from "@/lib/schemas/profile-v2";
import { useExperiment } from "@/lib/use-experiment";
import { LABEL, edit } from "./cells";
import { useRemoval, type OnRemoved } from "./removal";

const labelOf = (job: { company: string; role: string }) => [job.role, job.company].filter(Boolean).join(" · ");

/**
 * "Pasar a un puesto": which sentences of a note are things done in a job, and which job. The ones
 * that name the job are ticked to begin with — a starting point, not a decision — and the ones that are
 * already among the tasks of some job are said to be, and not offered again.
 */
function PassToJob({ profile, note, onPassed, onCancel }: { profile: StoredProfile; note: Note; onPassed: (message: string) => void; onCancel: () => void }) {
  const jobs = passableJobs(profile);
  const sentences = noteSentences(note.text);
  const used = usedSentences(profile);
  const [jobId, setJobId] = useState("");
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const job = jobs.find((entry) => entry.id === jobId);

  const choose = (id: string) => {
    setJobId(id);
    const chosen = jobs.find((entry) => entry.id === id);
    const distinct = chosen ? roleIsDistinct(profile, chosen.id) : false;
    setPicked(new Set(chosen ? sentences.filter((sentence) => !isUsed(sentence, used) && namesJob(sentence, chosen, distinct)) : []));
  };
  const toggle = (sentence: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(sentence)) next.delete(sentence);
      else next.add(sentence);
      return next;
    });

  const pass = () => {
    if (!job) return;
    let added = 0;
    edit((draft) => {
      added = passNoteToJob(draft, note.id, job.id, sentences.filter((sentence) => picked.has(sentence))).length;
      // A note they wrote down that is now somewhere is no longer «sin ordenar».
      if (added > 0 && isCaptured(note)) settleNote(draft, note.id);
    });
    onPassed(added === 1 ? `Agregamos una tarea a «${labelOf(job)}».` : `Agregamos ${added} tareas a «${labelOf(job)}».`);
  };

  if (jobs.length === 0) {
    return <p className="text-sm text-ink-3">Para pasar frases a un puesto, primero cargá el puesto en «Experiencia laboral».</p>;
  }
  if (sentences.length === 0) {
    return <p className="text-sm text-ink-3">Esta nota no tiene frases largas como para ser una tarea.</p>;
  }

  return (
    <div className="space-y-3 border-t border-rule pt-3">
      <div>
        <label htmlFor={`pass-${note.id}`} className={`mb-1 block ${LABEL}`}>
          ¿A qué puesto?
        </label>
        <Select id={`pass-${note.id}`} value={jobId} onChange={(event) => choose(event.target.value)} className="max-w-md">
          <option value="">Elegí un puesto</option>
          {jobs.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {labelOf(entry)}
            </option>
          ))}
        </Select>
      </div>

      {job ? (
        <fieldset className="space-y-2">
          <legend className={`mb-1 ${LABEL}`}>Lo que hacías ahí</legend>
          <p className="text-xs text-ink-3">Tildá las frases que son tareas de este puesto. Cada una queda como tarea, con tus palabras.</p>
          <ul className="space-y-2">
            {sentences.map((sentence) => {
              const already = isUsed(sentence, used);
              return (
                <li key={sentence}>
                  <Checkbox
                    label={
                      <span className={already ? "text-ink-3" : "text-ink-2"}>
                        {sentence}
                        {already ? <span className="ml-2 text-xs text-ink-3">· ya es una tarea</span> : null}
                      </span>
                    }
                    checked={picked.has(sentence)}
                    disabled={already}
                    onChange={() => toggle(sentence)}
                  />
                </li>
              );
            })}
          </ul>
        </fieldset>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={!job || picked.size === 0} onClick={pass}>
          Agregar como tareas
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

/** «Anotada el 8 de octubre de 2026 · sin ordenar»: the date, which is what writing it down was for, and whether it has been put anywhere. */
function noteLine(note: Note): string {
  const day = note.at ? new Date(note.at) : null;
  const when = day && !Number.isNaN(day.getTime()) ? day.toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" }) : "";
  const how = note.via === "share" ? "Compartida" : "Anotada";
  return [when ? `${how} el ${when}` : how, note.settledAt ? "" : "sin ordenar"].filter(Boolean).join(" · ");
}

function NoteItem({ profile, note, onRemoved }: { profile: StoredProfile; note: Note; onRemoved: OnRemoved }) {
  const remove = useRemoval(onRemoved);
  const capture = useExperiment("note_capture");
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const captured = capture && isCaptured(note);

  return (
    <li className="space-y-3 border border-rule bg-paper-2 p-4" data-note={note.id} data-note-unsorted={captured && !note.settledAt ? "" : undefined}>
      {captured ? (
        <p className="text-xs text-ink-3" data-note-meta>
          {noteLine(note)}
        </p>
      ) : null}
      <div className="flex items-start gap-3">
        <p className="line-clamp-6 min-w-0 flex-1 text-sm whitespace-pre-line text-ink-2">{note.text}</p>
        <button
          type="button"
          aria-label="Borrar esta nota"
          onClick={() => remove((draft) => removeNote(draft, note.id))}
          className="px-1 text-ink-3 hover:text-ink pointer-coarse:-my-3 pointer-coarse:min-w-11 pointer-coarse:py-3"
        >
          ✕
        </button>
      </div>
      {result ? (
        <p role="status" className="text-sm text-ink-2">
          {result} Las ves en su tarjeta, en «Experiencia laboral».
        </p>
      ) : null}
      {open ? (
        <PassToJob
          profile={profile}
          note={note}
          onPassed={(message) => {
            setResult(message);
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" compact onClick={() => setOpen(true)}>
            Pasar a un puesto
          </Button>
          {/* «Ahora no» with the same weight: it stays as a note, and stops being counted as one to sort. */}
          {captured && !note.settledAt ? (
            <Button type="button" variant="secondary" compact onClick={() => edit((draft) => void settleNote(draft, note.id))}>
              Dejarla como nota
            </Button>
          ) : null}
        </div>
      )}
    </li>
  );
}

/**
 * What was said freely, kept as it was said: to read again, to pass a sentence at a time to the job it
 * belongs to, or to take out — which can be taken back, like anything else taken out.
 */
export function NotesList({ profile, onRemoved }: { profile: StoredProfile; onRemoved: OnRemoved }) {
  const capture = useExperiment("note_capture");
  if (profile.notes.length === 0) return null;
  // How many are waiting, said here and nowhere else and never as a task: a count of what is there, with «Anotá algo» switched on.
  const waiting = capture ? unsortedLine(unsortedNotes(profile).length) : null;
  return (
    <div className="space-y-3">
      <p className={LABEL}>Notas</p>
      {waiting ? (
        <p className="text-xs text-ink-3" data-notes-unsorted>
          {waiting}
        </p>
      ) : null}
      <ul className="space-y-3">
        {profile.notes.map((note) => (
          <NoteItem key={note.id} profile={profile} note={note} onRemoved={onRemoved} />
        ))}
      </ul>
    </div>
  );
}
