"use client";

import type { ReactNode } from "react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { PEEK_REM, type SheetStop } from "@/components/ui/sheet-heights";
import { useMediaQuery } from "@/components/ui/useMediaQuery";

/**
 * The profile and the view of it. Where there is room for two columns the view stands beside it, in view while the profile is edited: an edit shows what it
 * did. Where there is not —a phone— the view is the page and the profile is a sheet over its foot, that starts peeking so the page is seen first and is
 * pulled up to edit. With no view (a profile nobody has put anything in) it is only the column.
 */
export function ProfileLayout({
  view,
  wideView = false,
  startAt,
  label = "Editar tu perfil",
  children,
}: {
  view?: ReactNode;
  /** The view is a sheet of paper: from a wide screen it takes half the width, beside the profile, so that what is written on it can be read. */
  wideView?: boolean;
  /** Where the sheet starts on a phone: whole when what is in it is what the page was opened for. */
  startAt?: SheetStop;
  /** What the handle of the sheet says it is for. */
  label?: string;
  children: ReactNode;
}) {
  const sideBySide = useMediaQuery("(min-width: 1024px)");
  const column = <div className="min-w-0 space-y-12">{children}</div>;
  if (!view) return column;
  if (sideBySide) {
    // The two columns share the width: the sheet scales to its column, so a fixed width left it smaller the wider the screen got — a quarter of a
    // 1920 px one. Half and half from a large screen up is the even split; the text view —a panel, not a sheet— keeps its fixed, readable column.
    return (
      <div data-panel={wideView ? "full" : "wide"} className={`grid gap-10 ${wideView ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : "lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]"}`}>
        {column}
        <div className="min-w-0">
          {/* Longer than a screen, the view stays in sight and scrolls in itself: on a laptop 768 px tall the part of it under the fold could not be reached. */}
          <div className="space-y-4 lg:sticky lg:top-[calc(var(--nav-h,4.5rem)+1.5rem)] lg:max-h-[calc(100dvh-var(--nav-h,4.5rem)-3rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1">{view}</div>
        </div>
      </div>
    );
  }
  return (
    <>
      {/* The room of the peeking sheet at the foot, so that when the page opens nothing of it is under the sheet. */}
      <div className="space-y-4" style={{ paddingBottom: `${PEEK_REM}rem` }}>
        {view}
      </div>
      <BottomSheet label={label} {...(startAt ? { startAt } : {})}>{column}</BottomSheet>
    </>
  );
}
