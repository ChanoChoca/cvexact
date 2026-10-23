import type { ReactNode } from "react";

/**
 * A folded card: a line that says what it is, opening into its fields. Uncontrolled —
 * the browser keeps it open or shut, and `open` only decides how it first appears.
 */
export function EntityCard({
  title,
  subtitle,
  note,
  badges,
  open,
  children,
}: {
  title: string;
  subtitle?: string;
  note?: string;
  badges?: ReactNode;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={open} className="group border border-rule bg-paper-2">
      <summary className="flex cursor-pointer list-none items-start gap-3 p-4 [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="mt-1 inline-block shrink-0 text-ink-3 transition-transform group-open:rotate-90 motion-reduce:transition-none">
          ▸
        </span>
        <span className="min-w-0 flex-1">
          <span className="block wrap-break-word text-[15px] text-ink">{title || "Sin nombre"}</span>
          {subtitle ? <span className="block wrap-break-word text-sm text-ink-2">{subtitle}</span> : null}
          {note ? <span className="block text-xs text-ink-3">{note}</span> : null}
        </span>
        {badges ? <span className="flex shrink-0 flex-wrap justify-end gap-1.5">{badges}</span> : null}
      </summary>
      <div className="space-y-6 border-t border-rule p-4">{children}</div>
    </details>
  );
}
