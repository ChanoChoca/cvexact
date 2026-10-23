"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button, Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import { ChoiceButtons, MultiChips } from "@/components/ui/Chips";
import { useDictation } from "@/components/ui/useDictation";
import { useFocusOnDesktop } from "@/components/ui/useFocusOnDesktop";
import type { CurrentJobAnswer, FigureAnswer } from "@/lib/onboarding/answer";
import { blankForm, ENTRY_KIND_LABEL, ENTRY_KINDS, ENTRY_LABELS, SELF_EMPLOYED, isFilled, type EntryForm, type EntryKind } from "@/lib/onboarding/entries";
import { FIGURE_UNITS, describeReading, readFigure } from "@/lib/onboarding/figure";
import { LEVEL_OPTIONS, achievementTypesFor, type AchievementType } from "@/lib/onboarding/questions";
import { DRAFT_MAX } from "@/lib/onboarding/resume";
import type { Impact } from "@/lib/onboarding/results";
import { MONTH_NAMES_ES, spelledDate, type DateValue } from "@/lib/profile/dates";
import type { Practical } from "@/lib/schemas/profile";
import { JOB_NAME_MAX, JOB_NOTE_MAX, type CefrLevel, type SkillLevel, type StoredExperience } from "@/lib/schemas/profile-v2";
import { DictationNote } from "./DictationNote";
import { EntryFormFields } from "./EntryFormFields";
import { EXPIRY_YEARS_AHEAD, MonthYearPicker } from "./MonthYearPicker";

/**
 * How each kind of question is answered. Each control is one small piece of state
 * and one `onSubmit`, and knows nothing about the profile: the card that holds it
 * turns what it says into an answer.
 *
 * The rule for all of them is the spec's — closed answers are chips and a tap,
 * open ones are a box with a hint about the *shape* of an answer and never an
 * example of one — and "no lo sé" is always a way out that costs one tap.
 */

const Error = ({ children }: { children?: string | null | undefined }) =>
  children ? (
    <p role="alert" className="text-sm text-red-300">
      {children}
    </p>
  ) : null;

const Row = ({ children }: { children: ReactNode }) => <div className="flex flex-wrap items-center gap-3">{children}</div>;

// --- What they did, in their words ---------------------------------------------------------

/** How long a pause in typing is before what was typed is handed over to be kept as a draft. */
const DRAFT_DELAY_MS = 600;

const FROM_THE_START = "Esto sale de lo que contaste al principio. Revisalo, cambialo o borralo antes de guardar.";
/** What to say about a box that opened with what was being typed in it: a reload, a return, an answer taken back. */
export const RESUMED_NOTE = "Retomé lo que habías escrito. Seguilo, cambialo o empezá de nuevo.";

/**
 * A box. An answer of a few words is offered a second look, once, with the shape of
 * a fuller one — and kept as it is if that is what they meant.
 *
 * What is typed is handed to `onDraft` after a pause, and once more as the box goes away, so a caller
 * that keeps it can give it back as `initial` — a reload, or a phone that put the tab to sleep, loses
 * nothing. Cleared by sending: after `onSubmit` nothing more is handed over.
 */
