import type { CSSProperties } from "react";

/**
 * The bevel that marks a filled or bordered control as Solar rather than a
 * plain rectangle — the one recurring shape idea in the whole system, used at
 * 14px on every `Button`/`NavCta` (`components/ui/index.tsx`) and at 24px on
 * the landing's own hero/final `Cta` (`components/landing/solar/Cta.tsx`).
 *
 * Its own file, deliberately not exported from `components/ui/index.tsx`
 * (which has `"use client"` at the top for the hooks its other exports use):
 * a `"use client"` file's exports are all client references, even a pure,
 * dependency-free function like this one — a Server Component is allowed to
 * *render* a client component from that module, but not to *call* a plain
 * function from it directly in its own render body, which is exactly what
 * `Cta` in `components/landing/parts.tsx` (a Server Component) needs to do to
 * compute a `style` prop. Living outside any `"use client"` boundary, this
 * file can be called from server and client code alike.
 */
export const chamfer = (n: number): CSSProperties => ({
  clipPath: `polygon(0 0, calc(100% - ${n}px) 0, 100% ${n}px, 100% 100%, ${n}px 100%, 0 calc(100% - ${n}px))`,
});
