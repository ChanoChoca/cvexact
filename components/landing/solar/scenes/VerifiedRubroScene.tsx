"use client";

import { CompositionStage, Easing, animate, clamp, useComposition, type Scene } from "../composition";
import { SOLAR, OK } from "./palette";

/**
 * Based on the project's design reference `CVExact hero design/verified-rubro.html` ("Sirve también
 * fuera de tu rubro"). Pure abstract SVG motion, no demo copy: a verified
 * profile card sends connectors out to eight professional-field icons.
 * Unlike the other two "verified" scenes this one is meant transparent —
 * its own authored default (`background: "transparent"`), kept as-is.
 */

const SCENES: Scene[] = [
  { name: "Open", dur: 1.4, desc: "La tarjeta de perfil verificado está sola en el centro y su insignia verde emite un pulso suave" },
  { name: "Desarrollo", dur: 0.9, desc: "Una línea sube desde la tarjeta y aparece un ícono de código arriba" },
  { name: "Diseño", dur: 0.9, desc: "Una línea sale hacia arriba a la derecha y aparece un ícono de pluma de diseño" },
  { name: "Marketing", dur: 0.9, desc: "Una línea sale a la derecha y aparece un ícono de señal" },
  { name: "Finanzas", dur: 0.9, desc: "Una línea sale hacia abajo a la derecha y aparece un ícono de barras ascendentes" },
  { name: "Ingeniería", dur: 0.9, desc: "Una línea baja y aparece un ícono de engranaje" },
  { name: "Educación", dur: 0.9, desc: "Una línea sale hacia abajo a la izquierda y aparece un ícono de birrete" },
  { name: "Salud", dur: 0.9, desc: "Una línea sale a la izquierda y aparece un ícono de cruz médica" },
  { name: "Investigación", dur: 0.9, desc: "Una línea sale hacia arriba a la izquierda y aparece un ícono de lupa, cerrando el anillo" },
  { name: "Converge", dur: 1.7, desc: "Pulsos viajan hacia afuera por cada conector mientras cada ícono respira y la insignia vuelve a pulsar" },
  { name: "Reset", dur: 1.6, desc: "Los íconos se achican y los conectores se retraen a la tarjeta, dejando el perfil solo para el loop" },
];

const W = 1920,
  H = 1080;
const RX = 560,
  RY = 372;
const CW = 420,
  CH = 264;
const TILE = 112;

const MOTION = {
  enter: (from: number, to: number, start: number, end: number) => animate({ from, to, start, end, ease: Easing.easeOutCubic }),
  draw: (from: number, to: number, start: number, end: number) => animate({ from, to, start, end, ease: Easing.easeInOutCubic }),
  pop: (from: number, to: number, start: number, end: number) => animate({ from, to, start, end, ease: Easing.easeOutBack }),
};

// El verde ✓ compartido con las otras dos escenas de "Verificado".
const ACCENT = OK;
// Conectores en reposo, sobre el fondo oscuro de la pagina.
const IDLE = SOLAR.link;

type GlyphKind = "code" | "nib" | "signal" | "bars" | "gear" | "cap" | "cross" | "lens";
type NodeDef = { cue: string; ang: number; glyph: GlyphKind };

const NODES: NodeDef[] = [
  { cue: "Desarrollo", ang: -90, glyph: "code" },
  { cue: "Diseño", ang: -45, glyph: "nib" },
  { cue: "Marketing", ang: 0, glyph: "signal" },
  { cue: "Finanzas", ang: 45, glyph: "bars" },
  { cue: "Ingeniería", ang: 90, glyph: "gear" },
  { cue: "Educación", ang: 135, glyph: "cap" },
  { cue: "Salud", ang: 180, glyph: "cross" },
  { cue: "Investigación", ang: 225, glyph: "lens" },
];

function geom(ang: number) {
  const a = (ang * Math.PI) / 180;
  const px = Math.cos(a) * RX,
    py = Math.sin(a) * RY;
  const d = Math.hypot(px, py);
  const ux = px / d,
    uy = py / d;
  const hw = CW / 2 + 26,
    hh = CH / 2 + 26;
  const s = 1 / Math.max(Math.abs(ux) / hw, Math.abs(uy) / hh);
  const sx = ux * s,
    sy = uy * s;
  const ex = ux * (d - TILE / 2 - 18),
    ey = uy * (d - TILE / 2 - 18);
  return { px, py, sx, sy, ex, ey, len: Math.hypot(ex - sx, ey - sy) };
}
const G = NODES.map((n) => geom(n.ang));

