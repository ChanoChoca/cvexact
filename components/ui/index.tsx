"use client";

import Link from "next/link";
import type { Route } from "next";
import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { chamfer } from "./chamfer";

/** Small shared primitives so the pages stay readable instead of Tailwind soup. */

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * Re-exported (not just used below) so most call sites can keep writing
 * `import { chamfer } from "@/components/ui"` alongside `Button`/`Card`/etc.
 * A Server Component computing a `style` prop with it directly — `Cta` in
 * `components/landing/parts.tsx` — has to reach past this file instead, to
 * `@/components/ui/chamfer`: this module's own `"use client"` above taints
 * every export as a client reference, including a plain function, and a
 * Server Component may render a client component from here but not call a
 * function from here. See that file's own comment for the full reasoning.
 */
export { chamfer };

/** A word in the accent gradient — the one emphasis device the system uses in
 *  a heading, wherever a caller wants to single a word out (`PageHeading`'s
 *  `title`, or straight in JSX like the landing's own `<h1>`s do). */
export function GradientText({ children }: { children: ReactNode }) {
  return <span className="bg-(image:--gradient-solar-text) bg-clip-text text-transparent">{children}</span>;
}

/**
 * The small gradient square beside the wordmark, wherever a nav or footer
 * needs the full mark rather than just the type (`Wordmark` alone). Moved
 * here from `components/landing/solar/parts.tsx` alongside `NavCta` below,
 * so both `components/landing/parts.tsx` (the Podio-public Nav/Footer) and
 * `components/landing/solar/parts.tsx` (the landing's own) can import the
 * same piece without either depending on the other.
 */
export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <span
      className="block flex-none rounded-[7px] bg-(image:--gradient-solar-mark)"
      style={{ width: size, height: size, boxShadow: "0 0 22px rgba(127,102,240,0.55)" }}
    />
  );
}

/**
 * The hamburger glyph for a nav's mobile menu `<details>` disclosure — shared
 * by `components/landing/parts.tsx` and `components/landing/solar/parts.tsx`
 * (each has its own `Nav`, but both collapse the same way below their
 * breakpoint) so the icon doesn't drift between the two.
 */
export function MenuGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  );
}

/**
 * The nav's small button — solid white, a plain colour-swap on hover. Unlike
 * the big hero/final `Cta` (`components/landing/solar/Cta.tsx`), no marquee
 * line: the real design only puts that on those two.
 */
export function NavCta({ href, children }: { href: Route; children: ReactNode }) {
  return (
    <Link
      href={href}
      style={chamfer(14)}
      className="inline-flex h-[42px] items-center px-4 font-solar text-[14.5px] font-bold tracking-[0.18em] text-solar-bg uppercase transition-colors duration-250 bg-solar-ink hover:bg-solar-g4 hover:text-solar-ink sm:px-6"
    >
      {children}
    </Link>
  );
}

const BUTTON_VARIANTS = {
  primary: "bg-solar-g4 text-solar-ink hover:brightness-110 disabled:bg-white/10 disabled:text-ink-3",
  secondary:
    "border border-white/15 text-ink-2 hover:border-solar-g4 hover:text-ink disabled:border-white/5 disabled:text-ink-2/40",
  ghost: "text-ink-3 hover:text-ink disabled:text-ink-3/50",
  // Quiet until you reach for it: a bordered red button in a list of rows gives
  // the destructive action more weight than the row it would destroy. `-300`,
  // not the `-700` a light page would want: a dark red is barely legible on
  // `#01020c`, so this needs the paler end of the scale to clear contrast.
  danger:
    "border border-transparent text-red-300 hover:border-red-400/40 hover:bg-red-400/10",
} as const;

/**
 * The look of a button, once, for the three things that wear it: `Button`, and the two that are a link and not a button — `ButtonLink` (a page of this
 * app) and `ButtonAnchor` (a file, or a page that is not this app's). A button inside a link is two controls for one thing: it takes two stops of the
 * tab key, it is announced as a link that holds a button, and HTML does not allow it.
 */
