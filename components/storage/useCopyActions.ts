"use client";

import { useCallback } from "react";
import { useToast } from "@/components/ui/toast";
import { usePlace } from "@/lib/pwa/install";
import { downloadLockedAccountBackup, downloadLockedProfile } from "@/lib/storage/copy-file";
import { downloadAccountBackup } from "@/lib/storage/download";
import { copySavedLines, type CopySize } from "@/lib/storage/durability";
import { exportOwnProfile } from "@/lib/storage/profile-copy";
import { canShareCopy, shareCopy } from "@/lib/storage/share-copy";
import { useCopyPassword } from "./CopyPassword";

/**
 * The copies a person asks for, from any screen that offers one: «Bajar una copia» (the profile), «Bajar la copia completa» (the profile and the postings), each open or
 * with a password. After it, the same three lines wherever it was asked (`copySavedLines`): where the file went, to keep it somewhere else, how it comes back — and, on a phone
 * that can share a file, «Compartir la copia». The copies a screen takes by itself before it replaces or erases something are not these: that screen has said so, in its own dialog.
 */
export type CopyActions = {
  /** «Bajar una copia». */
  saveProfile: () => void;
  /** «Bajar la copia completa». `false` when it could not be made. */
  saveComplete: () => Promise<boolean>;
  /** The same two with a password, chosen in its own dialog. `false` when it was not made. */
  saveLocked: (size: CopySize) => Promise<boolean>;
};

export function useCopyActions(): CopyActions {
  const toast = useToast();
  const ask = useCopyPassword();
  const place = usePlace();

  const said = useCallback(
    (file: File, size: CopySize, locked: boolean) => {
      // The share sheet is a phone's: on a computer the file is already where it can be moved from.
      const share = place !== "computer" && canShareCopy(file);
      toast({
        tone: "good",
        message: copySavedLines(place, { size, locked }).join("\n"),
        // Three lines to read and a file to find: not the few seconds of a notice that says «Listo».
        duration: 20_000,
        ...(share ? { action: { label: "Compartir la copia", onClick: () => void shareCopy(file) } } : {}),
      });
    },
    [place, toast],
  );

  const failed = useCallback(() => toast({ tone: "bad", message: "No pudimos armar la copia. Probá de nuevo." }), [toast]);

  return {
    saveProfile: useCallback(() => said(exportOwnProfile(), "profile", false), [said]),
    saveComplete: useCallback(async () => {
      try {
        said(await downloadAccountBackup(), "complete", false);
        return true;
      } catch {
        failed();
        return false;
      }
    }, [said, failed]),
    saveLocked: useCallback(
      async (size: CopySize) => {
        let file: File | null = null;
        const done = await ask({
          mode: "choose",
          holds: size === "complete" ? "cvexact-backup" : "cvexact-profile",
          use: async (password) => {
            file = await (size === "complete" ? downloadLockedAccountBackup(password) : downloadLockedProfile(password));
            return true;
          },
        });
        if (!done || !file) return false;
        said(file, size, true);
        return true;
      },
      [ask, said],
    ),
  };
}