export function NarrativeControl({
  label,
  onSubmit,
  submitLabel = "Guardar",
  initial,
  note = FROM_THE_START,
  onDraft,
  maxLength = DRAFT_MAX,
  alongside,
}: {
  label: string;
  onSubmit: (text: string) => void;
  submitLabel?: string;
  /** Another way to answer, beside the button that sends what was typed: a question whose answer may well be «nada». */
  alongside?: ReactNode;
  /** Where to start: what they already said about this, or what they were typing, in their words. Said to be that, and easy to start over. */
  initial?: string | undefined;
  /** What to say about `initial`; `null` to say nothing. */
  note?: string | null;
  /** Receives what is typed, after a pause. An empty text means there is no draft. */
  onDraft?: ((text: string) => void) | undefined;
  maxLength?: number;
}) {
  // Taken once: `initial` is what the box opened with, and a draft saved while typing must not change what it says about it.
  const [start] = useState(initial ?? "");
  const [text, setText] = useState(start);
  const [nudged, setNudged] = useState(false);
  const focus = useFocusOnDesktop<HTMLTextAreaElement>();
  // Onto whatever is already there, not over it — dictating adds to typing, both ways around.
  const dictation = useDictation((heard) => setText((current) => (current.trim() ? `${current.trim()} ${heard}` : heard)));
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const short = words > 0 && words < 4;

  // What the caller already has, what is in the box now, and the caller as of the last render: the three a
  // draft is handed over by. Refs because none of them is something to draw — and the callback is read
  // through one so that a caller that makes a new one every render does not restart the pause each time.
  const kept = useRef(start);
  const latest = useRef(text);
  const save = useRef(onDraft);
  useEffect(() => {
    latest.current = text;
    save.current = onDraft;
  });
  useEffect(() => {
    if (text === kept.current) return;
    const timer = setTimeout(() => {
      kept.current = text;
      save.current?.(text);
    }, DRAFT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);
  useEffect(
    () => () => {
      if (latest.current === kept.current) return;
      kept.current = latest.current;
      save.current?.(latest.current);
    },
    [],
  );

  return (
    <div className="space-y-3">
      <Textarea ref={focus} aria-label={label} rows={5} maxLength={maxLength} value={text} onChange={(event) => setText(event.target.value)} />
      {start && text === start && note ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-3">
          <span>{note}</span>
          <button
            type="button"
            onClick={() => setText("")}
            className="underline decoration-oro-soft underline-offset-4 hover:text-ink pointer-coarse:-my-3 pointer-coarse:py-3"
          >
            Empezar en blanco
          </button>
        </div>
      ) : null}
      {dictation.supported ? (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="ghost" aria-pressed={dictation.listening} onClick={dictation.listening ? dictation.stop : dictation.start}>
              {dictation.listening ? "Escuchando… (tocá para terminar)" : "Dictar"}
            </Button>
            {dictation.error ? (
              <p role="status" className="text-xs text-ink-3">
                {dictation.error}
              </p>
            ) : null}
          </div>
          <DictationNote />
        </div>
      ) : null}
      {nudged && short ? (
        <p role="status" className="text-sm text-ink-2">
          Es poco para armar algo. Si podés, agregá qué hacés, para quién y con qué; si no, guardalo así.
        </p>
      ) : null}
      <Row>
        <Button
          type="button"
          disabled={!text.trim()}
          onClick={() => {
            if (short && !nudged) {
              setNudged(true);
              return;
            }
            // Sent: nothing typed is a draft any more, not even at the moment this box goes away.
            kept.current = text;
            onSubmit(text);
          }}
        >
          {nudged && short ? "Guardar así" : submitLabel}
        </Button>
        {alongside}
      </Row>
    </div>
  );
}

// --- What improved ----------------------------------------------------------------------------

export type { AchievementType };

/** How many of the results already told are shown above the kinds: enough to recognise them, not a second copy of the job. */
const KNOWN_SHOWN = 3;

/**
 * The kinds of change, as chips. For a job whose lines already tell results
 * (`known`), those come first, in the person's words — what "además de lo que
 * ya contaste" refers to — and the kinds they already tell (`covered`) are
 * listed after the rest, marked, and still there to pick for another one of
 * the same kind.
 */
export function AchievementTypesControl({
  covered,
  known,
  onSubmit,
  onNothing,
}: {
  covered: readonly Impact[];
  known: ReadonlyArray<{ id: string; text: string }>;
  onSubmit: (types: AchievementType[]) => void;
  onNothing: () => void;
}) {
  const [chosen, setChosen] = useState<AchievementType[]>([]);
  const options = achievementTypesFor(covered).map((type) => ({ value: type.value, label: type.label, ...(type.told ? { hint: "Ya contaste una" } : {}) }));
  return (
    <div className="space-y-4">
      {known.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs text-ink-3">Ya contaste:</p>
          <ul className="space-y-1 border-l-2 border-solar-g4 pl-3 text-sm text-ink-2">
            {known.slice(0, KNOWN_SHOWN).map((fact) => (
              <li key={fact.id} className="line-clamp-2 wrap-break-word">
                {fact.text}
              </li>
            ))}
          </ul>
          {known.length > KNOWN_SHOWN ? <p className="text-xs text-ink-3">y {known.length - KNOWN_SHOWN} más</p> : null}
        </div>
      ) : null}
      <MultiChips label="Qué mejoró" options={options} value={chosen} onChange={setChosen} />
      <Row>
        <Button type="button" disabled={chosen.length === 0} onClick={() => onSubmit(chosen)}>
          {chosen.length > 1 ? "Contar estas" : "Contar esta"}
        </Button>
        <Button type="button" variant="ghost" onClick={onNothing}>
          {known.length > 0 ? "Nada más" : "Nada que destacar"}
        </Button>
      </Row>
    </div>
  );
}

// --- The figure ------------------------------------------------------------------------------------

/**
 * One line, read as it is written — "20 %", "20-25 %", "150 clientes", "aprox. 150" — with what was
 * made of it said before it is saved. A figure that comes without its unit is offered the usual ones
 * rather than given one: a "%" nobody chose would be wrong for "150 clientes".
 */
export function FigureControl({ quote, onSubmit, error }: { quote: string; onSubmit: (answer: FigureAnswer) => void; error?: string | null }) {
  const statusId = useId();
  const [text, setText] = useState("");
  const focus = useFocusOnDesktop<HTMLInputElement>();
  const save = useRef<HTMLButtonElement>(null);
  const reading = readFigure(text);
  const answer = reading.kind === "read" ? reading.answer : null;

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (answer) onSubmit(answer);
      }}
    >
      {quote ? <p className="border-l-2 border-solar-g4 pl-3 text-sm text-ink-2">«{quote}»</p> : null}
      <Field label="Tu cifra" hint="Con su unidad, si la sabés: 20 %, 20-25 %, 150 clientes. Si es un cálculo tuyo, empezá con «aprox.».">
        <Input ref={focus} value={text} maxLength={60} onChange={(event) => setText(event.target.value)} autoComplete="off" aria-describedby={statusId} />
      </Field>
      {answer && answer.unit === "" ? (
        <ChoiceButtons
          label="Unidad"
          options={FIGURE_UNITS.map((unit) => ({ value: unit, label: unit }))}
          onPick={(unit) => {
            setText(`${text.trim()} ${unit}`);
            // The button that was pressed goes away with the choice: focus goes on to what is next.
            save.current?.focus();
          }}
        />
      ) : null}
      {/* Said, not announced as it changes: on every keystroke it would talk over the typing. The button below points at it. */}
      <p id={statusId} className={reading.kind === "unclear" ? "min-h-5 text-sm text-ink-3" : "min-h-5 text-sm text-ink-2"}>
        {answer ? describeReading(answer) : reading.kind === "unclear" ? reading.why : ""}
      </p>
      <Error>{error}</Error>
      <Row>
        <Button ref={save} type="submit" disabled={!answer} aria-describedby={statusId}>
          Guardar
        </Button>
        <Button type="button" variant="ghost" onClick={() => onSubmit({ kind: "unknown" })}>
          No lo sé
        </Button>
        {/* For work with no numbers in it: said once, for every line, and taken back by asking again from the profile menu. */}
        <Button type="button" variant="ghost" onClick={() => onSubmit({ kind: "measureless" })}>
          En mi trabajo no se miden cifras
        </Button>
      </Row>
    </form>
  );
}

