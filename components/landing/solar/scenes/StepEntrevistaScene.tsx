"use client";

import type { CSSProperties, ReactNode } from "react";
import { CompositionStage, Captions, Easing, animate, clamp, interpolate, useComposition, type Scene } from "../composition";
import { SOLAR, hexA } from "./palette";

/**
 * Based on the project's design reference `CVExact hero design/step-entrevista.html` ("Recibís CV,
 * respuestas, email y entrevista" — Paso 03). Already Spanish and mostly
 * region-neutral (no city/currency markers) — only the two names are
 * swapped for Argentine ones, for consistency with the other two steps.
 */

const SCENES: Scene[] = [
  { name: "Curriculum", dur: 4, desc: "El currículum se eleva sobre el escritorio bajo una luz suave" },
  { name: "Match", dur: 4, desc: "Brillo verde de confirmación y el indicador 94% MATCH sube hasta su valor" },
  { name: "Postulacion", dur: 4, desc: "Una línea se dibuja hacia la tarjeta de postulación enviada" },
  { name: "Reclutador", dur: 4.5, desc: "El reclutador escribe y aparece su mensaje de respuesta" },
  { name: "Correo", dur: 3.5, desc: "Notificación de correo con el siguiente paso" },
  { name: "Entrevista", dur: 5, desc: "Invitación de calendario con fecha y hora confirmadas" },
  { name: "Cierre", dur: 4, desc: "La cámara se aleja, el flujo completo brilla y aparece el título final" },
];

const SANS = "Manrope, system-ui, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, monospace";
const INK = "#eef0f2";
const MUTED = "#8b939c";
/*
 * `CARD_BG` es `SOLAR.bg` levantado ~13% hacia `g4`: el porteo traia un
 * `#12151a` gris-verdoso que ni pertenecia a la familia del fondo (`#01020c`,
 * azul-violaceo) ni se despegaba lo suficiente de el. Unico valor de esta
 * escena calculado en vez de tomado de un token.
 *
 * `ACCENT` es `g1` porque es el color que `app/page.tsx` ya le da a la etiqueta
 * "Paso 03"; el verde menta anterior peleaba con su propia seccion. Sobre el CV
 * blanco `g1` da 1.6:1 — invisible — asi que ahi va `ACCENT_LIGHT`, el mismo
 * matiz en la variante documentada para llevar texto sobre papel.
 */
const CARD_BG = "#141130";
const CARD_BD = "1px solid rgba(255,255,255,0.16)";
const CARD_SH = "0 44px 90px -34px rgba(0,0,0,0.92), 0 10px 28px -14px rgba(0,0,0,0.6)";
const ACCENT = SOLAR.g1;
const ACCENT_LIGHT = SOLAR.oro;
const TILT = 1;
const SHOW_CAPTIONS = true;

const MOTION = {
  enter: (start: number) => (T: number) => {
    const p = animate({ from: 0, to: 1, start, end: start + 0.8, ease: Easing.easeOutCubic })(T);
    return { o: clamp(p * 1.7, 0, 1), y: (1 - p) * 44, s: 0.962 + 0.038 * p };
  },
  draw: (start: number, dur = 0.7) => animate({ from: 0, to: 1, start, end: start + dur, ease: Easing.easeInOutQuart }),
  pop: (start: number) => animate({ from: 0, to: 1, start, end: start + 0.62, ease: Easing.easeOutBack }),
};

const Bar = ({ w, c, h }: { w: string; c?: string; h?: number }) => <div style={{ width: w, height: h || 7, borderRadius: 4, background: c || "rgba(30,36,44,0.16)" }} />;

const Check = ({ c, s }: { c: string; s?: number }) => (
  <svg width={s || 18} height={s || 18} viewBox="0 0 18 18">
    <path d="M3.6 9.4 L7.2 13 L14.4 5.4" fill="none" stroke={c} strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function Panel({ x, y, w, z, at, dim, pad, children }: { x: number; y: number; w: number; z: number; at: number; dim?: number; pad?: number; children: ReactNode }) {
  const { T } = useComposition();
  const e = MOTION.enter(at)(T);
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: w,
        transform: `translateZ(${z}px) translateY(${e.y}px) scale(${e.s})`,
        opacity: e.o * (dim ?? 1),
        background: CARD_BG,
        border: CARD_BD,
        borderRadius: 20,
        boxShadow: CARD_SH,
        padding: pad ?? 24,
        color: INK,
        fontFamily: SANS,
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      {children}
    </div>
  );
}