function buttonClass(variant: keyof typeof BUTTON_VARIANTS, compact: boolean | undefined, className: string | undefined): string {
  return cx(
    // The compact size is fine for a mouse, but under 44px it is a real miss
    // target for a thumb — the `pointer: coarse` media feature is true on a
    // touchscreen and false everywhere a click is precise, so this only
    // grows the button where it has to.
    "inline-flex items-center justify-center gap-2 font-solar font-bold tracking-[0.18em] uppercase transition-colors disabled:cursor-not-allowed pointer-coarse:min-h-11 motion-reduce:transition-none",
    compact ? "px-2 py-1 text-xs" : "px-3.5 py-2 text-[14.5px]",
    BUTTON_VARIANTS[variant],
    className,
  );
}

type ButtonLook = {
  variant?: keyof typeof BUTTON_VARIANTS;
  /**
   * The small size, for what sits beside a card's main action and should not compete with it. A size
   * passed in `className` cannot do this: the padding and text size below are utilities of the same
   * kind, and which of two wins is up to the order of the stylesheet, not of the classes.
   */
  compact?: boolean;
};

export function Button({ variant = "primary", compact, className, style, ...props }: ComponentProps<"button"> & ButtonLook) {
  return <button {...props} style={{ ...chamfer(compact ? 8 : 14), ...style }} className={buttonClass(variant, compact, className)} />;
}

/** A link to a page of this app that looks like a button: one control, and the one the keyboard and a screen reader find. */
export function ButtonLink({ variant = "primary", compact, className, style, ...props }: ComponentProps<typeof Link> & ButtonLook) {
  return <Link {...props} style={{ ...chamfer(compact ? 8 : 14), ...style }} className={buttonClass(variant, compact, className)} />;
}

/** The same for what next/link must not handle: a file to download, a page that is not this app's. */
export function ButtonAnchor({ variant = "primary", compact, className, style, ...props }: ComponentProps<"a"> & ButtonLook) {
  return <a {...props} style={{ ...chamfer(compact ? 8 : 14), ...style }} className={buttonClass(variant, compact, className)} />;
}

export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cx("border border-rule bg-paper-2 p-5", className)}>
      {children}
    </div>
  );
}

// A for-less <label> forwards clicks on its non-interactive area to the first
// labelable descendant. That's only correct when the field wraps a single
// simple control; composite children (tag inputs, repeatable lists) can put a
// remove button first, so a stray click would delete an item instead of
// focusing anything. Field detects the simple case and wires an explicit
// htmlFor/id instead of relying on implicit association.
const LABELABLE_CONTROLS = new Set<unknown>([Input, Textarea, Select, SecretInput]);

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  const generatedId = useId();
  const onlyChild =
    Children.count(children) === 1 && isValidElement(children) ? children : null;
  const isSimpleControl = onlyChild !== null && LABELABLE_CONTROLS.has(onlyChild.type);

  if (isSimpleControl) {
    const control = onlyChild as ReactElement<ComponentProps<"input">>;
    const controlId = control.props.id ?? generatedId;
    return (
      <label htmlFor={controlId} className={cx("block", className)}>
        <span className="mb-1 block font-solar text-[12.5px] font-bold tracking-[0.18em] text-ink-3 uppercase">
          {label}
        </span>
        {cloneElement(control, { id: controlId })}
        {hint ? <span className="mt-1 block text-xs text-ink-3">{hint}</span> : null}
      </label>
    );
  }

  return (
    <div className={cx("block", className)}>
      <span className="mb-1 block font-solar text-[12.5px] font-bold tracking-[0.18em] text-ink-3 uppercase">
          {label}
        </span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-ink-3">{hint}</span> : null}
    </div>
  );
}

// A whole box at `border-white/40` with a faint fill, not an underline: a
// field's resting edge has to be findable on a dark page before anyone has
// touched it, and a 2-line textarea with text in it under an underline reads
// as a paragraph. /40 is ~3.7:1 on `paper` and `paper-2` (WCAG 1.4.11 asks
// 3:1); the /15 underline this replaces was ~1.5:1.
const CONTROL =
  "w-full border border-white/40 bg-white/[0.03] px-3 py-2 text-sm text-ink transition-colors placeholder:text-ink-3 hover:border-white/60 focus:border-solar-g4 focus:outline-none pointer-coarse:min-h-11 motion-reduce:transition-none disabled:cursor-not-allowed disabled:border-dashed disabled:opacity-40";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input {...props} className={cx(CONTROL, className)} />;
}

