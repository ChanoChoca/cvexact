"use client";

import type { ReactNode } from "react";
import { CompositionStage, Easing, animate, clamp, useComposition, type Scene } from "../composition";
import { SOLAR, OK } from "./palette";

/**
 * Based on the project's design reference `CVExact hero design/verified-scope.html` ("Te muestra qué
 * cubre y qué no"). Pure abstract SVG motion, no demo copy: a verified
 * profile card holds center while capability nodes emerge, link, and
 * resolve into supported (check) or out-of-scope (pause) states.
 */

const SCENES: Scene[] = [
  { name: "Verified", dur: 1.6, desc: "La tarjeta de perfil verificado sostiene el centro y su insignia verde pulsa" },
  { name: "Emerge", dur: 2.6, desc: "Los íconos de capacidad aparecen y escalan alrededor del perfil, uno por uno" },
  { name: "Link", dur: 2.8, desc: "Las líneas conectoras se dibujan desde la tarjeta hacia cada capacidad" },
  { name: "Sort", dur: 3.4, desc: "Las capacidades cubiertas reciben un check verde; las que quedan afuera se detienen en un límite con una marca neutra" },
  { name: "Hold", dur: 2.6, desc: "La imagen se sostiene mientras pulsos viajan por los enlaces cubiertos" },
  { name: "Recede", dur: 2.0, desc: "Los enlaces se retraen y los íconos se desvanecen, dejando sola la tarjeta para el loop" },
];

const W = 1600,
  H = 900,
  CX = 800,
  CY = 450;

const MOTION = {
  enter: (from: number, to: number, start: number, end: number) => animate({ from, to, start, end, ease: Easing.easeOutBack }),
  draw: (from: number, to: number, start: number, end: number) => animate({ from, to, start, end, ease: Easing.easeInOutCubic }),
  pop: (from: number, to: number, start: number, end: number) => animate({ from, to, start, end, ease: Easing.easeOutQuad }),
};

/*
 * `card`/`edge`/`ink`/`glyph`/`neutralSoft`/`avatar` viven dentro de la
 * tarjeta blanca y el resto de sus tiles — no cambian. `link`/`neutral` son
 * los conectores dibujados directo sobre el fondo oscuro de la pagina, y
 * `neutralInk` es la misma familia pero legible sobre el badge claro
 * (`neutralSoft`) que corona un nodo "fuera de alcance" — `SOLAR.muted` ahi
 * da ~2.4:1, insuficiente para el icono de pausa que lleva encima.
 * `bg`/`halo` (el fondo claro y el halo de la maqueta original) ya no se
 * pintan — ver el comentario mas abajo — asi que se sacan del objeto.
 */
const THEME = {
  card: "#FFFFFF",
  edge: "#E3E5DE",
  ink: "#2B2F2C",
  glyph: "#616861",
  link: SOLAR.link,
  neutral: SOLAR.link,
  neutralInk: SOLAR.muted2,
  neutralSoft: "#EAEBE6",
  avatar: "#DDE0D9",
};
const ACCENT = OK;

type GlyphKind = "bars" | "grid" | "diamond" | "square" | "triangle" | "ring";
type Node = { a: number; g: GlyphKind; ok: boolean };

const NODES: Node[] = [
  { a: -90, g: "bars", ok: true },
  { a: -30, g: "grid", ok: true },
  { a: 30, g: "diamond", ok: false },
  { a: 90, g: "square", ok: true },
  { a: 150, g: "triangle", ok: true },
  { a: -150, g: "ring", ok: false },
];

const RX = 520,
  RY = 305,
  NR = 48,
  CARD_RX = 168,
  CARD_RY = 122;

function geom(n: Node) {
  const r = (n.a * Math.PI) / 180;
  const nx = CX + RX * Math.cos(r),
    ny = CY + RY * Math.sin(r);
  const sx = CX + CARD_RX * Math.cos(r),
    sy = CY + CARD_RY * Math.sin(r);
  const dx = nx - sx,
    dy = ny - sy;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len,
    uy = dy / len;
  const ex = nx - ux * (NR + 16),
    ey = ny - uy * (NR + 16);
  return { nx, ny, sx, sy, ex, ey, ux, uy };
}
const GEO = NODES.map(geom);