const Meta = ({ children }: { children: ReactNode }) => <div style={{ font: `500 13px ${MONO}`, letterSpacing: "0.08em", color: MUTED, textTransform: "uppercase" }}>{children}</div>;

type Cues = Record<string, number>;

function Resume({ accent, C }: { accent: string; C: Cues }) {
  const { T } = useComposition();
  const rise = MOTION.enter(0.25)(T);
  const glow = animate({ from: 0, to: 1, start: C.Match + 0.9, end: C.Match + 1.9, ease: Easing.easeOutCubic })(T);
  const scan = MOTION.draw(0.9, 2.2)(T);
  const keys = animate({ from: 0, to: 1, start: C.Match + 0.2, end: C.Match + 1.6, ease: Easing.easeInOutCubic })(T);
  const pulse = 0.5 + 0.5 * Math.sin(T * 1.5);
  return (
    <div
      style={{
        position: "absolute",
        left: 770,
        top: 285,
        width: 380,
        height: 512,
        transform: `translateZ(${74 + (1 - rise.s) * 40}px) translateY(${rise.y}px) scale(${rise.s})`,
        opacity: rise.o,
        borderRadius: 14,
        overflow: "hidden",
        background: "linear-gradient(168deg,#fbfcfb 0%,#f1f3f2 100%)",
        boxShadow: `0 60px 110px -40px rgba(0,0,0,0.95), 0 0 0 1px rgba(255,255,255,0.08), 0 0 ${34 + 26 * pulse * glow}px ${1 + 5 * glow}px ${hexA(ACCENT, 0.3 * glow)}, 0 0 0 ${1.4 * glow}px ${accent}`,
        padding: "34px 32px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        fontFamily: SANS,
        color: "#1b2027",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ font: "700 25px " + SANS, letterSpacing: "-0.01em" }}>Camila Ibarra</div>
          <div style={{ font: "500 14px " + SANS, color: "#6c757e" }}>Diseñadora de Producto Senior</div>
        </div>
        <div style={{ font: `500 10px ${MONO}`, color: "#96a0a8", letterSpacing: "0.1em", paddingTop: 6 }}>CV · V4</div>
      </div>
      <div style={{ height: 1, background: "rgba(27,32,39,0.10)" }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <Bar w="86%" />
        <Bar w="96%" />
        <Bar w="72%" />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 2 }}>
        {["Design Systems", "Prototipado", "Investigación UX"].map((k, i) => {
          const on = clamp((keys - i * 0.22) / 0.4, 0, 1);
          return (
            <div
              key={k}
              style={{
                font: "600 12px " + SANS,
                padding: "6px 11px",
                borderRadius: 999,
                color: `rgb(${Math.round(90 + 48 * on)},${Math.round(101 - 8 * on)},${Math.round(110 - 87 * on)})`,
                background: hexA(ACCENT_LIGHT, 0.16 * on),
                boxShadow: `inset 0 0 0 1px rgba(27,32,39,${0.09 * (1 - on)}), inset 0 0 0 1px ${hexA(ACCENT_LIGHT, 0.5 * on)}`,
              }}
            >
              {k}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 6 }}>
        <Bar w="92%" />
        <Bar w="64%" />
        <Bar w="88%" />
        <Bar w="78%" />
        <Bar w="46%" />
      </div>
      <div style={{ marginTop: "auto", marginBottom: 92, display: "flex", alignItems: "center", gap: 9 }}>
        <Check c={ACCENT_LIGHT} s={15} />
        <div style={{ font: `500 11px ${MONO}`, color: "#7d868e", letterSpacing: "0.07em" }}>OPTIMIZADO PARA LA VACANTE</div>
      </div>
      <div
        style={{
          position: "absolute",
          left: -40,
          right: -40,
          height: 260,
          top: -260 + scan * 780,
          background: `linear-gradient(180deg,rgba(255,255,255,0) 0%,${hexA(ACCENT_LIGHT, 0.16)} 50%,rgba(255,255,255,0) 100%)`,
          opacity: scan > 0 && scan < 1 ? 0.9 : 0,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

function MatchBadge({ accent, C }: { accent: string; C: Cues }) {
  const { T } = useComposition();
  const p = MOTION.pop(C.Match + 0.35)(T);
  const fill = animate({ from: 0, to: 0.94, start: C.Match + 0.7, end: C.Match + 2.3, ease: Easing.easeOutQuart })(T);
  const CIRC = 2 * Math.PI * 19;
  return (
    <div
      style={{
        position: "absolute",
        left: 1046,
        top: 226,
        transform: `translateZ(168px) scale(${p})`,
        opacity: clamp(p * 1.6, 0, 1),
        display: "flex",
        alignItems: "center",
        gap: 13,
        background: hexA(CARD_BG, 0.94),
        border: `1px solid ${hexA(ACCENT, 0.32)}`,
        borderRadius: 999,
        padding: "11px 20px 11px 13px",
        color: INK,
        fontFamily: SANS,
        boxShadow: `0 26px 50px -22px rgba(0,0,0,0.9), 0 0 26px -4px ${hexA(ACCENT, 0.35)}`,
        whiteSpace: "nowrap",
      }}
    >
      <svg width="44" height="44" viewBox="0 0 44 44">
        <circle cx="22" cy="22" r="19" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3" />
        <circle cx="22" cy="22" r="19" fill="none" stroke={accent} strokeWidth="3" strokeLinecap="round" strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - fill)} transform="rotate(-90 22 22)" />
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ font: "700 27px " + SANS, letterSpacing: "-0.02em", lineHeight: 1 }}>{Math.round(fill * 100)}%</div>
        <div style={{ font: `500 10px ${MONO}`, letterSpacing: "0.18em", color: accent }}>MATCH</div>
      </div>
    </div>
  );
}

const LINKS: Array<{ d: string; at: (C: Cues) => number }> = [
  { d: "M 770 430 H 700 Q 680 430 680 410 V 272 Q 680 252 660 252 H 632", at: (C) => C.Postulacion + 0.5 },
  { d: "M 1150 430 H 1222 Q 1242 430 1242 410 V 292 Q 1242 272 1262 272 H 1288", at: (C) => C.Reclutador + 0.5 },
  { d: "M 1150 664 H 1222 Q 1242 664 1242 684 V 742 Q 1242 762 1262 762 H 1308", at: (C) => C.Correo + 0.45 },
  { d: "M 770 664 H 700 Q 680 664 680 684 V 772 Q 680 792 660 792 H 652", at: (C) => C.Entrevista + 0.6 },
];

function Links({ accent, C }: { accent: string; C: Cues }) {
  const { T } = useComposition();
  const late = animate({ from: 0, to: 1, start: C.Cierre + 0.3, end: C.Cierre + 1.6, ease: Easing.easeInOutCubic })(T);
  return (
    <svg width="1920" height="1080" viewBox="0 0 1920 1080" style={{ position: "absolute", left: 0, top: 0, transform: "translateZ(26px)", overflow: "visible" }}>
      {LINKS.map((l, i) => {
        const p = MOTION.draw(l.at(C), 0.8)(T);
        return (
          <g key={i} opacity={p > 0 ? 1 : 0}>
            <path d={l.d} fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="2" strokeLinecap="round" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - p} />
            <path d={l.d} fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - p} opacity={0.3 + 0.45 * late} />
          </g>
        );
      })}
    </svg>
  );
}

