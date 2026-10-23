"use client";

import { useCallback } from "react";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { recoverCopy, type Recovery } from "@/lib/storage/recover-copy";
import { useCopyPassword } from "./CopyPassword";

/**
 * «Recuperar una copia», for the screens that offer it: the file the person chose, read as whatever it is (`recoverCopy`), asking for its
 * password and for the go-ahead to replace through the dialogs every other screen uses. The screen says what came of it, where it is.
 */
export function useRecoverCopy(): (file: File) => Promise<Recovery> {
  const confirm = useConfirm();
  const ask = useCopyPassword();
  return useCallback((file: File) => recoverCopy(file, { confirm, ask }), [confirm, ask]);
}
