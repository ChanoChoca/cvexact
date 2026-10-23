"use client";

import { useMemo, useState } from "react";
import { Alert, Badge, Button, CollapsibleCard, Textarea } from "@/components/ui";
import { ChoiceButtons } from "@/components/ui/Chips";
import { buildEvidenceIndex, findUnsupportedTerms } from "@/lib/ai/evidence";
import type { Coverage } from "@/lib/schemas/cv";
import type { InferredSkill, JobAnalysis } from "@/lib/schemas/job";
import type { Profile } from "@/lib/schemas/profile";
import { coverageAudit, type Finding } from "@/lib/ai/verify";
import { scoreJobAnalysis } from "@/lib/jobs/score";
import { askedAgain, declinedKey } from "@/lib/profile/declined";
import { askedAgainQuestion } from "@/lib/jobs/requirement-ask";
import { whenWords } from "@/lib/profile/sync-status";
import type { Declined } from "@/lib/schemas/profile-v2";
import { normalizeForComparison } from "@/lib/text/normalize";

/**
 * Everything the user needs to audit a generated CV before sending it: what the
 * job asked for and whether it is covered, what was left out and why, which
 * skills were derived rather than stated, and any structural fabrication the
 * verifier caught.
 */

const RELEVANCE_COPY: Record<
  JobAnalysis["relevance"],
  { tone: "good" | "info" | "warn"; label: string; detail: string }
> = {
  direct: {
    tone: "good",
    label: "Tu mismo rubro",
    detail: "El CV profundiza en lo técnico y espeja el vocabulario de la oferta.",
  },
  adjacent: {
    tone: "info",
    label: "Rubro cercano",
    detail:
      "Se mantiene tu experiencia pero reenfocada hacia lo que pide este puesto.",
  },
  unrelated: {
    tone: "warn",
    label: "Fuera de tu rubro",
    detail:
      "Se reescribió tu experiencia en habilidades transferibles, se sacó la jerga técnica y se reordenaron las secciones para lo que este puesto valora.",
  },
};

/** Badge tone for the match score — see `lib/jobs/score.ts` for how it's built. */
function scoreTone(score: number): "good" | "info" | "warn" {
  if (score >= 70) return "good";
  if (score >= 40) return "info";
  return "warn";
}

/**
 * Only the fit signals worth a sentence: a clean match on any axis is the
 * expected case and saying so on every posting would be noise nobody reads,
 * the same call `RELEVANCE_COPY` makes about `relevanceReason`. What is worth
 * surfacing is where this posting asks for something the profile does not
 * show — the reader can act on that before generating anything.
 */
export function fitNotes(match: ReturnType<typeof scoreJobAnalysis>, objective: string): string[] {
  const notes: string[] = [];
  // What the person said they are after, against what this posting is: a difference worth knowing before generating, not
  // a verdict — the title is read by its words, and the CV is made from what the posting asks either way.
  if (match.objectiveFit === "mismatch") notes.push(`Tu objetivo dice «${objective.trim()}» y este puesto apunta a otra cosa: si te postulás igual, el CV se arma con lo que pide el aviso.`);
  if (match.seniorityFit === "under") notes.push("Pide más experiencia de la que tu perfil muestra.");
  if (match.seniorityFit === "over") notes.push("Tu perfil muestra más experiencia de la que este puesto pide.");
  if (match.locationFit === "mismatch") notes.push("No es remoto y tu perfil no dice que puedas mudarte.");
  if (match.locationFit === "relocatable") notes.push("No es remoto, pero tu perfil dice que podés mudarte.");
  if (match.languageFit === false) notes.push("Pide un idioma que tu perfil no declara.");
  return notes;
}

