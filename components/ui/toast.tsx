"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cx, TONES } from "@/components/ui";

export type ToastTone = keyof typeof TONES;

export type ToastInput = {
  tone?: ToastTone;
  title?: string;
  message: ReactNode;
  /** A single follow-up action, e.g. "Deshacer" on a postponed delete. */
  action?: { label: string; onClick: () => void };
  /** Milliseconds before it dismisses itself. 0 disables auto-dismiss. */
  duration?: number;
};

type Toast = ToastInput & { id: string };

const DEFAULT_DURATION: Record<ToastTone, number> = {
  neutral: 5000,
  good: 4000,
  warn: 6000,
  // Errors get longer on screen and never auto-vanish mid-read: a person who
  // looked away for three seconds should not come back to nothing.
  bad: 8000,
  info: 5000,
};

/**
 * Left-edge accent only — the tint backgrounds `TONES` uses for an inline
 * `Alert` are meant to sit directly on the page's own `paper` background.
 * A toast floats over whatever the user scrolled to, so it carries its own
 * opaque `bg-paper-2` (one step lighter than the page itself, or it would
 * have no visible edge to float on) and signals tone with a rule instead, the
 * same way the "Ver a tamaño real" pill in the wizard stays legible over the
 * CV preview. `-400`, matching `TONES`: the same reasoning applies — a `-600`
 * rule reads as a dark smear next to a `-400` badge on the same page.
 */
const ACCENT: Record<ToastTone, string> = {
  neutral: "border-l-ink-3",
  good: "border-l-emerald-400",
  warn: "border-l-amber-400",
  bad: "border-l-red-400",
  info: "border-l-sky-400",
};

type ToastFn = (input: ToastInput) => void;

const ToastContext = createContext<ToastFn | null>(null);

/**
 * The one channel for a message that has nowhere positional to live — a
 * download that failed after its button scrolled out of view, a save that
 * succeeded silently, an undo window on a delete. It does not replace an
 * inline `Alert`: a denial that forks the next step (`LimitReached`) or an
 * error tied to a field the user is looking at belongs where it already is.
 */
export function useToast(): ToastFn {
  const fn = useContext(ToastContext);
  if (!fn) throw new Error("useToast must be used within a ToastProvider");
  return fn;
}

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback<ToastFn>(
    (input) => {
      const id = `toast-${++nextId}`;
      const tone = input.tone ?? "neutral";
      const duration = input.duration ?? DEFAULT_DURATION[tone];
      setToasts((prev) => [...prev, { ...input, tone, id }]);
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {/* A phone's tab bar (`data-tab-bar`, `AppShell`: `--tab-h`, 3.75rem) is where the notices would land: they stand above it, on the pages that have one — this region is
          outside the shell and does not read its variables, so it asks whether the page has the bar. */}
      {/* `aria-live="polite"` on the region: a new toast is announced without
          cutting off whatever the screen reader was already saying. A `bad`
          toast additionally carries `role="alert"` on its own node, which is
          assertive regardless of the region it sits in. */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-60 mb-[var(--sheet-lift,0px)] flex flex-col items-center gap-2 px-4 [body:has([data-tab-bar])_&]:bottom-[calc(3.75rem+1rem)] chrome:inset-x-auto chrome:right-4 chrome:items-end chrome:[body:has([data-tab-bar])_&]:bottom-4"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === "bad" ? "alert" : "status"}
            className={cx(
              "pointer-events-auto flex w-full max-w-sm items-start gap-3 border border-rule border-l-2 bg-paper-2 px-4 py-3 text-sm text-ink-2",
              ACCENT[t.tone ?? "neutral"],
            )}
          >
            <div className="min-w-0 flex-1">
              {t.title ? <p className="font-normal text-ink">{t.title}</p> : null}
              <div className={cx("whitespace-pre-line", t.title ? "mt-1" : undefined)}>
                {t.message}
              </div>
              {t.action ? (
                <button
                  type="button"
                  onClick={() => {
                    t.action?.onClick();
                    dismiss(t.id);
                  }}
                  className="mt-2 font-mono text-[11px] tracking-[0.14em] text-ink underline underline-offset-4 hover:text-oro pointer-coarse:-my-1 pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"
                >
                  {t.action.label}
                </button>
              ) : null}
            </div>
            <button
              type="button"
              aria-label="Cerrar aviso"
              onClick={() => dismiss(t.id)}
              className="shrink-0 text-ink-3 hover:text-ink pointer-coarse:-m-3 pointer-coarse:grid pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:place-items-center"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
