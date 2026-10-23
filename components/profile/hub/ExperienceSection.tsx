"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, ButtonLink, CollapsibleCard, Input, Textarea } from "@/components/ui";
import { AiAction } from "@/components/onboarding/AiAction";
import { EntryFormFields } from "@/components/onboarding/EntryFormFields";
import { ProvenanceBadge } from "@/components/onboarding/ProvenanceBadge";
import type { PreviewFactRef } from "@/lib/cv/from-profile";
import { answerNarrative } from "@/lib/onboarding/answer";
import { splitWithAi } from "@/lib/onboarding/ai";
import { employerRuns, spanOfRun, type EmployerRun } from "@/lib/onboarding/employers";
import { addEntry, blankForm, ENTRY_LABELS, isFilled, type EntryForm } from "@/lib/onboarding/entries";
import { removeExperience, needsAttention, settleExperienceDoubts } from "@/lib/onboarding/review";
import { gapMarks } from "@/lib/onboarding/session";
import { splitCovers } from "@/lib/parse/verify-extraction";
import { addSkill } from "@/lib/profile/entities";
import { addFactText, removeJobTool, toolsOfJob } from "@/lib/profile/facts";
import { formatRange, jobsByRecency } from "@/lib/profile/timeline";
import { emptyField, isMeaningfulExperience, JOB_NOTE_MAX, type StoredExperience, type StoredProfile } from "@/lib/schemas/profile-v2";
import { DateCell, LABEL, TextCell, edit, useKept } from "./cells";
import { JobDoubts } from "./Doubts";
import { BackingNote, EvidenceBlock } from "./EvidenceBlock";
import { FactRow } from "./FactRow";
import { ImproveSection } from "./ImproveSection";
import { useRemoval, type OnRemoved } from "./removal";
import { ANCHOR, SECTION_ID } from "@/components/profile/anchors";
import { FoldStatus } from "./ReviewedNote";
import { figuresIn } from "@/lib/profile/inventory";

/**
 * The jobs, as cards: each a summary line that opens into its fields, what was done
 * there, and what was used. Everything on them is edited where it stands, and says
 * where it came from — a job read from a CV and one typed by hand look alike, and
 * differ only by the badge.
 */