function Applied({ accent, C, dim }: { accent: string; C: Cues; dim: number }) {
  const { T } = useComposition();
  const tick = MOTION.pop(C.Postulacion + 1.5)(T);
  return (
    <Panel x={212} y={182} w={420} z={44} at={C.Postulacion + 0.95} dim={dim}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Meta>Postulación</Meta>
        <div style={{ font: `500 12px ${MONO}`, color: "rgba(139,147,156,0.7)" }}>hace 2 min</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 15 }}>
        <div style={{ width: 42, height: 42, borderRadius: 12, display: "grid", placeItems: "center", background: hexA(ACCENT, 0.13), boxShadow: `inset 0 0 0 1px ${hexA(ACCENT, 0.34)}`, transform: `scale(${0.6 + 0.4 * tick})` }}>
          <Check c={accent} s={20} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ font: "600 19px " + SANS }}>Postulación enviada</div>
          <div style={{ font: "500 14px " + SANS, color: MUTED }}>Diseñadora de Producto Senior · Nova Labs</div>
        </div>
      </div>
    </Panel>
  );
}

function Recruiter({ accent, C, dim }: { accent: string; C: Cues; dim: number }) {
  const { T } = useComposition();
  const typing = clamp((T - (C.Reclutador + 1.2)) / 0.3, 0, 1) * (1 - clamp((T - (C.Reclutador + 2.1)) / 0.3, 0, 1));
  const msg = clamp((T - (C.Reclutador + 2.35)) / 0.45, 0, 1);
  return (
    <Panel x={1290} y={196} w={420} z={44} at={C.Reclutador + 0.9} dim={dim}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Meta>Mensaje</Meta>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <div style={{ width: 7, height: 7, borderRadius: 99, background: accent }} />
          <div style={{ font: `500 12px ${MONO}`, color: "rgba(139,147,156,0.75)" }}>en línea</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
        <div style={{ width: 38, height: 38, borderRadius: 99, background: "rgba(255,255,255,0.07)", display: "grid", placeItems: "center", font: "600 13px " + SANS, color: "#cfd5db" }}>MR</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <div style={{ font: "600 17px " + SANS }}>Marina Rojas</div>
          <div style={{ font: "500 13px " + SANS, color: MUTED }}>Talent Partner · Nova Labs</div>
        </div>
      </div>
      <div style={{ position: "relative", minHeight: 78 }}>
        <div style={{ position: "absolute", inset: 0, opacity: typing, display: "flex", alignItems: "center", gap: 6, padding: "0 18px", borderRadius: 14, background: "rgba(255,255,255,0.045)" }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ width: 7, height: 7, borderRadius: 99, background: "rgba(207,213,219,0.8)", transform: `translateY(${Math.sin(T * 6 - i * 0.9) * 3}px)` }} />
          ))}
        </div>
        <div style={{ position: "absolute", inset: 0, opacity: msg, transform: `translateY(${(1 - msg) * 8}px)`, padding: "14px 17px", borderRadius: 14, background: "rgba(255,255,255,0.05)", boxShadow: `inset 1px 0 0 ${accent}`, font: "500 15px/1.45 " + SANS, color: "#dde2e7" }}>
          «Hola Camila, tu perfil encaja perfecto. ¿Hablamos esta semana?»
        </div>
      </div>
    </Panel>
  );
}