/**
 * An `Input` for secrets — API keys — with an eye toggle to check what was
 * pasted. Keys are long opaque strings, and the one mistake this field invites
 * is pasting the wrong or a truncated one; the mask makes that undiagnosable.
 *
 * Hidden by default and never remembered: the reveal lives in component state,
 * so a reload masks the value again. The key already sits in `localStorage`;
 * the mask is shoulder-surfing protection, and the toggle hands that choice to
 * the user the way every password manager does.
 */
export function SecretInput({ className, ...props }: ComponentProps<"input">) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span className={cx("relative block", className)}>
      <Input
        {...props}
        type={revealed ? "text" : "password"}
        className={cx("pr-8", revealed && "font-mono text-[13px]")}
      />
      <button
        type="button"
        aria-label={revealed ? "Ocultar" : "Mostrar"}
        aria-pressed={revealed}
        onClick={() => setRevealed((v) => !v)}
        className="absolute inset-y-0 right-0 grid w-8 place-items-center text-ink-3 transition-colors hover:text-ink motion-reduce:transition-none"
      >
        {/* SVG en línea como el resto de la app: ni un asset ni una librería
            de iconos para dos dibujos de 16px. */}
        {revealed ? (
          <svg
            aria-hidden
            viewBox="0 0 16 16"
            fill="none"
            className="size-4 stroke-current"
          >
            <path
              d="M1.7 8s2.6-4.3 6.3-4.3c1 0 1.9.2 2.7.6M14.3 8s-2.6 4.3-6.3 4.3c-1 0-1.9-.2-2.7-.6"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
            <circle cx="8" cy="8" r="2.1" strokeWidth="1.4" />
            <path d="M3 13L13 3" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        ) : (
          <svg
            aria-hidden
            viewBox="0 0 16 16"
            fill="none"
            className="size-4 stroke-current"
          >
            <path
              d="M1.7 8s2.6-4.3 6.3-4.3S14.3 8 14.3 8 11.7 12.3 8 12.3 1.7 8 1.7 8Z"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <circle cx="8" cy="8" r="2.1" strokeWidth="1.4" />
          </svg>
        )}
      </button>
    </span>
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea {...props} className={cx(CONTROL, "resize-y", className)} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select {...props} className={cx(CONTROL, className)} />;
}

export function Checkbox({
  label,
  className,
  ...props
}: ComponentProps<"input"> & { label?: ReactNode }) {
  // The checked state used to live in a color swap alone — nobody
  // colorblind, or squinting at a low-contrast screen, could rely on
  // it. The mark is the same check drawn on every other affordance in
  // the app; `peer`/`peer-checked` reads the input's own state, so
  // there is nothing to keep in sync by hand. Checked fills with the
  // accent (`solar-g4`), the same "this is on" colour `Button` primary
  // and the active tab use, rather than a plain white box.
  const box = (
    <span
      className={cx("relative inline-flex size-4 shrink-0", label === undefined && className)}
    >
      <input
        type="checkbox"
        {...props}
        className="peer size-4 appearance-none border border-white/40 bg-transparent checked:border-solar-g4 checked:bg-solar-g4 disabled:cursor-not-allowed disabled:opacity-40"
      />
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="pointer-events-none absolute inset-0 size-4 stroke-solar-ink opacity-0 peer-checked:opacity-100"
      >
        <path
          d="M4 8.5l2.5 2.5L12 5"
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );

  // A table's row-selection checkbox has no visible label — it carries an
  // `aria-label` instead — so wrapping it in a `<label>` would add a click
  // target with no text in it. Without `label`, the box is the whole
  // component and `className` sizes/positions it directly.
  if (label === undefined) return box;

  return (
    <label className={cx("flex items-center gap-2 text-sm text-ink-2 pointer-coarse:min-h-11 has-disabled:cursor-not-allowed has-disabled:opacity-40", className)}>
      {box}
      {label}
    </label>
  );
}

