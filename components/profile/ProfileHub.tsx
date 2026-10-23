"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeading } from "@/components/ui";
import { AccountOffer } from "@/components/account/AccountOffer";
import { BaseCvDownload } from "@/components/cv/BaseCvDownload";
import { BaseCvPreview } from "@/components/cv/BaseCvPreview";
import { SECTION_ID } from "./anchors";
import { goTo } from "./jumpTo";
import { CorruptNotice } from "./CorruptNotice";
import { EmptyProfile } from "./EmptyProfile";
import { FirstCvCard } from "./FirstCvCard";
import { ProfileActions } from "./ProfileActions";
import { ProfileLayout } from "./ProfileLayout";
import { ReviewBlock, type ReviewRequest } from "./ReviewBlock";
import { TaskList } from "./TaskList";
import { ContactSection } from "./hub/ContactSection";
import { EducationSection } from "./hub/EducationSection";
import { ExperienceSection } from "./hub/ExperienceSection";
import { OtherSection } from "./hub/OtherSection";
import { ProjectsSection } from "./hub/ProjectsSection";
import { RemovedNotice, useRemovedNotice } from "./hub/removal";
import { SkillsSection } from "./hub/SkillsSection";
import { VerificationLine } from "./hub/VerificationLine";
import { ConflictList } from "@/components/onboarding/ConflictList";
import { readCleanly } from "@/lib/onboarding/review";
import { isPreviewReady, previewFactRefs, type PreviewFactRef } from "@/lib/cv/from-profile";
import { reviewItems } from "@/lib/profile/to-review";
import { useEngineSignals } from "@/lib/onboarding/use-signals";
import { useReturnReviewState } from "@/lib/storage/return-review";
import { useAccountSync } from "@/lib/profile/use-account-sync";
import { profileTasks } from "@/lib/profile/tasks";
import { useBackupReminderState } from "@/lib/storage/backup-reminder";
import { copyFooter } from "@/lib/storage/durability";
import { isBlankProfile } from "@/lib/schemas/profile-v2";
import { useHydrated, useStoredProfile } from "@/lib/storage/hooks";

/**
 * The profile: everything in it, as cards that are edited where they stand, and
 * where each thing came from. It is the one place to read what the CV will be made
 * of and to change it; nothing here asks for confirmation, because nothing here is
 * final — an edit can be undone and a removal can be restored.
 *
 * There is no percentage of completion. What would make it better is a list of
 * things, not a score, and none of it is required to use it.
 */