// --- People in charge -----------------------------------------------------------------------------

export function PeopleControl({ onSubmit, error }: { onSubmit: (answer: { yes: boolean; count?: string }) => void; error?: string | null }) {
  const [yes, setYes] = useState(false);
  const [count, setCount] = useState("");
  // Where the person just said "Sí": the next thing is the number, and a phone's keyboard waits to be asked for.
  const focus = useFocusOnDesktop<HTMLInputElement>();
  return (
    <div className="space-y-4">
      <ChoiceButtons
        label="Personas a cargo"
        value={yes ? "yes" : undefined}
        options={[
          { value: "no", label: "No" },
          { value: "yes", label: "Sí" },
        ]}
        onPick={(picked) => (picked === "no" ? onSubmit({ yes: false }) : setYes(true))}
      />
      {yes ? (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit({ yes: true, ...(count.trim() ? { count } : {}) });
          }}
        >
          <Field label="¿Cuántas?" hint="Si no sabés el número, dejalo vacío.">
            <Input ref={focus} inputMode="numeric" value={count} onChange={(event) => setCount(event.target.value)} autoComplete="off" />
          </Field>
          <Error>{error}</Error>
          <Button type="submit">Guardar</Button>
        </form>
      ) : null}
    </div>
  );
}

// --- A month --------------------------------------------------------------------------------------------

export function MonthControl({ onSubmit }: { onSubmit: (month: number | null) => void }) {
  const [month, setMonth] = useState("");
  return (
    <Row>
      <Select aria-label="Mes" value={month} onChange={(event) => setMonth(event.target.value)} className="w-48">
        <option value="">Elegí el mes</option>
        {MONTH_NAMES_ES.map((name, index) => (
          <option key={name} value={index + 1}>
            {name}
          </option>
        ))}
      </Select>
      <Button type="button" disabled={!month} onClick={() => onSubmit(Number(month))}>
        Guardar
      </Button>
      <Button type="button" variant="ghost" onClick={() => onSubmit(null)}>
        No me acuerdo
      </Button>
    </Row>
  );
}

// --- Tools and skills ------------------------------------------------------------------------------------

export function ToolsControl({ tools, onSubmit }: { tools: readonly string[]; onSubmit: (accepted: string[]) => void }) {
  const [chosen, setChosen] = useState<string[]>([]);
  return (
    <div className="space-y-4">
      <MultiChips label="Herramientas que nombraste" options={tools.map((tool) => ({ value: tool, label: tool }))} value={chosen} onChange={setChosen} />
      <Row>
        <Button type="button" disabled={chosen.length === 0} onClick={() => onSubmit(chosen)}>
          {chosen.length > 0 ? `Agregar ${chosen.length}` : "Marcá las que quieras"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => onSubmit([])}>
          Ninguna
        </Button>
      </Row>
    </div>
  );
}

export function SkillUsesControl({ jobs, onSubmit }: { jobs: ReadonlyArray<{ id: string; label: string }>; onSubmit: (ids: string[]) => void }) {
  const [chosen, setChosen] = useState<string[]>([]);
  return (
    <div className="space-y-4">
      <MultiChips label="Dónde la usaste" options={jobs.map((job) => ({ value: job.id, label: job.label }))} value={chosen} onChange={setChosen} />
      <Row>
        <Button type="button" disabled={chosen.length === 0} onClick={() => onSubmit(chosen)}>
          Guardar
        </Button>
        <Button type="button" variant="ghost" onClick={() => onSubmit([])}>
          Fuera de estos trabajos
        </Button>
      </Row>
    </div>
  );
}

// --- A language's level -------------------------------------------------------------------------------------

export function LevelControl({ onPick }: { onPick: (level: CefrLevel | "unknown") => void }) {
  return <ChoiceButtons label="Nivel" options={[...LEVEL_OPTIONS, { value: "unknown" as const, label: "No lo sé" }]} onPick={onPick} />;
}

// --- A reason, in a line --------------------------------------------------------------------------------------------

/**
 * A line of the CV, in the person's words: why a stay was short, or what happened before a job. One box and one tap to put it on the CV;
 * `onDecline`, when there is one, is the way out that says nothing, «Prefiero no explicarlo».
 */
export function ReasonControl({ label, onSubmit, onDecline }: { label: string; onSubmit: (text: string) => void; onDecline?: () => void }) {
  const [text, setText] = useState("");
  const focus = useFocusOnDesktop<HTMLInputElement>();
  return (
    <form
      className="space-y-4"
      data-reason
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim()) onSubmit(text);
      }}
    >
      <Field label={label}>
        <Input ref={focus} value={text} maxLength={JOB_NOTE_MAX} onChange={(event) => setText(event.target.value)} autoComplete="off" />
      </Field>
      <Row>
        <Button type="submit" disabled={!text.trim()}>
          Agregar al CV
        </Button>
        {onDecline ? (
          <Button type="button" variant="secondary" onClick={onDecline}>
            Prefiero no explicarlo
          </Button>
        ) : null}
      </Row>
    </form>
  );
}

// --- How well they know each skill ---------------------------------------------------------------------------------

export const SKILL_LEVEL_LABEL: Record<SkillLevel, string> = { strong: "Fuerte", working: "Uso habitual", basic: "Básico" };