// The `-800` texts on `-600/10` tints this used to be were tuned for a light
// page — on `#01020c` a dark-800 text on a near-black wash is a dark smear on
// a darker smear. Dark UIs invert which end of the scale carries text: the
// wash stays a low-opacity mid tone (readable as a colour, not as content)
// and the readable text moves to the pale end, `-300`.
export const TONES = {
  neutral: "bg-white/[0.04] text-ink-2 ring-1 ring-white/10",
  good: "bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/25",
  warn: "bg-amber-400/10 text-amber-300 ring-1 ring-amber-400/25",
  bad: "bg-red-400/10 text-red-300 ring-1 ring-red-400/25",
  info: "bg-sky-400/10 text-sky-300 ring-1 ring-sky-400/25",
} as const;

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: keyof typeof TONES;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center px-2 py-0.5 text-xs font-normal tracking-[0.08em] uppercase",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Alert({
  tone = "warn",
  title,
  role,
  children,
}: {
  tone?: keyof typeof TONES;
  title?: string;
  /**
   * Defaults to `"alert"` for `tone="bad"` (an interruption worth announcing
   * immediately) and `"status"` for every other tone (worth reading, not
   * worth cutting off whatever the screen reader was already saying). Every
   * banner in the app used to carry neither, so a waiting-on-the-model error
   * was invisible until the user happened to tab past it.
   */
  role?: "alert" | "status";
  children: ReactNode;
}) {
  return (
    <div
      role={role ?? (tone === "bad" ? "alert" : "status")}
      className={cx("px-4 py-3 text-sm", TONES[tone])}
    >
      {title ? <p className="font-normal text-ink">{title}</p> : null}
      <div className={cx("wrap-break-word whitespace-pre-line", title ? "mt-1" : undefined)}>{children}</div>
    </div>
  );
}

export function SectionTitle({
  children,
  action,
  note,
}: {
  children: ReactNode;
  action?: ReactNode;
  /** A line in small type under the title — when the section was last reviewed. Nothing is drawn for a note that renders nothing. */
  note?: ReactNode;
}) {
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="min-w-0 font-solar text-[12.5px] font-bold tracking-[0.18em] text-ink-3 uppercase">
          {children}
        </h2>
        {action}
      </div>
      {note ? <p className="mt-1 text-xs text-ink-3 empty:hidden">{note}</p> : null}
    </div>
  );
}

export type TabItem<T extends string = string> = {
  id: T;
  label: string;
  /** DOM id for this tab button — only needed when a matching tabpanel exists. */
  domId?: string;
  /** `aria-controls` target — only needed when a matching tabpanel exists. */
  controls?: string;
};

/**
 * The one tablist the app uses, pulled out of `ExtrasPanel` so a second
 * switcher (Postulaciones' Kanban/Tabla/Métricas) gets the same ARIA roles,
 * gradient underline and keyboard behavior instead of reinventing "which panel
 * shows" with plain buttons.
 *
 * Standard tablist arrow-key navigation: Left/Right (wrapping) and Home/End
 * move focus and switch the panel in the same step — with a handful of short
 * tabs, activating on arrival beats requiring a second key press.
 */
export function Tabs<T extends string>({
  tabs,
  activeId,
  onChange,
  label,
}: {
  tabs: TabItem<T>[];
  activeId: T;
  onChange: (id: T) => void;
  label: string;
}) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    if (next === null) return;
    event.preventDefault();
    onChange(tabs[next].id);
    tabRefs.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      className="flex snap-x gap-1 overflow-x-auto border-b border-rule sm:flex-wrap sm:overflow-visible"
    >
      {tabs.map((entry, index) => (
        <button
          key={entry.id}
          ref={(el) => {
            tabRefs.current[index] = el;
          }}
          id={entry.domId}
          role="tab"
          type="button"
          aria-selected={activeId === entry.id}
          aria-controls={entry.controls}
          tabIndex={activeId === entry.id ? 0 : -1}
          onClick={() => onChange(entry.id)}
          onKeyDown={(e) => onKeyDown(e, index)}
          className={cx(
            "relative -mb-px shrink-0 snap-start px-3 py-2 font-solar text-[13px] font-bold tracking-[0.16em] whitespace-nowrap uppercase transition-colors pointer-coarse:min-h-11",
            activeId === entry.id ? "text-ink" : "text-ink-3 hover:text-ink",
          )}
        >
          {entry.label}
          {/* The gradient underline is a positioned bar rather than a
              `border-b` colour: a border can only ever be one solid colour,
              and the whole point here is the same accent ramp
              `GradientText` and the AI hairline draw from. */}
          {activeId === entry.id ? (
            <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-(image:--gradient-solar-text)" />
          ) : null}
        </button>
      ))}
    </div>
  );
}