export function ProfileHub({
  focusFactId,
  justRead,
  guide,
}: { focusFactId?: string | undefined; justRead?: boolean | undefined; guide?: boolean | undefined } = {}) {
  const profile = useStoredProfile();
  const hydrated = useHydrated();
  const router = useRouter();
  const [now] = useState(() => new Date());
  const returnState = useReturnReviewState();
  // What the engine may ask besides the profile (the experiments that are switched on): nothing at all while they are off.
  const signals = useEngineSignals(profile, now);
  const backup = useBackupReminderState();
  // What this browser remembers of its meetings with the account signed in, if there is one: whether it has what is here.
  const account = useAccountSync(profile);
  const { removed, onRemoved, restore, dismiss } = useRemovedNotice();
  /** A line tapped in the view of the profile — opens and scrolls to the fact it names. */
  const [factFocus, setFactFocus] = useState<PreviewFactRef | null>(null);
  /** Something outside «Para revisar» —a credential in the CV, a job's card— asked for one of its questions to be opened there. */
  const [reviewRequest, setReviewRequest] = useState<ReviewRequest | null>(null);
  const openReview = (gapId: string) => {
    setReviewRequest((current) => ({ id: gapId, n: (current?.n ?? 0) + 1 }));
    goTo(SECTION_ID.review, "#review-title");
  };
  /** A thing a job says, tapped in the view of the profile: its job opens, as tapping its line in the CV did, and the section with it if it was shut. */
  const showFact = (ref: PreviewFactRef) => {
    setFactFocus(ref);
    goTo(SECTION_ID.experience);
  };
  /** How many times "Agregar un trabajo" was tapped on the empty profile: each one opens the form of the experience section. */
  const [addJobRequests, setAddJobRequests] = useState(0);
  /**
   * A line named in the address, from the list of what is left — a figure nobody had, with no
   * question to ask about it — opens its job and scrolls to it the same way tapping it does.
   * Worked out from the profile rather than set from an effect: it is not there before it loads.
   */
  const linked = useMemo<PreviewFactRef | null>(() => {
    if (!focusFactId) return null;
    const job = profile.experience.find((entry) => entry.facts.some((fact) => fact.id === focusFactId));
    return job ? { experienceId: job.id, factId: focusFactId } : null;
  }, [focusFactId, profile.experience]);

  // Nobody has begun: the profile starts with the first-run flow, not with an empty
  // page. Someone who chose "cargarlo a mano" there has finished with it.
  const starting = hydrated && !profile.onboarding.done && isBlankProfile(profile);
  useEffect(() => {
    if (starting) router.replace("/perfil/empezar");
  }, [starting, router]);

  // The sections fold, and start shut but the first —and the one that holds the job a link names—: what is marked «Para revisar» says so on its title, shut or open, and does
  // not open by itself. Decided once, as the profile first shows: it would otherwise fold the section the hand that is editing it is in.
  const [startOpen, setStartOpen] = useState<Record<"contact" | "experience", boolean> | null>(null);
  if (hydrated && !starting && startOpen === null) {
    setStartOpen({ contact: true, experience: linked !== null });
  }
  // Arriving at /perfil#experiencia from another page: the section is shut until something opens it.
  useEffect(() => {
    if (hydrated && !starting) goTo(window.location.hash.slice(1));
  }, [hydrated, starting]);

  if (!hydrated || starting) return <p className="text-sm text-ink-3">Cargando tu perfil…</p>;

  // What there is left to do, in one list: the steps that were begun and left, and the questions. Nothing here is a score, and none of it is required.
  const tasks = profileTasks(profile, now, signals);
  // What time brings, in one list: the block above this one says it and answers it (`ReviewBlock`). What was put off is still in it, apart, and is not counted.
  const review = reviewItems(profile, now, { signals, putOff: returnState.putOff });
  const reviewByJob = Object.fromEntries(review.filter((item) => item.kind === "job" && item.experienceId).map((item) => [item.experienceId!, item.id]));
  // Only reached done: one nobody has begun is sent to the first-run flow above.
  const empty = isBlankProfile(profile);
  // Arriving from a document that was read with something marked: that is what the page was opened for, and on a phone the sheet starts whole so the tags that say it are seen —and so
  // that the first press on what they lead to is not lost: whatever takes focus inside a sheet that is not whole opens it, and moves the button from under the finger.
  const markedFirst = justRead === true && !empty && !readCleanly(profile);
  // The first reading left something marked and came here: the way to a CV for an offer is offered, once. Not without a name —the tour's second step points at a «Generar CV» that would not press— or a CV to make.
  const offerGuide = guide === true && !empty && isPreviewReady(profile) && profile.contact.fullName.value.trim().length > 0;
  // What is in order about keeping the profile is said once, at the foot: the date of the last copy, and that the account has it.
  const footer = empty ? null : copyFooter({ lastBackupAt: backup.lastBackupAt, accountSynced: account.status === "synced" }, now);
  // The CV the profile makes, as it is turning out: a sheet beside the profile on a computer and behind it on a phone, with the buttons for its file over its corner. The sheet says what its one page
  // has no room for, with a jump to where each thing is, and a line of it is a tap to the job it comes from. Nothing, for a profile with nothing in it.
  const sheet = empty ? null : <BaseCvPreview profile={profile} here factRefs={previewFactRefs(profile)} onFactClick={showFact} />;
  const view = empty ? undefined : isPreviewReady(profile) ? (
    <BaseCvDownload profile={profile} onReview={openReview}>
      {sheet}
    </BaseCvDownload>
  ) : (
    sheet
  );

  return (
    <>
      <ProfileLayout view={view} wideView {...(markedFirst ? { startAt: "full" as const } : {})}>
        <CorruptNotice />

        <div className="space-y-5">
          <PageHeading eyebrow="Tu base" title="Tu perfil">
            Cargá todo lo que sepas hacer, aunque parezca irrelevante. Nada de esto se publica: cada CV toma de acá lo que sirve para esa oferta, y lo demás sigue guardado.
          </PageHeading>
          <ProfileActions />
        </div>

        {offerGuide ? <FirstCvCard /> : null}

        {/* The differences between two documents are chosen here (they have no card to be chosen on). */}
        <ConflictList profile={profile} />

        {/* What the account holds, offered where someone who just signed in looks for it. Nothing for whoever has no account. */}
        <AccountOffer />

        {empty ? (
          <EmptyProfile
            onAddJob={() => {
              setAddJobRequests((count) => count + 1);
              // The form is in a section that folds: shut, there would be nothing to see of it.
              goTo(SECTION_ID.experience);
            }}
          />
        ) : (
          <>
            <ReviewBlock profile={profile} now={now} items={review} request={reviewRequest} />
            <div className="space-y-4">
              {/* How much of it has something beside it, when that is switched on and something has: a count, never a percentage. */}
              <VerificationLine profile={profile} />
              <TaskList tasks={tasks} />
            </div>
          </>
        )}

        {/* Folded, the six are an index of the profile: close together, a list and not six separate things. */}
        <div className="space-y-4">
          <ContactSection profile={profile} defaultOpen={startOpen?.contact ?? false} />
          <ExperienceSection profile={profile} onRemoved={onRemoved} focus={factFocus ?? linked ?? undefined} addRequests={addJobRequests} reviewByJob={reviewByJob} onReview={openReview} defaultOpen={startOpen?.experience ?? false} />
          <EducationSection profile={profile} onRemoved={onRemoved} />
          <SkillsSection profile={profile} onRemoved={onRemoved} now={now} />
          <ProjectsSection profile={profile} onRemoved={onRemoved} />
          <OtherSection profile={profile} onRemoved={onRemoved} now={now} />
        </div>

        {footer ? (
          <p className="text-xs text-ink-3" data-copy-footer>
            {footer}
          </p>
        ) : null}

      </ProfileLayout>
      {/* Outside the sheet: inside it the notice would be one of its layers, under the button to take a note that it is meant to be over. */}
      <RemovedNotice removed={removed} onRestore={restore} onDismiss={dismiss} />
    </>
  );
}
