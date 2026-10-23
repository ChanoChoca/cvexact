"use client";

import { useEffect } from "react";
import { autoSync, setAutoSyncUser } from "@/lib/api/auto-sync";
import { useSession } from "@/lib/auth-client";
import { useStoredProfile } from "@/lib/storage/hooks";
import { useSyncState } from "@/lib/storage/sync-state";

/**
 * Keeps «Mantener sincronizado» running while the app is open, and draws nothing.
 *
 * It only looks again when something that matters has changed — a save of the profile, what the browser remembers of the
 * account, who is signed in, the connection coming back — and when the page is going away, so that what was waiting goes
 * then and not at the next visit. Whether there is anything to do is `createAutoSync`'s to say: with the permission off,
 * which is how everyone starts, every one of these looks and finds nothing.
 */
export function AutoSync() {
  const { data: session } = useSession();
  const user = session?.user;
  const userId = user && user.emailVerified !== false ? user.id : null;
  const profile = useStoredProfile();
  const state = useSyncState();

  useEffect(() => {
    setAutoSyncUser(userId);
    autoSync().poke();
  }, [userId, profile.rev, state]);

  useEffect(() => {
    const engine = autoSync();
    const back = () => engine.poke();
    const leaving = () => {
      if (document.visibilityState === "hidden") engine.flush();
    };
    window.addEventListener("online", back);
    document.addEventListener("visibilitychange", leaving);
    return () => {
      window.removeEventListener("online", back);
      document.removeEventListener("visibilitychange", leaving);
    };
  }, []);

  return null;
}
