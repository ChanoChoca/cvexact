"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cx } from "@/components/ui";

/**
 * The one overlay shell, so a centred dialog and a side drawer share the same
 * mechanics `ConfirmDialog` and the sign-out dialog in `AccountPanel` already
 * proved out — `<dialog>` + `showModal()`, Escape and a backdrop click both
 * resolving to `onClose`. Before this, three overlays (`DetailPanel`,
 * `ImportCsvDialog`, `ChooseCvDialog`) each hand-rolled a `fixed inset-0`
 * div with its own backdrop opacity and neither Escape nor a trapped focus —
 * a native `<dialog>` gets both for free, plus returning focus to whatever
 * opened it on close.
 *
 * `open` covers both ways a caller uses this: a component the parent mounts
 * only while shown (`DetailPanel`, `ImportCsvDialog`, `ChooseCvDialog` —
 * these pass a constant `open`) and one that stays mounted and toggles
 * (the sign-out dialog). Content renders only while `open`, matching
 * `ConfirmDialog`'s own `{pending ? … : null}` — nothing inside runs while
 * the dialog is hidden.
 *
 * Header chrome (an eyebrow, a title, a close button) is deliberately not
 * part of this shell: `ChooseCvDialog` has no close button and the sign-out
 * dialog has no eyebrow, so baking in one shape would not fit either. Each
 * caller renders its own few lines and wires the close button to the same
 * `onClose` this takes.
 */
// Hardcoded black backdrops, not `bg-ink/40`: see `ConfirmDialog`'s own
// comment on the same swap — `ink` used to be near-black and dimmed a light
// page; aliased to white now, it would wash a dark one out instead.
const PLACEMENT = {
  center:
    "m-auto w-[calc(100%-2rem)] border border-rule bg-paper-2 backdrop:bg-black/70 backdrop:backdrop-blur-sm",
  // A full-height drawer pinned to the right edge. `<dialog>`'s own UA
  // stylesheet centers it with `inset: 0; margin: auto`; `left-auto` releases
  // the left edge that `inset-y-0 right-0` alone would leave pinned by that
  // default, and `m-0` drops the auto-centering margin.
  right:
    "inset-y-0 right-0 left-auto m-0 h-full max-h-none w-full overflow-y-auto border-l border-rule bg-paper-2 backdrop:bg-black/70 backdrop:backdrop-blur-sm",
} as const;

export function Modal({
  open,
  onClose,
  placement = "center",
  labelledBy,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  placement?: keyof typeof PLACEMENT;
  /** id of the element inside `children` that names this dialog. */
  labelledBy?: string;
  className?: string;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={labelledBy}
      // The native `cancel` event fires on Escape and must resolve exactly
      // like the backdrop click below — otherwise Escape would close the
      // dialog natively while the caller's own state still thought it open.
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
      className={cx(PLACEMENT[placement], className)}
    >
      {open ? children : null}
    </dialog>
  );
}
