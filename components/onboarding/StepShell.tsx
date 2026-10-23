import type { ReactNode } from "react";
import { PageHeading } from "@/components/ui";

/**
 * The frame every step of the first-run flow wears: an eyebrow, a title, a line
 * of what to do, and the way back. One place, so the steps read as one flow.
 */
export function StepShell({
  eyebrow = "Tu perfil",
  title,
  intro,
  onBack,
  wide,
  children,
}: {
  eyebrow?: string;
  title: ReactNode;
  intro?: ReactNode;
  onBack?: () => void;
  /** A step with a second column beside its content: the page opens up to make room for it. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-8" data-panel={wide ? "wide" : undefined}>
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="font-solar text-[12.5px] font-bold tracking-[0.18em] text-ink-3 uppercase transition-colors hover:text-ink pointer-coarse:min-h-11 motion-reduce:transition-none"
        >
          ← Atrás
        </button>
      ) : null}
      <PageHeading eyebrow={eyebrow} title={title}>
        {intro}
      </PageHeading>
      {children}
    </div>
  );
}
