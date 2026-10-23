"use client";

import type { CSSProperties, ReactNode } from "react";
import {
  CompositionStage,
  Captions,
  Easing,
  animate,
  clamp,
  interpolate,
  useComposition,
  type Scene,
} from "../composition";
import { SOLAR, OK } from "./palette";

/**
 * Based on the project's design reference `CVExact hero design/step-alineo.html` ("Pegás el aviso" —
 * Paso 02). Already shipped in Spanish (Madrid-flavored: euros, `es-ES`
 * number formatting) — localized to Buenos Aires and USD/month, the way
 * Argentine tech postings actually quote pay, rather than translated from
 * scratch.
 *
 * The on-screen fake SaaS is renamed here to "cvexact" — the source mockup
 * this reference calls it "Alineo", which is where `step-alineo.html`
 * above comes from.
 */

const SCENES: Scene[] = [
  {
    name: "Apertura",
    dur: 3.5,
    desc: "Plano general del portal de empleo: la oferta de Desarrollador Backend Senior aparece y la cámara se acerca",
  },
  {
    name: "Descripción",
    dur: 4,
    desc: "La cámara recorre la descripción del puesto y el cursor entra en escena",
  },
  {
    name: "Selección",
    dur: 4.5,
    desc: "El cursor arrastra y selecciona descripción, responsabilidades y requisitos",
  },
  {
    name: "Copiar",
    dur: 2.5,
    desc: "Menú contextual, clic en Copiar y aviso de copiado al portapapeles",
  },
  {
    name: "Transición",
    dur: 2.5,
    desc: "El texto copiado viaja mientras la cámara se desplaza hacia cvexact",
  },
  {
    name: "Pegar",
    dur: 3.5,
    desc: "Clic en el campo, atajo Command V y el texto se pega línea a línea",
  },
  {
    name: "Análisis",
    dur: 5.5,
    desc: "Barrido luminoso, resaltados sobre requisitos clave y detección en el panel",
  },
  {
    name: "Coincidencia",
    dur: 4.5,
    desc: "El anillo llega al 87 por ciento y aparece el informe completo",
  },
];

function mono(a: number[]) {
  const o = [a[0]];
  for (let i = 1; i < a.length; i++) o.push(Math.max(a[i], o[i - 1] + 0.01));
  return o;
}
const kf = (
  t: number,
  times: number[],
  vals: number[],
  ease = Easing.easeInOutCubic,
) => interpolate(mono(times), vals, ease)(t);
const MOTION = {
  enter: (t: number, s: number, d = 0.5) =>
    animate({
      from: 0,
      to: 1,
      start: s,
      end: s + d,
      ease: Easing.easeOutCubic,
    })(t),
  pop: (t: number, s: number, d = 0.42) =>
    animate({ from: 0, to: 1, start: s, end: s + d, ease: Easing.easeOutBack })(
      t,
    ),
  glide: (t: number, times: number[], vals: number[]) =>
    kf(t, times, vals, Easing.easeInOutCubic),
};
const hexA = (h: string, a: number) => {
  const n = parseInt(h.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

const F = '"Plus Jakarta Sans", system-ui, sans-serif';
const M = '"JetBrains Mono", ui-monospace, monospace';
const P = {
  surface: "#ffffff",
  chrome: "#fafaff",
  alt: "#f6f7fb",
  line: "#e5e6f0",
  soft: "#eef0f7",
  ink: "#14161f",
  ink2: "#464b5e",
  muted: "#7c8299",
};

const WIN = { w: 2400, h: 1460 };
const JOB_O = { x: 40, y: 40 };
const APP_O = { x: 2600, y: 40 };
const PAD = 80;

type Token = string | { k: string };

// Localizado a Argentina: Madrid -> Buenos Aires, euros -> USD/mes (así se
// cotizan los puestos senior de tech acá), "Europa" -> "Latinoamérica".
const JOB = {
  company: "Kestra Cloud",
  role: "Desarrollador Backend Senior",
  meta: [
    "Jornada completa",
    "Híbrido · Buenos Aires",
    "USD 3.500 – 4.500",
    "Hace 2 días",
  ],
  sections: [
    {
      title: "Descripción del puesto",
      lines: [
        [
          "En Kestra Cloud construimos la infraestructura de pagos que usan más",
        ],
        [
          "de 4.000 empresas en Latinoamérica. Buscamos un perfil senior para liderar",
        ],
        ["el diseño de nuestros servicios de liquidación en tiempo real."],
      ] as Token[][],
    },
    {
      title: "Responsabilidades",
      bullet: true,
      lines: [
        [
          "Diseñar y mantener microservicios de alta disponibilidad en ",
          { k: "Go" },
          " y Python.",
        ],
        [
          "Optimizar esquemas y consultas en ",
          { k: "PostgreSQL" },
          " para cargas de +50k TPS.",
        ],
        [
          "Definir contratos de API con ",
          { k: "gRPC" },
          " y liderar revisiones de arquitectura.",
        ],
        ["Acompañar a perfiles junior con mentoría y revisión de código."],
      ] as Token[][],
    },
    {
      title: "Requisitos",
      bullet: true,
      lines: [
        [
          "Mínimo ",
          { k: "5 años de experiencia" },
          " en desarrollo backend en producción.",
        ],
        [
          "Dominio de Go o Python y experiencia con ",
          { k: "sistemas distribuidos" },
          ".",
        ],
        [
          "Experiencia operando en ",
          { k: "Kubernetes y AWS" },
          " con foco en observabilidad.",
        ],
        [
          "Conocimiento de colas de mensajes como ",
          { k: "Kafka" },
          " y patrones de eventos.",
        ],
        [{ k: "Inglés profesional B2" }, " y comunicación escrita clara."],
      ] as Token[][],
    },
  ],
  tech: [
    "Go",
    "Python",
    "PostgreSQL",
    "Kubernetes",
    "AWS",
    "gRPC",
    "Kafka",
    "Terraform",
  ],
};

const tokText = (tk: Token) => (typeof tk === "string" ? tk : tk.k);
const lineText = (ln: Token[]) => ln.map(tokText).join("");

type DocRow =
  | { kind: "h"; si: number; y: number; x: number; text: string; w: number }
  | {
      kind: "l";
      si: number;
      li: number;
      y: number;
      x: number;
      tokens: Token[];
      w: number;
      bullet: boolean;
    };

const DOC = (() => {
  const rows: DocRow[] = [];
  let y = 450;
  JOB.sections.forEach((s, si) => {
    if (si > 0) y += 56;
    rows.push({
      kind: "h",
      si,
      y,
      x: PAD,
      text: s.title,
      w: s.title.length * 16.5,
    });
    y += 50;
    s.lines.forEach((tokens, li) => {
      const txt = lineText(tokens);
      rows.push({
        kind: "l",
        si,
        li,
        y,
        x: s.bullet ? PAD + 34 : PAD,
        tokens,
        w: txt.length * 13.0,
        bullet: !!s.bullet,
      });
      y += 42;
    });
  });
  return { rows, techHeadY: y + 56, techChipY: y + 110, chars: 1482 };
})();

const KW: string[] = [];
JOB.sections.forEach((s) =>
  s.lines.forEach((ln) =>
    ln.forEach((tk) => {
      if (typeof tk !== "string" && tk.k) KW.push(tk.k);
    }),
  ),
);
const KW_INDEX: Record<string, number> = {};
KW.forEach((k, i) => {
  KW_INDEX[k] = i;
});

const DETECTED = [
  { l: "Lenguaje", v: "Go · Python" },
  { l: "Base de datos", v: "PostgreSQL" },
  { l: "Contratos de API", v: "gRPC" },
  { l: "Experiencia", v: "5+ años backend" },
  { l: "Arquitectura", v: "Sistemas distribuidos" },
  { l: "Infraestructura", v: "Kubernetes · AWS" },
  { l: "Mensajería", v: "Kafka" },
  { l: "Idioma", v: "Inglés B2" },
];

function Check({ size = 22, color }: { size?: number; color: string }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        background: color,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
      }}
    >
      <div
        style={{
          width: size * 0.36,
          height: size * 0.19,
          borderLeft: "2.4px solid #fff",
          borderBottom: "2.4px solid #fff",
          transform: "rotate(-45deg) translate(0.5px,-1px)",
        }}
      />
    </div>
  );
}