/**
 * A `Card` whose header is a native disclosure rather than a fixed
 * `SectionTitle` — open by default, so nothing changes for the sidebar this
 * was built for (`AnalysisPanel`, `CoveragePanel`, `InferredSkillsPanel` next
 * to the CV preview at `lg`), but foldable for the same panels stacked full
 * width below it on a phone, where four of these open at once is a wall of
 * scroll between the CV and the rest of the page.
 *
 * `open` only sets the *initial* state: React re-renders with the same prop
 * value on every subsequent render regardless of what the user has toggled,
 * so it never fights a manual open/close the way a fully controlled `open`
 * would.
 */
export function CollapsibleCard({
  id,
  title,
  action,
  defaultOpen = true,
  onToggle,
  children,
  className,
}: {
  /** What a link to this card names (`goTo` opens it first): the card is the target and not its heading. */
  id?: string;
  title: ReactNode;
  action?: ReactNode;
  defaultOpen?: boolean;
  /** Fired on every user-driven expand/collapse, with the new open state. */
  onToggle?: (open: boolean) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details
      id={id}
      open={defaultOpen}
      onToggle={(event) => onToggle?.(event.currentTarget.open)}
      className={cx("group border border-rule bg-paper-2 p-5", className)}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 mb-0 group-open:mb-3 pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-2 font-solar text-[12.5px] font-bold tracking-[0.18em] text-ink-3 uppercase">
          <span
            aria-hidden
            className="inline-block shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none"
          >
            ▸
          </span>
          <span className="min-w-0 wrap-break-word">{title}</span>
        </span>
        {action}
      </summary>
      {children}
    </details>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        "inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none",
        className,
      )}
    />
  );
}

/**
 * The heading every section opens with: a Barlow eyebrow, a light title, and
 * one line saying what the screen is for. Written once because all five
 * sections wear it, and because the weights and tracking are the whole
 * character of the design — retyped by hand they drift immediately. `title`
 * takes any `ReactNode`, so a caller can wrap one word in `GradientText` the
 * same way the landing's own headings emphasise a word, without this
 * component needing to know about it.
 */
export function PageHeading({
  eyebrow,
  title,
  children,
  action,
}: {
  eyebrow: string;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <span className="mb-3.5 block font-solar text-[12.5px] font-bold tracking-[0.18em] text-ink-3 uppercase">
          {eyebrow}
        </span>
        <h1 className="wrap-break-word text-[clamp(1.75rem,3.4vw,2.375rem)] leading-tight font-light tracking-[-0.045em] text-balance text-ink">
          {title}
        </h1>
        {children ? (
          <p className="mt-3 max-w-[48ch] text-[14.5px] leading-relaxed text-pretty text-ink-2">
            {children}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/**
 * The ruled key/value list the design uses wherever a section has to show a few
 * facts about itself — settings, counts, the applications history.
 */
export function Rows({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("border-t border-rule", className)}>{children}</div>
  );
}

export function Row({
  children,
  aside,
}: {
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-2 border-b border-rule py-3.5 text-[14.5px] text-ink-2 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
      <div className="w-full min-w-0 wrap-break-word sm:w-auto">{children}</div>
      {aside ? (
        // Font only, not the full eyebrow recipe: unlike `SectionTitle` or
        // `Field`, this wraps arbitrary mixed content passed in by the
        // caller — a formatted date, a `Badge`, a `Button` — and forcing
        // `uppercase`/`font-bold` on all of it would reach content that was
        // never meant to be transformed, not just this component's own text.
        <div className="flex flex-wrap items-center gap-3 font-solar text-xs tracking-widest text-ink-3 lg:shrink-0 lg:flex-nowrap">
          {aside}
        </div>
      ) : null}
    </div>
  );
}