export function AnalysisPanel({
  analysis,
  profile,
}: {
  analysis: JobAnalysis;
  profile: Profile;
}) {
  const relevance = RELEVANCE_COPY[analysis.relevance];
  const match = useMemo(() => scoreJobAnalysis(profile, analysis), [profile, analysis]);
  const notes = fitNotes(match, profile.objective);

  return (
    <CollapsibleCard
      title={analysis.title || "Puesto"}
      action={
        <div className="flex items-center gap-2">
          <Badge tone={scoreTone(match.score)}>{match.score}% compatible</Badge>
          <Badge tone={relevance.tone}>{relevance.label}</Badge>
        </div>
      }
    >
      <dl className="space-y-1 text-sm">
        {analysis.company ? (
          <div className="flex gap-2">
            <dt className="text-ink-3">Empresa:</dt>
            <dd className="min-w-0 wrap-break-word text-ink">{analysis.company}</dd>
          </div>
        ) : null}
        {analysis.location ? (
          <div className="flex gap-2">
            <dt className="text-ink-3">Lugar:</dt>
            <dd className="min-w-0 wrap-break-word text-ink">{analysis.location}</dd>
          </div>
        ) : null}
        <div className="flex gap-2">
          <dt className="text-ink-3">Idioma detectado:</dt>
          <dd className="text-ink uppercase">{analysis.language}</dd>
        </div>
      </dl>
      <p className="mt-3 text-sm text-ink-2">{relevance.detail}</p>
      <p className="mt-1 wrap-break-word text-xs text-ink-3">{analysis.relevanceReason}</p>

      {match.keywords.supported.length > 0 || match.keywords.fabricable.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {match.keywords.supported.slice(0, 8).map((term) => (
            <Badge key={`s-${term}`} tone="good">
              {term}
            </Badge>
          ))}
          {match.keywords.fabricable.slice(0, 8).map((term) => (
            <Badge key={`f-${term}`} tone="warn">
              {term}
            </Badge>
          ))}
        </div>
      ) : null}

      {notes.length > 0 ? (
        <p className="mt-2 text-xs text-ink-3">{notes.join(" ")}</p>
      ) : null}

      {match.blocking.length > 0 ? (
        <div className="mt-3">
          <Alert tone="warn" title="Antes de generar, revisá esto" role="status">
            <ul className="list-disc space-y-1 pl-4">
              {match.blocking.map((b) => (
                <li key={b.requirement}>
                  <span className="text-ink">{b.requirement}</span> — {b.reason}
                </li>
              ))}
            </ul>
          </Alert>
        </div>
      ) : null}
    </CollapsibleCard>
  );
}

/**
 * An uncovered requirement, offered back to the user as a question.
 *
 * The panel used to be read-only: it named what the posting asked for and the
 * profile could not answer, and there it ended. But a gap is very often not a
 * gap — it is something the user does do and never wrote down, and every later
 * application inherits the same hole. Asking here is the only moment the user
 * is looking straight at it.
 *
 * The question is "did you use it", never "do you want to add it". A panel that
 * nudges toward a yes is a panel that writes a claim which collapses in the
 * first ten minutes of an interview, which is the exact failure the CV prompt
 * spends a paragraph avoiding.
 */
/**
 * The hint in the box where someone says where they used a tool the offer asked for: the shape of the answer and
 * nothing of its content, as the onboarding's own boxes do (`questions.ts`). A sample sentence is what
 * somebody unsure of what to say copies, and the one this replaced — staging and production environments — was
 * written for any term at all, for a cook as much as for an engineer. A question and not an instruction, which in
 * voseo would read as one and get typed back literally.
 */
export const claimPlaceholder = (term: string) => `Qué hiciste con ${term}, dónde y para qué…`;

