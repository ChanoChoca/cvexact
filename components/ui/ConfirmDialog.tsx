"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui";

type ConfirmOptions = {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `primary` for a question that is not about losing anything: the confirm button is `danger` unless said otherwise. */
  confirmTone?: "danger" | "primary";
};

type PendingConfirm = {
  message: string;
  options: ConfirmOptions;
  resolve: (ok: boolean) => void;
};

type ConfirmFn = (message: string, options?: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * A drop-in replacement for `window.confirm`, but styled, undismissable by a
 * background click going unnoticed, and — the actual reason it exists — not a
 * native dialog a browser can silently suppress. Every call site in the app
 * so far is a destructive action with no undo, so the confirm button is
 * always styled `danger`; a call site with a gentler need can still override
 * the label.
 *
 * `await confirm(message)` swaps in for `confirm(message)` at every existing
 * call site — same truthy/falsy return, now a promise.
 */
export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext);
  if (!fn) throw new Error("useConfirm must be used within a ConfirmDialogProvider");
  return fn;
}

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const confirm = useCallback<ConfirmFn>(
    (message, options = {}) =>
      new Promise((resolve) => {
        setPending({ message, options, resolve });
      }),
    [],
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (pending && !dialog.open) dialog.showModal();
    if (!pending && dialog.open) dialog.close();
  }, [pending]);

  const settle = useCallback(
    (ok: boolean) => {
      pending?.resolve(ok);
      setPending(null);
    },
    [pending],
  );

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <dialog
        ref={dialogRef}
        aria-labelledby={pending ? "confirm-dialog-message" : undefined}
        // The native `cancel` event fires on Escape and must resolve `false`
        // exactly like the backdrop and Cancel button — otherwise Escape
        // would leave the caller's promise hanging forever.
        onCancel={(e) => {
          e.preventDefault();
          settle(false);
        }}
        onClick={(e) => {
          if (e.target === dialogRef.current) settle(false);
        }}
        // Hardcoded black, not `bg-ink/40`: `ink` used to be near-black, so
        // that dimmed a *light* page; now it aliases white, which would wash
        // the page out instead of receding it. The page is already near-black
        // itself, so a plain darken has less headroom than it used to —
        // `/70` (up from the light-mode `/40`) plus the blur is what still
        // reads as "the page behind this stepped back".
        className="m-auto w-[calc(100%-2rem)] max-w-sm border border-rule bg-paper-2 p-6 backdrop:bg-black/70 backdrop:backdrop-blur-sm"
      >
        {pending ? (
          <div>
            {pending.options.title ? (
              <p className="mb-2 font-solar text-[12.5px] font-bold tracking-[0.18em] text-ink-3 uppercase">
                {pending.options.title}
              </p>
            ) : null}
            <p id="confirm-dialog-message" className="text-[14.5px] leading-relaxed whitespace-pre-line text-ink-2">
              {pending.message}
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <Button variant="secondary" type="button" onClick={() => settle(false)}>
                {pending.options.cancelLabel ?? "Cancelar"}
              </Button>
              <Button variant={pending.options.confirmTone === "primary" ? "primary" : "danger"} type="button" autoFocus onClick={() => settle(true)}>
                {pending.options.confirmLabel ?? "Confirmar"}
              </Button>
            </div>
          </div>
        ) : null}
      </dialog>
    </ConfirmContext.Provider>
  );
}