/** A row for each skill and three taps; marking is optional, and tapping the one marked takes it back. */
export function SkillLevelsControl({ skills, onSubmit }: { skills: ReadonlyArray<{ id: string; name: string }>; onSubmit: (levels: Record<string, SkillLevel>) => void }) {
  const [levels, setLevels] = useState<Record<string, SkillLevel>>({});
  const marked = Object.keys(levels).length;
  return (
    <div className="space-y-4" data-skill-levels>
      <ul className="space-y-2">
        {skills.map((skill) => (
          <li key={skill.id} className="flex flex-wrap items-center gap-2">
            <span className="min-w-32 text-sm text-ink-2">{skill.name}</span>
            {(Object.keys(SKILL_LEVEL_LABEL) as SkillLevel[]).map((level) => (
              <Button
                key={level}
                type="button"
                compact
                variant={levels[skill.id] === level ? "primary" : "secondary"}
                aria-pressed={levels[skill.id] === level}
                onClick={() =>
                  setLevels((current) => {
                    const { [skill.id]: was, ...rest } = current;
                    return was === level ? rest : { ...rest, [skill.id]: level };
                  })
                }
              >
                {SKILL_LEVEL_LABEL[level]}
              </Button>
            ))}
          </li>
        ))}
      </ul>
      <Row>
        <Button type="button" disabled={marked === 0} onClick={() => onSubmit(levels)}>
          Guardar
        </Button>
      </Row>
    </div>
  );
}

// --- What they are after ------------------------------------------------------------------------------------------

/**
 * A short line, and the person's own titles to start from: choosing one says "algo así", and
 * the field stays theirs to change. Never an example of what to write — the suggestions are
 * what they wrote themselves.
 */
export function ObjectiveControl({ suggestions, onSubmit }: { suggestions: readonly string[]; onSubmit: (value: string) => void }) {
  const [text, setText] = useState("");
  const focus = useFocusOnDesktop<HTMLInputElement>();
  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim()) onSubmit(text);
      }}
    >
      <Field label="El puesto que buscás">
        <Input ref={focus} value={text} maxLength={160} onChange={(event) => setText(event.target.value)} autoComplete="off" />
      </Field>
      {suggestions.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm text-ink-3">O partí de uno de tus puestos:</p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => setText(role)}
                className="min-h-9 border border-white/15 px-3.5 py-2 text-left text-sm text-ink-2 transition-colors hover:border-white/40 hover:text-ink focus-visible:border-solar-g4 focus-visible:outline-none pointer-coarse:min-h-11 motion-reduce:transition-none"
              >
                {role}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {/* Not knowing yet is "Ahora no", and not wanting to say is "No aplica": the card has both. */}
      <Row>
        <Button type="submit" disabled={!text.trim()}>
          Guardar
        </Button>
      </Row>
    </form>
  );
}

// --- How they can work ----------------------------------------------------------------------------------------------

const CAPTION = "mb-1 block font-solar text-[12.5px] font-bold tracking-[0.18em] text-ink-3 uppercase";

/** Closed answers for the one practical fact that has a usual set of them; kept, joined, in this order. */
const AVAILABILITY = ["Tiempo completo", "Medio tiempo", "Fines de semana", "Turnos rotativos", "Turno noche", "Incorporación inmediata"] as const;

/**
 * Availability, a licence, a vehicle, a permit, moving for work — all of it optional, none of it asked in
 * turn. What is marked or typed is kept; what is left alone says nothing (it is not a "no"), and
 * answering nothing is the card's own "No aplica".
 */
export function PracticalControl({ onSubmit }: { onSubmit: (answer: Partial<Practical>) => void }) {
  const [availability, setAvailability] = useState<Array<(typeof AVAILABILITY)[number]>>([]);
  const [licence, setLicence] = useState("");
  const [permit, setPermit] = useState("");
  const [vehicle, setVehicle] = useState(false);
  const [relocate, setRelocate] = useState(false);
  const ready = availability.length > 0 || licence.trim() !== "" || permit.trim() !== "" || vehicle || relocate;

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        onSubmit({
          // In the order they are listed, not the order they were tapped.
          availability: AVAILABILITY.filter((option) => availability.includes(option)).join(", "),
          driverLicense: licence,
          workEligibility: permit,
          ownVehicle: vehicle,
          willingToRelocate: relocate,
        });
      }}
    >
      <div>
        <span className={CAPTION}>Disponibilidad</span>
        <MultiChips label="Disponibilidad" options={AVAILABILITY.map((option) => ({ value: option, label: option }))} value={availability} onChange={setAvailability} />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Licencia de conducir" hint="La categoría, como figura en tu licencia. Vacío si no tenés.">
          <Input value={licence} maxLength={80} onChange={(event) => setLicence(event.target.value)} autoComplete="off" />
        </Field>
        <Field label="Permiso de trabajo" hint="Solo si el puesto lo pide. Podés dejarlo vacío.">
          <Input value={permit} maxLength={200} onChange={(event) => setPermit(event.target.value)} autoComplete="off" />
        </Field>
      </div>
      <div className="space-y-3">
        <Checkbox label="Tengo vehículo propio" checked={vehicle} onChange={(event) => setVehicle(event.target.checked)} />
        <Checkbox label="Puedo mudarme por trabajo" checked={relocate} onChange={(event) => setRelocate(event.target.checked)} />
      </div>
      <Button type="submit" disabled={!ready}>
        Guardar
      </Button>
    </form>
  );
}

// --- A credential whose date is near or past -----------------------------------------------------------------------

const THIS_YEAR = new Date().getFullYear();

/**
 * «¿Hiciste la renovación?». Closed answers: yes — and then the date it holds until now, which is all that is asked — or that it no
 * longer applies, which sets it aside. Not having done it yet, «Todavía no», is an answer of the same weight where the screen gives it one
 * (`onLater`): the question comes back, and nothing is kept in the meantime, because nothing has changed. A renewal whose new date is not
 * known is a way out too: it takes the date off, and a credential with no date is not asked about.
 */