function Chip({
  children,
  accent,
  mono: isMono,
  big,
}: {
  children: ReactNode;
  accent?: string | null;
  mono?: boolean;
  big?: boolean;
}) {
  return (
    <div
      style={{
        padding: big ? "11px 20px" : "9px 16px",
        borderRadius: 999,
        border: `1.5px solid ${accent ? hexA(accent, 0.32) : P.line}`,
        background: accent ? hexA(accent, 0.09) : P.alt,
        color: accent || P.ink2,
        font: `${accent ? 600 : 500} ${big ? 22 : 20}px ${isMono ? M : F}`,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </div>
  );
}

function WindowShell({
  o,
  children,
  glow,
  a1,
}: {
  o: { x: number; y: number };
  children: ReactNode;
  glow: number;
  a1: string;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: o.x,
        top: o.y,
        width: WIN.w,
        height: WIN.h,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: -120,
          borderRadius: 400,
          background: `radial-gradient(60% 55% at 50% 50%, ${hexA(a1, 0.16 * glow)}, transparent 70%)`,
          filter: "blur(40px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 26,
          background: P.surface,
          border: `1px solid ${hexA("#ffffff", 0.14)}`,
          overflow: "hidden",
          boxShadow:
            "0 60px 140px rgba(2,4,12,0.7), 0 4px 14px rgba(2,4,12,0.5)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function TopBar({
  brand,
  nav,
  a1,
  right,
}: {
  brand: string;
  nav: string[];
  a1: string;
  right: ReactNode;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: "100%",
        height: 84,
        background: P.chrome,
        borderBottom: `1px solid ${P.soft}`,
        display: "flex",
        alignItems: "center",
        gap: 40,
        padding: `0 ${PAD}px`,
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          style={{ width: 26, height: 26, borderRadius: 8, background: a1 }}
        />
        <div
          style={{
            font: `800 26px ${F}`,
            color: P.ink,
            letterSpacing: "-0.02em",
          }}
        >
          {brand}
        </div>
      </div>
      <div style={{ display: "flex", gap: 32 }}>
        {nav.map((n, i) => (
          <div
            key={n}
            style={{
              font: `${i === 0 ? 600 : 500} 21px ${F}`,
              color: i === 0 ? P.ink : P.muted,
            }}
          >
            {n}
          </div>
        ))}
      </div>
      <div
        style={{
          marginLeft: "auto",
          display: "flex",
          alignItems: "center",
          gap: 20,
        }}
      >
        {right}
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            background: P.alt,
            border: `1px solid ${P.line}`,
          }}
        />
      </div>
    </div>
  );
}

type Timings = {
  cursorIn: number;
  selStart: number;
  selEnd: number;
  menuIn: number;
  copyClick: number;
  toast: number;
  pasteFocus: number;
  pasteKey: number;
  paste: number;
  analyzeClick: number;
  kw0: number;
  det0: number;
  scanEnd: number;
  done: number;
  ringStart: number;
  ringEnd: number;
  cta: number;
};

