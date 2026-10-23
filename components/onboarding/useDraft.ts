"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clearDraft, loadDraft, saveDraft } from "@/lib/onboarding/drafts";

/**
 * A piece of state that lives in a component, also kept while it is being written.
 *
 * `restored` is what was kept when the component appeared, once: the form opens on it. `remember` is called with the
 * whole value as it changes — it waits for the typing to pause (600 ms, as the big boxes do) before writing, and
 * writes what is pending if the component goes away first. `forget` is for when the form is sent or put away: a
 * draft that outlived the thing it was a draft of would come back to be an answer nobody asked for.
 *
 * `accepts` says whether what was kept still fits the form: a draft from before the form changed is not restored, which
 * is better than a form opened on fields it does not have.
 */
export function useDraft<T>(key: string, accepts: (value: unknown) => boolean = () => true, delay = 600) {
  const [restored] = useState<T | null>(() => {
    const found = loadDraft<T>(key);
    return found !== null && accepts(found) ? found : null;
  });
  const pending = useRef<{ value: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (pending.current) saveDraft(key, pending.current.value);
    pending.current = null;
  }, [key]);

  const remember = useCallback(
    (value: T) => {
      pending.current = { value };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, delay);
    },
    [flush, delay],
  );

  const forget = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
    clearDraft(key);
  }, [key]);

  // Whatever was typed in the last moments before leaving is not lost with the component.
  useEffect(() => flush, [flush]);

  return { restored, remember, forget };
}