export function RenewalControl({ onRenewed, onNoLonger, onLater }: { onRenewed: (expires: DateValue | null) => void; onNoLonger: () => void; onLater?: (() => void) | undefined }) {
  const [renewed, setRenewed] = useState(false);
  const [expires, setExpires] = useState<DateValue>({});
  return (
    <div className="space-y-4">
      <ChoiceButtons
        label="Renovación"
        value={renewed ? "yes" : undefined}
        options={[
          { value: "yes", label: "Sí, la hice" },
          // Not having done it yet is the answer to the question as much as the other two, and it is how this card puts the question off.
          ...(onLater ? [{ value: "later", label: "Todavía no" }] : []),
          { value: "no_longer", label: "Ya no corresponde" },
        ]}
        onPick={(picked) => (picked === "no_longer" ? onNoLonger() : picked === "later" ? onLater?.() : setRenewed(true))}
      />
      {renewed ? (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (expires.year !== undefined) onRenewed(expires);
          }}
        >
          <MonthYearPicker label="Vence ahora" value={expires} newest={THIS_YEAR + EXPIRY_YEARS_AHEAD} oldest={THIS_YEAR} onChange={setExpires} />
          <Row>
            <Button type="submit" disabled={expires.year === undefined}>
              Guardar
            </Button>
            <Button type="button" variant="ghost" onClick={() => onRenewed(null)}>
              No sé hasta cuándo
            </Button>
          </Row>
        </form>
      ) : null}
    </div>
  );
}

// --- What was said about how they can work ------------------------------------------------------------------------------

/**
 * «¿Sigue igual?»: one tap to say it does. If something changed, the same fields as in the profile, filled with what they said, to
 * correct here and send with «Listo». What is touched stays in the card until then and is not written to the profile as each field
 * is: an edit is the person standing behind what they said, which is what is being asked, and the question would be gone from under
 * their hands with the first one. The answer is the same either way — they have just looked at it, and said so.
 */
export function ConditionsControl({
  current,
  onSame,
  onChanged,
  onLater,
}: {
  current: Practical;
  onSame: () => void;
  onChanged: (next: Practical) => void;
  /** «Ahora no»: not now, and nothing is kept. */
  onLater?: (() => void) | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Practical>(current);
  if (!editing) {
    // Three answers of the same weight: «Sigue igual» is the easy one, and none of them is the one to nudge towards — it is not asked for the sake of the tap.
    return (
      <Row>
        <Button type="button" variant="secondary" onClick={onSame}>
          Sigue igual
        </Button>
        <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
          Cambió algo
        </Button>
        {onLater ? (
          <Button type="button" variant="secondary" onClick={onLater}>
            Ahora no
          </Button>
        ) : null}
      </Row>
    );
  }
  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        onChanged(values);
      }}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Disponibilidad horaria">
            <Input value={values.availability} maxLength={200} onChange={(event) => setValues({ ...values, availability: event.target.value })} autoComplete="off" />
          </Field>
        </div>
        <Field label="Licencia de conducir" hint="La categoría, como figura en tu licencia. Vacío si no tenés.">
          <Input value={values.driverLicense} maxLength={80} onChange={(event) => setValues({ ...values, driverLicense: event.target.value })} autoComplete="off" />
        </Field>
        <Field label="Permiso de trabajo" hint="Solo si el puesto lo pide. Podés dejarlo vacío.">
          <Input value={values.workEligibility} maxLength={200} onChange={(event) => setValues({ ...values, workEligibility: event.target.value })} autoComplete="off" />
        </Field>
      </div>
      <div className="space-y-3">
        <Checkbox label="Tengo vehículo propio" checked={values.ownVehicle} onChange={(event) => setValues({ ...values, ownVehicle: event.target.checked })} />
        <Checkbox label="Puedo mudarme por trabajo" checked={values.willingToRelocate} onChange={(event) => setValues({ ...values, willingToRelocate: event.target.checked })} />
      </div>
      <Button type="submit">Listo</Button>
    </form>
  );
}

// --- A job that is going on ------------------------------------------------------------------------------------------

type CurrentJobStep =
  | { at: "ask" }
  /** «¿Cuándo terminó?» */
  | { at: "ended" }
  /** «¿Empezaste en otro lado?», once it is said when it ended. */
  | { at: "next"; end: DateValue }
  /** The job they went on to — where, as what, and from when —, after the end of this one or in its place. */
  | { at: "job"; how: "ended" | "moved"; end?: DateValue; sameCompany: boolean }
  /** «¿Qué cambió?» */
  | { at: "changed" }
  /** A role or a company that was written wrong, corrected where it stands. */
  | { at: "fix" }
  /** «¿Pasó algo en este tiempo que quieras agregar?», with what was said above it. */
  | { at: "news"; status: Extract<CurrentJobAnswer["status"], { kind: "still" | "ended" }> };

/** What was said of the job, in a line: the summary above the open question, with the way back. */
function saidOfJob(status: Extract<CurrentJobAnswer["status"], { kind: "still" | "ended" }>, place: string): string {
  if (status.kind === "ended") return `Terminó en ${spelledDate(status.end)}.`;
  return status.role !== undefined || status.company !== undefined ? "Corregimos un dato del puesto." : `Seguís ${place}.`;
}

