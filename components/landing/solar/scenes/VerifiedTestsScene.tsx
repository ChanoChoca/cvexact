"use client";

import { CompositionStage, Easing, animate, clamp, useComposition, type Scene } from "../composition";
import { SOLAR, OK } from "./palette";

/**
 * Based on the project's design reference `CVExact hero design/verified-tests.html`
 * ("controles automáticos contra afirmaciones sin respaldo"). The scene is a
 * React implementation created with AI assistance under the project owner's
 * direction; see `ASSETS.md`. Pure abstract SVG motion, no demo copy to
 * localize: a profile card is verified by orbiting checks, three of which
 * flip from a blocked-claim slash to a check, ending in a green badge.
 *
 * The source's own tweak defaults ship this on a light `#f2f5f8` backdrop
 * (its "clean" preview mode). Overridden to transparent here at the user's
 * request, to match `VerifiedRubroScene`'s already-transparent tile and read
 * as one consistent row against the dark page.
 */

const SCENES: Scene[] = [
  { name: "Assemble", dur: 2.2, desc: "La tarjeta de perfil aparece; el avatar y las líneas del CV se completan" },
  { name: "Scan", dur: 2.2, desc: "Una franja de luz recorre la tarjeta dos veces y aparece el anillo orbital" },
  { name: "Checks", dur: 3.8, desc: "Nueve chequeos chicos orbitan la tarjeta, cada uno gira y se completa" },
  { name: "Guards", dur: 2.6, desc: "Tres indicadores grandes de dato bloqueado pasan de tache a check" },
  { name: "Badge", dur: 2.2, desc: "El anillo cierra en verde, los checks espiralan hacia adentro y aparece la insignia" },
  { name: "Hold", dur: 1.8, desc: "La tarjeta insignia respira y todo se desvanece para el loop" },
];

const W = 1600,
  H = 900,
  CX = 800,
  CY = 450,
  R = 302;
const RING_P = 2 * Math.PI * R;

const MOTION = {
  enter: (from: number, to: number, start: number, dur: number) => animate({ from, to, start, end: start + dur, ease: Easing.easeOutCubic }),
  pop: (from: number, to: number, start: number, dur: number) => animate({ from, to, start, end: start + dur, ease: Easing.easeOutBack }),
  sweep: (from: number, to: number, start: number, dur: number) => animate({ from, to, start, end: start + dur, ease: Easing.easeInOutCubic }),
};
const arc = (t: number) => Math.sin(clamp(t, 0, 1) * Math.PI);

const CARD = { x: 590, y: 310, w: 420, h: 280 };
const ROWS = [284, 236, 300, 198];
const GUARD_SLOTS = [2, 6, 10];
const SLOTS = 12;
const CHECK_SLOTS = [0, 1, 3, 4, 5, 7, 8, 9, 11];

// `g4`: el color que `app/page.tsx` ya usa para "Paso 01", asi la primera
// tarjeta de esta seccion no trae un azul ajeno a la paleta. `SUCCESS` es el
// verde ✓ compartido con las otras dos escenas de "Verificado".
const ACCENT = SOLAR.g4;
const SUCCESS = OK;
const ORBIT_SPEED = 9;

function OrbitChip({
  T,
  slot,
  appearAt,
  guard,
  ink,
  accent,
  success,
  rot,
  radius,
  fade,
}: {
  T: number;
  slot: number;
  appearAt: number;
  guard: boolean;
  ink: string;
  accent: string;
  success: string;
  rot: number;
  radius: number;
  fade: number;
}) {
  const app = MOTION.pop(0, 1, appearAt, 0.5)(T);
  if (app <= 0.001 || fade <= 0.001) return null;
  const spin = MOTION.sweep(0, 1, appearAt + 0.08, 0.46)(T);
  const draw = MOTION.sweep(0, 1, appearAt + 0.5, 0.34)(T);
  const bump = arc((T - (appearAt + 0.5)) / 0.44) * 0.16;

  const r = guard ? 31 : 25;
  const C = 2 * Math.PI * r;
  const ang = ((slot * (360 / SLOTS) - 90 + rot) * Math.PI) / 180;
  const x = CX + Math.cos(ang) * radius;
  const y = CY + Math.sin(ang) * radius;
  const s = app * (1 + bump) * (0.72 + 0.28 * fade);

  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} opacity={clamp(app, 0, 1) * clamp(fade, 0, 1)}>
      <circle r={r} fill="#ffffff" />
      <circle r={r} fill={success} opacity={0.09 * draw} />
      {guard ? <circle r={r + 8} fill="none" stroke={ink} strokeOpacity={0.16} strokeWidth={2} strokeDasharray="2.5 8" /> : null}
      <circle r={r} fill="none" stroke={ink} strokeOpacity={0.09} strokeWidth={3} />
      <circle r={r} fill="none" stroke={accent} strokeWidth={3} strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - spin)} opacity={1 - draw} transform="rotate(-90)" />
      <circle r={r} fill="none" stroke={success} strokeWidth={3} opacity={draw} />
      {guard ? (
        <g stroke={ink} strokeOpacity={0.34} strokeWidth={2.6} strokeLinecap="round" fill="none" opacity={1 - draw} transform={`scale(${1 - 0.25 * draw})`}>
          <circle r={8.5} />
          <line x1={-6} y1={-6} x2={6} y2={6} />
        </g>
      ) : null}
      <path
        d={guard ? "M-10 0.5 L-3 8 L10.5 -7" : "M-8.5 0.5 L-2.5 6.5 L9 -6"}
        fill="none"
        stroke={success}
        strokeWidth={guard ? 3.8 : 3.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        strokeDasharray="1"
        strokeDashoffset={1 - draw}
      />
    </g>
  );
}