function Glyph({ kind, color }: { kind: GlyphKind; color: string }) {
  const s = { fill: "none", stroke: color, strokeWidth: 3.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (kind === "bars")
    return (
      <g>
        <rect x={-15} y={-11} width={30} height={4.6} rx={2.3} fill={color} />
        <rect x={-15} y={-2.3} width={30} height={4.6} rx={2.3} fill={color} />
        <rect x={-15} y={6.4} width={19} height={4.6} rx={2.3} fill={color} />
      </g>
    );
  if (kind === "grid")
    return (
      <g fill={color}>
        <rect x={-14} y={-14} width={11} height={11} rx={3} />
        <rect x={3} y={-14} width={11} height={11} rx={3} />
        <rect x={-14} y={3} width={11} height={11} rx={3} />
        <rect x={3} y={3} width={11} height={11} rx={3} />
      </g>
    );
  if (kind === "diamond") return <rect x={-11} y={-11} width={22} height={22} rx={4} transform="rotate(45)" {...s} />;
  if (kind === "square") return <rect x={-13} y={-13} width={26} height={26} rx={6} {...s} />;
  if (kind === "triangle") return <path d="M 0 -14 L 14 10 L -14 10 Z" {...s} />;
  return (
    <g>
      <circle r={14} {...s} />
      <circle r={4.6} fill={color} />
    </g>
  );
}

function Check({ p, color }: { p: number; color: string }) {
  return <path d="M -6.4 0.4 L -2 5 L 6.6 -5" pathLength={1} fill="none" stroke={color} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={`${p} 1`} />;
}

function Pause({ color, o }: { color: string; o: number }) {
  return (
    <g opacity={o}>
      <rect x={-4.8} y={-5.4} width={3.4} height={10.8} rx={1.7} fill={color} />
      <rect x={1.4} y={-5.4} width={3.4} height={10.8} rx={1.7} fill={color} />
    </g>
  );
}

function Piece() {
  const { T, CUES, authoredTotal } = useComposition();
  const C = THEME;
  const total = authoredTotal || 15;
  const count = NODES.length;

  const breathe = 1 + 0.005 * Math.sin((2 * Math.PI * 3 * T) / total);

  const period = total / 4;
  const ph = (T % period) / period;
  const pulseR = 17 + 30 * ph;
  const pulseO = 0.34 * (1 - ph) * (1 - ph);

  const nodes = NODES.slice(0, count).map((n, i) => {
    const G = GEO[i];
    const inAt = CUES.Emerge + i * 0.19;
    const appear = MOTION.enter(0, 1, inAt, inAt + 0.72)(T);
    const fade = MOTION.pop(0, 1, inAt, inAt + 0.34)(T);

    const linkAt = CUES.Link + i * 0.17;
    const drawn = MOTION.draw(0, 1, linkAt, linkAt + 0.8)(T);

    const sortAt = CUES.Sort + i * 0.24;
    const res = MOTION.pop(0, 1, sortAt, sortAt + 0.55)(T);
    const badge = MOTION.enter(0, 1, sortAt, sortAt + 0.6)(T);
    const check = MOTION.draw(0, 1, sortAt + 0.18, sortAt + 0.62)(T);

    const outAt = CUES.Recede + (count - 1 - i) * 0.1;
    const gone = MOTION.draw(0, 1, outAt, outAt + 0.8)(T);

    const scale = clamp(appear * (1 - gone), 0, 1.15);
    const opacity = clamp(fade * (1 - gone), 0, 1);
    const linkP = clamp(drawn * (1 - gone), 0, 1);
    const trim = n.ok ? 1 : 1 - 0.4 * res;
    const badgeS = clamp(badge * (1 - gone), 0, 1.2);

    const bx = G.sx + (G.ex - G.sx) * trim,
      by = G.sy + (G.ey - G.sy) * trim;

    let pulse: ReactNode = null;
    if (n.ok) {
      const win = MOTION.pop(0, 1, sortAt + 0.5, sortAt + 1.1)(T) * (1 - MOTION.pop(0, 1, CUES.Recede - 0.5, CUES.Recede)(T));
      if (win > 0.01) {
        const q = ((T - CUES.Sort + i * 0.5) / 1.9) % 1;
        const e = Math.sin(Math.PI * q);
        pulse = <circle cx={G.sx + (G.ex - G.sx) * q} cy={G.sy + (G.ey - G.sy) * q} r={4.6} fill={ACCENT} opacity={win * e * 0.9} />;
      }
    }

    return { n, G, scale, opacity, linkP, trim, res, badgeS, check, bx, by, pulse, gone, i };
  });

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      {/* The source's "clean" preview backdrop (a light bg + a softening halo) is left
          unpainted, to match VerifiedRubroScene's transparent tile — the halo only read as
          depth against that light bg and became a visible grey disc without it. */}

      {nodes.map(({ n, G, linkP, trim, res, bx, by, pulse, gone, i }) => {
        if (linkP <= 0.001) return null;
        const p = linkP * trim;
        const stroke = n.ok ? C.link : C.neutral;
        return (
          <g key={"l" + i}>
            <line x1={G.sx} y1={G.sy} x2={G.ex} y2={G.ey} pathLength={1} stroke={stroke} strokeWidth={2.4} strokeLinecap="round" strokeDasharray={`${p} 1`} opacity={n.ok ? 1 : 0.9} />
            {n.ok && <line x1={G.sx} y1={G.sy} x2={G.ex} y2={G.ey} pathLength={1} stroke={ACCENT} strokeWidth={2.4} strokeLinecap="round" strokeDasharray={`${p} 1`} opacity={res * 0.95} />}
            {!n.ok && res > 0.01 && (
              <g opacity={res * (1 - gone)}>
                <line x1={bx} y1={by} x2={G.ex} y2={G.ey} stroke={C.neutral} strokeWidth={2.4} strokeLinecap="round" strokeDasharray="1 9" opacity={0.75} />
                <line x1={bx - G.uy * 17} y1={by + G.ux * 17} x2={bx + G.uy * 17} y2={by - G.ux * 17} stroke={C.neutral} strokeWidth={3.4} strokeLinecap="round" />
              </g>
            )}
            {pulse}
          </g>
        );
      })}

      {nodes.map(({ n, G, scale, opacity, res, badgeS, check, i }) => {
        if (opacity <= 0.001) return null;
        const ringCol = n.ok ? ACCENT : C.neutral;
        return (
          <g key={"n" + i} transform={`translate(${G.nx} ${G.ny}) scale(${scale})`} opacity={opacity}>
            <circle r={NR} fill={C.card} stroke={C.edge} strokeWidth={2} />
            <circle r={NR} fill="none" stroke={ringCol} strokeWidth={2.4} opacity={res * (n.ok ? 0.9 : 0.65)} strokeDasharray={n.ok ? "none" : "6 9"} />
            <g opacity={n.ok ? 1 : 1 - 0.35 * res}>
              <Glyph kind={n.g} color={C.glyph} />
            </g>
            <g transform={`translate(34 34) scale(${badgeS})`}>
              <circle r={17} fill={n.ok ? ACCENT : C.neutralSoft} stroke={n.ok ? ACCENT : C.neutralInk} strokeWidth={n.ok ? 0 : 2} />
              {n.ok ? <Check p={check} color="#FFFFFF" /> : <Pause color={C.neutralInk} o={check} />}
            </g>
          </g>
        );
      })}

      <g transform={`translate(${CX} ${CY}) scale(${breathe})`}>
        <rect x={-150} y={-105} width={300} height={210} rx={26} fill={C.card} stroke={C.edge} strokeWidth={2} />
        <g transform="translate(0 -36)">
          <circle r={38} fill={C.avatar} />
          <clipPath id="av">
            <circle r={38} />
          </clipPath>
          <g clipPath="url(#av)" fill={C.card}>
            <circle cy={-9} r={14.5} />
            <circle cy={34} r={23} />
          </g>
          <circle cx={28} cy={28} r={pulseR} fill="none" stroke={ACCENT} strokeWidth={2.2} opacity={pulseO} />
          <g transform="translate(28 28)">
            <circle r={17} fill={ACCENT} stroke={C.card} strokeWidth={3.5} />
            <Check p={1} color="#FFFFFF" />
          </g>
        </g>
        <rect x={-62} y={30} width={124} height={12} rx={6} fill={C.avatar} />
        <rect x={-40} y={56} width={80} height={10} rx={5} fill={C.avatar} opacity={0.7} />
      </g>
    </svg>
  );
}

export function VerifiedScopeScene() {
  return (
    <CompositionStage width={W} height={H} scenes={SCENES} driver={{ kind: "loop", gated: true, threshold: 0.4, hold: 2, restartOnEnter: true }} bg="transparent">
      <Piece />
    </CompositionStage>
  );
}
