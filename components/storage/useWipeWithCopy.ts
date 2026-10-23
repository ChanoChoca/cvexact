"use client";

import { useCallback, useState } from "react";
import { downloadLockedAccountBackup } from "@/lib/storage/copy-file";
import { downloadAccountBackup } from "@/lib/storage/download";
import { useCopyPassword } from "./CopyPassword";

/**
 * The copy that comes before erasing what this browser holds, the same from both ways of doing it —«Borrar los datos de este navegador» and «Cerrar y borrar datos»—: the
 * complete copy, open or with a password that the person chooses, and nothing is erased unless it was taken. What goes is not kept anywhere else unless they have put it somewhere, so
 * the way back is the condition. With a password because a computer that more than one person uses is what a wipe is for, and an open file in its folder of downloads would undo it.
 */
export function useWipeWithCopy() {
  const ask = useCopyPassword();
  const [locked, setLocked] = useState(false);

  /** `true` when the copy was taken: only then does the caller go on. A copy that could not be made, or a password dialog that was cancelled, is `false`. */
  const takeCopy = useCallback(async (): Promise<boolean> => {
    if (locked) {
      const done = await ask({
        mode: "choose",
        holds: "cvexact-backup",
        use: async (password) => {
          await downloadLockedAccountBackup(password);
          return true;
        },
      });
      return done === true;
    }
    try {
      await downloadAccountBackup();
      return true;
    } catch {
      return false;
    }
  }, [ask, locked]);

  return { locked, setLocked, takeCopy };
}