function Mail({ accent, C, dim }: { accent: string; C: Cues; dim: number }) {
  return (
    <Panel x={1310} y={690} w={400} z={44} at={C.Correo + 0.85} dim={dim}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Meta>Correo</Meta>
        <div style={{ font: `500 12px ${MONO}`, color: "rgba(139,147,156,0.7)" }}>10:04</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ width: 40, height: 40, borderRadius: 11, display: "grid", placeItems: "center", background: "rgba(255,255,255,0.055)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)" }}>
          <svg width="20" height="20" viewBox="0 0 20 20">
            <rect x="2.5" y="4.5" width="15" height="11" rx="2.5" fill="none" stroke="#cfd5db" strokeWidth="1.5" />
            <path d="M3.5 6 L10 11 L16.5 6" fill="none" stroke={accent} strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ font: "600 17px " + SANS }}>Siguiente paso: entrevista</div>
          <div style={{ font: `500 12px ${MONO}`, color: MUTED }}>talent@example.com</div>
        </div>
      </div>
    </Panel>
  );
}

function Interview({ accent, C, dim }: { accent: string; C: Cues; dim: number }) {
  const { T } = useComposition();
  const pill = MOTION.pop(C.Entrevista + 2.5)(T);
  const ring = clamp((T - (C.Entrevista + 2.5)) / 1.1, 0, 1);
  return (
    <Panel x={192} y={686} w={460} z={52} at={C.Entrevista + 1.05} dim={dim} pad={26}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Meta>Entrevista</Meta>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            opacity: clamp(pill * 1.5, 0, 1),
            transform: `scale(${0.7 + 0.3 * pill})`,
            padding: "6px 13px",
            borderRadius: 999,
            background: hexA(ACCENT, 0.14),
            boxShadow: `inset 0 0 0 1px ${hexA(ACCENT, 0.4)}, 0 0 ${18 * (1 - ring)}px ${hexA(ACCENT, 0.5 * (1 - ring))}`,
            font: `600 12px ${MONO}`,
            letterSpacing: "0.08em",
            color: accent,
          }}
        >
          <Check c={accent} s={13} />
          CONFIRMADA
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <div style={{ width: 84, height: 88, borderRadius: 14, background: "rgba(255,255,255,0.05)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
          <div style={{ font: `600 12px ${MONO}`, letterSpacing: "0.14em", color: accent }}>JUE</div>
          <div style={{ font: "700 36px " + SANS, lineHeight: 1, letterSpacing: "-0.03em" }}>17</div>
          <div style={{ font: `500 10px ${MONO}`, letterSpacing: "0.12em", color: MUTED }}>SEP</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ font: "600 21px " + SANS, letterSpacing: "-0.01em" }}>10:30 – 11:15</div>
          <div style={{ font: "500 15px " + SANS, color: "#c3cad1" }}>Entrevista con Marina Rojas</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, font: `500 12px ${MONO}`, color: MUTED }}>
            <div style={{ width: 6, height: 6, borderRadius: 99, background: accent }} />
            Videollamada · 45 min
          </div>
        </div>
      </div>
    </Panel>
  );
}

