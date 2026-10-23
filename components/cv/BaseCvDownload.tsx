"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { DownloadDocxButton } from "@/components/cv/DownloadDocxButton";
import { DownloadPdfButton } from "@/components/cv/DownloadPdfButton";
import { PAGE_WIDTH_PX } from "@/components/cv/measure";
import { ExpiredCredentialsAlert } from "@/components/cv/ExpiredCredentialsAlert";
import { ANCHOR, SECTION_ID } from "@/components/profile/anchors";
import { profileToCVDocument } from "@/lib/cv/from-profile";
import { reviewCounts } from "@/lib/onboarding/review";
import { lapsedCredentials } from "@/lib/profile/currency";
import { NAME_MISSING } from "@/lib/profile/name-missing";
import type { StoredProfile } from "@/lib/schemas/profile-v2";

/**
 * The CV the profile makes, as a file — with no model, no account and no posting in the way.
 *
 * The profile builds a CV from the person's own words at the first screen that has anything to show, and until now
 * the only way to a file was to get a key, paste a posting and generate one for it. This is the file that is already
 * there, said for what it is: theirs, from what they loaded, not adapted to anything. Word first, because it is built
 * in the browser and nothing leaves it; the PDF is printed by our server.
 *
 * It wraps the sheet it makes the file of: the two buttons sit astride the sheet's top edge, half of their box over it, with no card
 * of their own to read before getting to them, and what the file has to say for itself —blocks nobody has looked at, a date that has
 * passed, a name that is missing— goes under the sheet.
 */

/** «Word»: short, because the bar sits over the sheet and the name of the CV is at the top of it. A screen reader reads the whole name, and skips the drawing. */
function Short({ children }: { children: ReactNode }) {
  return (
    <>
      {/* An arrow into a tray: the one drawing for both files, since what they have in common is that they are downloaded. */}
      <svg aria-hidden viewBox="0 0 16 16" fill="none" className="size-4 shrink-0 stroke-current">
        <path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M3 13h10" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="sr-only">Descargar en </span>
      {children}
    </>
  );
}

export function BaseCvDownload({
  profile,
  onReview,
  children,
}: {
  profile: StoredProfile;
  /** Where the profile lists what time brings: a credential past its date opens its question there and not on another page. */
  onReview?: ((gapId: string) => void) | undefined;
  /** The sheet, which has to be the first thing in the box: the buttons are placed against its top edge, which is the box's. */
  children: ReactNode;
}) {
  const titleId = useId();
  // The date of today, taken once when this appears: the credentials in the CV whose date has passed, said below.
  const [today] = useState(() => new Date());
  // Only the certifications: this CV states those, and does not state the licence (a CV written for an offer does, and says so there).
  const lapsed = lapsedCredentials(profile, today).filter((review) => review.subject.kind === "certification");
  const document = useMemo(() => profileToCVDocument(profile), [profile]);
  const counts = reviewCounts(profile);
  const unreviewed = counts.doubtful + counts.conflicts;
  const hasName = profile.contact.fullName.value.trim() !== "";
  // Saying so once is enough: the first download with blocks still unreviewed is the person knowing it, and doing it anyway.
  const [knowing, setKnowing] = useState(false);
  const confirm = (label: ReactNode) => (unreviewed > 0 && !knowing ? { label, onConfirm: () => setKnowing(true) } : undefined);
  const sectionRef = useRef<HTMLElement>(null);
  /**
   * The buttons grow with the sheet. The preview draws it at its column's width over the page's own, and above 100% the
   * bar has to grow with it or it reads as a stamp on a poster. Never below its own size: on a laptop the sheet is
   * narrower than the page, and a bar shrunk with it would be harder to hit for no gain.
   */
  const [barScale, setBarScale] = useState(1);
  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    // `CVPreview` measures its box — this section minus the frame's 1px border on each side — and fits one pixel under
    // it: the same arithmetic, so the bar grows exactly as much as the sheet does.
    const fit = () => setBarScale(Math.max(1, (section.clientWidth - 3) / PAGE_WIDTH_PX));
    fit();
    // The profile's column changes with the window, and the sheet with it.
    const observer = new ResizeObserver(fit);
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  return (
    // `mt-6`: the room for the half of the bar that is above the sheet.
    <section ref={sectionRef} id="cv-base" aria-labelledby={titleId} className={`relative mt-6 ${ANCHOR}`}>
      <h2 id={titleId} className="sr-only">
        Tu CV
      </h2>
      {/* Before the sheet in the page, as it is on the screen: whoever tabs through the lines of the CV does not have to get to the end of them to download it. A dark
          bar and not bare buttons: the secondary one is pale ink on a pale sheet. Centred on the top edge, half over the sheet and half above it, so it covers a strip of the
          sheet's margin and not the corner. */}
      <div
        role="group"
        aria-label="Descargar tu CV"
        style={{ transform: `translate(-50%, -50%) scale(${barScale})` }}
        className="absolute top-0 left-1/2 z-10 flex items-center gap-1 border border-rule bg-paper/90 p-1 backdrop-blur-md"
      >
        <DownloadDocxButton data={document} variant="primary" compact confirm={confirm(<Short>Word</Short>)}>
          <Short>Word</Short>
        </DownloadDocxButton>
        <DownloadPdfButton
          payload={{ kind: "cv", data: document }}
          variant="secondary"
          compact
          unavailableHint="Descargá el Word, que se arma en tu navegador."
          confirm={confirm(<Short>Pdf</Short>)}
        >
          <Short>Pdf</Short>
        </DownloadPdfButton>
      </div>
      {children}
      <div className="mt-3 space-y-3">
        <ExpiredCredentialsAlert reviews={lapsed} {...(onReview ? { onReview } : {})} />
        {/* The one blank a CV cannot go without: said where the file is, not left to be found out on opening it. */}
        {!hasName ? (
          <p className="text-sm text-ink-2">
            {NAME_MISSING}{" "}
            <Link href={`/perfil#${SECTION_ID.contact}`} className="underline decoration-oro-soft underline-offset-4 hover:text-ink pointer-coarse:inline-block pointer-coarse:-my-3 pointer-coarse:py-3.5">
              Escribirlo en «Datos personales»
            </Link>
          </p>
        ) : null}
      </div>
    </section>
  );
}
