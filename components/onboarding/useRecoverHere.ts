"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { useRecoverCopy } from "@/components/storage/useRecoverCopy";

/**
 * Bringing a copy back from the empty start, from the drop zone: the same reading wherever the file comes in (`recoverCopy`), and the
 * profile it brings back is said where it lands — a notice on the profile, which the start used to leave for the person to find out by looking.
 */
export function useRecoverHere() {
  const router = useRouter();
  const recover = useRecoverCopy();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);

  const recoverFile = async (file: File) => {
    setError(null);
    const result = await recover(file);
    if (result.status === "failed") setError(result.message);
    else if (result.status === "recovered") {
      // The toast outlives the page that said it: it is on the profile when they get there.
      toast({ tone: "good", message: result.message, duration: 10_000 });
      router.push("/perfil");
    }
  };

  return { recoverFile, error };
}