function Tools({ profile, job, onRemoved }: { profile: StoredProfile; job: StoredExperience; onRemoved: OnRemoved }) {
  const [draft, setDraft] = useState("");
  const remove = useRemoval(onRemoved);
  const tools = toolsOfJob(profile, job);
  const add = () => {
    if (!draft.trim()) return;
    edit((next) => void addSkill(next, draft, undefined, job.id));
    setDraft("");
  };
  return (
    <div className="space-y-2">
      <p className={LABEL}>Herramientas y sistemas</p>
      {tools.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {tools.map((tool) => (
            <li key={tool.skillId ?? tool.factIds[0]} className="inline-flex items-center gap-1 border border-rule bg-paper-2 py-1 pr-1 pl-2 text-xs text-ink-2">
              {tool.name}
              <button type="button" aria-label={`Sacar ${tool.name} de este puesto`} onClick={() => remove((next) => removeJobTool(next, job.id, tool))} className="px-1 text-ink-3 hover:text-ink pointer-coarse:min-h-11 pointer-coarse:min-w-11">
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <Input
        aria-label="Agregar una herramienta"
        value={draft}
        placeholder="Escribí y presioná Enter"
        maxLength={80}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
      <p className="text-xs text-ink-3">Todo lo que usabas, por obvio que parezca. Quedan también entre tus habilidades.</p>
    </div>
  );
}

function AddFact({ experienceId }: { experienceId: string }) {
  const [text, setText] = useState("");
  const addAsIs = () => {
    edit((draft) => void addFactText(draft, experienceId, text));
    setText("");
  };
  return (
    <div className="space-y-2">
      <Textarea aria-label="Agregar algo que hacías" rows={2} maxLength={600} value={text} onChange={(event) => setText(event.target.value)} placeholder="Agregá algo más que hacías o lograste" />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" disabled={!text.trim()} onClick={addAsIs}>
          Agregar
        </Button>
        {text.trim().length >= 40 ? (
          <AiAction
            label="Separar con tu IA"
            busyLabel="Separando…"
            // The two moments the spec allows asking for a key are a
            // non-standard document and "Contámelo a mi manera" — not the
            // hub, where "Agregar" is already this control's own way past it.
            whenUnavailable="hide"
            run={async (signal) => {
              const outcome = await splitWithAi(text, signal);
              if (!outcome.ok) return outcome;
              if (outcome.result.length <= 1) {
                return { ok: false, message: "No encontramos más de una parte para separar; probá «Agregar» tal cual." };
              }
              if (!splitCovers(text, outcome.result)) {
                return { ok: false, message: "Tu IA cambió o dejó afuera parte de lo que dijiste; probá «Agregar» tal cual." };
              }
              edit((draft) => {
                for (const piece of outcome.result) addFactText(draft, experienceId, piece);
              });
              return { ok: true };
            }}
            onDone={() => setText("")}
            onSkip={addAsIs}
          />
        ) : null}
      </div>
    </div>
  );
}

function JobCard({
  profile,
  job,
  onRemoved,
  open,
  focusFactId,
  reviewId,
  onReview,
}: {
  profile: StoredProfile;
  job: StoredExperience;
  onRemoved: OnRemoved;
  open: boolean;
  /** The question «¿Seguís en…?» of this job, when it is time to ask it: the card says so, and opens it in «Para revisar». */
  reviewId?: string | undefined;
  onReview?: ((gapId: string) => void) | undefined;
  /** The one fact of this job to scroll to and mark — from tapping its line in the CV preview. */
  focusFactId?: string | undefined;
}) {
  const remove = useRemoval(onRemoved);
  const at = ["experience", job.id];
  // Changing a field by hand puts right the doubts it was about, and with the last one the job needs no «Está bien».
  const settle = (draft: StoredProfile) => void settleExperienceDoubts(draft, job.id);
  // A tool is a chip under «Herramientas y sistemas», not a line of what was done — but one left out keeps its row here, so it is not lost.
  const facts = job.facts.filter((fact) => fact.text.trim() !== "" && (fact.kind !== "tool" || fact.excluded));
  // «5 tareas · 2 con cifra»: what the job says and how much of it has a number, in counts — never a score. The same count that «Ya tenés» makes of the whole
  // profile: the lines that say what was done, and not the tools listed beside them.
  const { tasks, withFigure } = figuresIn(job);
  const review = needsAttention(job, profile.conflicts);
  // §3's "add a logro" mark: in the profile's own card, never in the preview, and never a percentage.
  const marks = gapMarks(profile, job.id);
  const range = formatRange(job.start.value, job.end.value);

  return (
    <details open={open} className="group border border-rule bg-paper-2">
      <summary className="flex cursor-pointer list-none items-start gap-3 p-4 [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="mt-1 inline-block shrink-0 text-ink-3 transition-transform group-open:rotate-90 motion-reduce:transition-none">
          ▸
        </span>
        <span className="min-w-0 flex-1">
          <span className="block wrap-break-word text-[15px] text-ink">{job.role.value || job.company.value || "Sin nombre"}</span>
          {/* A job with no dates is listed last, wherever it was added: said, so it is not taken for a mistake. */}
          <span className="block wrap-break-word text-sm text-ink-2">{[job.role.value ? job.company.value : "", range || "Sin fechas: va al final"].filter(Boolean).join(" · ")}</span>
          <span className="block text-xs text-ink-3" data-job-counts>
            {tasks === 0 ? "Sin detalle todavía" : `${tasks} ${tasks === 1 ? "tarea" : "tareas"}${withFigure > 0 ? ` · ${withFigure} con cifra` : ""}`}
          </span>
          {marks.length > 0 ? (
            <Link
              href={`/perfil/preguntas?puesto=${job.id}`}
              // Stops the click from also toggling this <summary>'s own <details> —
              // it should navigate, not just expand the card it already sits on.
              onClick={(event) => event.stopPropagation()}
              className="mt-0.5 block text-xs text-oro-soft underline decoration-oro-soft/60 underline-offset-4 hover:text-ink pointer-coarse:-my-3 pointer-coarse:py-3.5"
            >
              {marks.join(" · ")}
            </Link>
          ) : null}
          {reviewId && onReview ? (
            <button
              type="button"
              data-job-review
              onClick={(event) => {
                // It opens the question in «Para revisar»; it is not the summary's tap, which folds and unfolds the card.
                event.preventDefault();
                event.stopPropagation();
                onReview(reviewId);
              }}
              className="mt-0.5 block text-left text-xs text-oro-soft underline decoration-oro-soft/60 underline-offset-4 hover:text-ink pointer-coarse:-my-3 pointer-coarse:py-3.5"
            >
              En curso · ¿Seguís?
            </button>
          ) : null}
        </span>
        <span className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {review ? <Badge tone="warn">Para revisar</Badge> : null}
          <ProvenanceBadge status={job.company.status} source={job.company.source} />
        </span>
      </summary>

      <div className="space-y-6 border-t border-rule p-4">
        <JobDoubts job={job} />
        <div className="grid gap-5 sm:grid-cols-2">
          <TextCell label={ENTRY_LABELS.job.where} field={job.company} path={[...at, "company"]} maxLength={160} after={settle} />
          <TextCell label={ENTRY_LABELS.job.what} field={job.role} path={[...at, "role"]} maxLength={160} after={settle} />
          <TextCell label="Ciudad" field={job.city} path={[...at, "city"]} maxLength={80} after={settle} />
          <TextCell label="País" field={job.country} path={[...at, "country"]} maxLength={80} after={settle} />
          <DateCell label="Desde" field={job.start} path={[...at, "start"]} after={settle} />
          <DateCell label="Hasta" field={job.end} path={[...at, "end"]} allowCurrent after={settle} />
        </div>
        <TextCell
          label="Motivo breve (opcional)"
          field={job.note ?? emptyField("")}
          path={[...at, "note"]}
          maxLength={JOB_NOTE_MAX}
          optional
          hint="Una línea con tus palabras, para una estadía corta o la pausa antes de este puesto. Va debajo del puesto en el CV."
        />

        <div className="space-y-3">
          <p className={LABEL}>Qué hacías</p>
          {facts.length > 0 ? (
            <ul className="space-y-4">
              {facts.map((fact) => (
                <FactRow key={fact.id} experienceId={job.id} fact={fact} onRemoved={onRemoved} focused={fact.id === focusFactId} />
              ))}
            </ul>
          ) : null}
          <AddFact experienceId={job.id} />
        </div>

        <Tools profile={profile} job={job} onRemoved={onRemoved} />

        {/* What shows this job, when that is switched on: nothing is drawn otherwise. */}
        <EvidenceBlock profile={profile} target={{ kind: "experience", id: job.id }} />

        <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-4">
          <span className="flex-1" />
          <ButtonLink href={`/perfil/preguntas?puesto=${job.id}`} variant="secondary">
            Preguntas sobre este puesto →
          </ButtonLink>
          <Button type="button" variant="danger" onClick={() => remove((draft) => removeExperience(draft, job.id))}>
            Quitar puesto
          </Button>
        </div>
      </div>
    </details>
  );
}

/**
 * "Agregar experiencia": four fields, and what was done there if they want to say — the rest is asked, a little at a time.
 * Opened from "Otro puesto en {empresa}" (the button of a group) it starts with the company in, brought into view with the role to be typed next.
 * With `autoSave` there is no «Agregar» to press: it is always open, and what it holds is given to the profile as it is left and kept in the form, so that a click
 * that missed a box costs nothing. «Agregar otra experiencia» lets go of it and starts another. `drafting` is the job it holds in the profile, which the list leaves out.
 */
function AddJob({
  onAdded,
  company,
  startOpen = false,
  autoSave = false,
  drafting = null,
  onDraft,
}: {
  onAdded: (id: string) => void;
  company?: string | undefined;
  startOpen?: boolean;
  autoSave?: boolean;
  drafting?: string | null;
  onDraft?: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(startOpen);
  /** Counts the times the form was started over: a new one forgets the month a picker was left on. */
  const [round, setRound] = useState(0);
  const [form, setForm] = useState<EntryForm>(() => ({ ...blankForm("job"), where: company ?? "" }));
  const [said, setSaid] = useState("");
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!startOpen) return;
    root.current?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    // The company is already there: what is missing is the role, the first box.
    root.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
  }, [startOpen]);
  const put = (draft: StoredProfile) => {
    const id = addEntry(draft, form, { newId: () => crypto.randomUUID(), now: new Date().toISOString() });
    if (id && said.trim()) answerNarrative(draft, { id: `add:${id}`, priority: "blocking", experienceId: id }, id, said);
    return id;
  };
  // The company a form opened from «Otro puesto en…» starts with is not something said: leaving it as it came keeps nothing.
  const ready = isFilled({ ...form, where: form.where === company ? "" : form.where });
  const kept = useKept({ list: "experience", id: drafting, setId: onDraft ?? (() => {}), signature: JSON.stringify([form, said]), ready, put });
  const startOver = () => {
    setForm(blankForm("job"));
    setSaid("");
    setRound((count) => count + 1);
  };

  if (!open && !autoSave) {
    return (
      <div ref={root}>
        <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
          + Agregar experiencia
        </Button>
      </div>
    );
  }

  const add = () => {
    if (!isFilled(form)) return;
    let id: string | null = null;
    edit((draft) => void (id = put(draft)));
    startOver();
    setOpen(false);
    if (id) onAdded(id);
  };

  return (
    <div ref={root} className="space-y-3">
      <form
        className="space-y-5 border border-rule p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!autoSave) add();
        }}
        {...(autoSave ? { onBlur: kept.onBlur } : {})}
      >
        <div key={round} className="space-y-5">
          <EntryFormFields form={form} onChange={(patch) => setForm({ ...form, ...patch })} whatLabel={ENTRY_LABELS.job.what} whereLabel={ENTRY_LABELS.job.where} datesOpen={autoSave} />
          <div className="space-y-1">
            <label htmlFor="add-said" className={LABEL}>
              ¿Qué hacías allí? · opcional
            </label>
            <Textarea id="add-said" rows={4} maxLength={1500} value={said} onChange={(event) => setSaid(event.target.value)} />
            <p className="text-xs text-ink-3">Con tus palabras. Si lo dejás vacío, después te hacemos unas preguntas.</p>
          </div>
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
          disabled={!ready && !drafting}
          onClick={() => {
            kept.save();
            kept.release();
            startOver();
          }}
        >
          + Agregar otra experiencia
        </Button>
      ) : null}
    </div>
  );
}