/**
 * «¿Seguís en…?», and what happened since. «Sí, sigo», «Ya terminé», «Cambió algo» and «Ahora no», four buttons of the same weight: none of them is the
 * one to nudge towards, and the card has no row of its own for putting it off.
 *
 *  - «Ya terminé» asks when, and then whether they started somewhere else: if they did, that is a job of its own, with where, as what and from when.
 *  - «Cambió algo» asks what: another role at the same place, or another place — each a new job from the date they say, which the one before gives
 *    way to — or a role or a company that was written wrong, corrected where it stands. The company is never written over the one that was: it is where
 *    they worked, and where they work now is another line.
 *  - The open question that is the reason to ask at all — said without an example of what to say (an example is what gets copied): «¿Pasó algo en este
 *    tiempo que quieras agregar?» — is asked when nothing else was started: what happened is about this job, and when they went on to another it is that
 *    one's to tell, and the questions of a job with nothing in it ask it. «Nada nuevo» is as complete an answer as what is told, and sits beside it.
 *
 * Nothing is kept until the last of the steps: the first answer is the person standing behind the job, and a card that took it as soon as it was given
 * would be gone before the second could be asked. The summary of what was said stays above it, with the way back.
 */
export function CurrentJobControl({
  job,
  error,
  onSubmit,
  onLater,
}: {
  job: StoredExperience;
  error?: string | null | undefined;
  onSubmit: (answer: CurrentJobAnswer) => void;
  /** «Ahora no»: not now, and nothing is kept. */
  onLater?: (() => void) | undefined;
}) {
  const [step, setStep] = useState<CurrentJobStep>({ at: "ask" });
  const [end, setEnd] = useState<DateValue>({});
  const [role, setRole] = useState("");
  const [company, setCompany] = useState("");
  const [start, setStart] = useState<DateValue>({});
  const [fixRole, setFixRole] = useState(job.role.value);
  const [fixCompany, setFixCompany] = useState(job.company.value);
  const place = job.company.value.trim() ? `en ${job.company.value.trim()}` : job.role.value.trim() ? `como ${job.role.value.trim()}` : "en este puesto";

  /** The form of the job they went on to, with the company they had when it is another role at the same place. */
  const startJob = (how: "ended" | "moved", sameCompany: boolean, endedAt?: DateValue) => {
    setRole("");
    setCompany(sameCompany ? job.company.value.trim() : "");
    setStart({});
    setStep({ at: "job", how, sameCompany, ...(endedAt ? { end: endedAt } : {}) });
  };
  const back = () => setStep({ at: "ask" });

  if (step.at === "news") {
    const { status } = step;
    return (
      <div className="space-y-4">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
          <span>{saidOfJob(status, place)}</span>
          {/* Back to where it was said, with what was put there: the date for a job that ended, the fields of what was corrected, the choices for the rest. */}
          <button
            type="button"
            onClick={() => setStep(status.kind === "ended" ? { at: "ended" } : status.role !== undefined || status.company !== undefined ? { at: "fix" } : { at: "ask" })}
            className="text-ink-3 underline decoration-oro-soft underline-offset-4 hover:text-ink pointer-coarse:-my-3 pointer-coarse:py-3"
          >
            Cambiar
          </button>
        </p>
        <p className="text-[15px] text-ink">¿Pasó algo en este tiempo que quieras agregar?</p>
        <NarrativeControl
          label="Lo que pasó en este tiempo"
          submitLabel="Agregar"
          note={null}
          onSubmit={(news) => onSubmit({ status, news })}
          alongside={
            <Button type="button" variant="secondary" onClick={() => onSubmit({ status, news: "" })}>
              Nada nuevo
            </Button>
          }
        />
        <Error>{error}</Error>
      </div>
    );
  }

  if (step.at === "ended") {
    return (
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (end.year !== undefined) setStep({ at: "next", end });
        }}
      >
        <MonthYearPicker label="¿Cuándo terminó?" value={end} newest={new Date().getFullYear()} oldest={job.start.value.year ?? new Date().getFullYear() - 40} onChange={setEnd} />
        <Row>
          <Button type="submit" disabled={end.year === undefined}>
            Seguir
          </Button>
          <Button type="button" variant="ghost" onClick={back}>
            Atrás
          </Button>
        </Row>
      </form>
    );
  }

  if (step.at === "next") {
    const { end: endedAt } = step;
    return (
      <div className="space-y-4">
        <p className="text-sm text-ink-2">Terminó en {spelledDate(endedAt)}.</p>
        <p className="text-[15px] text-ink">¿Empezaste en otro lado?</p>
        <ChoiceButtons
          label="Otro trabajo"
          options={[
            { value: "yes", label: "Sí" },
            { value: "no", label: "No" },
          ]}
          onPick={(picked) => (picked === "yes" ? startJob("ended", false, endedAt) : setStep({ at: "news", status: { kind: "ended", end: endedAt } }))}
        />
        <Row>
          <Button type="button" variant="ghost" onClick={() => setStep({ at: "ended" })}>
            Atrás
          </Button>
        </Row>
      </div>
    );
  }

  if (step.at === "job") {
    const { how, sameCompany, end: endedAt } = step;
    const ready = (company.trim() !== "" || role.trim() !== "") && start.year !== undefined;
    return (
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready) return;
          const next = { company: company.trim(), role: role.trim(), start };
          onSubmit({ status: how === "ended" && endedAt ? { kind: "ended", end: endedAt, next } : { kind: "moved", next }, news: "" });
        }}
      >
        <p className="text-[15px] text-ink">{how === "ended" ? "¿Dónde empezaste?" : sameCompany ? "¿Qué puesto tenés ahora?" : "¿Dónde y en qué puesto?"}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {sameCompany ? null : (
            <Field label="Empresa o lugar">
              <Input value={company} maxLength={JOB_NAME_MAX} onChange={(event) => setCompany(event.target.value)} autoComplete="off" />
            </Field>
          )}
          <Field label="Puesto">
            <Input value={role} maxLength={JOB_NAME_MAX} onChange={(event) => setRole(event.target.value)} autoComplete="off" />
          </Field>
        </div>
        {sameCompany ? <p className="text-sm text-ink-3">Empresa o lugar: {company}.</p> : null}
        <MonthYearPicker label="¿Desde cuándo?" value={start} newest={new Date().getFullYear()} oldest={job.start.value.year ?? new Date().getFullYear() - 40} onChange={setStart} />
        <Row>
          <Button type="submit" disabled={!ready}>
            Guardar
          </Button>
          <Button type="button" variant="ghost" onClick={() => setStep(how === "ended" && endedAt ? { at: "next", end: endedAt } : { at: "changed" })}>
            Atrás
          </Button>
        </Row>
        <Error>{error}</Error>
      </form>
    );
  }

  if (step.at === "changed") {
    return (
      <div className="space-y-4">
        <p className="text-[15px] text-ink">¿Qué cambió?</p>
        <ChoiceButtons
          label="Qué cambió"
          options={[
            // Another role at the same place needs a place that has a name.
            ...(job.company.value.trim() ? [{ value: "role", label: "Mi puesto, en el mismo lugar" }] : []),
            { value: "place", label: "Cambié de lugar" },
            { value: "fix", label: "Había un dato mal escrito" },
          ]}
          onPick={(picked) => (picked === "fix" ? setStep({ at: "fix" }) : startJob("moved", picked === "role"))}
        />
        <Row>
          <Button type="button" variant="ghost" onClick={back}>
            Atrás
          </Button>
        </Row>
      </div>
    );
  }

  if (step.at === "fix") {
    const edited = { role: fixRole.trim() !== job.role.value.trim() ? fixRole.trim() : undefined, company: fixCompany.trim() !== job.company.value.trim() ? fixCompany.trim() : undefined };
    return (
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setStep({ at: "news", status: { kind: "still", ...(edited.role ? { role: edited.role } : {}), ...(edited.company ? { company: edited.company } : {}) } });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Puesto">
            <Input value={fixRole} maxLength={JOB_NAME_MAX} onChange={(event) => setFixRole(event.target.value)} autoComplete="off" />
          </Field>
          <Field label="Empresa o lugar">
            <Input value={fixCompany} maxLength={JOB_NAME_MAX} onChange={(event) => setFixCompany(event.target.value)} autoComplete="off" />
          </Field>
        </div>
        <Row>
          <Button type="submit">Seguir</Button>
          <Button type="button" variant="ghost" onClick={() => setStep({ at: "changed" })}>
            Atrás
          </Button>
        </Row>
      </form>
    );
  }

  return (
    <ChoiceButtons
      label="Puesto actual"
      options={[
        { value: "still", label: "Sí, sigo" },
        { value: "ended", label: "Ya terminé" },
        { value: "changed", label: "Cambió algo" },
        ...(onLater ? [{ value: "later", label: "Ahora no" }] : []),
      ]}
      onPick={(picked) => {
        if (picked === "still") setStep({ at: "news", status: { kind: "still" } });
        else if (picked === "ended") setStep({ at: "ended" });
        else if (picked === "changed") setStep({ at: "changed" });
        else onLater?.();
      }}
    />
  );
}

