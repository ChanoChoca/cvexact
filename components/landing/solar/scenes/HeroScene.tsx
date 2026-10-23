"use client";

import type { CSSProperties } from "react";
import { CompositionStage, useComposition, type Scene } from "../composition";
import { FONT_STACKS } from "../fonts";

/**
 * Based on the project's design reference `CVExact hero design/floating-cv.html` (its embedded
 * `cv-scene.jsx`, extracted from the manifest — see the redesign plan).
 * Continuous 360° loop: every motion is a periodic function of
 * `u = T / authoredTotal`, so the last authored frame equals the first and
 * the loop has no seam. `useTweaks`/`TweaksPanel` (editor-only) are dropped;
 * the tweakable name/role/paper/accent are now fixed constants (`TW` below)
 * with the demo CV localized to Argentina — the original shipped an English
 * CV in Barcelona.
 */

const SCENES: Scene[] = [
  { name: "Front", dur: 3.5, desc: "El CV mira a cámara y las palabras sueltas pasan flotando" },
  { name: "Turn", dur: 3.5, desc: "La hoja gira de canto y aparece el reverso" },
  { name: "Back", dur: 3.5, desc: "El dorso de la hoja muestra el mismo CV mientras las palabras siguen orbitando" },
  { name: "Return", dur: 3.5, desc: "El giro se completa y todo se asienta en el cuadro inicial" },
];

const SANS = '"Helvetica Neue", Helvetica, "Nimbus Sans", sans-serif';
const SERIF = FONT_STACKS.instrumentSerif;
const PAPER_W = 680;
const PAPER_H = 962;
const PERSP = 2600;
const P_WORD = 3400;
const TAU = Math.PI * 2;

const MOTION = {
  spin(u: number) {
    return -18 + 360 * u - 22 * Math.sin(2 * TAU * u);
  },
  breathe(u: number, amp: number, phase: number, k: number) {
    return amp * Math.sin(TAU * ((k || 1) * u + (phase || 0)));
  },
  orbit(u: number, w: Word, flutter: number) {
    const th = TAU * (w.dir * u + w.ph);
    const z = w.r * 0.8 * Math.sin(th);
    const s = P_WORD / (P_WORD - z);
    const depth = (z / (w.r * 0.8) + 1) / 2;
    return {
      x: w.r * 0.95 * Math.cos(th) * s,
      y: w.y + MOTION.breathe(u, w.ya * flutter, w.yph, w.yk),
      s,
      front: z > 0,
      opacity: 0.34 + 0.6 * depth,
      blur: (1 - depth) * 2.2,
      rot: MOTION.breathe(u, w.rot, w.ph + 0.25, 1),
    };
  },
};

type Word = {
  t: string;
  s: number;
  f: string;
  it?: boolean;
  c: 1 | 2 | 3;
  r: number;
  ph: number;
  dir: 1 | -1;
  y: number;
  ya: number;
  yk: number;
  yph: number;
  rot: number;
};

// Localizado a Buenos Aires — el original orbitaba jerga de diseño en inglés
// alrededor de un CV de Barcelona.
const WORDS: Word[] = [
  { t: "oficio", s: 46, f: SERIF, it: true, c: 2, r: 470, ph: 0.0, dir: -1, y: -470, ya: 4, yk: 1, yph: 0.5, rot: -9 },
  { t: "BUENOS AIRES", s: 22, f: SANS, c: 3, r: 690, ph: 0.0625, dir: 1, y: -407, ya: 4, yk: 2, yph: 0.9, rot: 4 },
  { t: "tipografía", s: 40, f: SERIF, it: true, c: 3, r: 450, ph: 0.125, dir: -1, y: -345, ya: 4, yk: 1, yph: 0.75, rot: 8 },
  { t: "FADU, 2016", s: 24, f: SANS, c: 3, r: 620, ph: 0.1875, dir: 1, y: -282, ya: 4, yk: 1, yph: 0.45, rot: 6 },
  { t: "Tipografía", s: 42, f: SERIF, it: true, c: 2, r: 660, ph: 0.25, dir: -1, y: -219, ya: 4, yk: 1, yph: 0.1, rot: -7 },
  { t: "accesibilidad", s: 22, f: SANS, c: 1, r: 680, ph: 0.3125, dir: 1, y: -157, ya: 4, yk: 1, yph: 0.8, rot: 7 },
  { t: "Editorial", s: 40, f: SERIF, it: true, c: 2, r: 500, ph: 0.375, dir: -1, y: -94, ya: 4, yk: 1, yph: 0.15, rot: -6 },
  { t: "2022 — 2026", s: 26, f: SANS, c: 2, r: 640, ph: 0.4375, dir: 1, y: -31, ya: 4, yk: 1, yph: 0.7, rot: 9 },
  { t: "Prototipado", s: 36, f: SERIF, c: 1, r: 610, ph: 0.5, dir: -1, y: 31, ya: 4, yk: 1, yph: 0.2, rot: -5 },
  { t: "lanzado", s: 26, f: SANS, c: 2, r: 660, ph: 0.5625, dir: 1, y: 94, ya: 4, yk: 1, yph: 0.1, rot: -5 },
  { t: "sistemas", s: 36, f: SERIF, c: 1, r: 530, ph: 0.625, dir: -1, y: 157, ya: 4, yk: 1, yph: 0.65, rot: -7 },
  { t: "grillas", s: 28, f: SANS, c: 3, r: 640, ph: 0.6875, dir: 1, y: 219, ya: 4, yk: 2, yph: 0.55, rot: 5 },
  { t: "Investigación", s: 30, f: SERIF, c: 3, r: 560, ph: 0.75, dir: -1, y: 282, ya: 4, yk: 2, yph: 0.6, rot: -4 },
  { t: "sistemas de diseño", s: 26, f: SANS, c: 1, r: 520, ph: 0.8125, dir: 1, y: 345, ya: 4, yk: 2, yph: 0.4, rot: 5 },
  { t: "motion", s: 32, f: SANS, c: 1, r: 700, ph: 0.875, dir: -1, y: 407, ya: 4, yk: 1, yph: 0.3, rot: 6 },
  { t: "Líder de diseño", s: 26, f: SANS, c: 1, r: 590, ph: 0.9375, dir: 1, y: 470, ya: 4, yk: 1, yph: 0.35, rot: -8 },
];

