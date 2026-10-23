"use client";

import type { CSSProperties, ReactNode } from "react";
import { CompositionStage, Easing, animate, clamp, interpolate, useComposition, type Scene } from "../composition";
import { SOLAR } from "./palette";

/**
 * Based on the project's design reference `CVExact hero design/step-perfil.html` ("Cargás tu perfil una
 * vez" — Paso 01). A blank résumé fills itself in. This scene already
 * shipped in Spanish (Madrid-flavored: IED Madrid, Complutense, a compound
 * "Ríos Mendoza" surname) — localized to a single Argentine surname and
 * Buenos Aires rather than translated from scratch.
 */

const SCENES: Scene[] = [
  { name: "Entrada", dur: 2.2, desc: "Una hoja de CV en blanco se asienta sobre el escritorio mientras la cámara se acerca" },
  { name: "Identidad", dur: 2.6, desc: "La foto, el nombre, el rol y el contacto se completan solos" },
  { name: "Aptitudes", dur: 2.4, desc: "Aparecen los chips de habilidades, después educación e idiomas" },
  { name: "Experiencia", dur: 3.2, desc: "La cámara panea a la izquierda y se escriben tres puestos de trabajo" },
  { name: "Reorganiza", dur: 2.6, desc: "Los bloques se acomodan, un brillo pule la página, la cámara se aleja" },
  { name: "Listo", dur: 3.2, desc: "Un resplandor verde, una insignia de check y la etiqueta PERFIL LISTO" },
];

const MOTION = {
  enter: (o: Parameters<typeof animate>[0]) => animate({ ...o, ease: Easing.easeOutCubic }),
  draw: (o: Parameters<typeof animate>[0]) => animate({ ...o, ease: Easing.easeInOutQuart }),
  pop: (o: Parameters<typeof animate>[0]) => animate({ ...o, ease: Easing.easeOutBack }),
};

const SANS = "'Manrope', system-ui, sans-serif";
const SERIF = "'Instrument Serif', Georgia, serif";
const MONO = "'IBM Plex Mono', ui-monospace, monospace";

const PAGE_W = 660;
const PAGE_H = 934;
const PAD = 52;
const COL_R = 436;
const COL_R_W = 172;
const COL_L_W = 352;
const COL_TOP = 236;

function hexToRgb(h: string) {
  let hex = h.replace("#", "");
  if (hex.length === 3)
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (h: string, a: number) => `rgba(${hexToRgb(h).join(",")},${a})`;
const shade = (h: string, f: number) =>
  "#" +
  hexToRgb(h)
    .map((v) => Math.round(v * (1 - f)).toString(16).padStart(2, "0"))
    .join("");

const INK = "#26241f";
const INK2 = "#736e64";
const SKEL = "#eceae4";
const RULE = "#e4e1d9";
const PAPER = "#fefdfb";
// `g4`: el color que `app/page.tsx` ya le da a la etiqueta "Paso 01".
const ACCENT = SOLAR.g4;
const FINAL_LABEL = "Perfil listo";

const CAM_T = [0, 2.2, 3.0, 4.6, 5.5, 7.0, 7.9, 10.3, 11.4, 13.0, 16.2];
const CAM_S = [0.95, 1.0, 2.85, 2.9, 3.05, 3.05, 3.0, 3.05, 0.97, 0.96, 0.95];
const CAM_X = [0, 0, 10, 6, 150, 150, -102, -100, 0, 0, 0];
const CAM_Y = [50, 30, -300, -292, -174, 12, -100, -50, 58, 58, 50];

function FillLine({
  at,
  dur = 0.5,
  size = 10.5,
  text,
  w,
  family = SANS,
  weight = 500,
  ls = "0",
  upper,
  color = INK,
  factor = 0.54,
  skel = SKEL,
  style,
}: {
  at: number;
  dur?: number;
  size?: number;
  text: string;
  w?: number;
  family?: string;
  weight?: number;
  ls?: string;
  upper?: boolean;
  color?: string;
  factor?: number;
  skel?: string;
  style?: CSSProperties;
}) {
  const { T } = useComposition();
  const rev = MOTION.draw({ from: 0, to: 1, start: at, end: at + dur })(T);
  const grow = MOTION.enter({ from: 0, to: 1, start: at - 0.34, end: at - 0.06 })(T);
  const width = w || Math.round(text.length * size * factor);
  const h = Math.round(size * 1.38);
  const barH = Math.max(3, Math.round(size * 0.66));
  return (
    <div style={{ position: "relative", width, height: h, ...style }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: Math.round((h - barH) / 2),
          height: barH,
          width: grow * 100 + "%",
          borderRadius: 99,
          background: skel,
          opacity: (1 - rev) * 0.95,
          clipPath: "inset(0 0 0 " + rev * 100 + "%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: "200%",
          height: h,
          lineHeight: h + "px",
          whiteSpace: "nowrap",
          fontFamily: family,
          fontSize: size,
          fontWeight: weight,
          letterSpacing: ls,
          textTransform: upper ? "uppercase" : "none",
          color,
          opacity: clamp(rev * 4, 0, 1),
          filter: "blur(" + ((1 - rev) * 2.2).toFixed(2) + "px)",
          clipPath: rev > 0.995 ? "none" : "inset(0 " + (100 - rev * 100) + "% 0 0)",
        }}
      >
        {text}
      </div>
    </div>
  );
}