function ProfileCard({ T, ink, accent, scanEnd }: { T: number; ink: string; accent: string; scanEnd: number }) {
  const { x, y, w, h } = CARD;
  const app = MOTION.pop(0, 1, 0.15, 0.85)(T);
  const av = MOTION.pop(0, 1, 0.5, 0.55)(T);
  const nameW = MOTION.enter(0, 1, 0.72, 0.4)(T);
  const subW = MOTION.enter(0, 1, 0.82, 0.4)(T);

  const scanActive = clamp((T - 2.25) / 0.25, 0, 1) * (1 - clamp((T - (scanEnd - 0.3)) / 0.3, 0, 1));
  const pass1 = MOTION.sweep(y - 170, y + h, 2.35, 1.2)(T);
  const pass2 = MOTION.sweep(y - 170, y + h, 3.6, 0.75)(T);

  return (
    <g opacity={clamp(app, 0, 1)}>
      <g transform={`translate(${CX} ${CY}) scale(${0.9 + 0.1 * app}) translate(${-CX} ${-CY})`}>
        <rect x={x} y={y} width={w} height={h} rx={26} fill="#ffffff" filter="url(#cardShadow)" />
        <rect x={x} y={y} width={w} height={h} rx={26} fill="none" stroke={ink} strokeOpacity={0.07} strokeWidth={2} />

        <g clipPath="url(#cardClip)" opacity={scanActive}>
          <rect x={x} y={pass1} width={w} height={170} fill="url(#scanGrad)" />
          <rect x={x} y={pass1 + 168} width={w} height={2.5} fill={accent} opacity={0.5} />
          <rect x={x} y={pass2} width={w} height={170} fill="url(#scanGrad)" opacity={0.7} />
          <rect x={x} y={pass2 + 168} width={w} height={2.5} fill={accent} opacity={0.35} />
        </g>
        <rect x={x} y={y} width={w} height={h} rx={26} fill="none" stroke={accent} strokeOpacity={0.3 * scanActive} strokeWidth={2} />

        <g transform={`translate(656 376) scale(${av})`} opacity={clamp(av, 0, 1)}>
          <circle r={34} fill={ink} fillOpacity={0.06} />
          <g clipPath="url(#avatarClip)" fill={ink} fillOpacity={0.22}>
            <circle cy={-9} r={11.5} />
            <rect x={-17} y={8} width={34} height={28} rx={17} />
          </g>
        </g>
        <rect x={710} y={361} width={148 * nameW} height={14} rx={7} fill={ink} fillOpacity={0.17} />
        <rect x={710} y={387} width={100 * subW} height={10} rx={5} fill={ink} fillOpacity={0.1} />
        <rect x={622} y={434} width={356} height={2} rx={1} fill={ink} fillOpacity={0.06} />

        {ROWS.map((rw, i) => {
          const p = MOTION.enter(0, 1, 0.95 + i * 0.12, 0.45)(T);
          const ry = 458 + i * 30;
          return (
            <g key={i} opacity={clamp(p, 0, 1)}>
              <rect x={622} y={ry} width={12} height={12} rx={3.5} fill={ink} fillOpacity={0.14} transform={`translate(628 ${ry + 6}) scale(${p}) translate(-628 ${-ry - 6})`} />
              <rect x={646} y={ry} width={rw * p} height={12} rx={6} fill={ink} fillOpacity={0.09} />
            </g>
          );
        })}
      </g>
    </g>
  );
}