type CamFrame = { x: number; y: number; s: number; rx: number };

function Piece() {
  const c = useComposition();
  const T = c.T,
    C = c.CUES,
    total = c.authoredTotal;
  const accent = ACCENT;

  const cam = (px: number, py: number, s: number, rx: number): CamFrame => ({
    x: -(px - 960) * s,
    y: -(py - 540) * s * Math.cos((rx * Math.PI) / 180),
    s,
    rx: rx * TILT,
  });
  const kf: Array<[number, CamFrame]> = [
    [0, cam(960, 570, 1.16, 44)],
    [C.Match - 0.5, cam(960, 540, 1.3, 30)],
    [C.Match + 2.4, cam(960, 470, 1.42, 24)],
    [C.Postulacion + 0.6, cam(720, 430, 1.0, 26)],
    [C.Postulacion + 3.3, cam(770, 450, 1.06, 26)],
    [C.Reclutador + 0.6, cam(1250, 410, 1.02, 22)],
    [C.Reclutador + 3.8, cam(1290, 390, 1.07, 22)],
    [C.Correo + 0.5, cam(1430, 730, 0.98, 20)],
    [C.Correo + 2.9, cam(1440, 735, 1.02, 20)],
    [C.Entrevista + 0.7, cam(570, 730, 1.1, 18)],
    [C.Entrevista + 4.0, cam(575, 730, 1.18, 18)],
    [C.Cierre + 1.0, cam(960, 545, 0.66, 36)],
    [total, cam(960, 545, 0.62, 38)],
  ];
  const ts = kf.map((k) => k[0]);
  const ch = (key: keyof CamFrame) =>
    interpolate(
      ts,
      kf.map((k) => k[1][key]),
      Easing.easeInOutCubic,
    )(T);
  const cx = ch("x") + Math.sin(T * 0.29) * 9;
  const cy = ch("y") + Math.cos(T * 0.23) * 7;
  const cs = ch("s") * (1 + 0.004 * Math.sin(T * 0.37));
  const crx = ch("rx") + Math.sin(T * 0.19) * 0.7;

  const dim = 1 - 0.06 * animate({ from: 0, to: 1, start: C.Cierre + 0.4, end: C.Cierre + 1.6 })(T);
  const titleIn = MOTION.enter(C.Cierre + 1.3)(T);
  const fade = animate({ from: 0, to: 1, start: total - 0.75, end: total - 0.05, ease: Easing.easeInQuad })(T);
  const open = animate({ from: 1, to: 0, start: 0, end: 0.6, ease: Easing.easeOutQuad })(T);

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>

      <div style={{ position: "absolute", inset: 0, perspective: "2000px", perspectiveOrigin: "50% 46%" }}>
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: 1920,
            height: 1080,
            transformStyle: "preserve-3d",
            transformOrigin: "960px 540px",
            transform: `translate3d(${cx}px,${cy}px,0) scale(${cs}) rotateX(${crx}deg)`,
          }}
        >
          <div
            style={{
              position: "absolute",
              left: -700,
              top: -520,
              width: 3320,
              height: 2120,
              backgroundImage: "radial-gradient(rgba(255,255,255,0.055) 1px, transparent 1px)",
              backgroundSize: "56px 56px",
              transform: "translateZ(0px)",
            }}
          >
          </div>

          <Links accent={accent} C={C} />
          <Applied accent={accent} C={C} dim={dim} />
          <Recruiter accent={accent} C={C} dim={dim} />
          <Mail accent={accent} C={C} dim={dim} />
          <Interview accent={accent} C={C} dim={dim} />
          <Resume accent={accent} C={C} />
          <MatchBadge accent={accent} C={C} />
        </div>
      </div>

      <div style={{ position: "absolute", left: 0, right: 0, bottom: 96, textAlign: "center", opacity: titleIn.o, transform: `translateY(${titleIn.y * 0.5}px)`, fontFamily: SANS, color: INK, pointerEvents: "none" }}>
        <div style={{ font: "600 66px " + SANS, letterSpacing: "-0.03em" }}>De currículum a entrevista</div>
        <div style={{ font: `500 17px ${MONO}`, letterSpacing: "0.22em", color: accent, marginTop: 18 }}>EN UN SOLO FLUJO</div>
      </div>


      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: "21%",
          pointerEvents: "none",
          background: `linear-gradient(180deg,${hexA(SOLAR.bg, 0)} 0%,${hexA(SOLAR.bg, 0.42)} 45%,${hexA(SOLAR.bg, 0.75)} 100%)`,
          opacity: SHOW_CAPTIONS || T > C.Cierre ? 1 : 0,
        }}
      />

      {SHOW_CAPTIONS && (
        <Captions
          style={{ font: "500 32px " + SANS, bottom: "8%", color: "#f2f4f6", letterSpacing: "-0.01em" } as CSSProperties}
          items={[
            { at: 0.9, until: C.Match + 0.3, text: "Tu currículum, ajustado a cada oferta." },
            { at: C.Match + 0.8, until: C.Postulacion + 0.2, text: "94 % de compatibilidad con la vacante." },
            { at: C.Postulacion + 1.1, until: C.Reclutador + 0.2, text: "Postulación enviada automáticamente." },
            { at: C.Reclutador + 2.5, until: C.Correo + 0.2, text: "El reclutador responde en horas." },
            { at: C.Correo + 1.1, until: C.Entrevista + 0.2, text: "Confirmación directa en tu correo." },
            { at: C.Entrevista + 2.6, until: C.Cierre + 0.1, text: "Entrevista agendada: jueves 17, 10:30." },
          ]}
        />
      )}

      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: Math.max(open, fade) }} />
    </div>
  );
}

export function StepEntrevistaScene() {
  return (
    <CompositionStage width={1920} height={1080} scenes={SCENES} driver={{ kind: "loop", gated: true, threshold: 0.4, hold: 2, restartOnEnter: true }}>
      <Piece />
    </CompositionStage>
  );
}
