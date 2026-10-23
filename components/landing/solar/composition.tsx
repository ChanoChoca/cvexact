"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";

/**
 * A from-scratch, minimal implementation of the animation model used by the project's Claude Design reference
 * "animations-v3" engine (`CVExact hero design/*.html`, the jsx manifest
 * entry shared by all 9 scenes) — just enough of its API for the 9
 * scenes in `./scenes/*.tsx` to run unmodified against real scroll/viewport
 * state instead of the editor's scrub protocol
 * (`data-om-seek-to-time-frame` on an iframe's `contentDocument`).
 *
 * Left out on purpose: the `<svg>`/`foreignObject`/`data-om-exportable-*`
 * wrapper (video-export plumbing, irrelevant to a live page), `useTweaks`/
 * `TweaksPanel` (editor-only controls — each scene's `TWEAK_DEFAULTS` are
 * inlined as constants instead), and `Shot`/watercolor (`WatercolorPainting`
 * etc.) — none of the 9 scenes use them.
 *
 * `CUES`/`authoredTotal`: the original derives these with a `nat` field for
 * the host timeline's trim/speed retiming. No scene here ever sets `nat`, so
 * `nat === dur` always and the retiming math (`ccWarp`) collapses to the
 * identity — `T` is simply elapsed seconds, and `CUES[name]` is the running
 * sum of `dur` up to that section's first occurrence. `deriveCues` below is
 * that simplification, not an approximation.
 */

// ── Easing + interpolation (verbatim from animations-v3.jsx) ───────────────

export const Easing = {
  linear: (t: number) => t,

  easeInQuad: (t: number) => t * t,
  easeOutQuad: (t: number) => t * (2 - t),
  easeInOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),

  easeInCubic: (t: number) => t * t * t,
  easeOutCubic: (t: number) => --t * t * t + 1,
  easeInOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),

  easeInQuart: (t: number) => t * t * t * t,
  easeOutQuart: (t: number) => 1 - --t * t * t * t,
  easeInOutQuart: (t: number) => (t < 0.5 ? 8 * t * t * t * t : 1 - 8 * --t * t * t * t),

  easeInExpo: (t: number) => (t === 0 ? 0 : Math.pow(2, 10 * (t - 1))),
  easeOutExpo: (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  easeInOutExpo: (t: number) => {
    if (t === 0) return 0;
    if (t === 1) return 1;
    if (t < 0.5) return 0.5 * Math.pow(2, 20 * t - 10);
    return 1 - 0.5 * Math.pow(2, -20 * t + 10);
  },

  easeInSine: (t: number) => 1 - Math.cos((t * Math.PI) / 2),
  easeOutSine: (t: number) => Math.sin((t * Math.PI) / 2),
  easeInOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,

  easeOutBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  easeInBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return c3 * t * t * t - c1 * t * t;
  },
  easeInOutBack: (t: number) => {
    const c1 = 1.70158;
    const c2 = c1 * 1.525;
    return t < 0.5
      ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
      : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;
  },

  easeOutElastic: (t: number) => {
    const c4 = (2 * Math.PI) / 3;
    if (t === 0) return 0;
    if (t === 1) return 1;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
};

export type EaseFn = (t: number) => number;

export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** interpolate([0,0.5,1], [0,100,50], ease?) -> fn(t) — multi-keyframe tween. */
export function interpolate(input: number[], output: number[], ease: EaseFn | EaseFn[] = Easing.linear) {
  return (t: number) => {
    if (t <= input[0]) return output[0];
    if (t >= input[input.length - 1]) return output[output.length - 1];
    for (let i = 0; i < input.length - 1; i++) {
      if (t >= input[i] && t <= input[i + 1]) {
        const span = input[i + 1] - input[i];
        const local = span === 0 ? 0 : (t - input[i]) / span;
        const easeFn = Array.isArray(ease) ? ease[i] || Easing.linear : ease;
        return output[i] + (output[i + 1] - output[i]) * easeFn(local);
      }
    }
    return output[output.length - 1];
  };
}