// --- Two jobs at once ------------------------------------------------------------------------------------------

export type DatePatch = { start: DateValue; end: DateValue & { current?: boolean } };

export function OverlapControl({
  jobs,
  names,
  onConfirm,
  onFix,
}: {
  jobs: readonly [StoredExperience, StoredExperience];
  /** What to call each job, when the company alone would name both. */
  names?: readonly [string, string] | undefined;
  onConfirm: () => void;
  onFix: (patches: Array<{ id: string } & DatePatch>) => void;
}) {
  const [fixing, setFixing] = useState(false);
  const [dates, setDates] = useState(() =>
    jobs.map((job) => ({ id: job.id, start: job.start.value, end: job.end.value })),
  );
  const patch = (index: number, change: Partial<DatePatch>) =>
    setDates((current) => current.map((entry, i) => (i === index ? { ...entry, ...change } : entry)));

  if (!fixing) {
    return (
      <Row>
        <Button type="button" onClick={onConfirm}>
          Sí, fue a la vez
        </Button>
        <Button type="button" variant="secondary" onClick={() => setFixing(true)}>
          Corregir fechas
        </Button>
      </Row>
    );
  }

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        onFix(dates);
      }}
    >
      {jobs.map((job, index) => (
        <fieldset key={job.id} className="space-y-3 border border-rule p-4">
          <legend className="px-1 text-sm text-ink">{names?.[index] ?? (job.company.value || job.role.value)}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <MonthYearPicker label="Desde" value={dates[index]!.start} onChange={(start) => patch(index, { start })} />
            <div className="space-y-2">
              <MonthYearPicker
                label="Hasta"
                value={dates[index]!.end}
                disabled={Boolean(dates[index]!.end.current)}
                onChange={(end) => patch(index, { end })}
              />
              {/* Not offered for a job already marked ongoing — see the note
                  below, which sends *that* correction to the profile instead. */}
              {job.end.value.current ? null : (
                <Checkbox
                  label="Actualmente"
                  checked={Boolean(dates[index]!.end.current)}
                  onChange={(e) => patch(index, { end: e.target.checked ? { current: true } : {} })}
                />
              )}
            </div>
          </div>
          {job.end.value.current ? <p className="text-xs text-ink-3">Sigue en curso: para cambiarlo, hacelo desde tu perfil.</p> : null}
        </fieldset>
      ))}
      <Button type="submit">Guardar fechas</Button>
    </form>
  );
}

// --- The skeleton ------------------------------------------------------------------------------------------------------

