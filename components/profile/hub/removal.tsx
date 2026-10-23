"use client";

import { useCallback, useState } from "react";
import { restoreArchived } from "@/lib/profile/edit";
import type { StoredProfile } from "@/lib/schemas/profile-v2";
import { transformStoredProfile, updateStoredProfile } from "@/lib/storage/local";

/** Told to the screen when something is taken out, so it can offer to put it back. */
export type OnRemoved = (label: string, archiveId: string) => void;

/**
 * Removes something with `run` and tells the screen what went where. Removing is not
 * destructive — it goes to the archive and can be restored — so there is nothing to
 * confirm: the person is told, with a way back, after.
 */
export function useRemoval(onRemoved: OnRemoved) {
  return useCallback(
    (run: (draft: StoredProfile) => boolean) => {
      let archived: { id: string; label: string } | undefined;
      updateStoredProfile((draft) => {
        const before = draft.archive.length;
        if (!run(draft)) return;
        const entry = draft.archive.at(-1);
        if (entry && draft.archive.length > before) archived = { id: entry.id, label: entry.label };
      });
      if (archived) onRemoved(archived.label, archived.id);
    },
    [onRemoved],
  );
}

export type Removed = { label: string; id: string };

/**
 * The thing taken out most recently, and the way to put it back: what every screen that
 * lets someone remove something keeps for it — the profile, the review, the guided steps. One at
 * a time; a second removal takes the notice's place, and both stay restorable from the
 * profile's history.
 */
export function useRemovedNotice() {
  const [removed, setRemoved] = useState<Removed | null>(null);
  const onRemoved = useCallback<OnRemoved>((label, id) => setRemoved({ label, id }), []);
  const restore = useCallback(() => {
    if (!removed) return;
    transformStoredProfile((current) => {
      const result = restoreArchived(current, removed.id);
      return result.ok ? result.profile : current;
    });
    setRemoved(null);
  }, [removed]);
  const dismiss = useCallback(() => setRemoved(null), []);
  return { removed, onRemoved, restore, dismiss };
}

/**
 * "Quitaste «X». Deshacer", over everything else, clear of the tab bar on a phone. One step above the floating «Anotá algo» (`z-40`, `NoteCapture`), which sits
 * in the same corner of a phone: the notice stays until it is answered, and what it offers must not be a button under another one.
 */
export function RemovedNotice({ removed, onRestore, onDismiss }: { removed: Removed | null; onRestore: () => void; onDismiss: () => void }) {
  if (!removed) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-[calc(var(--tab-h)+1rem)] z-[45] mx-auto mb-[var(--sheet-lift,0px)] flex max-w-md items-center justify-between gap-4 border border-white/15 bg-paper px-4 py-3 text-sm text-ink-2 shadow-lg chrome:bottom-6"
    >
      <span className="min-w-0 wrap-break-word">Quitaste «{removed.label || "eso"}».</span>
      <span className="flex shrink-0 items-center gap-3">
        {/* On a finger, a row of the notice's height to touch: padded, and pulled back by the same amount so the notice stays as it was. */}
        <button type="button" onClick={onRestore} className="underline decoration-oro-soft underline-offset-4 hover:text-ink pointer-coarse:-my-3 pointer-coarse:py-3">
          Deshacer
        </button>
        <button type="button" aria-label="Cerrar" onClick={onDismiss} className="text-ink-3 hover:text-ink pointer-coarse:-my-3 pointer-coarse:grid pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:place-items-center">
          ✕
        </button>
      </span>
    </div>
  );
}