type Tw = { name: string; role: string; paper: string; accent: string; ink: string; faint: string; swarm: number; flutter: number; backdrop: string };

const TW: Tw = {
  name: "Martina Aguirre",
  role: "Diseñadora de producto — sistemas e interfaces",
  paper: "#ffffff",
  accent: "#b0603f",
  ink: "#6f665c",
  faint: "#9a9285",
  swarm: 16,
  flutter: 1,
  backdrop: "Transparent",
};

function Face({ tw, shade }: { tw: Tw; shade: number }) {
  const ink = "#22201d";
  const muted = "#7c756a";
  const rule = "rgba(34,32,29,0.16)";
  const label: CSSProperties = {
    font: `600 12px ${SANS}`,
    letterSpacing: "0.2em",
    textTransform: "uppercase",
    color: muted,
    marginBottom: 16,
  };
  const roleLine: CSSProperties = { font: `500 17.5px ${SANS}`, color: ink };
  const meta: CSSProperties = { font: `400 14.5px ${SANS}`, color: muted, letterSpacing: "0.04em", whiteSpace: "nowrap" };
  const bullet: CSSProperties = { font: `400 15px ${SANS}`, color: "#4a453e", lineHeight: 1.5 };
  const entry: CSSProperties = { display: "flex", flexDirection: "column", gap: 6 };
  const row: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 16, alignItems: "baseline" };

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: tw.paper,
        backfaceVisibility: "hidden",
        padding: "62px 58px",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: 32,
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ font: `400 58px/1 ${SERIF}`, color: ink, letterSpacing: "-0.005em" }}>{tw.name}</div>
          <div style={{ font: `500 11.5px ${SANS}`, letterSpacing: "0.22em", textTransform: "uppercase", color: tw.accent }}>{tw.role}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, textAlign: "right", font: `400 13px ${SANS}`, color: muted, letterSpacing: "0.03em" }}>
          <div>martina@example.com</div>
          <div>+54 9 11 0000 0003</div>
          <div>Buenos Aires</div>
        </div>
      </div>
      <div style={{ height: 1, background: ink, opacity: 0.85 }} />

      <div>
        <div style={label}>Experiencia</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={entry}>
            <div style={row}>
              <div style={roleLine}>Líder de Diseño — Estudio Aperture</div>
              <div style={meta}>2022 — 2026</div>
            </div>
            <div style={bullet}>Rediseñó el sistema de diseño en cuarenta pantallas del producto; redujo a la mitad el tiempo de armar una pantalla nueva.</div>
            <div style={bullet}>Lideró un equipo de seis diseñadores en dos lanzamientos de plataforma.</div>
          </div>
          <div style={{ height: 1, background: rule }} />
          <div style={entry}>
            <div style={row}>
              <div style={roleLine}>Diseñadora de Producto Senior — Northline</div>
              <div style={meta}>2019 — 2022</div>
            </div>
            <div style={bullet}>Lanzó el kit editorial que hoy usan 1,2M de lectores por mes.</div>
            <div style={bullet}>Estuvo a cargo de tipografía, grilla y estándares de motion.</div>
          </div>
          <div style={{ height: 1, background: rule }} />
          <div style={entry}>
            <div style={row}>
              <div style={roleLine}>Diseñadora — Estudio Perenne</div>
              <div style={meta}>2016 — 2019</div>
            </div>
            <div style={bullet}>Identidad, gráfica editorial y muestras para clientes culturales.</div>
          </div>
        </div>
      </div>

      <div>
        <div style={label}>Educación</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={row}>
            <div style={roleLine}>Maestría en Comunicación Visual — Universidad de Palermo</div>
            <div style={meta}>2016</div>
          </div>
          <div style={row}>
            <div style={roleLine}>Lic. en Diseño Gráfico — UBA</div>
            <div style={meta}>2014</div>
          </div>
        </div>
      </div>

      <div>
        <div style={label}>Habilidades</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "9px 9px" }}>
          {["Sistemas de diseño", "Tipografía", "Prototipado", "Motion", "Investigación", "Accesibilidad", "Editorial", "Grillas"].map((s) => (
            <div
              key={s}
              style={{
                font: `400 13px ${SANS}`,
                color: "#4a453e",
                letterSpacing: "0.04em",
                border: "1px solid rgba(34,32,29,0.18)",
                borderRadius: 999,
                padding: "5px 12px",
              }}
            >
              {s}
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: "auto", font: `400 11px ${SANS}`, letterSpacing: "0.18em", textTransform: "uppercase", color: muted }}>
        Portfolio — example.com
      </div>

      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background: "linear-gradient(100deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0) 38%, rgba(0,0,0,0.10) 100%)",
          opacity: shade,
        }}
      />
    </div>
  );
}