function SectionLabel({ at, top, w, text, accent }: { at: number; top: number; w: number; text: string; accent: string }) {
  const { T } = useComposition();
  const g = MOTION.draw({ from: 0, to: 1, start: at + 0.1, end: at + 0.7 })(T);
  return (
    <div style={{ position: "absolute", left: 0, top, width: w }}>
      <FillLine at={at} dur={0.42} text={text} size={9.5} family={MONO} weight={500} ls="0.22em" upper color={INK2} factor={0.78} />
      <div style={{ marginTop: 5, height: 1, width: g * 26 + "px", background: accent, opacity: 0.85 }} />
    </div>
  );
}

function Chip({ at, label, dx, dy }: { at: number; label: string; dx: number; dy: number }) {
  const { T } = useComposition();
  const p = MOTION.pop({ from: 0, to: 1, start: at, end: at + 0.52 })(T);
  const rev = MOTION.draw({ from: 0, to: 1, start: at + 0.1, end: at + 0.55 })(T);
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 19,
        padding: "0 9px",
        borderRadius: 99,
        border: "1px solid " + RULE,
        background: "#faf9f6",
        opacity: clamp(p * 1.6, 0, 1),
        transform: `translate(${dx}px,${(dy + (1 - p) * 5).toFixed(2)}px) scale(${(0.9 + p * 0.1).toFixed(3)})`,
        fontFamily: SANS,
        fontSize: 9.5,
        fontWeight: 600,
        color: INK,
        letterSpacing: "0.01em",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ clipPath: rev > 0.99 ? "none" : "inset(0 " + (100 - rev * 100) + "% 0 0)" }}>{label}</span>
    </div>
  );
}

function Dots({ at, level, accent }: { at: number; level: number; accent: string }) {
  const { T } = useComposition();
  return (
    <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
      {[0, 1, 2, 3, 4].map((i) => {
        const on = i < level;
        const p = MOTION.enter({ from: 0, to: 1, start: at + i * 0.05, end: at + 0.3 + i * 0.05 })(T);
        return (
          <div
            key={i}
            style={{ width: 5, height: 5, borderRadius: 99, background: on ? accent : RULE, opacity: p, transform: `scale(${(0.4 + p * 0.6).toFixed(2)})` }}
          />
        );
      })}
    </div>
  );
}