function JobWindow({
  T,
  t,
  sel,
  a1,
  glow,
}: {
  T: number;
  t: Timings;
  sel: number;
  a1: string;
  glow: number;
}) {
  const selCol = hexA(a1, 0.24);
  return (
    <WindowShell o={JOB_O} glow={glow} a1={a1}>
      <TopBar
        brand="vacantia"
        nav={["Ofertas", "Empresas", "Guardadas"]}
        a1={a1}
        right={
          <div
            style={{
              width: 300,
              height: 44,
              borderRadius: 22,
              background: P.alt,
              border: `1px solid ${P.line}`,
              display: "flex",
              alignItems: "center",
              padding: "0 18px",
              font: `500 19px ${F}`,
              color: P.muted,
              boxSizing: "border-box",
            }}
          >
            Buscar ofertas…
          </div>
        }
      />

      <div
        style={{
          position: "absolute",
          left: PAD,
          top: 138,
          display: "flex",
          alignItems: "center",
          gap: 18,
        }}
      >
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: 14,
            background: P.ink,
            color: "#fff",
            font: `700 22px ${F}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          KC
        </div>
        <div style={{ font: `600 24px ${F}`, color: P.ink2 }}>
          {JOB.company}
        </div>
        <div
          style={{ width: 6, height: 6, borderRadius: 3, background: P.line }}
        />
        <div style={{ font: `500 24px ${F}`, color: P.muted }}>
          Plataforma de pagos · 320 empleados
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: PAD,
          top: 214,
          font: `800 60px ${F}`,
          color: P.ink,
          letterSpacing: "-0.03em",
        }}
      >
        {JOB.role}
      </div>
      <div
        style={{
          position: "absolute",
          left: PAD,
          top: 322,
          display: "flex",
          gap: 14,
        }}
      >
        {JOB.meta.map((m, i) => (
          <Chip key={m} big accent={i === 2 ? a1 : null}>
            {m}
          </Chip>
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          left: PAD,
          top: 412,
          width: 1480,
          height: 1,
          background: P.soft,
        }}
      />

      {DOC.rows.map((r, i) => {
        const p = clamp(sel - i, 0, 1);
        const bg: CSSProperties =
          p > 0
            ? {
                backgroundImage: `linear-gradient(${selCol},${selCol})`,
                backgroundRepeat: "no-repeat",
                backgroundSize: `${p * 100}% 100%`,
              }
            : {};
        if (r.kind === "h") {
          return (
            <div key={i} style={{ position: "absolute", left: r.x, top: r.y }}>
              <span
                style={{
                  font: `700 28px ${F}`,
                  color: a1,
                  letterSpacing: "0.09em",
                  textTransform: "uppercase",
                  padding: "3px 2px",
                  ...bg,
                }}
              >
                {r.text}
              </span>
            </div>
          );
        }
        return (
          <div key={i} style={{ position: "absolute", left: r.x, top: r.y }}>
            {r.bullet && (
              <div
                style={{
                  position: "absolute",
                  left: -30,
                  top: 15,
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  background: hexA(a1, 0.55),
                }}
              />
            )}
            <span
              style={{
                font: `400 26px ${F}`,
                color: P.ink2,
                padding: "3px 2px",
                lineHeight: 1.2,
                ...bg,
              }}
            >
              {r.tokens.map((tk, j) => (
                <span
                  key={j}
                  style={
                    typeof tk === "string"
                      ? undefined
                      : { color: P.ink, fontWeight: 600 }
                  }
                >
                  {tokText(tk)}
                </span>
              ))}
            </span>
          </div>
        );
      })}

      <div
        style={{
          position: "absolute",
          left: PAD,
          top: DOC.techHeadY,
          font: `700 28px ${F}`,
          color: a1,
          letterSpacing: "0.09em",
          textTransform: "uppercase",
        }}
      >
        Tecnologías
      </div>
      <div
        style={{
          position: "absolute",
          left: PAD,
          top: DOC.techChipY,
          display: "flex",
          gap: 12,
          width: 1480,
          flexWrap: "wrap",
        }}
      >
        {JOB.tech.map((x) => (
          <Chip key={x} mono>
            {x}
          </Chip>
        ))}
      </div>

      <div
        style={{
          position: "absolute",
          left: 1680,
          top: 138,
          width: 640,
          borderRadius: 22,
          border: `1px solid ${P.line}`,
          background: P.alt,
          padding: 36,
          boxSizing: "border-box",
        }}
      >
        <div style={{ font: `500 22px ${F}`, color: P.muted }}>
          Salario mensual
        </div>
        <div
          style={{
            font: `800 38px ${F}`,
            color: P.ink,
            letterSpacing: "-0.02em",
            marginTop: 6,
          }}
        >
          USD 3.500 – 4.500
        </div>
        <div
          style={{
            height: 60,
            borderRadius: 14,
            background: a1,
            color: "#fff",
            font: `700 23px ${F}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginTop: 26,
            boxShadow: `0 12px 30px ${hexA(a1, 0.35)}`,
          }}
        >
          Solicitar puesto
        </div>
        <div
          style={{
            height: 60,
            borderRadius: 14,
            border: `1.5px solid ${P.line}`,
            background: P.surface,
            color: P.ink2,
            font: `600 23px ${F}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginTop: 12,
          }}
        >
          Guardar oferta
        </div>
        <div style={{ height: 1, background: P.line, margin: "26px 0" }} />
        {(
          [
            ["Equipo", "Plataforma de pagos"],
            ["Nivel", "Senior"],
            ["Idiomas", "ES · EN"],
          ] as Array<[string, string]>
        ).map(([k, v]) => (
          <div
            key={k}
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 14,
            }}
          >
            <span style={{ font: `500 21px ${F}`, color: P.muted }}>{k}</span>
            <span style={{ font: `600 21px ${F}`, color: P.ink2 }}>{v}</span>
          </div>
        ))}
      </div>

      <CopyMenu T={T} t={t} a1={a1} />
    </WindowShell>
  );
}

function CopyMenu({ T, t, a1 }: { T: number; t: Timings; a1: string }) {
  const p = MOTION.pop(T, t.menuIn, 0.34);
  const out = 1 - MOTION.enter(T, t.copyClick + 0.06, 0.18);
  const o = clamp(p, 0, 1) * out;
  if (o <= 0.002) return null;
  const hot = T >= t.copyClick - 0.5;
  return (
    <div
      style={{
        position: "absolute",
        left: 785,
        top: 1200,
        width: 340,
        borderRadius: 16,
        background: "rgba(255,255,255,0.98)",
        border: `1px solid ${P.line}`,
        padding: 10,
        boxSizing: "border-box",
        boxShadow: "0 26px 60px rgba(12,16,32,0.22)",
        opacity: o,
        transform: `scale(${0.94 + 0.06 * p}) translateY(${(1 - p) * -8}px)`,
        transformOrigin: "0 0",
      }}
    >
      {(
        [
          ["Copiar", "⌘C"],
          ["Buscar en la web", ""],
          ["Traducir selección", ""],
        ] as Array<[string, string]>
      ).map(([label, key], i) => (
        <div
          key={label}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "13px 16px",
            borderRadius: 10,
            background: i === 0 && hot ? hexA(a1, 0.12) : "transparent",
            font: `${i === 0 ? 600 : 500} 22px ${F}`,
            color: i === 0 && hot ? a1 : P.ink2,
          }}
        >
          <span>{label}</span>
          <span style={{ font: `500 19px ${M}`, color: P.muted }}>{key}</span>
        </div>
      ))}
    </div>
  );
}

function AppWindow({
  T,
  t,
  a1,
  a2,
  glow,
}: {
  T: number;
  t: Timings;
  a1: string;
  a2: string;
  glow: number;
}) {
  const pasted = clamp((T - t.paste) / 0.7, 0, 1);
  const focus = T >= t.pasteFocus ? 1 : 0;
  const analyzing = T >= t.analyzeClick;
  const done = T >= t.done;
  const chars = Math.round(
    kf(T, [t.paste, t.paste + 0.7], [0, DOC.chars], Easing.easeOutCubic),
  );
  const step = done ? 2 : analyzing ? 1 : 0;
  const boxTop = 320,
    boxH = 790,
    boxLeft = PAD,
    boxW = 1480;

  const scan = clamp(
    (T - (t.analyzeClick + 0.15)) / (t.scanEnd - t.analyzeClick - 0.15),
    0,
    1,
  );
  const scanOn =
    analyzing && T < t.scanEnd + 0.25
      ? 1 - clamp((T - t.scanEnd) / 0.25, 0, 1)
      : 0;
  const borderGlow = analyzing && !done ? 0.55 + 0.45 * Math.sin(T * 4.2) : 0;

  return (
    <WindowShell o={APP_O} glow={glow} a1={a1}>
      <TopBar
        brand="cvexact"
        nav={["Análisis", "Mi CV", "Historial"]}
        a1={a1}
        right={
          <div style={{ font: `600 20px ${F}`, color: P.muted }}>Plan Pro</div>
        }
      />

      <div
        style={{
          position: "absolute",
          left: PAD,
          top: 120,
          font: `800 42px ${F}`,
          color: P.ink,
          letterSpacing: "-0.03em",
        }}
      >
        Análisis de coincidencia
      </div>
      <div
        style={{
          position: "absolute",
          left: PAD,
          top: 178,
          font: `500 24px ${F}`,
          color: P.muted,
        }}
      >
        Pega la oferta y la comparamos con tu CV, requisito a requisito.
      </div>
      <div
        style={{
          position: "absolute",
          right: PAD,
          top: 132,
          display: "flex",
          gap: 12,
        }}
      >
        {["1 · Oferta", "2 · Análisis", "3 · Resultados"].map((s, i) => (
          <div
            key={s}
            style={{
              padding: "11px 20px",
              borderRadius: 999,
              font: `600 20px ${F}`,
              border: `1.5px solid ${i === step ? hexA(a1, 0.4) : P.line}`,
              background: i === step ? hexA(a1, 0.1) : P.alt,
              color: i === step ? a1 : P.muted,
              boxShadow: i === step ? `0 0 24px ${hexA(a1, 0.25)}` : "none",
            }}
          >
            {s}
          </div>
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          left: PAD,
          top: 240,
          width: 2240,
          height: 1,
          background: P.soft,
        }}
      />

      <div
        style={{
          position: "absolute",
          left: PAD,
          top: 276,
          width: boxW,
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
        }}
      >
        <div style={{ font: `700 25px ${F}`, color: P.ink }}>
          Descripción de la oferta
        </div>
        <div style={{ font: `500 19px ${M}`, color: P.muted }}>
          texto sin formato
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: boxLeft,
          top: boxTop,
          width: boxW,
          height: boxH,
          borderRadius: 20,
          background: P.surface,
          boxSizing: "border-box",
          overflow: "hidden",
          border: `2px solid ${focus || analyzing ? hexA(a1, 0.45) : P.line}`,
          boxShadow: analyzing
            ? `0 0 ${30 + 26 * borderGlow}px ${hexA(a1, 0.18 + 0.16 * borderGlow)}, inset 0 0 60px ${hexA(a1, 0.04)}`
            : focus
              ? `0 0 0 6px ${hexA(a1, 0.1)}`
              : "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 18,
            opacity: 1 - clamp((T - (t.paste - 0.2)) / 0.3, 0, 1),
          }}
        >
          <div
            style={{
              width: 96,
              height: 96,
              borderRadius: 22,
              border: `2px dashed ${P.line}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              font: `500 26px ${M}`,
              color: P.muted,
            }}
          >
            ⌘V
          </div>
          <div style={{ font: `600 30px ${F}`, color: P.ink2 }}>
            Pega aquí la descripción de la oferta
          </div>
          <div style={{ font: `500 23px ${F}`, color: P.muted }}>
            Detectamos requisitos, habilidades y experiencia automáticamente
          </div>
        </div>
        <div
          style={{ position: "absolute", left: 48, top: 40, width: boxW - 96 }}
        >
          {DOC.rows.map((r, i) => {
            const app = clamp((pasted * (DOC.rows.length + 5) - i) / 3, 0, 1);
            const txt = r.kind === "h" ? r.text : null;
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: 0,
                  top: i * 40 + r.si * 14,
                  opacity: app,
                  transform: `translateY(${(1 - app) * 10}px)`,
                  whiteSpace: "nowrap",
                }}
              >
                {txt ? (
                  <span style={{ font: `700 24px ${F}`, color: P.ink }}>
                    {txt}
                  </span>
                ) : (
                  <span style={{ font: `400 24px ${F}`, color: P.ink2 }}>
                    {r.kind === "l" && r.bullet ? "·  " : ""}
                    {r.kind === "l" &&
                      r.tokens.map((tk, j) =>
                        typeof tk === "string" ? (
                          <span key={j}>{tk}</span>
                        ) : (
                          <Keyword
                            key={j}
                            T={T}
                            t={t}
                            idx={KW_INDEX[tk.k]}
                            a1={a1}
                          >
                            {tk.k}
                          </Keyword>
                        ),
                      )}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        {scanOn > 0.002 && (
          <>
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: scan * (boxH - 4) - 150,
                height: 150,
                background: `linear-gradient(to bottom, ${hexA(a1, 0)}, ${hexA(a1, 0.1)})`,
                opacity: scanOn,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: scan * (boxH - 4),
                height: 3,
                background: `linear-gradient(90deg, ${hexA(a1, 0)}, ${hexA(a1, 0.95)} 45%, ${hexA(a2, 0.95)} 65%, ${hexA(a1, 0)})`,
                boxShadow: `0 0 28px ${hexA(a1, 0.7)}`,
                opacity: scanOn,
              }}
            />
          </>
        )}
      </div>

      <div
        style={{
          position: "absolute",
          left: boxLeft,
          top: boxTop + boxH + 34,
          width: boxW,
          display: "flex",
          alignItems: "center",
        }}
      >
        <div style={{ font: `500 21px ${M}`, color: P.muted }}>
          {chars.toLocaleString("es-AR")} caracteres
        </div>
        <div
          style={{
            marginLeft: 22,
            display: "flex",
            alignItems: "center",
            gap: 12,
            opacity: analyzing ? 1 : 0,
          }}
        >
          {done ? <Check size={24} color={a2} /> : <Spinner T={T} a1={a1} />}
          <span style={{ font: `600 21px ${F}`, color: done ? a2 : a1 }}>
            {done ? "Análisis completado" : "Analizando la oferta…"}
          </span>
        </div>
        <div
          style={{
            marginLeft: "auto",
            width: 260,
            height: 60,
            borderRadius: 14,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            font: `700 23px ${F}`,
            background: pasted > 0.5 ? a1 : P.alt,
            border: pasted > 0.5 ? "none" : `1.5px solid ${P.line}`,
            color: pasted > 0.5 ? "#fff" : P.muted,
            boxShadow:
              pasted > 0.5
                ? `0 14px 34px ${hexA(a1, 0.34 + 0.2 * Math.max(0, 1 - Math.abs(T - t.analyzeClick) / 1.2))}`
                : "none",
            transform: `scale(${1 - 0.03 * clamp(1 - Math.abs(T - t.analyzeClick) / 0.18, 0, 1)})`,
          }}
        >
          Analizar oferta
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 1680,
          top: boxTop,
          width: 640,
          height: 1080,
          borderRadius: 20,
          border: `1px solid ${P.line}`,
          background: P.alt,
          padding: 36,
          boxSizing: "border-box",
        }}
      >
        <div style={{ font: `700 25px ${F}`, color: P.ink }}>
          Detectado en la oferta
        </div>
        <div style={{ position: "absolute", left: 36, top: 92, right: 36 }}>
          <div style={{ opacity: 1 - clamp((T - t.det0 + 0.4) / 0.4, 0, 1) }}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} style={{ marginBottom: 34 }}>
                <div
                  style={{
                    width: 140,
                    height: 14,
                    borderRadius: 7,
                    background: P.line,
                  }}
                />
                <div
                  style={{
                    width: 300 - i * 30,
                    height: 20,
                    borderRadius: 10,
                    background: P.soft,
                    marginTop: 12,
                  }}
                />
              </div>
            ))}
          </div>
          {DETECTED.map((d, i) => {
            const at = t.det0 + i * 0.28;
            const p = MOTION.enter(T, at, 0.4);
            return (
              <div
                key={d.l}
                style={{
                  position: "absolute",
                  left: 0,
                  top: i * 68,
                  right: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  opacity: p,
                  transform: `translateY(${(1 - p) * 14}px)`,
                }}
              >
                <Check size={26} color={a2} />
                <div>
                  <div
                    style={{
                      font: `500 18px ${F}`,
                      color: P.muted,
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                    }}
                  >
                    {d.l}
                  </div>
                  <div
                    style={{
                      font: `600 24px ${F}`,
                      color: P.ink,
                      marginTop: 2,
                    }}
                  >
                    {d.v}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <MatchBlock T={T} t={t} a1={a1} a2={a2} />
      </div>
    </WindowShell>
  );
}

function Keyword({
  T,
  t,
  idx,
  a1,
  children,
}: {
  T: number;
  t: Timings;
  idx: number;
  a1: string;
  children: ReactNode;
}) {
  const at = t.kw0 + (idx || 0) * 0.28;
  const p = MOTION.pop(T, at, 0.4);
  const glow = clamp(1 - (T - (at + 0.4)) / 1.1, 0, 1);
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        margin: "0 -4px",
        borderRadius: 8,
        background: hexA(a1, 0.14 * clamp(p, 0, 1)),
        boxShadow:
          p > 0.01
            ? `inset 0 0 0 ${1.6 * clamp(p, 0, 1)}px ${hexA(a1, 0.5)}, 0 0 ${18 * glow + 6}px ${hexA(a1, 0.45 * glow)}`
            : "none",
        color: p > 0.4 ? a1 : P.ink,
        fontWeight: 600,
        transform: `scale(${0.97 + 0.03 * clamp(p, 0, 1)})`,
      }}
    >
      {children}
    </span>
  );
}