function Sheet({ u, tw }: { u: number; tw: Tw }) {
  const a = MOTION.spin(u);
  const rx = MOTION.breathe(u, 7 * tw.flutter, 0.12, 1) - 3;
  const rz = MOTION.breathe(u, 2.6 * tw.flutter, 0.4, 2);
  const ty = MOTION.breathe(u, 20 * tw.flutter, 0.6, 1);
  const tx = MOTION.breathe(u, 26 * tw.flutter, 0.05, 1);
  const rad = (a * Math.PI) / 180;
  const shade = Math.abs(Math.sin(rad)) * 0.9;
  const frontUp = Math.cos(rad) > 0;
  const faceBase: CSSProperties = {
    position: "absolute",
    inset: 0,
    backfaceVisibility: "hidden",
    transformStyle: "preserve-3d",
  };

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        width: PAPER_W,
        height: PAPER_H,
        marginLeft: -PAPER_W / 2,
        marginTop: -PAPER_H / 2,
        transformStyle: "preserve-3d",
        transform: `perspective(${PERSP}px) translate3d(${tx}px, ${ty}px, 0) rotateY(${a}deg) rotateX(${rx}deg) rotateZ(${rz}deg)`,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 0,
          width: 3,
          height: "100%",
          marginLeft: -1.5,
          background: "#d6cfc1",
          transform: "rotateY(90deg)",
        }}
      />
      <div style={{ ...faceBase, transform: "translateZ(0.9px)", opacity: frontUp ? 1 : 0 }}>
        <Face tw={tw} shade={shade} />
      </div>
      <div style={{ ...faceBase, transform: "rotateY(180deg) translateZ(0.9px)", opacity: frontUp ? 0 : 1 }}>
        <Face tw={tw} shade={shade * 0.65} />
      </div>
    </div>
  );
}

function Swarm({ u, tw, front }: { u: number; tw: Tw; front: boolean }) {
  const colors: Record<number, string> = { 1: tw.ink, 2: tw.accent, 3: tw.faint };
  const list = WORDS.slice(0, tw.swarm);
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {list.map((w, i) => {
        const o = MOTION.orbit(u, w, tw.flutter);
        if (o.front !== front) return null;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              font: `${w.it ? "italic " : ""}400 ${w.s}px ${w.f}`,
              color: colors[w.c] || tw.ink,
              letterSpacing: w.f === SANS ? "0.02em" : "0",
              whiteSpace: "nowrap",
              opacity: o.opacity,
              filter: o.blur > 0.35 ? `blur(${o.blur.toFixed(2)}px)` : "none",
              transform: `translate3d(calc(${o.x.toFixed(1)}px - 50%), calc(${o.y.toFixed(1)}px - 50%), 0) scale(${o.s.toFixed(3)}) rotate(${o.rot.toFixed(2)}deg)`,
            }}
          >
            {w.t}
          </div>
        );
      })}
    </div>
  );
}

function Piece() {
  const { T, authoredTotal } = useComposition();
  const total = authoredTotal || 14;
  const u = ((T / total) % 1 + 1) % 1;
  return (
    <div style={{ position: "absolute", inset: 0, background: "transparent" }}>
      <Swarm u={u} tw={TW} front={false} />
      <Sheet u={u} tw={TW} />
      <Swarm u={u} tw={TW} front={true} />
    </div>
  );
}

export function HeroScene() {
  return (
    <CompositionStage width={1920} height={1080} scenes={SCENES} driver={{ kind: "loop" }} bg="transparent">
      <Piece />
    </CompositionStage>
  );
}