/** animate({from,to,start,end,ease})(t) — single-segment tween, clamped outside [start,end]. */
export function animate({
  from = 0,
  to = 1,
  start = 0,
  end = 1,
  ease = Easing.easeInOutCubic,
}: { from?: number; to?: number; start?: number; end?: number; ease?: EaseFn } = {}) {
  return (t: number) => {
    if (t <= start) return from;
    if (t >= end) return to;
    const local = (t - start) / (end - start);
    return from + (to - from) * ease(local);
  };
}

// ── Cues ─────────────────────────────────────────────────────────────────

export type Scene = { name: string; dur: number; desc?: string };

function deriveCues(scenes: Scene[]) {
  let t = 0;
  const table: Record<string, number> = {};
  for (const s of scenes) {
    if (!(s.name in table)) table[s.name] = Math.round(t * 1000) / 1000;
    t += s.dur;
  }
  return { table, total: Math.round(t * 1000) / 1000 };
}

// ── Composition context ─────────────────────────────────────────────────

type CompositionValue = { T: number; CUES: Record<string, number>; authoredTotal: number };

const CompositionContext = createContext<CompositionValue | null>(null);

export function useComposition() {
  const ctx = useContext(CompositionContext);
  if (!ctx) throw new Error("useComposition() must be called inside <CompositionStage>");
  return ctx;
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_MOTION_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
const getReducedMotionSnapshot = () => window.matchMedia(REDUCED_MOTION_QUERY).matches;
const getReducedMotionServerSnapshot = () => false;

/**
 * `useSyncExternalStore` rather than a state-plus-effect pair: this needs to
 * read a browser API (unavailable during SSR, hence the server snapshot)
 * without the extra render an effect-driven `setState` on mount would add.
 */
function useReducedMotion() {
  return useSyncExternalStore(subscribeReducedMotion, getReducedMotionSnapshot, getReducedMotionServerSnapshot);
}

/**
 * The four playback shapes the original page's outer `Component` class drove
 * its scenes with (`seek()`/`stepPlay()`/`ctaPlay()`/`progress()` in
 * `cvexact Landing.dc.html`) — one per scene, chosen the same way there:
 *
 * - `loop`, `gated: false` — the hero (`floating-cv`): free-running, never
 *   paused. The original never gates it either; nothing in the design wires
 *   an observer to the hero's iframe.
 * - `loop`, `gated: true` — the 3 verified tiles: one shared cadence in
 *   spirit (each still runs its own rAF here, since they're no longer
 *   sibling iframes a single loop can reach into), paused outside the
 *   viewport (`observeVerified`, threshold 0.15).
 * - `once` — the 3 steps: plays start-to-finish exactly once, the first time
 *   it crosses `threshold` (`observeSteps`, 0.55). `cap` reproduces
 *   `if (i === 0) dur = Math.min(dur, 15)` — step 0 only ever plays its
 *   first 15 authored seconds in this context.
 * - `replay` — the CTA: replays from 0 on every entry, resets to 0 on exit
 *   (`observeCta`, threshold 0.4).
 * - `scroll` — the runway: `T` tracks a pinned track's scroll progress
 *   directly (`progress()`/`seek()`), not time. `start` reproduces the
 *   original's `const start = 1` — scrubbing begins 1 authored second in.
 */
export type Driver =
  | { kind: "loop"; gated?: boolean; threshold?: number; start?: number; end?: number; hold?: number; restartOnEnter?: boolean }
  | { kind: "once"; threshold?: number; cap?: number; start?: number }
  | { kind: "replay"; threshold?: number }
  | { kind: "scroll"; trackRef: RefObject<HTMLElement | null>; start?: number };

function useDriverTime(driver: Driver, total: number, hostRef: RefObject<HTMLElement | null>) {
  const reduced = useReducedMotion();
  const [T, setT] = useState(0);

  useEffect(() => {
    // Reduced motion (and a still-loading scene with no duration yet): no
    // rAF, no observer — the return statement below already substitutes
    // `STATIC_T` for `T` whenever `reduced` is true, so there's nothing to
    // set here.
    if (reduced || total <= 0) return;

    if (driver.kind === "loop") {
      let raf = 0;
      let last: number | null = null;
      let visible = !driver.gated;
      const from = driver.start ?? 0;
      const to = Math.min(total, driver.end ?? total);
      const hold = driver.hold ?? 0;
      // `elapsed` runs from 0 to (to - from + hold): the scene plays, sits on
      // its last frame for `hold` seconds, then wraps back to `from`.
      let elapsed = 0;
      const tick = (ts: number) => {
        if (last == null) last = ts;
        const dt = (ts - last) / 1000;
        last = ts;
        if (visible) {
          elapsed = (elapsed + dt) % (to - from + hold);
          setT(Math.min(to - 0.001, from + elapsed));
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      let observer: IntersectionObserver | undefined;
      if (driver.gated && hostRef.current) {
        observer = new IntersectionObserver(
          ([e]) => {
            if (e.isIntersecting && !visible && driver.restartOnEnter) elapsed = 0;
            visible = e.isIntersecting;
          },
          { threshold: driver.threshold ?? 0.15 },
        );
        observer.observe(hostRef.current);
      }
      return () => {
        cancelAnimationFrame(raf);
        observer?.disconnect();
      };
    }

    if (driver.kind === "once") {
      const host = hostRef.current;
      if (!host) return;
      let raf = 0;
      let played = false;
      const dur = driver.cap ? Math.min(total, driver.cap) : total;
      const play = () => {
        if (played) return;
        played = true;
        const t0 = performance.now();
        const tick = (now: number) => {
          const t = Math.min(dur - 0.001, (driver.start ?? 0) + (now - t0) / 1000);
          setT(t);
          if (t < dur - 0.001) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      };
      const observer = new IntersectionObserver(
        ([e]) => {
          if (e.isIntersecting) play();
        },
        { threshold: driver.threshold ?? 0.55 },
      );
      observer.observe(host);
      return () => {
        cancelAnimationFrame(raf);
        observer.disconnect();
      };
    }

    if (driver.kind === "replay") {
      const host = hostRef.current;
      if (!host) return;
      let raf = 0;
      const play = () => {
        if (raf) cancelAnimationFrame(raf);
        const t0 = performance.now();
        const tick = (now: number) => {
          const t = Math.min(total - 0.001, (now - t0) / 1000);
          setT(t);
          raf = t < total - 0.001 ? requestAnimationFrame(tick) : 0;
        };
        raf = requestAnimationFrame(tick);
      };
      const stop = () => {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        setT(0);
      };
      const observer = new IntersectionObserver(([e]) => (e.isIntersecting ? play() : stop()), {
        threshold: driver.threshold ?? 0.4,
      });
      observer.observe(host);
      setT(0);
      return () => {
        cancelAnimationFrame(raf);
        observer.disconnect();
      };
    }

    // scroll
    let raf = 0;
    const startSkip = driver.start ?? 0;
    const compute = () => {
      raf = 0;
      const track = driver.trackRef.current;
      const pin = track?.firstElementChild as HTMLElement | null;
      if (!track || !pin) return;
      const r = track.getBoundingClientRect();
      const span = r.height - pin.getBoundingClientRect().height;
      if (span <= 0) {
        setT(startSkip);
        return;
      }
      // `top` on a `position: sticky` element reads back as the authored CSS
      // value (a constant, e.g. the nav height) rather than a live offset —
      // reading it instead of hardcoding keeps this correct if that value
      // ever changes.
      const pinTop = parseFloat(getComputedStyle(pin).top) || 0;
      const progress = clamp((pinTop - r.top) / span, 0, 1);
      setT(clamp(startSkip + progress * (total - startSkip), 0, total - 0.001));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(compute);
    };
    compute();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
    // `driver` is a fresh object per render at every call site (all of them
    // pass an inline literal) — comparing it here would re-run this effect
    // every render, so its relevant fields are read once above and this
    // effect is keyed on `total`/`reduced` instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, reduced, hostRef]);

  return reduced ? total * STATIC_FRACTION : T;
}

/**
 * Where a reduced-motion viewer sees a scene held, instead of `total` itself
 * (`T = 1` in `u = T / total`) — several of the 9 scenes fade to black in
 * their last authored fraction of a second, precisely *because* they were
 * authored as seamless loops, where "the last frame equals the first" means
 * both ends sit at black (see `useComposition`'s comment on loop seams).
 * Freezing exactly at `total` under reduced motion would show that fade's
 * black end state — motion turned off, but the frame it lands on is the one
 * frame that looks broken rather than finished. 0.95 sits before every such
 * scene's fade-out window while still reading as "settled": checked against
 * each of the 9 scenes by hand rather than derived automatically, since
 * nothing in `Scene`/`OM_SCENES` marks where a fade window starts.
 */
const STATIC_FRACTION = 0.95;

/**
 * A fixed-size canvas (each scene authors against its own `width`/`height` —
 * most are 1920×1080 or 1600×900, but the runway scene is a portrait
 * 1080×1350, because it's a CV sheet, not a 16:9 clip) scaled to fit its
 * container: `Math.min(containerW / width, containerH / height)`, the same
 * "contain" fit the original engine's own `Stage` component uses. Scaling by
 * width alone — this component's first version did — is only safe when the
 * container's own aspect ratio already matches the canvas's, true for 8 of
 * the 9 scenes (each sits in an `aspect-video` box) but not the runway,
 * whose container is the full-viewport sticky track, not a 16:9 box; a
 * portrait canvas stretched to that container's width overflows its height
 * several times over, which is what "the video cuts off the sheet" was.
 * `transformOrigin: center` inside a centered flex box, also matching
 * `Stage`, so the letterboxing (empty space where the ratios don't match)
 * lands evenly on both sides rather than piling up bottom-right the way a
 * top-left-anchored scale would.
 */
export function CompositionStage({
  width = 1920,
  height = 1080,
  scenes,
  driver,
  bg = "transparent",
  children,
}: {
  width?: number;
  height?: number;
  scenes: Scene[];
  driver: Driver;
  bg?: string;
  children: ReactNode;
}) {
  const { table, total } = useMemo(() => deriveCues(scenes), [scenes]);
  const hostRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => setScale(Math.min(el.clientWidth / width, el.clientHeight / height));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height]);

  const T = useDriverTime(driver, total, hostRef);
  const value = useMemo(() => ({ T, CUES: table, authoredTotal: total }), [T, table, total]);

  return (
    <div
      ref={hostRef}
      style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", background: bg }}
    >
      <div
        style={{
          width,
          height,
          flexShrink: 0,
          transformOrigin: "center",
          transform: `scale(${scale})`,
        }}
      >
        <CompositionContext.Provider value={value}>{children}</CompositionContext.Provider>
      </div>
    </div>
  );
}

const CAPTION_FADE = 0.18;

/** One caption visible at a time, keyed to `T` — verbatim port of the original. */
export function Captions({
  items,
  style,
}: {
  items: Array<{ at: number; until?: number; text: string }>;
  style?: CSSProperties;
}) {
  const { T } = useComposition();
  const sorted = useMemo(
    () => [...items].filter((it) => Number.isFinite(it.at)).sort((a, b) => a.at - b.at),
    [items],
  );
  let active: (typeof sorted)[number] | null = null;
  let end = Infinity;
  for (let i = 0; i < sorted.length; i++) {
    if (T < sorted[i].at) break;
    active = sorted[i];
    end = typeof active.until === "number" && Number.isFinite(active.until) ? active.until : (sorted[i + 1]?.at ?? Infinity);
  }
  if (!active || T >= end) return null;
  let o = Math.min(1, (T - active.at) / CAPTION_FADE);
  if (Number.isFinite(end)) o = Math.min(o, (end - T) / CAPTION_FADE);
  o = clamp(o, 0, 1);
  return (
    <div
      style={{
        position: "absolute",
        left: "8%",
        right: "8%",
        bottom: "7%",
        textAlign: "center",
        opacity: o,
        pointerEvents: "none",
        font: "500 30px Inter, system-ui, sans-serif",
        color: "#f6f4ef",
        textShadow: "0 1px 14px rgba(0,0,0,0.45)",
        ...style,
      }}
    >
      {active.text}
    </div>
  );
}
