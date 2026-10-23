"use client";

import { useSyncExternalStore } from "react";
import { NavCta } from "@/components/ui";

/**
 * The key `lib/storage/local.ts` keeps the profile under. Written out and not imported: that module is the whole of the browser's storage, and the landing is the one page
 * that people open before they have anything of ours to load — `tests/landing-profile-cta.test.ts` holds the two to the same string.
 */
export const PROFILE_STORAGE_KEY = "cvexact.profile.v2";

/** Whether this browser holds a profile with a career in it: a job or a study. Nothing else counts — a name and an email are no profile to go back to. */
export function hasProfileHere(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const profile = JSON.parse(raw) as { experience?: unknown; education?: unknown } | null;
    return (Array.isArray(profile?.experience) && profile.experience.length > 0) || (Array.isArray(profile?.education) && profile.education.length > 0);
  } catch {
    return false;
  }
}

const read = (): boolean => {
  try {
    return hasProfileHere(window.localStorage.getItem(PROFILE_STORAGE_KEY));
  } catch {
    return false;
  }
};

const subscribe = (listener: () => void) => {
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
};

/**
 * The one call to action of the landing's menu: «Empezar». Whoever has a profile in this browser goes on to Postular, and whoever does not goes to the profile, which
 * opens its start by itself when it is blank.
 */
export function ProfileNavCta() {
  const has = useSyncExternalStore(subscribe, read, () => false);
  return <NavCta href={has ? "/postular" : "/perfil"}>Empezar</NavCta>;
}
