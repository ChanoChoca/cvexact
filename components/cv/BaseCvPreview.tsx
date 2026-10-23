"use client";

import { useMemo } from "react";
import Link from "next/link";
import { CVPreview } from "@/components/cv/CVPreview";
import { SECTION_ID } from "@/components/profile/anchors";
import { jumpTo } from "@/components/profile/jumpTo";
import { baseCv, isThinPreview, type BaseCvOmission, type PreviewFactRef } from "@/lib/cv/from-profile";
import type { StoredProfile } from "@/lib/schemas/profile-v2";

const WHERE: Record<BaseCvOmission["section"], string> = {
  experience: "Experiencia laboral",
  education: "Formación",
  skills: "Habilidades",
  projects: "Proyectos",
  other: "Otros datos",
};

/** Where the profile keeps what the sheet has no room for: a jump on the profile itself, a link to it from anywhere else. */
function WhereItIs({ section, here }: { section: BaseCvOmission["section"]; here: boolean }) {
  const id = SECTION_ID[section];
  const className = "underline decoration-white/20 underline-offset-4 hover:text-ink pointer-coarse:inline-block pointer-coarse:-my-3 pointer-coarse:py-3.5";
  return here ? (
    <a href={`#${id}`} onClick={(event) => jumpTo(event, id)} className={className}>
      Verlo en {WHERE[section]}
    </a>
  ) : (
    <Link href={`/perfil#${id}`} className={className}>
      Verlo en {WHERE[section]}
    </Link>
  );
}

/**
 * What the base CV says about itself under the sheet: that it has one entry and one more makes it better, and what the
 * page had no room for. The template is one sheet, with a fixed number of jobs, studies, tasks and short lines; a profile
 * can have more, and what does not fit is told, with where it still is, not left out in silence.
 */
export function BaseCvNotes({ thin, omissions, here = false }: { thin: boolean; omissions: readonly BaseCvOmission[]; here?: boolean }) {
  if (!thin && omissions.length === 0) return null;
  return (
    <div className="space-y-3">
      {thin ? <p className="text-xs text-ink-3">Con una entrada más queda mejor.</p> : null}
      {omissions.length > 0 ? (
        <div className="border-l-2 border-oro-soft py-1 pl-4">
          <p className="text-sm text-ink-2">
            Esta hoja no muestra todo lo que cargaste. Sigue en tu perfil, y el CV para una oferta elige lo que más le sirve a esa oferta.
          </p>
          <ul className="mt-2 space-y-1.5 text-xs text-ink-3">
            {omissions.map((omission) => (
              <li key={`${omission.section}:${omission.item}`}>
                <span className="text-ink-2">{omission.item}</span> · {omission.reason} <WhereItIs section={omission.section} here={here} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The CV the profile makes, as a preview, with what it says about itself. Every place that shows it — the review, the
 * first value, the questions' side panel, the profile — shows it through this, so they cannot disagree about when a CV
 * is worth showing (`isPreviewReady`) or about what it leaves out.
 */
export function BaseCvPreview({
  profile,
  here,
  factRefs,
  onFactClick,
}: {
  profile: StoredProfile;
  /** On the profile itself, where "Verlo en…" is a jump on the page and not a link to it. */
  here?: boolean;
  factRefs?: ReadonlyMap<string, PreviewFactRef>;
  onFactClick?: (ref: PreviewFactRef) => void;
}) {
  const { document, omissions } = useMemo(() => baseCv(profile), [profile]);
  return (
    <div className="space-y-3">
      <CVPreview data={document} factRefs={factRefs} onFactClick={onFactClick} />
      <BaseCvNotes thin={isThinPreview(profile)} omissions={omissions} here={here} />
    </div>
  );
}
