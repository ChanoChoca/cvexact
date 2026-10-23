"use client";

import { catchError, type ErrorInfo } from "next/error";
import { Alert } from "@/components/ui";

/**
 * Wraps one piece of the wizard so a throw in it degrades to a message
 * instead of taking `app/(app)/error.tsx` — and everything rendered outside
 * this boundary, like the download buttons above the CV preview — down with
 * it. `route segment` boundaries are too coarse for that: a `ResizeObserver`
 * failure in `CVPreview` or a malformed field in a stored CV must not cost the
 * user the PDF button sitting three lines above it.
 *
 * `retry()` (not `reset()`) re-renders the children from scratch, which is
 * what a transient failure — a bad `ResizeObserver` read, a race on mount —
 * actually needs; see the `error.js` docs on the difference.
 */
function CrashFallback(
  props: { title: string; hint?: string },
  { retry }: ErrorInfo,
) {
  return (
    <Alert tone="bad" title={props.title}>
      {props.hint ?? "Esta parte de la pantalla no se pudo dibujar."}{" "}
      <button
        type="button"
        onClick={() => retry()}
        className="underline underline-offset-4 hover:text-ink"
      >
        Reintentar
      </button>
    </Alert>
  );
}

export const CrashGuard = catchError(CrashFallback);
