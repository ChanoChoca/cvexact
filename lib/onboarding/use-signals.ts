"use client";

import { useMemo } from "react";
import { repeatedRequirement } from "@/lib/jobs/repeated";
import { toPlainProfile } from "@/lib/profile/project";
import type { StoredProfile } from "@/lib/schemas/profile-v2";
import { useApplications, useApplicationsReady } from "@/lib/storage/hooks";
import { useExperiment } from "@/lib/use-experiment";
import type { Signals } from "./gaps";

/**
 * What the engine is told for whoever asks it questions: the offers they analysed, read once they are loaded, and what else it may ask — only when the
 * switch of each is on (`lib/experiments.ts`). With them off — the way it is for everyone — this is `{}` and the engine sees the profile and only the
 * profile, as it always did; no offer is read, and nothing waits for them to load.
 */

const NONE: Signals = {};

export function useEngineSignals(profile: StoredProfile, now: Date): Signals {
  const repeated = useExperiment("repeated_requirement");
  // The notes they wrote down (O15) and the skills nothing has backed for years (O17) are read from the profile itself: for them the engine only needs to be told that
  // it may ask, and nothing waits for the offers to load.
  const capture = useExperiment("note_capture");
  const stale = useExperiment("stale_skills");
  const ready = useApplicationsReady();
  const offers = useApplications();
  return useMemo(() => {
    const signals: Signals = {
      ...(capture ? { capture: true } : {}),
      ...(stale ? { stale: true } : {}),
    };
    if (repeated && ready) signals.repeated = repeatedRequirement({ offers, profile: toPlainProfile(profile), stored: profile, now });
    return Object.keys(signals).length === 0 ? NONE : signals;
  }, [repeated, capture, stale, ready, offers, profile, now]);
}
