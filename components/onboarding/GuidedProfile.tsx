"use client";

import { useState, type ReactNode } from "react";
import { BaseCvPreview } from "@/components/cv/BaseCvPreview";
import { Button, CollapsibleCard } from "@/components/ui";
import { ContactBody } from "@/components/profile/hub/ContactSection";
import { EducationSection } from "@/components/profile/hub/EducationSection";
import { ExperienceSection } from "@/components/profile/hub/ExperienceSection";
import { ProjectsSection } from "@/components/profile/hub/ProjectsSection";
import { RemovedNotice, useRemovedNotice } from "@/components/profile/hub/removal";
import { SkillsSection } from "@/components/profile/hub/SkillsSection";
import { ANCHOR, SECTION_ID } from "@/components/profile/anchors";
import { goTo } from "@/components/profile/jumpTo";
import { ProfileLayout } from "@/components/profile/ProfileLayout";
import { previewFactRefs, type PreviewFactRef } from "@/lib/cv/from-profile";
import { resumeBuilder, saveBuilder } from "@/lib/onboarding/resume";
import { isBlankProfile, type StoredProfile } from "@/lib/schemas/profile-v2";
import { updateStoredProfile } from "@/lib/storage/local";
import { AnswersIllustration, AtsIllustration, TimeIllustration, WeekIllustration } from "./Illustrations";
import { ReferencePages, isPdf } from "./ReferencePages";
import { StepShell } from "./StepShell";

/**
 * The step the person is on, said as a bar: a line that fills, and the words for whoever does not see it. It stays in sight while the parts are filled in —under the
 * bar of the page on a computer, at the top of the sheet on a phone—, so that going on is seen to be going on.
 */
function Progress({ step, of }: { step: number; of: number }) {
  const text = `Paso ${step} de ${of}`;
  return (
    <div className="sticky top-0 z-10 space-y-2 bg-paper py-3 lg:top-[var(--nav-h,4.5rem)]">
      <p className="font-solar text-[12.5px] font-bold tracking-[0.18em] text-ink-3 uppercase">{text}</p>
      <div role="progressbar" aria-label="Tu avance" aria-valuemin={1} aria-valuemax={of} aria-valuenow={step} aria-valuetext={text} className="h-1.5 bg-white/10">
        <div className="h-full bg-solar-g4 transition-[width] motion-reduce:transition-none" style={{ width: `${(step / of) * 100}%` }} />
      </div>
    </div>
  );
}

/**
 * One part of the profile, as a fold that shares its `name` with the others: opening one shuts the one that was open, with no script. `open` follows the
 * step the profile says it is on, which is also what a click on another fold writes (`onOpen`), so that the browsers that do not group folds by name still
 * show one at a time.
 */
function GuidedStep({ n, title, open, onOpen, children }: { n: number; title: string; open: boolean; onOpen: () => void; children: ReactNode }) {
  return (
    <li>
      <details id={`paso-${n}`} name="guided-step" open={open} onToggle={(event) => event.currentTarget.open && onOpen()} className={`group ${ANCHOR} max-lg:scroll-mt-14!`}>
        <summary className="flex cursor-pointer list-none items-center gap-3 border-b border-rule py-3 pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
          <span aria-hidden className="font-solar flex size-8 shrink-0 items-center justify-center border border-rule text-sm font-bold text-ink-2 group-open:border-solar-g4 group-open:text-ink">
            {n}
          </span>
          <span className="min-w-0 flex-1 text-[17px] text-ink wrap-break-word">{title}</span>
          <span aria-hidden className="shrink-0 text-base text-ink-3 transition-transform group-open:rotate-90 motion-reduce:transition-none">
            ▸
          </span>
        </summary>
        <div className="space-y-4 pt-5 pb-2">{children}</div>
      </details>
    </li>
  );
}

/**
 * «De cero», guiado: the profile built a part at a time —who they are; jobs and studies; projects; skills and languages— with the CV it
 * is turning out to be beside it (or behind it, on a phone: `ProfileLayout`). The parts are the profile's own sections, filled in where they stand, so what is learned
 * here is what is found there; one is open at a time, and «Siguiente» skips what there is nothing to say about. Nothing is kept apart from the profile:
 * what is typed is in it the moment the box is left, and the step they are on is `onboarding.builder.index`, so a reload or a return lands on the same one.
 * Each part ends, before its button, with a card on what the profile is for (`Illustrations`): not a step, and nothing to press, so it never stands between
 * the person and «Siguiente».
 *
 * `reference`: a document that could not be read, kept in view to copy from.
 */