function Photo() {
  const { T } = useComposition();
  const at = 2.35;
  const p = MOTION.draw({ from: 0, to: 1, start: at, end: at + 0.85 })(T);
  const frame = MOTION.enter({ from: 0, to: 1, start: at - 0.3, end: at + 0.1 })(T);
  return (
    <div
      style={{
        position: "absolute",
        left: PAD,
        top: 54,
        width: 92,
        height: 92,
        borderRadius: 99,
        overflow: "hidden",
        background: "#f4f2ec",
        opacity: frame,
        boxShadow: "inset 0 0 0 1px " + RULE,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "repeating-linear-gradient(135deg, #e7e4dc 0 5px, #f1efe9 5px 10px)",
          clipPath: "inset(" + ((1 - p) * 100).toFixed(1) + "% 0 0 0)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: MONO,
          fontSize: 7.5,
          letterSpacing: "0.2em",
          color: "#a9a49a",
          opacity: p * 0.9,
        }}
      >
        FOTO
      </div>
    </div>
  );
}

type Exp = { top: number; at: number; title: string; meta: string; lines: Array<{ text: string; w: number }>; dy: number };

const EXP: Exp[] = [
  {
    top: 34,
    at: 7.45,
    title: "Lead Product Designer",
    meta: "Norvia — Buenos Aires · 2023 → Actualidad",
    lines: [
      { text: "Dirección del sistema de diseño y del equipo de producto.", w: 328 },
      { text: "Rediseño del onboarding: activación +34% en dos trimestres.", w: 340 },
      { text: "Métricas propias de calidad visual y accesibilidad.", w: 288 },
    ],
    dy: -7,
  },
  {
    top: 148,
    at: 8.4,
    title: "Diseñadora de Producto Sr.",
    meta: "Kalio Labs · 2020 — 2023",
    lines: [
      { text: "App móvil de pagos para 1,2 M de personas usuarias.", w: 296 },
      { text: "Investigación continua: 60+ entrevistas al año.", w: 262 },
    ],
    dy: 15,
  },
  {
    top: 246,
    at: 9.15,
    title: "Diseñadora de Interacción",
    meta: "Estudio Marea · 2018 — 2020",
    lines: [{ text: "Prototipado y motion para banca y salud digital.", w: 272 }],
    dy: 24,
  },
  {
    top: 328,
    at: 9.5,
    title: "Diseñadora Junior",
    meta: "Taller Nube · 2016 — 2018",
    lines: [{ text: "Identidad y web para estudios culturales.", w: 244 }],
    dy: 30,
  },
];

const PROJECTS = [
  { at: 9.78, n: "Sistema Aurora", d: "Design system multiproducto · 2024" },
  { at: 9.94, n: "Norvia Pay", d: "Rediseño de checkout móvil · 2023" },
];
const TOOLS = ["Figma", "After Effects", "Framer", "Notion"];
const SKILLS = ["Design Systems", "Investigación", "Figma", "Prototipado", "Accesibilidad", "Motion"];
const SKILL_NUDGE: Array<[number, number]> = [
  [0, -5],
  [2, 4],
  [-2, 5],
  [1, -4],
  [0, 6],
  [-1, 5],
];
const LANGS = [
  { n: "Español", l: 5, at: 6.72 },
  { n: "Inglés", l: 4, at: 6.84 },
  { n: "Portugués", l: 3, at: 6.96 },
];