/** Where someone says where they used what an offer asked for: the one line that goes to their profile and serves every posting. */
export function ClaimForm({
  terms,
  jobs,
  onClaim,
  onCancel,
  question,
  placeholder,
  className = "mt-2 space-y-2",
}: {
  terms: string[];
  jobs: ReadonlyArray<{ id: string; label: string }>;
  onClaim: (where: string, jobId: string | null) => void;
  onCancel: () => void;
  /** What is asked above the box, when it is not about a tool: «¿Dónde lo hiciste?». */
  question?: string;
  placeholder?: string;
  className?: string;
}) {
  const [where, setWhere] = useState("");
  const [jobId, setJobId] = useState<string | null>(jobs[0]?.id ?? null);
  // A requirement can name several missing tools; the button has to stay a button.
  const label = terms.slice(0, 3).join(", ");
  return (
    <div className={className}>
      <label className="block text-xs text-ink-2">
        {question ?? `¿Dónde usaste ${label}?`} Una línea alcanza — va a tu perfil y sirve para todas las postulaciones.
      </label>
      {jobs.length > 1 ? (
        <ChoiceButtons
          label="En qué puesto"
          value={jobId ?? undefined}
          options={jobs.map((job) => ({ value: job.id, label: job.label }))}
          onPick={setJobId}
          className="text-xs"
        />
      ) : null}
      <Textarea rows={2} autoFocus value={where} onChange={(e) => setWhere(e.target.value)} placeholder={placeholder ?? claimPlaceholder(terms[0] ?? label)} />
      <div className="flex flex-wrap gap-2">
        <Button disabled={where.trim().length < 10} onClick={() => onClaim(where.trim(), jobId)}>
          Guardar en mi perfil
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

/**
 * What can be said to a tool or a credential the offer asked for and the profile has nothing about, in two answers of the same weight —
 * «Sí, usé…» and «No lo tengo» — because neither of them is the one to nudge towards. A «no» is kept in the profile with its date, and is not
 * asked again in the next posting.
 *
 * Asked a second time, a year after a «no», it says the day it was said and gives the second answer its own words — «Sigue siendo no» —, which is
 * the last: it is not asked a third time.
 */
function GapAction({
  terms,
  jobs,
  again,
  now,
  onClaim,
  onDecline,
  onKeep,
}: {
  terms: string[];
  /** The user's own roles, to ask which one this belongs to — never guessed. */
  jobs: ReadonlyArray<{ id: string; label: string }>;
  /** The day they said no, when this is the second time it is asked. */
  again?: string | undefined;
  now: Date;
  onClaim: (where: string, jobId: string | null) => void;
  onDecline: () => void;
  onKeep: () => void;
}) {
  const [claiming, setClaiming] = useState(false);
  const label = terms.slice(0, 3).join(", ");

  if (claiming) return <ClaimForm terms={terms} jobs={jobs} onClaim={(where, jobId) => { onClaim(where, jobId); setClaiming(false); }} onCancel={() => setClaiming(false)} />;

  return (
    <div className="mt-1.5 space-y-1.5">
      {again ? (
        <p className="text-xs text-ink-3" data-declined-again>
          {askedAgainQuestion(again, now)}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => setClaiming(true)}>
          Sí, usé {label}
        </Button>
        <Button variant="secondary" className="px-2 py-1 text-xs" onClick={again ? onKeep : onDecline}>
          {again ? "Sigue siendo no" : "No lo tengo"}
        </Button>
      </div>
    </div>
  );
}

/** What was said no to, said where it would have been offered: the day, and the way back — «Ya lo tengo» — which is theirs to take and is not an offer. */
function DeclinedNote({
  terms,
  at,
  now,
  jobs,
  onClaim,
}: {
  terms: string[];
  at: string;
  now: Date;
  jobs: ReadonlyArray<{ id: string; label: string }>;
  onClaim: (where: string, jobId: string | null) => void;
}) {
  const [claiming, setClaiming] = useState(false);
  if (claiming) return <ClaimForm terms={terms} jobs={jobs} onClaim={(where, jobId) => { onClaim(where, jobId); setClaiming(false); }} onCancel={() => setClaiming(false)} />;
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3" data-declined-note>
      <span>
        Anotaste {whenWords(at, now)} que no tenés {terms.slice(0, 3).join(", ")}.
      </span>
      <button
        type="button"
        onClick={() => setClaiming(true)}
        className="underline decoration-oro-soft underline-offset-4 hover:text-ink pointer-coarse:-my-3.5 pointer-coarse:py-3.5"
      >
        Ya lo tengo
      </button>
    </p>
  );
}

export function CoveragePanel({
  coverage,
  analysis,
  profile,
  dismissed = [],
  declined = [],
  now = new Date(),
  onClaim,
  onDecline,
  onKeep,
}: {
  coverage: Coverage;
  /**
   * The posting itself, which is what the ratio has to be denominated in.
   * Optional so an application saved before this existed still renders — those
   * fall back to the model's own arithmetic, which is what they were shown.
   */
  analysis?: JobAnalysis;
  /**
   * Needed to work out which named technology a requirement is missing. The
   * same calculation `serializeJobMatch` runs server-side; `lib/ai/evidence.ts`
   * is pure, so it runs here too and no API changes.
   */
  profile?: Profile;
  /** Requirements put off for this posting in an application saved before the answer was removed: still left alone. */
  dismissed?: string[];
  /** What the person said no to, in the profile, with its day: not offered again in any posting, until it is asked once more. */
  declined?: ReadonlyArray<Declined>;
  /** Today, for the day a «no» was said and for when a year has gone by. */
  now?: Date;
  /** Receives the terms the user claims, the sentence they gave, and which of their roles it belongs to. */
  onClaim?: (terms: string[], where: string, jobId: string | null) => void;
  /** «No lo tengo»: the terms, and the line of the offer that asked for them, to be kept in the profile with the day. */
  onDecline?: (terms: string[], requirement: string) => void;
  /** «Sigue siendo no», the second asking answered the same: it was asked, and it is not asked again. */
  onKeep?: (terms: string[]) => void;
}) {
  // The user's own roles, for the chip picker: the panel never guesses which one a claim belongs to.
  const jobOptions = useMemo(
    () => (profile?.experience ?? []).map((job) => ({ id: job.id, label: [job.role, job.company].filter(Boolean).join(" · ") || "Sin nombre" })),
    [profile],
  );
  /**
   * The audit re-derives the report from the posting instead of trusting its own
   * arithmetic. Measured on real runs, a waiting job with 2 requirements came
   * back with 8 rows and showed 6/8; a groundskeeping ad with 3 came back with
   * 10 and showed 76%. Both were 1 of the requirements that existed.
   */
  const audit = useMemo(
    () => (analysis ? coverageAudit({ coverage }, analysis) : null),
    [coverage, analysis],
  );

  // Rows the posting actually asked for, in the posting's own order and wording,
  // so a requirement the model never reported still appears — as uncovered.
  const asked = audit
    ? audit.rows.map((row) => ({
        requirement: row.requirement,
        covered: row.covered,
        evidence: row.entry?.evidence ?? "El informe no dijo nada sobre este punto.",
        inferred: row.entry?.inferred ?? false,
        excluding: row.excluding,
        kind: row.kind,
      }))
    : [...coverage.requirements.filter((r) => r.covered), ...coverage.requirements.filter((r) => !r.covered)].map(
        (entry) => ({ ...entry, excluding: false, kind: "hard" as const }),
      );

  const ordered = [...asked.filter((r) => r.covered), ...asked.filter((r) => !r.covered)];

  /**
   * The badge counts the checkable half only.
   *
   * A CV can evidence a tool, a certification or a date range; it cannot
   * evidence "atención al detalle". Counting traits in the denominator told a
   * candidate who met 3 of 5 real requirements that they were 3 of 12 — a
   * shortfall they could not have closed with any CV, on an application worth
   * sending. The traits are still listed, because the posting asked for them
   * and the user should see them; they are just not scored.
   */
  const scored = audit ? { covered: audit.hardCovered, total: audit.hardTotal } : null;
  const softCount = asked.filter((r) => r.kind === "soft").length;
  const missingCount = scored
    ? scored.total - scored.covered
    : asked.filter((r) => !r.covered).length;

  const evidence = useMemo(
    () => (profile ? buildEvidenceIndex(profile) : null),
    [profile],
  );

  return (
    <CollapsibleCard
      title="Qué pide el puesto"
      action={
        <Badge tone={missingCount === 0 ? "good" : "warn"}>
          {scored ? `${scored.covered}/${scored.total}` : `${asked.length - missingCount}/${asked.length}`}
        </Badge>
      }
    >
      {scored && softCount > 0 ? (
        <p className="mb-2 text-xs text-ink-3">
          Sobre {scored.total} {scored.total === 1 ? "requisito concreto" : "requisitos concretos"}.
          {" "}Los otros {softCount} son rasgos personales: se listan abajo, pero ningún CV los
          demuestra y no cuentan en el puntaje.
        </p>
      ) : null}

      {asked.length === 0 ? (
        <p className="text-sm text-ink-3">No se extrajeron requisitos de la oferta.</p>
      ) : (
        <ul className="space-y-2.5">
          {ordered.map((requirement, index) => {
            // Only a requirement naming a technology can be claimed: "thrives in
            // a fast-paced environment" has nothing to add to a profile.
            const terms =
              !requirement.covered && evidence && onClaim
                ? findUnsupportedTerms(requirement.requirement, evidence)
                : [];
            // Each term the person already said no to: left alone, until a year has gone by — and then asked once more.
            const saidNo = (term: string) => declined.find((entry) => declinedKey("requirement", entry.text) === declinedKey("requirement", term));
            const askable = terms.filter((term) => {
              const entry = saidNo(term);
              return !entry || askedAgain(entry, now);
            });
            const second = askable.map(saidNo).find((entry) => entry && askedAgain(entry, now));
            const allDeclined = terms.length > 0 && terms.every((term) => saidNo(term));
            const actionable = askable.length > 0 && !dismissed.includes(requirement.requirement);

            return (
              <li key={index} className="flex gap-2.5 text-sm">
                <span
                  aria-hidden
                  className={
                    requirement.covered
                      ? "mt-0.5 text-emerald-300"
                      : "mt-0.5 text-amber-300"
                  }
                >
                  {requirement.covered ? "✓" : "○"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="wrap-break-word text-ink">
                    {requirement.requirement}
                    {requirement.excluding ? (
                      <Badge tone="warn" className="ml-2 align-middle">
                        excluyente
                      </Badge>
                    ) : null}
                    {requirement.inferred ? (
                      <Badge tone="info" className="ml-2 align-middle">
                        deducido
                      </Badge>
                    ) : null}
                  </p>
                  <p className="mt-0.5 wrap-break-word text-xs text-ink-3">{requirement.evidence}</p>
                  {actionable ? (
                    <GapAction
                      terms={askable}
                      jobs={jobOptions}
                      now={now}
                      again={second?.at}
                      onClaim={(where, jobId) => onClaim!(askable, where, jobId)}
                      onDecline={() => onDecline?.(askable, requirement.requirement)}
                      onKeep={() => onKeep?.(askable)}
                    />
                  ) : allDeclined ? (
                    <DeclinedNote terms={terms} at={saidNo(terms[0]!)!.at} now={now} jobs={jobOptions} onClaim={(where, jobId) => onClaim!(terms, where, jobId)} />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/*
        Rows the model reported on that the posting never asked for. Kept
        visible — some are genuine strengths — but out of the count, because
        counting them is exactly how a candidate who met 1 of 3 requirements was
        shown a 76% match.
      */}
      {audit && audit.extra.length > 0 ? (
        <div className="mt-5 border-t border-rule pt-4">
          <p className="mb-2 text-sm font-medium text-ink-2">
            Otros puntos que agregó el modelo
          </p>
          <p className="mb-2 text-xs text-ink-3">
            El aviso no los pide, así que no cuentan para el puntaje de arriba.
          </p>
          <ul className="space-y-1.5">
            {audit.extra.map((entry, index) => (
              <li key={index} className="text-sm text-ink-2">
                <span aria-hidden className="mr-1.5 text-ink-3">
                  {entry.covered ? "✓" : "○"}
                </span>
                {entry.requirement}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {coverage.omitted.length > 0 ? (
        <div className="mt-5 border-t border-rule pt-4">
          <p className="mb-2 text-sm font-medium text-ink-2">
            Qué se dejó afuera del CV
          </p>
          <ul className="space-y-1.5">
            {coverage.omitted.map((entry, index) => (
              <li key={index} className="text-sm text-ink-2">
                <span className="text-ink">{entry.item}</span>
                <span className="text-ink-3"> — {entry.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </CollapsibleCard>
  );
}

/**
 * Derived skills, each with the profile item it follows from, so the user can
 * veto anything that is not actually true of them. A veto is a «no» with its day
 * in the profile, and is excluded from every later generation — in this posting
 * and in the next — until they take it back; «Solo para esta postulación» keeps it
 * to this one, which is what a veto always was.
 */
export function InferredSkillsPanel({
  skills,
  rejected,
  vetoed = [],
  onToggle,
  onScope,
}: {
  skills: InferredSkill[];
  /** The skills vetoed for this posting only. */
  rejected: string[];
  /** The skills vetoed in the profile, for every posting. */
  vetoed?: ReadonlyArray<string>;
  /** A skill is unchecked, or checked again: whichever way it was vetoed, it is taken back. */
  onToggle: (skill: string, reject: boolean) => void;
  /** Moves a veto between «solo esta postulación» and «todas». */
  onScope?: (skill: string, scope: "application" | "profile") => void;
}) {
  if (skills.length === 0) return null;

  const same = (a: string, b: string) => normalizeForComparison(a) === normalizeForComparison(b);
  const inProfile = (skill: string) => vetoed.some((entry) => same(entry, skill));
  const inApplication = (skill: string) => rejected.some((entry) => same(entry, skill));
  const isRejected = (skill: string) => inProfile(skill) || inApplication(skill);

  return (
    <CollapsibleCard
      title="Habilidades deducidas de tu perfil"
      action={<Badge tone="neutral">{skills.length}</Badge>}
    >
      <p className="mb-3 text-sm text-ink-2">
        No las escribiste, pero se desprenden de lo que sí cargaste. Solo se usan si el
        puesto las pide. Destildá cualquiera que no sea cierta.
      </p>
      <ul className="space-y-2">
        {skills.map((skill) => {
          const off = isRejected(skill.skill);
          return (
            <li key={skill.skill} className="flex items-start gap-2.5">
              <input
                type="checkbox"
                id={`skill-${skill.skill}`}
                checked={!off}
                onChange={(e) => onToggle(skill.skill, !e.target.checked)}
                className="mt-1 size-4 border-rule text-ink"
              />
              <div className="min-w-0">
                <label
                  htmlFor={`skill-${skill.skill}`}
                  className="cursor-pointer wrap-break-word text-sm"
                >
                  <span className={off ? "text-ink-3 line-through" : "text-ink"}>
                    {skill.skill}
                  </span>
                  <span className="ml-2 text-xs text-ink-3">
                    de «{skill.derivedFrom}»
                  </span>
                </label>
                {off && onScope ? (
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-ink-3" data-veto-scope={inProfile(skill.skill) ? "profile" : "application"}>
                    <span>{inProfile(skill.skill) ? "Anotado en tu perfil: no la tenés." : "Solo en esta postulación."}</span>
                    <button
                      type="button"
                      onClick={() => onScope(skill.skill, inProfile(skill.skill) ? "application" : "profile")}
                      className="underline decoration-oro-soft underline-offset-4 hover:text-ink pointer-coarse:-my-3.5 pointer-coarse:py-3.5"
                    >
                      {inProfile(skill.skill) ? "Solo para esta postulación" : "Para todas mis postulaciones"}
                    </button>
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </CollapsibleCard>
  );
}

function findingList(findings: Finding[]) {
  return (
    <ul className="mt-1 list-disc space-y-1 pl-4">
      {findings.map((finding, index) => (
        <li key={index}>{finding.detail}</li>
      ))}
    </ul>
  );
}

/**
 * Output of the structural anti-fabrication check in lib/ai/verify.ts.
 *
 * The errors are what the panel is for, so they are listed; the warnings are
 * folded away behind a summary rather than padding the same list.
 * Informational only: the verifier is deliberately built to report rather
 * than throw, because a false positive must not block a legitimate CV, so the
 * last word stays the candidate's.
 */
export function FindingsPanel({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) return null;

  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity !== "error");

  if (errors.length === 0) {
    return (
      <Alert
        tone="warn"
        title={warnings.length === 1 ? "1 advertencia" : `${warnings.length} advertencias`}
      >
        {findingList(warnings)}
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      <Alert
        tone="bad"
        title={
          errors.length === 1 ? "1 error en este CV" : `${errors.length} errores en este CV`
        }
      >
        {findingList(errors)}
        <p className="mt-2 text-xs">
          Corregí el perfil y volvé a generar, o editá el CV a mano.
        </p>
      </Alert>

      {warnings.length > 0 ? (
        <Alert tone="warn">
          <details>
            <summary className="cursor-pointer text-xs underline">
              {warnings.length === 1 ? "Ver 1 advertencia" : `Ver ${warnings.length} advertencias`}
            </summary>
            {findingList(warnings)}
          </details>
        </Alert>
      ) : null}
    </div>
  );
}