export function SkeletonControl({
  field,
  onSubmit,
}: {
  field: "start" | "company" | "role";
  onSubmit: (value: string | DateValue, options?: { selfEmployed?: boolean }) => void;
}) {
  const [text, setText] = useState("");
  const [date, setDate] = useState<DateValue>({});
  const focus = useFocusOnDesktop<HTMLInputElement>();

  if (field === "start") {
    return (
      <div className="space-y-4">
        <MonthYearPicker label="Desde" value={date} onChange={setDate} />
        <Button type="button" disabled={date.year === undefined} onClick={() => onSubmit(date)}>
          Guardar
        </Button>
      </div>
    );
  }
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim()) onSubmit(text);
      }}
    >
      <Field label={field === "company" ? ENTRY_LABELS.job.where : ENTRY_LABELS.job.what}>
        <Input ref={focus} value={text} maxLength={JOB_NAME_MAX} onChange={(event) => setText(event.target.value)} autoComplete="off" />
      </Field>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={!text.trim()}>
          Guardar
        </Button>
        {/* For the freelancer, the one who took odd jobs, the family shop: a place that is not an employer. It is picked, never guessed. */}
        {field === "company" ? (
          <Button type="button" variant="secondary" onClick={() => onSubmit(SELF_EMPLOYED, { selfEmployed: true })}>
            {SELF_EMPLOYED}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/**
 * The start of several jobs, one row each: a month and a year to pick for the ones they remember, and a blank for the ones
 * they do not — a blank is not an answer, so it saves nothing and the job stays a question. «Guardar todo» saves the rows that
 * have a year, and is off until one does.
 */
export function SkeletonBatchControl({
  rows,
  onSubmit,
}: {
  rows: ReadonlyArray<{ experienceId: string; label: string }>;
  onSubmit: (entries: Array<{ experienceId: string; start: DateValue }>) => void;
}) {
  const [dates, setDates] = useState<Record<string, DateValue>>({});
  const filled = rows.filter((row) => dates[row.experienceId]?.year !== undefined);
  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (filled.length > 0) onSubmit(filled.map((row) => ({ experienceId: row.experienceId, start: dates[row.experienceId]! })));
      }}
    >
      <ul className="space-y-4">
        {rows.map((row) => (
          <li key={row.experienceId}>
            <MonthYearPicker label={row.label} value={dates[row.experienceId] ?? {}} onChange={(value) => setDates((current) => ({ ...current, [row.experienceId]: value }))} />
          </li>
        ))}
      </ul>
      <Button type="submit" disabled={filled.length === 0}>
        Guardar todo
      </Button>
    </form>
  );
}

/**
 * Which of a job's lines the person picks — «¿Qué te sirve para …?» — as boxes to tick, and the way out when none is. Nothing is
 * ticked to begin with and the lines are shown as they were said: a pre-ticked box is an answer given for them.
 */
export function PickFactsControl({
  facts,
  none,
  onSubmit,
}: {
  facts: ReadonlyArray<{ id: string; text: string }>;
  none: string;
  onSubmit: (ids: string[]) => void;
}) {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setTicked((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (ticked.size > 0) onSubmit(facts.filter((fact) => ticked.has(fact.id)).map((fact) => fact.id));
      }}
    >
      <ul className="space-y-3">
        {facts.map((fact) => (
          <li key={fact.id}>
            <Checkbox label={fact.text} checked={ticked.has(fact.id)} onChange={() => toggle(fact.id)} className="items-start gap-3 text-sm" />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={ticked.size === 0}>
          Guardar
        </Button>
        <Button type="button" variant="ghost" onClick={() => onSubmit([])}>
          {none}
        </Button>
      </div>
    </form>
  );
}

// --- Something to add: a stretch with nothing, a first experience ------------------------------------------------------

const ADD_KINDS: ReadonlyArray<{ value: EntryKind; label: string }> = ENTRY_KINDS.map((value) => ({ value, label: ENTRY_KIND_LABEL[value] }));

/** Mini-form for one entry, after choosing what kind. `declineLabel` is the way out: "Prefiero no incluirlo", "No". */
export function AddEntryControl({
  kinds,
  initial,
  declineLabel,
  onSubmit,
  onDecline,
  onLater,
}: {
  kinds?: readonly EntryKind[];
  initial?: Partial<EntryForm>;
  declineLabel: string;
  onSubmit: (form: EntryForm) => void;
  onDecline: () => void;
  /** «Ahora no», of the same weight as the decline beside it, for a question that has no row of its own for putting it off. */
  onLater?: (() => void) | undefined;
}) {
  const options = ADD_KINDS.filter((option) => !kinds || kinds.includes(option.value));
  const only = options.length === 1 ? options[0]!.value : null;
  // One thing that can be added is not a choice: the form is there, instead of a button that opens it.
  const [form, setForm] = useState<EntryForm | null>(() => (only ? { ...blankForm(only), ...initial, kind: only } : null));

  const start = (kind: EntryKind) => setForm({ ...blankForm(kind), ...initial, kind });

  return (
    <div className="space-y-5">
      {only ? null : <ChoiceButtons label="Qué querés agregar" value={form?.kind} options={options} onPick={start} />}
      {form ? (
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (isFilled(form)) onSubmit(form);
          }}
        >
          <EntryFormFields form={form} onChange={(patch) => setForm({ ...form, ...patch })} whatLabel={ENTRY_LABELS[form.kind].what} whereLabel={ENTRY_LABELS[form.kind].where} />
          <Button type="submit" disabled={!isFilled(form)}>
            Agregar
          </Button>
        </form>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant={onLater ? "secondary" : "ghost"} onClick={onDecline}>
          {declineLabel}
        </Button>
        {onLater ? (
          <Button type="button" variant="secondary" onClick={onLater}>
            Ahora no
          </Button>
        ) : null}
      </div>
    </div>
  );
}
