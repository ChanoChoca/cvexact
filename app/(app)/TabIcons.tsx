import type { ReactNode } from "react";
import { cx } from "@/components/ui";

/**
 * The glyphs `MobileTabBar` (`./AppShell.tsx`) draws above its labels — one per
 * section of the bar; the sections behind «Cuenta» keep theirs here too.
 * Inline SVG like `MenuGlyph` and the rest of the app's icons — no icon
 * library, no asset — drawn on the same 24×24 grid with the same 1.6 round
 * stroke, so they read as one family with the hamburger in the landing's nav.
 *
 * "You are here" lives in the glyph itself, not in a separate marker: the
 * stroke goes from the tab's grey (`ink-3`, inherited from the `Link`) to
 * `solar-g4`, the violet the bar's old dot used, and the closed shapes take a
 * faint wash of that same violet. The wash is not decoration. `ink-3` and
 * `solar-g4` have the same luminance (≈5:1 on the bar), so a stroke swap
 * alone changes hue and nothing else — the dot used to add a shape cue by
 * appearing, and the fill is what carries that now.
 */

type GlyphProps = { active: boolean };

/**
 * The fill is set once, here, on the root, and every shape inherits it: closed
 * bodies (a card, a sheet, a gear) tint for free, and only the open curves
 * that would otherwise fill their own chord (a handle, a pair of shoulders)
 * opt out with `fill="none"`. `fill-transparent` rather than `fill-none` when
 * inactive, because `none` is not interpolable and the colour transition
 * would snap instead of fading.
 */
function Glyph({ active, children }: GlyphProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cx(
        "size-5.5 shrink-0 transition-colors motion-reduce:transition-none",
        active ? "text-solar-g4 fill-solar-g4/30" : "fill-transparent",
      )}
    >
      {children}
    </svg>
  );
}

/** Postular — a sheet with a spark: the CV the app writes for a posting. */
export function SparkleDocGlyph({ active }: GlyphProps) {
  return (
    <Glyph active={active}>
      <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a1 1 0 0 0 1 1h4" fill="none" />
      {/* Solid, unlike everything else here: drawn as an outline, a four-point
          star this small closes up under the 1.6 stroke and reads as a
          diamond. Filled with `currentColor`, it follows the tab's colour
          without taking part in the wash. */}
      <path
        d="M12 10.2Q12.7 13.9 16.4 14.6Q12.7 15.3 12 19Q11.3 15.3 7.6 14.6Q11.3 13.9 12 10.2Z"
        fill="currentColor"
        stroke="none"
      />
    </Glyph>
  );
}

/** Empleos — a briefcase. */
export function BriefcaseGlyph({ active }: GlyphProps) {
  return (
    <Glyph active={active}>
      <rect x="3" y="7" width="18" height="13" rx="2.2" />
      <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" fill="none" />
      <path d="M3 13h18" />
    </Glyph>
  );
}

/** Perfil — the profile's "ficha": a card with a face and two lines of text. */
export function IdCardGlyph({ active }: GlyphProps) {
  return (
    <Glyph active={active}>
      <rect x="2.5" y="5" width="19" height="14" rx="2.2" />
      <circle cx="8.5" cy="10" r="1.8" />
      {/* A flat arc, not a semicircle: with the 1.6 stroke a round one
          touches the head above it and the two blur into a single blob. */}
      <path d="M5.4 16a3.6 3.6 0 0 1 6.2 0" fill="none" />
      <path d="M14.5 10.2h4M14.5 13.8h2.5" />
    </Glyph>
  );
}

/** Postulaciones — the tracker's board: three columns of different heights. */
export function KanbanGlyph({ active }: GlyphProps) {
  return (
    <Glyph active={active}>
      <rect x="3" y="3" width="18" height="18" rx="2.6" />
      <path d="M8 7.5V14M12 7.5v4M16 7.5V16" />
    </Glyph>
  );
}

/** Cuenta — a person: a head over a pair of shoulders, the shoulders closed so the wash tints them. */
export function UserGlyph({ active }: GlyphProps) {
  return (
    <Glyph active={active}>
      <circle cx="12" cy="8" r="3.8" />
      <path d="M4.5 20.5c0-4.1 3.4-7 7.5-7s7.5 2.9 7.5 7Z" />
    </Glyph>
  );
}

/**
 * Ajustes — a gear. One path, outline plus hole, filled `evenodd` so the wash
 * tints the body and leaves the hole clear. The outline is generated: 8
 * trapezoid teeth around (12,12), tip radius 10 and root radius 7.6, half-width
 * 8° at the tip and 12° at the root, joined along the root circle by arcs.
 * The gaps between teeth are what fills in first at this size, so widen the
 * root before adding teeth.
 */
export function GearGlyph({ active }: GlyphProps) {
  return (
    <Glyph active={active}>
      <path
        fillRule="evenodd"
        d="M10.42 4.57L10.61 2.1L13.39 2.1L13.58 4.57A7.6 7.6 0 0 1 16.14 5.63L18.02 4.01L19.99 5.98L18.37 7.86A7.6 7.6 0 0 1 19.43 10.42L21.9 10.61L21.9 13.39L19.43 13.58A7.6 7.6 0 0 1 18.37 16.14L19.99 18.02L18.02 19.99L16.14 18.37A7.6 7.6 0 0 1 13.58 19.43L13.39 21.9L10.61 21.9L10.42 19.43A7.6 7.6 0 0 1 7.86 18.37L5.98 19.99L4.01 18.02L5.63 16.14A7.6 7.6 0 0 1 4.57 13.58L2.1 13.39L2.1 10.61L4.57 10.42A7.6 7.6 0 0 1 5.63 7.86L4.01 5.98L5.98 4.01L7.86 5.63A7.6 7.6 0 0 1 10.42 4.57ZM15 12a3 3 0 1 0-6 0a3 3 0 1 0 6 0Z"
      />
    </Glyph>
  );
}
