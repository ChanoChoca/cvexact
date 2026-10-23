"use client";

import { PROJECT_DESCRIPTION_MAX, type CurrentJobAnswer, type FigureAnswer } from "@/lib/onboarding/answer";
import type { EntryForm } from "@/lib/onboarding/entries";
import { jobName, type AchievementType, type Question } from "@/lib/onboarding/questions";
import { draftFor } from "@/lib/onboarding/resume";
import type { DateValue } from "@/lib/profile/dates";
import type { Practical } from "@/lib/schemas/profile";
import { isMeaningfulExperience, type CefrLevel, type SkillLevel, type StoredProfile } from "@/lib/schemas/profile-v2";
import {
  AchievementTypesControl,
  AddEntryControl,
  FigureControl,
  LevelControl,
  MonthControl,
  NarrativeControl,
  ObjectiveControl,
  OverlapControl,
  PeopleControl,
  ConditionsControl,
  CurrentJobControl,
  PickFactsControl,
  PracticalControl,
  ReasonControl,
  RESUMED_NOTE,
  RenewalControl,
  SkeletonBatchControl,
  SkeletonControl,
  SkillLevelsControl,
  SkillUsesControl,
  ToolsControl,
  type DatePatch,
} from "./QuestionControls";
import { AbbreviationControl, NotePlaceControl, StaleSkillControl, type AbbreviationHandlers, type NotePlaceHandlers, type StaleSkillHandlers } from "./CaptureControls";
import { RequirementControl, type RequirementHandlers } from "./RequirementControl";
import { TrayOffer } from "./TrayOffer";

/** What each control does when the person answers: one per kind of question. */
export type QuestionHandlers = {
  narrative: (text: string) => void;
  /** What is typed for this question and not sent yet, after a pause: kept as a draft, so a reload gives it back. */
  draft: (text: string) => void;
  /** What a project was, for the one question that asks it. */
  project: (text: string) => void;
  /** What stands out of a study, for the one question that asks it. */
  study: (text: string) => void;
  /** Which lines of a job the person picked: none is the way out, «Ninguna me sirve». */
  pickFacts: (ids: string[]) => void;
  practical: (answer: Partial<Practical>) => void;
  /** The new date a credential holds until, or `null` when the renewal was made and the date is not known. */
  renewed: (expires: DateValue | null) => void;
  /** «Ya no corresponde»: the credential is no longer theirs. */
  noLonger: () => void;
  /** What they said about how they can work still holds — they have looked at it. With what they now say when they changed it. */
  conditions: (changed?: Practical) => void;
  /** A job that is going on: still there, over or changed — and what happened in the time since. */
  currentJob: (answer: CurrentJobAnswer) => void;
  /** «Ahora no», said inside a card that has its own answers: the question is put off, the way the card's own row would put it. */
  later: () => void;
  types: (types: AchievementType[]) => void;
  noAchievements: () => void;
  figure: (answer: FigureAnswer) => void;
  people: (answer: { yes: boolean; count?: string }) => void;
  month: (month: number | null) => void;
  tools: (accepted: string[]) => void;
  skillUses: (ids: string[]) => void;
  level: (level: CefrLevel | "unknown") => void;
  overlapYes: () => void;
  overlapFix: (patches: Array<{ id: string } & DatePatch>) => void;
  /** `selfEmployed`: the answer to "¿En qué empresa o lugar…?" was "Por mi cuenta", picked rather than typed. */
  skeleton: (value: string | DateValue, options?: { selfEmployed?: boolean }) => void;
  /** The start of several jobs at once: only the rows that were given a year. */
  skeletonBatch: (entries: Array<{ experienceId: string; start: DateValue }>) => void;
  addEntry: (form: EntryForm) => void;
  objective: (value: string) => void;
  /** A line the person's own document could not place, taken as the answer: a task for "¿De qué te encargabas?", an achievement for "¿Hubo algo que mejorara?". */
  fromTray: (unassignedId: string, as: "task" | "achievement") => void;
  /** A thing that comes up in several of the offers they analysed: yes — with what it asks for —, no, or not now. */
  requirement: RequirementHandlers;
  /** What they wrote down, offered to the job it names: its sentences as tasks, «no va ahí», or not now. */
  notePlace: NotePlaceHandlers;
  /** A skill nothing has backed for years: still used, no longer, or not now. */
  skillStale: StaleSkillHandlers;
  /** A skill written as its initials: the whole name, something else, or not now. */
  abbreviation: AbbreviationHandlers;
  /** The reason for a short stay, or for the pause before a job, on the job's CV line. */
  reason: (jobId: string, text: string) => void;
  /** What they marked of how well they know their skills: only the ones they tapped. */
  skillLevels: (levels: Record<string, SkillLevel>) => void;
  decline: () => void;
};