function Glyph({ kind, color }: { kind: GlyphKind; color: string }) {
  const st = { stroke: color, strokeWidth: 5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  switch (kind) {
    case "code":
      return (
        <g {...st}>
          <path d="M -7 -19 L -24 0 L -7 19" />
          <path d="M 7 -19 L 24 0 L 7 19" />
        </g>
      );
    case "nib":
      return (
        <g>
          <path d="M -19 13 C -19 -16, 19 16, 19 -13" {...st} />
          <rect x="-24" y="8" width="10" height="10" rx="2" fill={color} />
          <rect x="14" y="-18" width="10" height="10" rx="2" fill={color} />
        </g>
      );
    case "signal":
      return (
        <g>
          <circle cx="-15" cy="0" r="6" fill={color} />
          <path d="M 1 -13 A 17 17 0 0 1 1 13" {...st} />
          <path d="M 11 -23 A 28 28 0 0 1 11 23" {...st} />
        </g>
      );
    case "bars":
      return (
        <g fill={color}>
          <rect x="-22" y="6" width="11" height="16" rx="3.5" />
          <rect x="-5.5" y="-6" width="11" height="28" rx="3.5" />
          <rect x="11" y="-19" width="11" height="41" rx="3.5" />
        </g>
      );
    case "gear":
      return (
        <g>
          <circle cx="0" cy="0" r="11" {...st} />
          {[0, 60, 120, 180, 240, 300].map((d) => (
            <rect key={d} x="-5" y="-23" width="10" height="9" rx="2.5" fill={color} transform={`rotate(${d})`} />
          ))}
        </g>
      );
    case "cap":
      return (
        <g>
          <path d="M 0 -17 L 25 -4 L 0 9 L -25 -4 Z" {...st} />
          <path d="M 22 -1 L 22 15" {...st} />
        </g>
      );
    case "cross":
      return (
        <g fill={color}>
          <rect x="-6.5" y="-21" width="13" height="42" rx="4.5" />
          <rect x="-21" y="-6.5" width="42" height="13" rx="4.5" />
        </g>
      );
    case "lens":
    default:
      return (
        <g {...st}>
          <circle cx="-4" cy="-4" r="13" />
          <path d="M 6 6 L 20 20" />
        </g>
      );
  }
}

function ProfileCard({ T, total }: { T: number; total: number }) {
  const drift = Math.sin((T / Math.max(total, 0.001)) * Math.PI * 2) * 7;
  const x = -CW / 2,
    y = -CH / 2;
  return (
    <g transform={`translate(0 ${drift})`}>
      <rect x={x} y={y} width={CW} height={CH} rx="30" fill="#ffffff" stroke="#e7eaef" strokeWidth="2" filter="url(#cardShadow)" />
      <g transform={`translate(${x + 94} ${y + 92})`}>
        <circle cx="0" cy="0" r="46" fill="#eff2f6" />
        <circle cx="0" cy="-13" r="15" fill="#b3bcc9" />
        <path d="M -23 22 A 23 23 0 0 1 23 22 Z" fill="#b3bcc9" />
      </g>
      <rect x={x + 164} y={y + 74} width="176" height="18" rx="9" fill="#d5dae2" />
      <rect x={x + 164} y={y + 104} width="112" height="14" rx="7" fill="#e6e9ef" />
      <path d={`M ${x + 40} ${y + 166} L ${x + CW - 40} ${y + 166}`} stroke="#eef0f4" strokeWidth="2" />
      <rect x={x + 40} y={y + 194} width="126" height="30" rx="15" fill="#f2f4f7" />
      <rect x={x + 178} y={y + 194} width="84" height="30" rx="15" fill="#f2f4f7" />
      <g transform={`translate(${x + 94 + 34} ${y + 92 + 34})`}>
        <circle cx="0" cy="0" r="25" fill="#ffffff" />
        <circle cx="0" cy="0" r="20" fill={ACCENT} />
        <path d="M -8.5 0.5 L -2.5 6.5 L 9 -5.5" fill="none" stroke="#ffffff" strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </g>
  );
}

function BadgePulse({ T, at }: { T: number; at: number }) {
  const p = clamp((T - at) / 1.5, 0, 1);
  if (p <= 0 || p >= 1) return null;
  const e = Easing.easeOutCubic(p);
  return <circle cx={-CW / 2 + 128} cy={-CH / 2 + 126} r={20 + e * 62} fill="none" stroke={ACCENT} strokeWidth={3 - e * 2} opacity={0.45 * (1 - e)} />;
}

function Connector({ i, node, T, CUES, resetAt }: { i: number; node: NodeDef; T: number; CUES: Record<string, number>; resetAt: number }) {
  const g = G[i];
  const t0 = CUES[node.cue];
  const dash = g.len;
  const inP = MOTION.draw(0, 1, t0, t0 + 0.46)(T);
  const outP = MOTION.draw(0, 1, resetAt + 0.12 + i * 0.05, resetAt + 0.62 + i * 0.05)(T);
  const shown = inP - outP;
  if (shown <= 0.001) return null;

  const idle = MOTION.enter(0.9, 0.55, t0 + 1.0, t0 + 1.6)(T);
  const flash = 1 - clamp((T - t0) / 0.6, 0, 1);
  const cP = CUES.Converge;
  const wave = clamp((T - (cP + i * 0.055)) / 0.5, 0, 1);
  const waveGlow = wave > 0 && wave < 1 ? Math.sin(wave * Math.PI) : 0;

  const color = flash > 0.02 || waveGlow > 0.02 ? ACCENT : IDLE;
  const opacity = Math.max(idle, flash * 0.9, waveGlow * 0.85);

  const dot = (u: number) => ({ cx: g.sx + (g.ex - g.sx) * u, cy: g.sy + (g.ey - g.sy) * u });
  const travel = inP < 1 ? dot(inP) : null;
  const pulse = waveGlow > 0 ? dot(Easing.easeInOutQuad(wave)) : null;

  return (
    <g>
      <line x1={g.sx} y1={g.sy} x2={g.ex} y2={g.ey} stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeDasharray={`${dash} ${dash}`} strokeDashoffset={dash * (1 - shown)} opacity={opacity} />
      {travel && <circle cx={travel.cx} cy={travel.cy} r="6" fill={ACCENT} opacity={0.9} />}
      {pulse && <circle cx={pulse.cx} cy={pulse.cy} r="5.5" fill={ACCENT} opacity={waveGlow} />}
    </g>
  );
}

function NodeView({ i, node, T, CUES, resetAt }: { i: number; node: NodeDef; T: number; CUES: Record<string, number>; resetAt: number }) {
  const g = G[i];
  const t0 = CUES[node.cue];
  const inS = MOTION.pop(0, 1, t0 + 0.3, t0 + 0.92)(T);
  const inO = MOTION.enter(0, 1, t0 + 0.3, t0 + 0.6)(T);
  const outS = MOTION.enter(0, 1, resetAt + i * 0.055, resetAt + 0.5 + i * 0.055)(T);
  const scale = Math.max(0.0001, inS * (1 - outS));
  const opacity = inO * (1 - outS);
  if (opacity <= 0.005) return null;

  const cP = CUES.Converge;
  const breath = MOTION.pop(0, 1, cP + i * 0.055, cP + 0.45 + i * 0.055)(T) * (1 - clamp((T - (cP + 0.45 + i * 0.055)) / 0.45, 0, 1));
  const bob = Math.sin(clamp(breath, 0, 1) * Math.PI) * 0.07;
  const glyphFlash = 1 - clamp((T - t0 - 0.3) / 0.9, 0, 1);
  const glyphColor = glyphFlash > 0.5 ? ACCENT : "#333a45";

  return (
    <g transform={`translate(${g.px} ${g.py}) scale(${scale + bob})`} opacity={opacity}>
      <rect x={-TILE / 2} y={-TILE / 2} width={TILE} height={TILE} rx="28" fill="#ffffff" stroke="#e7eaef" strokeWidth="2" filter="url(#tileShadow)" />
      <Glyph kind={node.glyph} color={glyphColor} />
    </g>
  );
}

function Piece() {
  const c = useComposition();
  const T = c.T,
    CUES = c.CUES,
    total = c.authoredTotal;
  const resetAt = CUES.Reset;

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", inset: 0 }}>
      <defs>
        <filter id="cardShadow" x="-40%" y="-40%" width="180%" height="200%">
          <feDropShadow dx="0" dy="14" stdDeviation="20" floodColor="#1d2430" floodOpacity="0.1" />
        </filter>
        <filter id="tileShadow" x="-40%" y="-40%" width="180%" height="200%">
          <feDropShadow dx="0" dy="8" stdDeviation="12" floodColor="#1d2430" floodOpacity="0.08" />
        </filter>
      </defs>
      <g transform={`translate(${W / 2} ${H / 2}) scale(1.12)`}>
        {NODES.map((n, i) => (
          <Connector key={`c${n.cue}`} i={i} node={n} T={T} CUES={CUES} resetAt={resetAt} />
        ))}
        <ProfileCard T={T} total={total} />
        <BadgePulse T={T} at={0.25} />
        <BadgePulse T={T} at={CUES.Converge + 0.1} />
        {NODES.map((n, i) => (
          <NodeView key={`n${n.cue}`} i={i} node={n} T={T} CUES={CUES} resetAt={resetAt} />
        ))}
      </g>
    </svg>
  );
}

export function VerifiedRubroScene() {
  return (
    <CompositionStage width={W} height={H} scenes={SCENES} driver={{ kind: "loop", gated: true, threshold: 0.4, hold: 2, restartOnEnter: true }} bg="transparent">
      <Piece />
    </CompositionStage>
  );
}
