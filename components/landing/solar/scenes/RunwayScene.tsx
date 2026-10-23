"use client";

import type { CSSProperties, RefObject } from "react";
import { CompositionStage, Easing, animate, clamp, useComposition, type Scene } from "../composition";

/**
 * Based on the project's design reference `CVExact hero design/cv-assembles.html` ("El CV se construye
 * solo" — the scroll-scrubbed runway). Words fly in from off-camera onto a
 * blank sheet; `useTweaks` is dropped in favour of the fixed `CFG` below,
 * and the CV content is localized to Argentina (the original: Mira Okonkwo,
 * Lisbon/Meridian Labs, Central Saint Martins).
 *
 * Driven by `driver={{ kind: "scroll", trackRef }}` from `app/page.tsx` —
 * `T` here tracks scroll progress through the pinned 300vh track directly,
 * not wall-clock time.
 */

const SCENES: Scene[] = [
  { name: "Sheet", dur: 1.6, desc: "Una hoja en blanco sube a cuadro y se asienta" },
  { name: "Name", dur: 2.4, desc: "Nombre, rol y contacto caen desde arriba del cuadro" },
  { name: "Experience", dur: 5, desc: "El título Experiencia y los tres puestos entran desde los costados" },
  { name: "Education", dur: 2.2, desc: "El bloque de Educación sube desde abajo del cuadro" },
  { name: "Skills", dur: 2.2, desc: "La línea de habilidades cae en cascada desde abajo a la derecha" },
  { name: "Settle", dur: 2.6, desc: "El CV terminado se sostiene mientras la cámara sigue acercándose" },
];

const MOTION = {
  fly: (start: number, dur: number) => animate({ from: 0, to: 1, start, end: start + dur, ease: Easing.easeOutQuart }),
  draw: (start: number, dur: number) => animate({ from: 0, to: 1, start, end: start + dur, ease: Easing.easeOutCubic }),
  drift: (from: number, to: number, start: number, end: number) => animate({ from, to, start, end, ease: Easing.easeInOutSine }),
};

