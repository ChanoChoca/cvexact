"use client";

import { verificationCounts, verificationLine } from "@/lib/profile/evidence";
import type { StoredProfile } from "@/lib/schemas/profile-v2";
import { useExperiment } from "@/lib/use-experiment";

/**
 * «Con respaldo: 2 con un enlace y 1 en un registro oficial.» — how many of the things in the profile have something beside them, by how it can be
 * seen (e5, I4). A count the person reads about their own profile, that goes nowhere; never a percentage and never a list of what is missing.
 *
 * It exists only while one of the ways of putting evidence beside something is switched on (`lib/experiments.ts`), and says nothing until something
 * has it: with all four off — as everyone has them — nothing of this is drawn.
 */
export function VerificationLine({ profile }: { profile: StoredProfile }) {
  const links = useExperiment("evidence_links");
  const registries = useExperiment("official_registries");
  const badges = useExperiment("open_badges");
  const github = useExperiment("github_projects");
  if (!links && !registries && !badges && !github) return null;
  const line = verificationLine(verificationCounts(profile));
  return line ? (
    <p className="text-sm text-ink-3" data-verification-counts>
      {line}
    </p>
  ) : null;
}
