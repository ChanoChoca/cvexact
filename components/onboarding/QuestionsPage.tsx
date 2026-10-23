"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { CorruptNotice } from "@/components/profile/CorruptNotice";
import { isBlankProfile } from "@/lib/schemas/profile-v2";
import { useHydrated, useStoredProfile } from "@/lib/storage/hooks";
import { DeepenSession } from "./DeepenSession";

/**
 * A stretch of questions on demand, from the profile: the same session the first
 * run ends with, picked up whenever the person wants to make the profile better.
 * Nothing is asked of someone with nothing to ask about — they start where
 * everyone starts.
 */
export function QuestionsPage({ only, startWith, returning }: { only?: string | undefined; startWith?: string | undefined; returning?: boolean | undefined }) {
  const profile = useStoredProfile();
  const hydrated = useHydrated();
  const router = useRouter();
  const blank = hydrated && isBlankProfile(profile);

  useEffect(() => {
    if (blank) router.replace("/perfil/empezar");
  }, [blank, router]);

  if (!hydrated || blank) return <p className="text-sm text-ink-3">Cargando tu perfil…</p>;
  return (
    <div className="space-y-10">
      <CorruptNotice />
      {/* Keyed by what was asked for: a pending item opened from the close of a session lands on this same page, with
          another address, and has to start over on it instead of keeping the closing screen it was opened from. */}
      <DeepenSession
        key={`${only ?? ""}|${startWith ?? ""}|${returning ? "regreso" : ""}`}
        profile={profile}
        only={only}
        startWith={startWith}
        returning={returning}
        onFinish={(then) => router.push(then ?? "/perfil")}
      />
    </div>
  );
}