/** Several jobs at one employer: the employer, what they cover together, and each job as a card under it. */
function EmployerGroup({ run, card, onAddAnother }: { run: EmployerRun; card: (job: StoredExperience) => React.ReactNode; onAddAnother: (company: string) => void }) {
  const { start, end } = spanOfRun(run.jobs);
  const span = formatRange(start, end);
  return (
    <div role="group" aria-label={`Puestos en ${run.company}`} className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 text-[15px] wrap-break-word text-ink">{run.company}</p>
        <p className="text-xs text-ink-3">{[`${run.jobs.length} puestos`, span].filter(Boolean).join(" · ")}</p>
      </div>
      <div className="space-y-3 border-l-2 border-solar-g4/40 pl-3 sm:pl-4">
        {run.jobs.map(card)}
        <Button type="button" variant="ghost" onClick={() => onAddAnother(run.company)}>
          + Otro puesto en {run.company}
        </Button>
      </div>
    </div>
  );
}

export function ExperienceSection({
  profile,
  onRemoved,
  focus,
  addRequests = 0,
  reviewByJob,
  onReview,
  defaultOpen = false,
  autoSave = false,
}: {
  profile: StoredProfile;
  onRemoved: OnRemoved;
  /** Whether the section starts open: it folds like the rest, and the profile opens only the first. */
  defaultOpen?: boolean;
  /** For each job that goes on and is due to be asked about, the id of the question: its card says «En curso · ¿Seguís?». */
  reviewByJob?: Readonly<Record<string, string>> | undefined;
  /** Opens a question of «Para revisar» by its id. */
  onReview?: ((gapId: string) => void) | undefined;
  /** A fact tapped in the CV preview above: opens its job and scrolls to it. */
  focus?: PreviewFactRef | undefined;
  /** How many times something outside asked for the form to add a job ("Agregar un trabajo" on the empty profile): each one opens it. */
  addRequests?: number;
  /** The form to add a job has no «Agregar»: it is kept when the person leaves it, and its dates are in view. */
  autoSave?: boolean;
}) {
  // By their dates, as the CV lists them; one after another at the same employer, they are one stretch.
  /** With `autoSave`: the job the form below is holding in the profile. It is not listed until the form lets go of it. */
  const [drafting, setDrafting] = useState<string | null>(null);
  const jobs = jobsByRecency(profile.experience.filter(isMeaningfulExperience)).filter((job) => job.id !== drafting);
  /** A job just added is open, so what to do next is in front of them. */
  const [added, setAdded] = useState<string | null>(null);
  /** "Otro puesto en {empresa}": the form at the foot opens with the company already in it. */
  const [another, setAnother] = useState<{ company: string; nonce: number } | null>(null);
  const addAnother = (company: string) => {
    // The form starts over with the company in it: what it held is a job like the rest.
    setDrafting(null);
    setAnother((current) => ({ company, nonce: (current?.nonce ?? 0) + 1 }));
  };
  const addedJob = jobs.find((job) => job.id === added);
  const addedWithoutDates = Boolean(addedJob) && !formatRange(addedJob!.start.value, addedJob!.end.value);
  const card = (job: StoredExperience) => (
    <JobCard
      key={job.id}
      profile={profile}
      job={job}
      onRemoved={onRemoved}
      // Shut unless it was just added or asked for: what is marked says so with its tag, shut or open, and does not open by itself.
      open={job.id === added || job.id === focus?.experienceId}
      focusFactId={job.id === focus?.experienceId ? focus.factId : undefined}
      reviewId={reviewByJob?.[job.id]}
      onReview={onReview}
    />
  );

  return (
    <CollapsibleCard
      id={SECTION_ID.experience}
      title="Experiencia laboral"
      action={<FoldStatus review={jobs.some((job) => needsAttention(job, profile.conflicts))} />}
      defaultOpen={defaultOpen}
      className={`space-y-4 ${ANCHOR}`}
    >
      <ImproveSection profile={profile} section="experience" />
      {jobs.length > 0 ? <BackingNote kind="experience" /> : null}
      {jobs.length === 0 ? <p className="border border-dashed border-rule px-4 py-6 text-center text-sm text-ink-3">Todavía no cargaste ningún trabajo. Cuentan también las changas y los temporales.</p> : null}
      <div className="space-y-3">
        {employerRuns(jobs).map((run) =>
          run.jobs.length === 1 ? card(run.jobs[0]!) : <EmployerGroup key={run.jobs[0]!.id} run={run} card={card} onAddAnother={addAnother} />,
        )}
      </div>
      {added ? (
        <p className="text-sm text-ink-2">
          Agregado.
          {/* Listed by its dates, and with none it goes last: said, so it is not taken for lost. */}
          {addedWithoutDates ? " Como no tiene fechas, va al final de la lista." : ""}{" "}
          <Link href={`/perfil/preguntas?puesto=${added}`} className="underline decoration-oro-soft underline-offset-4 hover:text-ink">
            Contestá unas preguntas sobre ese puesto
          </Link>{" "}
          para que quede mejor.
        </p>
      ) : null}
      <AddJob key={`${another?.nonce ?? 0}:${addRequests}`} onAdded={setAdded} company={another?.company} startOpen={Boolean(another) || addRequests > 0} autoSave={autoSave} drafting={drafting} onDraft={setDrafting} />
    </CollapsibleCard>
  );
}