export function GuidedProfile({ profile, reference, onBack, onDone }: { profile: StoredProfile; reference?: File | undefined; onBack: () => void; onDone: () => void }) {
  const [now] = useState(() => new Date());
  const { removed, onRemoved, restore, dismiss } = useRemovedNotice();
  /** A line tapped on the sheet: its job opens, in the part that holds it, as it does on the profile. */
  const [factFocus, setFactFocus] = useState<PreviewFactRef | null>(null);
  const showFact = (ref: PreviewFactRef) => {
    setFactFocus(ref);
    goTo(SECTION_ID.experience);
  };

  const parts: ReadonlyArray<{ title: string; body: ReactNode; art: ReactNode }> = [
    {
      title: "Datos personales",
      body: (
        <div className="space-y-5 border border-rule bg-paper-2 p-5">
          <ContactBody profile={profile} />
        </div>
      ),
      art: <TimeIllustration />,
    },
    {
      title: "Experiencia laboral y formación",
      body: (
        <>
          <ExperienceSection profile={profile} onRemoved={onRemoved} focus={factFocus ?? undefined} defaultOpen autoSave />
          <EducationSection profile={profile} onRemoved={onRemoved} defaultOpen autoSave />
        </>
      ),
      art: <AtsIllustration />,
    },
    { title: "Proyectos", body: <ProjectsSection profile={profile} onRemoved={onRemoved} defaultOpen />, art: <AnswersIllustration /> },
    { title: "Habilidades, idiomas y certificaciones", body: <SkillsSection profile={profile} onRemoved={onRemoved} now={now} defaultOpen autoSave />, art: <WeekIllustration /> },
  ];
  const index = resumeBuilder(profile, parts.length);
  const blank = isBlankProfile(profile);

  /** To the part at `next`: kept in the profile, opened, and the eyes and the focus go to it — the one that was open shuts and the page moves under them. */
  const to = (next: number) => {
    updateStoredProfile((draft) => saveBuilder(draft, next));
    goTo(`paso-${next + 1}`, "summary");
  };
  /** Done with the last part: where they were is dropped with the rest of what was half done, and the flow goes on. */
  const finish = () => {
    updateStoredProfile((draft) => saveBuilder(draft, 0));
    onDone();
  };

  return (
    <>
      <StepShell
        title="Armemos tu perfil"
        intro="Cuatro pasos cortos. Saltá los que no te sirvan: lo que cargues queda guardado al instante."
        onBack={onBack}
      >
        {/* On a phone, whole for a profile with nothing in it —the parts are what the page is for, and there is nothing to see behind—; peeking for one that has been begun, which shows what there is of it, and its bar. */}
        <ProfileLayout view={<BaseCvPreview profile={profile} here factRefs={previewFactRefs(profile)} onFactClick={showFact} />} wideView {...(blank ? { startAt: "full" as const } : {})} label="Armar tu perfil">
          <Progress step={index + 1} of={parts.length} />
          {isPdf(reference) ? (
            <CollapsibleCard title="Tu documento" defaultOpen>
              <ReferencePages file={reference} />
            </CollapsibleCard>
          ) : null}
          <ol className="space-y-6" aria-label="Los pasos para armar tu perfil">
            {parts.map((part, at) => {
              const last = at + 1 === parts.length;
              return (
                <GuidedStep
                  key={part.title}
                  n={at + 1}
                  title={part.title}
                  open={at === index}
                  onOpen={() => {
                    if (at !== index) updateStoredProfile((draft) => saveBuilder(draft, at));
                  }}
                >
                  {part.body}
                  {part.art}
                  <Button onClick={() => (last ? finish() : to(at + 1))}>{last ? "Terminar" : "Siguiente"}</Button>
                </GuidedStep>
              );
            })}
          </ol>
        </ProfileLayout>
      </StepShell>
      {/* Outside the sheet: inside it the notice would be one of its layers, under the button to take a note that it is meant to be over. */}
      <RemovedNotice removed={removed} onRestore={restore} onDismiss={dismiss} />
    </>
  );
}