const rand = (i: number, salt: number) => {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

const SHEET = { w: 880, h: 1200, pad: 78 };
const STAGE = { w: 1080, h: 1350 };

type Row = { cue: string; at: number; style: string; text?: string; meta?: string; dir: number };

// Localizado a Argentina — el original era Mira Okonkwo, Lisboa/Meridian Labs.
const ROWS: Row[] = [
  { cue: "Name", at: 0.0, style: "name", text: "Sofía Herrera", dir: -90 },
  { cue: "Name", at: 0.4, style: "tagline", text: "Diseñadora de producto — sistemas, interfaces, motion", dir: -90 },
  { cue: "Name", at: 0.8, style: "contact", text: "sofia@example.com · +54 9 11 0000 0002 · example.com", dir: -90 },
  { cue: "Name", at: 1.3, style: "rule", dir: -90 },

  { cue: "Experience", at: 0.0, style: "section", text: "Experiencia", dir: 180 },
  { cue: "Experience", at: 0.2, style: "role", text: "Diseñadora de Producto Senior", meta: "2022 — hoy", dir: 180 },
  { cue: "Experience", at: 0.45, style: "company", text: "Meridian Labs, Buenos Aires", dir: 180 },
  {
    cue: "Experience",
    at: 0.65,
    style: "body",
    text: "Está a cargo del sistema de diseño detrás de cuatro productos; redujo a la mitad el tiempo de armar una pantalla nueva.",
    dir: 180,
  },
  { cue: "Experience", at: 1.5, style: "role", text: "Diseñadora de Producto", meta: "2019 — 2022", dir: 0 },
  { cue: "Experience", at: 1.75, style: "company", text: "Fathom & Co.", dir: 0 },
  {
    cue: "Experience",
    at: 1.95,
    style: "body",
    text: "Rediseñó el onboarding de punta a punta y subió la activación de 41% a 63% en dos trimestres.",
    dir: 0,
  },
  { cue: "Experience", at: 2.8, style: "role", text: "Diseñadora", meta: "2017 — 2019", dir: 180 },
  { cue: "Experience", at: 3.05, style: "company", text: "Estudio Vent", dir: 180 },
  { cue: "Experience", at: 3.25, style: "body", text: "Trabajo de marca e interfaces para equipos en etapa temprana en toda Latinoamérica.", dir: 180 },

  { cue: "Education", at: 0.0, style: "section", text: "Educación", dir: 90 },
  { cue: "Education", at: 0.25, style: "role", text: "Lic. en Diseño Gráfico", meta: "2013 — 2016", dir: 90 },
  { cue: "Education", at: 0.5, style: "company", text: "Universidad de Buenos Aires", dir: 90 },

  { cue: "Skills", at: 0.0, style: "section", text: "Habilidades", dir: 35 },
  { cue: "Skills", at: 0.25, style: "skills", text: "Figma · Prototipado · Sistemas de diseño · Motion · HTML y CSS · Investigación · Talleres", dir: 35 },
];

const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

function styles(ink: string) {
  const soft = `color-mix(in oklab, ${ink} 68%, #ffffff)`;
  const faint = `color-mix(in oklab, ${ink} 42%, #ffffff)`;
  return {
    name: { fontSize: 63, fontWeight: 700, letterSpacing: "-0.022em", lineHeight: 1.04, color: ink },
    tagline: { fontSize: 23.5, fontWeight: 400, lineHeight: 1.35, color: soft, marginTop: 12 },
    contact: { fontSize: 17.5, lineHeight: 1.4, color: faint, marginTop: 10 },
    rule: { height: 1, background: `color-mix(in oklab, ${ink} 16%, #ffffff)`, marginTop: 30 },
    section: { fontSize: 14, fontWeight: 600, letterSpacing: "0.19em", textTransform: "uppercase" as const, color: faint, marginTop: 46, marginBottom: 16 },
    role: { fontSize: 26, fontWeight: 600, letterSpacing: "-0.01em", lineHeight: 1.2, color: ink, marginTop: 26 },
    meta: { fontSize: 16.5, fontWeight: 400, letterSpacing: "0.02em", color: faint, whiteSpace: "nowrap" as const },
    company: { fontSize: 19, lineHeight: 1.3, color: soft, marginTop: 4 },
    body: { fontSize: 19, lineHeight: 1.5, color: soft, marginTop: 10, maxWidth: 660 },
    skills: { fontSize: 19, lineHeight: 1.6, color: soft, maxWidth: 690 },
  };
}
type Styles = ReturnType<typeof styles>;

function Word({ text, T, delay, dir, seed, dist, dur }: { text: string; T: number; delay: number; dir: number; seed: number; dist: number; dur: number }) {
  const p = MOTION.fly(delay, dur)(T);
  const away = 1 - p;
  const a = ((dir + (rand(seed, 1) - 0.5) * 44) * Math.PI) / 180;
  const d = dist * (0.7 + rand(seed, 2) * 0.6);
  const rot = (rand(seed, 3) - 0.5) * 24;
  return (
    <span
      style={{
        display: "inline-block",
        opacity: clamp(p / 0.05, 0, 1),
        transform: `translate3d(${(Math.cos(a) * d * away).toFixed(2)}px,${(Math.sin(a) * d * away).toFixed(2)}px,0) rotate(${(rot * away).toFixed(2)}deg) scale(${(1 + away * 0.13).toFixed(3)})`,
        willChange: "transform",
      }}
    >
      {text}
    </span>
  );
}

function RowView({ row, index, T, cue, S, cfg }: { row: Row; index: number; T: number; cue: number; S: Styles; cfg: { stagger: number; dist: number; dur: number } }) {
  const start = cue + row.at;
  if (row.style === "rule") {
    return <div style={{ ...S.rule, transform: `scaleX(${MOTION.draw(start, 0.8)(T).toFixed(3)})`, transformOrigin: "left center" }} />;
  }
  const stagger = row.style === "skills" ? cfg.stagger * 1.4 : cfg.stagger;
  const run = (text: string, offset: number, seedOffset: number) =>
    text.split(" ").map((w, i) => (
      <span key={i}>
        <Word text={w} T={T} delay={start + offset + i * stagger} dir={row.dir} seed={index * 97 + seedOffset + i} dist={cfg.dist} dur={cfg.dur} />{" "}
      </span>
    ));
  const style = S[row.style as keyof Styles] as CSSProperties;
  const body = run(row.text ?? "", 0, 0);
  if (!row.meta) return <div style={style}>{body}</div>;
  return (
    <div style={{ ...style, display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 24 }}>
      <div>{body}</div>
      <div style={S.meta}>{run(row.meta, 0.06, 50)}</div>
    </div>
  );
}

const CFG = { ink: "#191713", dist: 1150, stagger: 0.045, dur: 0.9, shadow: true };

function Piece() {
  const { T, CUES, authoredTotal } = useComposition();
  const S = styles(CFG.ink);

  const rise = MOTION.draw(0, 1.5)(T);
  const scale = 0.94 + rise * 0.06 + MOTION.drift(0, 0.055, 2.6, authoredTotal)(T);
  const y = (1 - rise) * 72 + MOTION.drift(0, -26, 2.6, authoredTotal)(T);
  const tilt = (1 - rise) * 1.4;

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT }}>
      <div
        style={{
          width: SHEET.w,
          height: SHEET.h,
          padding: SHEET.pad,
          boxSizing: "border-box",
          background: "#fdfdfc",
          borderRadius: 3,
          boxShadow: CFG.shadow ? "0 2px 3px rgba(28,25,20,0.06), 0 34px 90px rgba(28,25,20,0.20)" : "none",
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          opacity: clamp(rise * 2.2, 0, 1),
          transform: `translate3d(0,${y.toFixed(2)}px,0) scale(${scale.toFixed(4)}) rotate(${tilt.toFixed(3)}deg)`,
          willChange: "transform",
        }}
      >
        {ROWS.map((row, i) => (
          <RowView key={i} row={row} index={i} T={T} cue={CUES[row.cue]} S={S} cfg={CFG} />
        ))}
      </div>
    </div>
  );
}

export function RunwayScene({ trackRef }: { trackRef: RefObject<HTMLElement | null> }) {
  return (
    <CompositionStage width={STAGE.w} height={STAGE.h} scenes={SCENES} driver={{ kind: "scroll", trackRef, start: 1 }} bg="transparent">
      <Piece />
    </CompositionStage>
  );
}