/** The control that answers this question. */
export function QuestionBody({
  question,
  profile,
  handlers,
  error,
}: {
  question: Question;
  profile: StoredProfile;
  handlers: QuestionHandlers;
  error?: string | null;
}) {
  const { control } = question;
  switch (control.kind) {
    case "narrative": {
      // What was being typed comes before what they said at the start: it is the more recent of the two.
      const typed = draftFor(profile, question.id);
      return (
        <>
          <NarrativeControl label={question.text} onSubmit={handlers.narrative} initial={typed ?? control.initial} note={typed ? RESUMED_NOTE : undefined} onDraft={handlers.draft} />
          {question.experienceId ? <TrayOffer profile={profile} jobId={question.experienceId} as="task" onTake={(id) => handlers.fromTray(id, "task")} /> : null}
        </>
      );
    }
    case "project": {
      const typed = draftFor(profile, question.id);
      return <NarrativeControl label={question.text} onSubmit={handlers.project} initial={typed} note={RESUMED_NOTE} onDraft={handlers.draft} maxLength={PROJECT_DESCRIPTION_MAX} />;
    }
    case "pick-facts":
      return <PickFactsControl facts={control.facts} none={control.none} onSubmit={handlers.pickFacts} />;
    case "study": {
      const typed = draftFor(profile, question.id);
      return <NarrativeControl label={question.text} onSubmit={handlers.study} initial={typed} note={RESUMED_NOTE} onDraft={handlers.draft} />;
    }
    case "practical":
      return <PracticalControl onSubmit={handlers.practical} />;
    case "renewal":
      return <RenewalControl onRenewed={handlers.renewed} onNoLonger={handlers.noLonger} onLater={handlers.later} />;
    case "current-job": {
      const job = profile.experience.find((entry) => entry.id === control.jobId);
      return job ? <CurrentJobControl job={job} error={error} onSubmit={handlers.currentJob} onLater={handlers.later} /> : null;
    }
    case "conditions":
      return <ConditionsControl current={profile.legacy.practical.value} onSame={() => handlers.conditions()} onChanged={handlers.conditions} onLater={handlers.later} />;
    case "requirement-ask":
      return (
        <RequirementControl
          ask={control.ask}
          jobs={profile.experience.filter(isMeaningfulExperience).map((job) => ({ id: job.id, label: [job.role.value, job.company.value].filter(Boolean).join(" · ") || "Sin nombre" }))}
          handlers={handlers.requirement}
        />
      );
    case "note-place":
      return <NotePlaceControl sentences={control.sentences} handlers={handlers.notePlace} />;
    case "skill-stale":
      return <StaleSkillControl handlers={handlers.skillStale} />;
    case "abbreviation":
      return <AbbreviationControl handlers={handlers.abbreviation} />;
    case "reason":
      return <ReasonControl label="El motivo, en una línea" onSubmit={(text) => handlers.reason(control.jobId, text)} onDecline={handlers.decline} />;
    case "skill-levels":
      return <SkillLevelsControl skills={control.skills} onSubmit={handlers.skillLevels} />;
    case "achievement-types":
      return (
        <>
          <AchievementTypesControl covered={control.covered} known={control.known} onSubmit={handlers.types} onNothing={handlers.noAchievements} />
          {question.experienceId ? <TrayOffer profile={profile} jobId={question.experienceId} as="achievement" onTake={(id) => handlers.fromTray(id, "achievement")} /> : null}
        </>
      );
    case "figure":
      return <FigureControl quote={control.quote} onSubmit={handlers.figure} error={error} />;
    case "people":
      return <PeopleControl onSubmit={handlers.people} error={error} />;
    case "month":
      return <MonthControl onSubmit={handlers.month} />;
    case "tools":
      return <ToolsControl tools={control.tools} onSubmit={handlers.tools} />;
    case "skill-uses":
      return <SkillUsesControl jobs={control.jobs} onSubmit={handlers.skillUses} />;
    case "level":
      return <LevelControl onPick={handlers.level} />;
    case "overlap": {
      const a = profile.experience.find((job) => job.id === control.a);
      const b = profile.experience.find((job) => job.id === control.b);
      if (!a || !b) return null;
      const jobs = profile.experience.filter(isMeaningfulExperience);
      return <OverlapControl jobs={[a, b]} names={[jobName(a, jobs), jobName(b, jobs)]} onConfirm={handlers.overlapYes} onFix={handlers.overlapFix} />;
    }
    case "skeleton":
      return <SkeletonControl key={`${question.id}:${control.field}`} field={control.field} onSubmit={handlers.skeleton} />;
    case "skeleton-batch":
      return <SkeletonBatchControl key={question.id} rows={control.rows} onSubmit={handlers.skeletonBatch} />;
    case "gap-action": {
      const entry = (
        <AddEntryControl
          initial={{ from: control.from, to: control.to }}
          declineLabel={control.decline ?? "Prefiero no incluirlo"}
          onSubmit={handlers.addEntry}
          onDecline={handlers.decline}
          onLater={control.defers ? handlers.later : undefined}
        />
      );
      const reasonJobId = control.reasonJobId;
      // A pause that was not work or study can be said in a line of the job that follows it.
      return reasonJobId ? (
        <div className="space-y-6">
          {entry}
          <div className="space-y-2 border-t border-white/10 pt-5">
            <p className="text-sm text-ink-2">¿Fue un período sin trabajo ni estudio? Podés dejar el motivo en una línea, que va debajo del puesto que sigue.</p>
            <ReasonControl label="El motivo de la pausa" onSubmit={(text) => handlers.reason(reasonJobId, text)} />
          </div>
        </div>
      ) : (
        entry
      );
    }
    case "objective":
      return <ObjectiveControl suggestions={control.suggestions} onSubmit={handlers.objective} />;
    case "extra":
      // Not "No, por ahora no": next to the card's own "Ahora no" it would read as the same button, and this one settles it.
      return <AddEntryControl kinds={control.kinds ?? ["internship", "teaching", "student_org", "research", "project", "volunteer"]} declineLabel={control.decline ?? "Nada que agregar"} onSubmit={handlers.addEntry} onDecline={handlers.decline} />;
  }
}