function Spinner({ T, a1 }: { T: number; a1: string }) {
  return (
    <div
      style={{
        width: 24,
        height: 24,
        borderRadius: 12,
        border: `3px solid ${hexA(a1, 0.2)}`,
        borderTopColor: a1,
        transform: `rotate(${(T * 420) % 360}deg)`,
      }}
    />
  );
}

function MatchBlock({
  T,
  t,
  a1,
  a2,
}: {
  T: number;
  t: Timings;
  a1: string;
  a2: string;
}) {
  const p = MOTION.enter(T, t.ringStart - 0.5, 0.5);
  if (p <= 0.002) return null;
  const prog = animate({
    from: 0,
    to: 0.87,
    start: t.ringStart,
    end: t.ringEnd,
    ease: Easing.easeOutCubic,
  })(T);
  const r = 86,
    C = 2 * Math.PI * r;
  const cta = MOTION.enter(T, t.cta, 0.45);
  return (
    <div
      style={{
        position: "absolute",
        left: 36,
        right: 36,
        bottom: 36,
        opacity: p,
      }}
    >
      <div style={{ height: 1, background: P.line, marginBottom: 28 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
        <div
          style={{
            position: "relative",
            width: 200,
            height: 200,
            flex: "none",
          }}
        >
          <svg
            width="200"
            height="200"
            viewBox="0 0 200 200"
            style={{
              transform: "rotate(-90deg)",
              filter: `drop-shadow(0 0 16px ${hexA(a2, 0.45 * prog)})`,
            }}
          >
            <circle
              cx="100"
              cy="100"
              r={r}
              fill="none"
              stroke={P.soft}
              strokeWidth="16"
            />
            <circle
              cx="100"
              cy="100"
              r={r}
              fill="none"
              stroke={a2}
              strokeWidth="16"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - prog)}
            />
          </svg>
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                font: `800 56px ${F}`,
                color: P.ink,
                letterSpacing: "-0.03em",
              }}
            >
              {Math.round(prog * 100)}%
            </div>
          </div>
        </div>
        <div>
          <div
            style={{
              font: `700 27px ${F}`,
              color: P.ink,
              letterSpacing: "-0.01em",
            }}
          >
            Coincidencia con tu CV
          </div>
          <div
            style={{
              font: `500 22px ${F}`,
              color: P.muted,
              marginTop: 8,
              lineHeight: 1.35,
            }}
          >
            7 de 8 requisitos
            <br />
            cubiertos por tu perfil
          </div>
        </div>
      </div>
      <div
        style={{
          height: 60,
          borderRadius: 14,
          background: a1,
          color: "#fff",
          font: `700 23px ${F}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginTop: 26,
          opacity: cta,
          transform: `translateY(${(1 - cta) * 12}px)`,
          boxShadow: `0 14px 34px ${hexA(a1, 0.4 * cta)}`,
        }}
      >
        Ver informe completo
      </div>
    </div>
  );
}

type CursorState = {
  v: number;
  x?: number;
  y?: number;
  kind?: "text" | "arrow";
};

function cursorAt(T: number, t: Timings, sel: number): CursorState {
  const jx = (x: number) => x + JOB_O.x,
    jy = (y: number) => y + JOB_O.y;
  const ax = (x: number) => x + APP_O.x,
    ay = (y: number) => y + APP_O.y;
  if (T < t.cursorIn - 0.3) return { v: 0 };
  if (T < t.selStart) {
    return {
      v: clamp((T - (t.cursorIn - 0.3)) / 0.4, 0, 1),
      x: MOTION.glide(
        T,
        [t.cursorIn, t.selStart - 1, t.selStart],
        [jx(1900), jx(420), jx(PAD + 4)],
      ),
      y: MOTION.glide(
        T,
        [t.cursorIn, t.selStart - 1, t.selStart],
        [jy(1440), jy(620), jy(468)],
      ),
      kind: "text",
    };
  }
  if (T < t.selEnd) {
    const i = clamp(Math.floor(sel), 0, DOC.rows.length - 1);
    const r = DOC.rows[i];
    const p = clamp(sel - i, 0, 1);
    return { v: 1, x: jx(r.x + r.w * p + 4), y: jy(r.y + 20), kind: "text" };
  }
  if (T < t.copyClick + 0.5) {
    const last = DOC.rows[DOC.rows.length - 1];
    return {
      v: 1,
      x: MOTION.glide(
        T,
        [t.selEnd, t.selEnd + 0.55],
        [jx(last.x + last.w + 4), jx(870)],
      ),
      y: MOTION.glide(
        T,
        [t.selEnd, t.selEnd + 0.55],
        [jy(last.y + 20), jy(1232)],
      ),
      kind: "arrow",
    };
  }
  if (T < t.copyClick + 1.5) {
    return {
      v: 1 - clamp((T - (t.copyClick + 0.6)) / 0.6, 0, 1),
      x: MOTION.glide(
        T,
        [t.copyClick + 0.5, t.copyClick + 1.5],
        [jx(870), jx(1010)],
      ),
      y: MOTION.glide(
        T,
        [t.copyClick + 0.5, t.copyClick + 1.5],
        [jy(1232), jy(1180)],
      ),
      kind: "arrow",
    };
  }
  if (T < t.pasteFocus - 0.9) return { v: 0 };
  if (T < t.analyzeClick + 0.9) {
    const times = [
      t.pasteFocus - 0.75,
      t.pasteFocus,
      t.pasteFocus + 1.6,
      t.analyzeClick,
      t.analyzeClick + 0.9,
    ];
    return {
      v:
        clamp((T - (t.pasteFocus - 0.85)) / 0.35, 0, 1) *
        (1 - clamp((T - (t.analyzeClick + 0.25)) / 0.6, 0, 1)),
      x: MOTION.glide(T, times, [
        ax(1440),
        ax(700),
        ax(760),
        ax(1430),
        ax(1500),
      ]),
      y: MOTION.glide(T, times, [
        ay(1120),
        ay(720),
        ay(760),
        ay(1300),
        ay(1320),
      ]),
      kind: T < t.pasteFocus + 1.4 ? "text" : "arrow",
    };
  }
  return { v: 0 };
}

function Cursor({
  c,
}: {
  c: { x: number; y: number; v: number; kind?: "text" | "arrow" };
}) {
  if (c.v <= 0.002) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: c.x,
        top: c.y,
        opacity: c.v,
        transform: "translate(-2px,-2px)",
        filter: "drop-shadow(0 4px 10px rgba(4,6,14,0.5))",
      }}
    >
      {c.kind === "text" ? (
        <div
          style={{
            width: 3,
            height: 34,
            background: "#fff",
            borderRadius: 2,
            boxShadow: "0 0 0 1px rgba(10,12,20,0.55)",
          }}
        />
      ) : (
        <svg width="30" height="38" viewBox="0 0 26 34">
          <path
            d="M2 1 L2 26.5 L8.6 20.2 L13.2 32 L18.4 29.8 L13.8 18.3 L22.5 17.8 Z"
            fill="#ffffff"
            stroke="rgba(8,10,16,0.65)"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </div>
  );
}

// `a1` lleva texto sobre blanco en varios sitios: `g4` da 4.9:1 ahi, `g3` (el
// color de la etiqueta "Paso 02") solo 3.4:1. `a2` es el verde ✓ compartido
// con "Verificado contra tu perfil".
const PALETTE: [string, string] = [SOLAR.g4, OK];

function Piece() {
  const { T, CUES, authoredTotal: total } = useComposition();
  const [a1, a2] = PALETTE;

  const C = {
    open: CUES["Apertura"],
    desc: CUES["Descripción"],
    sel: CUES["Selección"],
    copy: CUES["Copiar"],
    trans: CUES["Transición"],
    paste: CUES["Pegar"],
    analyze: CUES["Análisis"],
    match: CUES["Coincidencia"],
  };
  const t: Timings = {
    cursorIn: C.desc + 1.2,
    selStart: C.sel + 0.05,
    selEnd: C.copy - 0.25,
    menuIn: C.copy - 0.2,
    copyClick: C.copy + 0.92,
    toast: C.copy + 1.05,
    pasteFocus: C.paste + 1.15,
    pasteKey: C.paste + 1.5,
    paste: C.paste + 1.8,
    analyzeClick: C.analyze - 0.05,
    kw0: C.analyze + 0.3,
    det0: C.analyze + 0.5,
    scanEnd: C.analyze + 2.9,
    done: C.analyze + 3.2,
    ringStart: C.match + 0.2,
    ringEnd: C.match + 2.4,
    cta: C.match + 2.8,
  };

  const camT = [
    C.open,
    C.desc,
    C.desc + 2.1,
    C.sel,
    C.sel + 2,
    C.sel + 4,
    C.copy + 0.2,
    C.copy + 1.6,
    C.trans,
    C.paste,
    C.paste + 1.6,
    C.analyze,
    C.analyze + 2.1,
    C.analyze + 3.8,
    C.match,
    C.match + 2.2,
    total,
  ];
  const camX = [
    1240, 1240, 1000, 960, 1000, 1040, 1060, 1120, 1240, 3560, 3420, 3440, 3460,
    3860, 3980, 4020, 3800,
  ];
  const camY = [
    740, 760, 620, 580, 780, 1020, 1090, 960, 780, 760, 660, 720, 940, 840, 820,
    960, 780,
  ];
  const camS = [
    0.7, 0.76, 0.92, 1.0, 1.0, 1.02, 1.02, 0.9, 0.74, 0.86, 1.0, 1.02, 1.02,
    0.9, 0.88, 1.0, 0.72,
  ];
  const cam = {
    x: kf(T, camT, camX),
    y: kf(T, camT, camY),
    s: kf(T, camT, camS),
  };
  const w2s = (x: number, y: number) => ({
    x: (x - cam.x) * cam.s + 960,
    y: (y - cam.y) * cam.s + 540,
  });

  const sel = kf(
    T,
    [t.selStart, t.selEnd],
    [0, DOC.rows.length],
    Easing.easeInOutSine,
  );
  const cur = cursorAt(T, t, sel);
  const curS =
    cur.v && cur.x !== undefined && cur.y !== undefined
      ? w2s(cur.x, cur.y)
      : null;
  const clicks = [t.copyClick, t.pasteFocus, t.analyzeClick];

  const chipA = w2s(1010, 1210);
  const chipC = w2s(APP_O.x + PAD + 740, APP_O.y + 520);
  const chipT = [t.copyClick, t.copyClick + 1.3, C.trans + 2.1, t.paste];
  const chip = {
    x: kf(T, chipT, [chipA.x, 960, 960, chipC.x]),
    y: kf(T, chipT, [chipA.y, 300, 300, chipC.y]),
    v:
      MOTION.pop(T, t.copyClick, 0.4) *
      (1 - clamp((T - (t.paste - 0.25)) / 0.35, 0, 1)),
  };

  const toast =
    MOTION.enter(T, t.toast, 0.35) *
    (1 - clamp((T - (t.toast + 1.4)) / 0.4, 0, 1));
  const keyBadge =
    MOTION.pop(T, t.pasteKey, 0.3) *
    (1 - clamp((T - (t.paste + 0.25)) / 0.3, 0, 1));
  const glow = {
    job: 1 - clamp((T - C.trans) / 1.6, 0, 1),
    app: clamp((T - (C.trans + 0.4)) / 1.6, 0, 1),
  };
  const fade = kf(
    T,
    [0, 0.6, total - 0.6, total],
    [1, 0, 0, 1],
    Easing.easeInOutSine,
  );

  return (
    <div
      style={{ position: "absolute", inset: 0, overflow: "hidden", font: F }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 1,
          height: 1,
          transformOrigin: "0 0",
          transform: `translate(960px, 540px) scale(${cam.s}) translate(${-cam.x}px, ${-cam.y}px)`,
        }}
      >
        <JobWindow T={T} t={t} sel={sel} a1={a1} glow={0.5 + 0.5 * glow.job} />
        <AppWindow T={T} t={t} a1={a1} a2={a2} glow={0.35 + 0.65 * glow.app} />
      </div>

      {chip.v > 0.002 && (
        <div
          style={{
            position: "absolute",
            left: chip.x,
            top: chip.y,
            transform: `translate(-50%,-50%) scale(${0.8 + 0.2 * chip.v})`,
            opacity: chip.v,
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: "18px 26px",
            borderRadius: 16,
            background: "rgba(16,19,32,0.82)",
            border: `1px solid ${hexA(a1, 0.45)}`,
            backdropFilter: "blur(14px)",
            boxShadow: `0 24px 60px rgba(2,4,12,0.6), 0 0 40px ${hexA(a1, 0.3)}`,
            whiteSpace: "nowrap",
          }}
        >
          <div
            style={{
              width: 34,
              height: 42,
              borderRadius: 6,
              background: hexA(a1, 0.9),
              display: "flex",
              flexDirection: "column",
              gap: 4,
              padding: 7,
              boxSizing: "border-box",
            }}
          >
            {[1, 0.7, 0.9, 0.5].map((w, i) => (
              <div
                key={i}
                style={{
                  height: 3,
                  width: `${w * 100}%`,
                  background: "rgba(255,255,255,0.85)",
                  borderRadius: 2,
                }}
              />
            ))}
          </div>
          <div>
            <div style={{ font: `700 24px ${F}`, color: "#fff" }}>
              Descripción de la oferta
            </div>
            <div style={{ font: `500 19px ${M}`, color: hexA("#ffffff", 0.6) }}>
              1.482 caracteres · portapapeles
            </div>
          </div>
        </div>
      )}

      {toast > 0.002 && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: 150,
            transform: `translate(-50%, ${(1 - toast) * 16}px)`,
            opacity: toast,
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "16px 26px",
            borderRadius: 999,
            background: "rgba(16,19,32,0.88)",
            border: "1px solid rgba(255,255,255,0.12)",
            backdropFilter: "blur(14px)",
          }}
        >
          <Check size={24} color={a2} />
          <span style={{ font: `600 23px ${F}`, color: "#fff" }}>
            Copiado al portapapeles
          </span>
        </div>
      )}

      {keyBadge > 0.002 && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 190,
            transform: `translate(-50%,0) scale(${0.9 + 0.1 * keyBadge})`,
            opacity: keyBadge,
            display: "flex",
            gap: 10,
          }}
        >
          {["⌘", "V"].map((k) => (
            <div
              key={k}
              style={{
                minWidth: 62,
                height: 62,
                padding: "0 16px",
                borderRadius: 14,
                boxSizing: "border-box",
                background: "rgba(255,255,255,0.95)",
                border: "1px solid rgba(255,255,255,0.6)",
                boxShadow: "0 14px 34px rgba(2,4,12,0.55)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                font: `600 28px ${M}`,
                color: P.ink,
              }}
            >
              {k}
            </div>
          ))}
        </div>
      )}

      {curS && (
        <Cursor c={{ x: curS.x, y: curS.y, v: cur.v, kind: cur.kind }} />
      )}
      {clicks.map((ct, i) => {
        const p = clamp((T - ct) / 0.5, 0, 1);
        if (p <= 0 || p >= 1 || !curS) return null;
        const s = 0.3 + p * 1.5;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: curS.x,
              top: curS.y,
              width: 90,
              height: 90,
              marginLeft: -45,
              marginTop: -45,
              borderRadius: 45,
              border: `2px solid ${hexA(a1, 0.7 * (1 - p))}`,
              background: hexA(a1, 0.12 * (1 - p)),
              transform: `scale(${s})`,
            }}
          />
        );
      })}

      <Captions
        style={{
          left: 0,
          right: 0,
          bottom: 0,
          padding: "160px 12% 54px",
          background:
            "linear-gradient(to top, rgba(4,6,12,0.9) 24%, rgba(4,6,12,0))",
          font: `600 42px ${F}`,
          color: "#f4f5fb",
          letterSpacing: "-0.02em",
          textShadow: "0 2px 20px rgba(0,0,0,0.6)",
        }}
        items={[
          {
            at: C.open + 0.9,
            until: C.desc - 0.2,
            text: "Encontrás la oferta perfecta.",
          },
          {
            at: C.sel + 0.4,
            until: C.copy - 0.6,
            text: "Copiás la descripción completa.",
          },
          {
            at: C.trans + 0.5,
            until: C.paste - 0.2,
            text: "La pegás en cvexact.",
          },
          {
            at: C.analyze + 0.4,
            until: C.analyze + 3.1,
            text: "La IA detecta requisitos y habilidades clave.",
          },
          {
            at: C.match + 0.6,
            until: total - 0.9,
            text: "Y mide tu coincidencia real con la oferta.",
          },
        ]}
      />

      {fade > 0.002 && (
        <div style={{ position: "absolute", inset: 0, opacity: fade }} />
      )}
    </div>
  );
}

export function StepCvexactScene() {
  return (
    <CompositionStage
      width={1920}
      height={1080}
      scenes={SCENES}
      driver={{ kind: "loop", gated: true, threshold: 0.4, start: 1, hold: 2, restartOnEnter: true }}
    >
      <Piece />
    </CompositionStage>
  );
}