function Piece() {
  const { T, CUES, authoredTotal } = useComposition();
  // Vive tanto dentro de la tarjeta blanca (fuerte, sin cambios) como en el
  // anillo punteado de fondo sobre la pagina oscura, donde a 0.13 de opacidad
  // era casi invisible: ahi se usa `ringInk` mas abajo.
  const ink = "#232a38";
  const ringInk = SOLAR.muted;

  const out = 1 - MOTION.sweep(0, 1, authoredTotal - 0.55, 0.55)(T);
  const rot = T * ORBIT_SPEED;

  const ringIn = MOTION.enter(0, 1, 1.5, 0.7)(T);
  const prog = MOTION.sweep(0, 1, CUES.Checks - 0.2, CUES.Badge - 0.2 - (CUES.Checks - 0.2))(T);
  const ringDone = MOTION.sweep(0, 1, CUES.Badge + 0.15, 0.45)(T);
  const ringOut = MOTION.sweep(0, 1, CUES.Badge + 0.35, 0.8)(T);

  const collapse = MOTION.sweep(1, 0, CUES.Badge + 0.35, 0.8);
  const chipFade = MOTION.sweep(1, 0, CUES.Badge + 0.4, 0.7);
  const badge = MOTION.pop(0, 1, CUES.Badge + 0.2, 0.55)(T);
  const badgeBounce = arc((T - (CUES.Badge + 0.78)) / 0.42) * 0.11;
  const badgeDraw = MOTION.sweep(0, 1, CUES.Badge + 0.42, 0.36)(T);
  const halo = MOTION.sweep(0, 1, CUES.Badge + 0.22, 0.85)(T);

  const chips: Array<{ slot: number; appearAt: number; guard: boolean }> = [];
  CHECK_SLOTS.forEach((slot, i) => chips.push({ slot, appearAt: CUES.Checks + i * 0.36, guard: false }));
  GUARD_SLOTS.forEach((slot, i) => chips.push({ slot, appearAt: CUES.Guards + 0.15 + i * 0.72, guard: true }));

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", opacity: clamp(out, 0, 1) }}>
        <defs>
          <filter id="cardShadow" x="-30%" y="-30%" width="160%" height="180%">
            <feDropShadow dx="0" dy="18" stdDeviation="26" floodColor="#1a2440" floodOpacity="0.10" />
          </filter>
          <clipPath id="cardClip">
            <rect x={CARD.x} y={CARD.y} width={CARD.w} height={CARD.h} rx={26} />
          </clipPath>
          <clipPath id="avatarClip">
            <circle r={34} />
          </clipPath>
          <linearGradient id="scanGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity="0" />
            <stop offset="100%" stopColor={ACCENT} stopOpacity="0.2" />
          </linearGradient>
        </defs>

        <g opacity={clamp(ringIn * (1 - ringOut), 0, 1)} transform={`translate(${CX} ${CY}) scale(${1 + 0.05 * ringOut}) translate(${-CX} ${-CY})`}>
          <circle cx={CX} cy={CY} r={R} fill="none" stroke={ringInk} strokeOpacity={0.85} strokeWidth={1.5} strokeDasharray="3 13" transform={`rotate(${rot * 0.3} ${CX} ${CY})`} />
          <circle cx={CX} cy={CY} r={R} fill="none" strokeWidth={3.5} strokeLinecap="round" stroke={ACCENT} opacity={1 - ringDone} strokeDasharray={RING_P} strokeDashoffset={RING_P * (1 - prog)} transform={`rotate(-90 ${CX} ${CY})`} />
          <circle cx={CX} cy={CY} r={R} fill="none" strokeWidth={3.5} stroke={SUCCESS} opacity={ringDone} />
        </g>

        <ProfileCard T={T} ink={ink} accent={ACCENT} scanEnd={CUES.Checks} />

        {chips.map((c, i) => (
          <OrbitChip key={i} T={T} slot={c.slot} appearAt={c.appearAt} guard={c.guard} ink={ink} accent={ACCENT} success={SUCCESS} rot={rot} fade={clamp(chipFade(T - c.slot * 0.025), 0, 1)} radius={R * (0.8 + 0.2 * clamp(collapse(T - c.slot * 0.025), 0, 1))} />
        ))}

        <g transform="translate(1004 320)" opacity={clamp(badge, 0, 1)}>
          <circle r={42 + 58 * halo} fill="none" stroke={SUCCESS} strokeWidth={2.5} opacity={0.32 * (1 - halo)} />
          <g transform={`scale(${badge * (1 + badgeBounce)})`}>
            <circle r={42} fill={SUCCESS} />
            <circle r={42} fill="none" stroke="#ffffff" strokeOpacity={0.9} strokeWidth={5} />
            <path d="M-16 1 L-5.5 12 L17 -11" fill="none" stroke="#ffffff" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - badgeDraw} />
          </g>
        </g>
      </svg>
    </div>
  );
}

export function VerifiedTestsScene() {
  return (
    <CompositionStage width={W} height={H} scenes={SCENES} driver={{ kind: "loop", gated: true, threshold: 0.4, hold: 2, restartOnEnter: true }} bg="transparent">
      <Piece />
    </CompositionStage>
  );
}