function Piece() {
  const { T } = useComposition();
  const DEEP = shade(ACCENT, 0.34);

  const settle = MOTION.draw({ from: 1, to: 0, start: 10.7, end: 12.5 })(T);
  const entrance = MOTION.enter({ from: 0, to: 1, start: 0.15, end: 1.5 })(T);
  const outro = MOTION.draw({ from: 1, to: 0, start: 15.75, end: 16.2 })(T);
  const glow = MOTION.enter({ from: 0, to: 1, start: 13.05, end: 14.0 })(T);
  const pulse = 0.5 + 0.5 * Math.sin((T - 13.0) * 1.9);
  const badge = MOTION.pop({ from: 0, to: 1, start: 13.5, end: 14.15 })(T);
  const check = MOTION.draw({ from: 0, to: 1, start: 13.78, end: 14.3 })(T);
  const labelP = MOTION.enter({ from: 0, to: 1, start: 13.95, end: 14.9 })(T);
  const prog = MOTION.draw({ from: 0, to: 1, start: 2.3, end: 12.5 })(T);
  const progGreen = MOTION.enter({ from: 0, to: 1, start: 12.9, end: 13.7 })(T);

  const s = interpolate(CAM_T, CAM_S, Easing.easeInOutCubic)(T) * (1 + 0.004 * Math.sin(T * 0.7));
  const fx = interpolate(CAM_T, CAM_X, Easing.easeInOutCubic)(T);
  const fy = interpolate(CAM_T, CAM_Y, Easing.easeInOutCubic)(T) + 3 * Math.sin(T * 0.5);
  const rx = MOTION.enter({ from: 9, to: 0, start: 0, end: 2.0 })(T);
  const rz = MOTION.enter({ from: -1.4, to: 0, start: 0, end: 2.1 })(T);

  const sweepP = clamp((T - 11.1) / 1.6, 0, 1);
  const sweepOn = T > 11.1 && T < 12.75;

  const shadow = [
    `0 ${(26 * entrance).toFixed(1)}px ${(66 * entrance).toFixed(1)}px ${rgba("#3a3428", 0.17 * entrance)}`,
    `0 2px 6px ${rgba("#3a3428", 0.07 * entrance)}`,
    glow > 0 ? `0 0 ${(70 * glow).toFixed(0)}px ${rgba(ACCENT, 0.34 * glow * (0.75 + 0.25 * pulse))}` : "",
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>

      <div style={{ position: "absolute", inset: 0, perspective: "2200px" }}>
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: PAGE_W,
            height: PAGE_H,
            transform: `translate(-50%,-50%) translate(${(-fx * s).toFixed(2)}px,${(-fy * s).toFixed(2)}px) scale(${s.toFixed(4)}) rotateX(${rx.toFixed(2)}deg) rotateZ(${rz.toFixed(2)}deg)`,
            transformStyle: "preserve-3d",
            opacity: outro,
          }}
        >
          <div style={{ position: "absolute", inset: -18, borderRadius: 12, border: "1.5px solid " + ACCENT, opacity: glow * 0.5, transform: `scale(${(1 + (1 - glow) * 0.02).toFixed(4)})` }} />
          <div style={{ position: "absolute", inset: -36, borderRadius: 18, border: "1px solid " + ACCENT, opacity: glow * 0.16 * (0.5 + 0.5 * pulse) }} />

          <div
            style={{
              position: "absolute",
              inset: 0,
              background: PAPER,
              borderRadius: 4,
              overflow: "hidden",
              boxShadow: shadow,
              transform: `translateY(${((1 - entrance) * 44).toFixed(2)}px)`,
              filter: `blur(${(settle * 0.45).toFixed(2)}px)`,
            }}
          >
            <div style={{ position: "absolute", left: 0, top: 0, height: 2, width: prog * 100 + "%", background: progGreen > 0 ? ACCENT : "#ddd9d0", opacity: 0.55 + progGreen * 0.45 }} />

            <div style={{ position: "absolute", inset: 0, transform: `scale(${(1 + settle * 0.008).toFixed(4)})` }}>
              <Photo />
              <div style={{ position: "absolute", left: PAD + 118, top: 56, transform: `translateX(${(settle * 11).toFixed(2)}px)` }}>
                <FillLine at={2.6} dur={0.75} text="Valentina Ríos" size={40} family={SERIF} weight={400} factor={0.46} />
                <div style={{ height: 9 }} />
                <FillLine at={2.98} dur={0.5} text="Diseñadora de producto · Senior" size={10} family={MONO} weight={500} ls={(0.16 + settle * 0.05).toFixed(3) + "em"} upper color={INK2} factor={0.8} />
              </div>

              <div
                style={{
                  position: "absolute",
                  left: PAD,
                  top: 168,
                  height: 1,
                  width: PAGE_W - PAD * 2,
                  background: RULE,
                  transformOrigin: "left",
                  transform: `scaleX(${MOTION.draw({ from: 0, to: 1, start: 3.2, end: 3.9 })(T).toFixed(3)})`,
                }}
              />

              <div style={{ position: "absolute", left: PAD, top: 184, display: "flex", gap: 20, transform: `translate(${(settle * -9).toFixed(2)}px,${(settle * 5).toFixed(2)}px)` }}>
                <FillLine at={3.4} dur={0.45} text="valentina@example.com" size={9} family={MONO} color={INK2} factor={0.62} />
                <FillLine at={3.55} dur={0.45} text="+54 9 11 0000 0001" size={9} family={MONO} color={INK2} factor={0.62} />
                <FillLine at={3.7} dur={0.45} text="Buenos Aires, Argentina" size={9} family={MONO} color={INK2} factor={0.62} />
              </div>

              <div style={{ position: "absolute", left: PAD, top: COL_TOP, width: COL_L_W }}>
                <SectionLabel at={7.25} top={0} w={COL_L_W} text="Experiencia" accent={ACCENT} />
                {EXP.map((e, i) => (
                  <div key={i} style={{ position: "absolute", left: 0, top: e.top, width: COL_L_W, transform: `translateY(${(settle * e.dy).toFixed(2)}px)` }}>
                    <FillLine at={e.at} dur={0.55} text={e.title} size={14.5} weight={700} factor={0.5} />
                    <div style={{ height: 3 }} />
                    <FillLine at={e.at + 0.15} dur={0.45} text={e.meta} size={9} family={MONO} color={INK2} factor={0.62} />
                    <div style={{ height: 6 }} />
                    {e.lines.map((l, j) => (
                      <FillLine key={j} at={e.at + 0.3 + j * 0.14} dur={0.6} text={l.text} w={l.w} size={10.5} weight={450} color="#5c584f" style={{ marginBottom: 2 }} />
                    ))}
                  </div>
                ))}
                <div style={{ position: "absolute", left: 0, top: 424, width: COL_L_W, transform: `translateY(${(settle * 34).toFixed(2)}px)` }}>
                  <SectionLabel at={9.7} top={0} w={COL_L_W} text="Proyectos" accent={ACCENT} />
                  {PROJECTS.map((p, i) => (
                    <div key={p.n} style={{ position: "absolute", left: 0, top: 30 + i * 42, width: COL_L_W }}>
                      <FillLine at={p.at} dur={0.5} text={p.n} size={12.5} weight={700} factor={0.5} />
                      <div style={{ height: 3 }} />
                      <FillLine at={p.at + 0.12} dur={0.45} text={p.d} size={9} family={MONO} color={INK2} factor={0.62} />
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ position: "absolute", left: COL_R, top: COL_TOP, width: COL_R_W, transform: `translate(${(settle * 7).toFixed(2)}px,${(settle * -10).toFixed(2)}px)` }}>
                <SectionLabel at={4.85} top={0} w={COL_R_W} text="Aptitudes" accent={ACCENT} />
                <div style={{ position: "absolute", left: 0, top: 26, width: COL_R_W, display: "flex", flexWrap: "wrap", gap: "7px 6px" }}>
                  {SKILLS.map((sk, i) => (
                    <Chip key={sk} label={sk} at={5.05 + i * 0.13} dx={settle * SKILL_NUDGE[i][0]} dy={settle * SKILL_NUDGE[i][1]} />
                  ))}
                </div>

                <SectionLabel at={5.95} top={142} w={COL_R_W} text="Formación" accent={ACCENT} />
                <div style={{ position: "absolute", left: 0, top: 168 }}>
                  <FillLine at={6.1} dur={0.5} text="Máster en Interacción" size={11.5} weight={700} factor={0.5} />
                  <div style={{ height: 2 }} />
                  <FillLine at={6.2} dur={0.45} text="U. de Palermo · 2018" size={8.5} family={MONO} color={INK2} factor={0.62} />
                  <div style={{ height: 8 }} />
                  <FillLine at={6.35} dur={0.5} text="Grado en Bellas Artes" size={11.5} weight={700} factor={0.5} />
                  <div style={{ height: 2 }} />
                  <FillLine at={6.45} dur={0.45} text="UBA · 2016" size={8.5} family={MONO} color={INK2} factor={0.62} />
                </div>

                <SectionLabel at={6.55} top={258} w={COL_R_W} text="Idiomas" accent={ACCENT} />
                <div style={{ position: "absolute", left: 0, top: 284, width: COL_R_W, display: "flex", flexDirection: "column", gap: 8 }}>
                  {LANGS.map((l) => (
                    <div key={l.n} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: COL_R_W - 8 }}>
                      <FillLine at={l.at} dur={0.4} text={l.n} size={10} weight={600} factor={0.54} />
                      <Dots at={l.at + 0.15} level={l.l} accent={ACCENT} />
                    </div>
                  ))}
                </div>

                <SectionLabel at={9.88} top={372} w={COL_R_W} text="Herramientas" accent={ACCENT} />
                <div style={{ position: "absolute", left: 0, top: 398, width: COL_R_W, display: "flex", flexWrap: "wrap", gap: "7px 6px" }}>
                  {TOOLS.map((tl, i) => (
                    <Chip key={tl} label={tl} at={10.0 + i * 0.1} dx={settle * (i % 2 ? -2 : 2)} dy={settle * 5} />
                  ))}
                </div>

                <SectionLabel at={10.08} top={470} w={COL_R_W} text="Enlaces" accent={ACCENT} />
                <div style={{ position: "absolute", left: 0, top: 496, width: COL_R_W, display: "flex", flexDirection: "column", gap: 6 }}>
                  <FillLine at={10.18} dur={0.45} text="example.com" size={9.5} family={MONO} color={INK2} factor={0.62} />
                  <FillLine at={10.26} dur={0.45} text="linkedin.com/in/perfil-ejemplo" size={9.5} family={MONO} color={INK2} factor={0.62} />
                </div>
              </div>
            </div>

            {sweepOn && (
              <div
                style={{
                  position: "absolute",
                  inset: "-10% -40%",
                  pointerEvents: "none",
                  background: `linear-gradient(102deg, transparent 42%, ${rgba("#ffffff", 0.95)} 50%, transparent 58%)`,
                  opacity: Math.sin(Math.PI * sweepP) * 0.9,
                  mixBlendMode: "overlay",
                  transform: `translateX(${-60 + sweepP * 120}%)`,
                }}
              />
            )}
          </div>

          <div
            style={{
              position: "absolute",
              left: "50%",
              top: PAGE_H,
              width: 56,
              height: 56,
              borderRadius: 99,
              marginLeft: -28,
              marginTop: -28,
              background: ACCENT,
              boxShadow: `0 10px 26px ${rgba(ACCENT, 0.38)}, 0 0 0 ${(10 * (1 - badge)).toFixed(1)}px ${rgba(ACCENT, 0.12 * badge)}`,
              opacity: clamp(badge * 1.8, 0, 1),
              transform: `scale(${(0.5 + badge * 0.5).toFixed(3)})`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="30" height="26" viewBox="0 0 32 28" fill="none">
              <path d="M8 15 L13.5 20.5 L24 8" stroke="#ffffff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="26" strokeDashoffset={(1 - check) * 26} />
            </svg>
          </div>

          <div
            style={{
              position: "absolute",
              left: 0,
              top: PAGE_H + 48,
              width: PAGE_W,
              textAlign: "center",
              fontFamily: MONO,
              fontSize: 22,
              fontWeight: 500,
              textTransform: "uppercase",
              color: DEEP,
              opacity: labelP,
              letterSpacing: (0.52 - labelP * 0.26).toFixed(3) + "em",
              transform: `translateY(${((1 - labelP) * 10).toFixed(2)}px)`,
            }}
          >
            <span style={{ marginRight: "-0.26em" }}>{FINAL_LABEL}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function StepPerfilScene(): ReactNode {
  return (
    <CompositionStage width={1920} height={1080} scenes={SCENES} driver={{ kind: "loop", gated: true, threshold: 0.4, end: 15, hold: 2, restartOnEnter: true }}>
      <Piece />
    </CompositionStage>
  );
}
