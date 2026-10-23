"use client";

import type { ReactNode } from "react";
import { CompositionStage, Easing, animate, clamp, interpolate, useComposition, type Scene } from "../composition";

/**
 * Based on the project's design reference `CVExact hero design/cv-tres.html` ("Tres CVs distintos" — the
 * final CTA visual). Fixed camera, three résumés tossed onto a surface, each
 * a different visual language. All three were in English (Copenhagen,
 * Berlin, London) — localized to three different Argentine cities, keeping
 * the point of the scene: three genuinely different people and CVs.
 */

/*
 * 5.45 s. Cada carta tarda ~1.95 s en asentarse (`TRAVEL` de vuelo + el rebote
 * de `MOTION.settle` + la rampa de sombra `p`), asi que estos cues son huecos,
 * no duracion de gesto: cada una despega 0.4 s despues de que aterrizo la
 * anterior. El vuelo en si no se toco.
 *
 * No hay cue de cierre. El driver es `replay`, que congela el ultimo frame
 * hasta que el usuario sale de la seccion, asi que la pila terminada ya se ve
 * indefinidamente — un "Hold" autorado solo agregaba tiempo muerto.
 *
 * Los 0.30 s de cola de `Third` (la carta queda quieta en 5.15) no son ese
 * hold: con `prefers-reduced-motion` el frame estatico se congela en
 * `total * 0.95` = 5.18 s, y sin esa cola agarraria la ultima carta a mitad
 * del rebote, torcida.
 */
const SCENES: Scene[] = [
  { name: "Open", dur: 0.4, desc: "Una superficie de estudio vacía y con luz suave se sostiene un instante" },
  { name: "First", dur: 1.4, desc: "El primer CV sube desde abajo del cuadro y se asienta rotado +45 grados" },
  { name: "Second", dur: 1.4, desc: "Un segundo CV, muy distinto, se desliza encima y se asienta a -45 grados" },
  { name: "Third", dur: 2.25, desc: "El último CV sube sobre los otros dos y se asienta perfectamente recto en 0 grados" },
];

const STAGE_W = 1920,
  STAGE_H = 1080;
const CARD_W = 530,
  CARD_H = 750;

const MOTION = {
  toss: (start: number, from: number, to: number, dur: number) => animate({ from, to, start, end: start + dur, ease: Easing.easeOutQuart }),
  settle: (start: number, over: number, target: number) =>
    interpolate([start, start + 0.36, start + 0.66, start + 0.94], [over, target - (over - target) * 0.24, target + (over - target) * 0.07, target], Easing.easeInOutSine),
  drift: (T: number, amp: number, period: number, phase = 0) => amp * Math.sin((T / period + phase) * Math.PI * 2),
};

const TRAVEL = 1.0;

type Target = { i: number; x: number; y: number; z: number; rz: number };

function cardState(T: number, s: number, tgt: Target) {
  const yOver = tgt.y - 34;
  const zOver = tgt.z + 54;
  const rzOver = tgt.rz * 1.075;
  const rxOver = -4.5;
  const xOver = tgt.x * 1.06;

  const land = s + TRAVEL;
  const at = (over: { from: number; to: number }, target: number) => (T < land ? MOTION.toss(s, over.from, over.to, TRAVEL)(T) : MOTION.settle(land, over.to, target)(T));

  const gate = animate({ from: 0, to: 1, start: s + 1.7, end: s + 3.0, ease: Easing.easeInOutSine })(T);
  const i = tgt.i;

  const y = at({ from: 1180, to: yOver }, tgt.y) + gate * MOTION.drift(T, 2.6, 7.5, i * 0.31);
  const x = at({ from: tgt.x * 0.52, to: xOver }, tgt.x) + gate * MOTION.drift(T, 2.0, 9.1, i * 0.44);
  const z = at({ from: tgt.z + 150, to: zOver }, tgt.z);
  const rz = at({ from: tgt.rz * 0.34, to: rzOver }, tgt.rz) + gate * MOTION.drift(T, 0.16, 11.0, i * 0.27);
  const rx = T < land ? MOTION.toss(s, 64, rxOver, TRAVEL)(T) : MOTION.settle(land, rxOver, 0)(T) + gate * MOTION.drift(T, 0.35, 8.3, i * 0.5);
  const ry = T < land ? MOTION.toss(s, tgt.rz > 0 ? 9 : tgt.rz < 0 ? -9 : 4, 0, TRAVEL)(T) : gate * MOTION.drift(T, 0.4, 10.2, 0.2 + i * 0.33);

  const dt = 1 / 60;
  const yPrev = T - dt < land ? MOTION.toss(s, 1180, yOver, TRAVEL)(T - dt) : MOTION.settle(land, yOver, tgt.y)(T - dt);
  const blur = clamp(Math.abs(y - yPrev) * 0.055, 0, 5.5);

  const p = clamp((T - s) / (TRAVEL + 0.95), 0, 1);
  return { x, y, z, rz, rx, ry, blur, p };
}

function Card({ T, start, target, children }: { T: number; start: number; target: Target; children: ReactNode }) {
  const st = cardState(T, start, target);
  const rad = (st.rz * Math.PI) / 180;
  const dBroad = 26 + (1 - st.p) * 62;
  const blurBroad = 40 + (1 - st.p) * 78;
  const aBroad = 0.11 + st.p * 0.05 + target.i * 0.012;
  const dTight = 5 + (1 - st.p) * 12;

  return (
    <div
      style={{
        position: "absolute",
        left: (STAGE_W - CARD_W) / 2,
        top: (STAGE_H - CARD_H) / 2,
        width: CARD_W,
        height: CARD_H,
        transformStyle: "preserve-3d",
        transform: `translate3d(${st.x}px, ${st.y}px, ${st.z}px) rotateX(${st.rx}deg) rotateY(${st.ry}deg) rotateZ(${st.rz}deg)`,
        filter: st.blur > 0.12 ? `blur(${st.blur}px)` : "none",
        borderRadius: 5,
        background: "#fff",
        overflow: "hidden",
        boxShadow: [
          `${dTight * Math.sin(rad)}px ${dTight * Math.cos(rad)}px ${dTight * 2.1}px rgba(24,28,40,${0.13 + st.p * 0.05})`,
          `${dBroad * Math.sin(rad)}px ${dBroad * Math.cos(rad)}px ${blurBroad}px rgba(24,28,40,${aBroad})`,
          `0 0 0 1px rgba(20,24,36,0.045)`,
        ].join(", "),
      }}
    >
      {children}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background: `linear-gradient(${152 - st.rz}deg, rgba(255,255,255,0.42) 0%, rgba(255,255,255,0.06) 38%, rgba(18,22,34,0.035) 76%, rgba(18,22,34,0.075) 100%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          opacity: 0.5,
          background: `linear-gradient(${118 - st.rz}deg, rgba(255,255,255,0) ${28 + MOTION.drift(T, 9, 13, target.i * 0.3)}%, rgba(255,255,255,0.5) ${44 + MOTION.drift(T, 9, 13, target.i * 0.3)}%, rgba(255,255,255,0) ${60 + MOTION.drift(T, 9, 13, target.i * 0.3)}%)`,
        }}
      />
    </div>
  );
}

const Rule = ({ c, m }: { c: string; m?: string | number }) => <div style={{ height: 1, background: c, margin: m || 0 }} />;
const Eyebrow = ({ children, c, s }: { children: ReactNode; c: string; s?: number }) => (
  <div style={{ fontSize: s || 8, letterSpacing: "0.2em", textTransform: "uppercase" as const, fontWeight: 700, color: c }}>{children}</div>
);

// CV 1 — editorial, warm paper, serif. Localizado: Copenhague -> Buenos Aires.
function CVEditorial() {
  const ink = "#221F1A",
    muted = "#6E6659",
    line = "#DFD8C8";
  const accent = "oklch(0.60 0.13 44)";
  const jobs = [
    ["Directora de Diseño", "Kestrel Health · Buenos Aires", "2021 — Presente", "Lidera un equipo de 14 personas en diseño de producto para herramientas clínicas y apps de pacientes."],
    ["Diseñadora Principal", "Northwind Studio", "2017 — 2021", "Construyó el primer lenguaje de diseño compartido del estudio; entregó más de 30 sistemas para clientes."],
    ["Diseñadora Senior", "Atelier Ovo", "2013 — 2017", "Trabajo editorial y de identidad para instituciones culturales de la región."],
  ];
  return (
    <div style={{ width: "100%", height: "100%", boxSizing: "border-box", background: "#F8F5EE", padding: "48px 46px 40px", fontFamily: '"Libre Franklin", system-ui, sans-serif', color: ink, display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <div style={{ fontFamily: '"Instrument Serif", Georgia, serif', fontSize: 46, lineHeight: 0.98, letterSpacing: "-0.015em" }}>
            Elena
            <br />
            Marchetti
          </div>
          <div style={{ marginTop: 12 }}>
            <Eyebrow c={accent} s={8.5}>
              Directora de Diseño
            </Eyebrow>
          </div>
        </div>
        <div style={{ width: 72, height: 72, borderRadius: "50%", flexShrink: 0, background: "repeating-linear-gradient(135deg,#E6E0D2 0 4px,#EFEADF 4px 8px)", boxShadow: "inset 0 0 0 1px #DED6C5" }} />
      </div>
      <Rule c={line} />
      <div style={{ display: "grid", gridTemplateColumns: "1.55fr 1fr", gap: 26, flex: 1, minHeight: 0 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Eyebrow c={muted}>Experiencia</Eyebrow>
          {jobs.map((j, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <div style={{ fontSize: 12, fontWeight: 650, letterSpacing: "-0.005em" }}>{j[0]}</div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8.5, color: muted }}>
                <span>{j[1]}</span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{j[2]}</span>
              </div>
              <div style={{ fontSize: 8.5, lineHeight: 1.6, color: "#4A453C", marginTop: 2 }}>{j[3]}</div>
            </div>
          ))}
          <div style={{ marginTop: "auto", display: "flex", gap: 6, alignItems: "center" }}>
            <div style={{ width: 18, height: 6, background: accent }} />
            <div style={{ width: 5, height: 6, background: "#D9D2C1" }} />
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div>
            <Eyebrow c={muted}>Contacto</Eyebrow>
            <div style={{ marginTop: 8, fontSize: 8.5, lineHeight: 1.85, color: "#4A453C" }}>
              elena@example.com
              <br />
              +54 9 11 0000 0004
              <br />
              Palermo, Buenos Aires
            </div>
          </div>
          <div>
            <Eyebrow c={muted}>Expertise</Eyebrow>
            <div style={{ marginTop: 8 }}>
              {["Sistemas de diseño", "Liderazgo de equipos", "Diseño de servicios", "Tipografía", "Operaciones de investigación"].map((s, i) => (
                <div key={i} style={{ fontSize: 8.5, padding: "6px 0", borderBottom: `1px solid ${line}`, color: "#4A453C" }}>
                  {s}
                </div>
              ))}
            </div>
          </div>
          <div>
            <Eyebrow c={muted}>Educación</Eyebrow>
            <div style={{ marginTop: 8, fontSize: 8.5, lineHeight: 1.7, color: "#4A453C" }}>
              Maestría en Comunicación Visual
              <br />
              <span style={{ color: muted }}>Universidad de Palermo, 2013</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// CV 2 — técnico, sidebar oscuro, mono. Localizado: Berlín -> Córdoba.
function CVTechnical() {
  const ink = "#12151C",
    accent = "oklch(0.66 0.13 245)",
    side = "#26314D",
    accentOnDark = "oklch(0.76 0.12 245)";
  const mono = '"JetBrains Mono", ui-monospace, monospace';
  const sans = '"IBM Plex Sans", system-ui, sans-serif';
  const jobs = [
    ["Staff ML Infrastructure Engineer", "Halcyon AI", "2022 →", "Está a cargo de la plataforma de entrenamiento: scheduler de 4k GPUs, tiering de checkpoints y pipeline de evaluación."],
    ["Senior Backend Engineer", "Origin Data", "2019 — 2022", "Feature store en streaming que sirve 90k rps con p99 de 12 ms."],
    ["Software Engineer", "Telemark Systems", "2016 — 2019", "Runner de jobs distribuido; migró pipelines batch a Kubernetes."],
  ];
  return (
    <div style={{ width: "100%", height: "100%", display: "grid", gridTemplateColumns: "36% 1fr", fontFamily: sans, color: ink, background: "#fff" }}>
      <div style={{ background: side, color: "#F1F4FA", padding: "38px 22px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 22 }}>
        <div style={{ width: 66, height: 66, borderRadius: "50%", background: "repeating-linear-gradient(135deg,#334263 0 4px,#3B4A6E 4px 8px)", boxShadow: "inset 0 0 0 1px #4B5B82" }} />
        <div>
          <div style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.18, letterSpacing: "-0.01em" }}>
            Nicolás
            <br />
            Ferreyra
          </div>
          <div style={{ marginTop: 8, fontFamily: mono, fontSize: 7.5, letterSpacing: "0.08em", color: accentOnDark }}>ML INFRASTRUCTURE</div>
        </div>
        <div>
          <div style={{ fontFamily: mono, fontSize: 7, letterSpacing: "0.16em", color: "#9FADCB" }}>CONTACTO</div>
          <div style={{ marginTop: 8, fontFamily: mono, fontSize: 7.5, lineHeight: 1.9, color: "#DCE3F1" }}>
            n.ferreyra@example.com
            <br />
            github.com/perfil-ejemplo
            <br />
            Córdoba, AR
          </div>
        </div>
        <div>
          <div style={{ fontFamily: mono, fontSize: 7, letterSpacing: "0.16em", color: "#9FADCB" }}>STACK</div>
          <div style={{ marginTop: 9, display: "flex", flexWrap: "wrap", gap: 5 }}>
            {["Go", "Rust", "Python", "CUDA", "Ray", "K8s", "Terraform", "Postgres"].map((s, i) => (
              <div key={i} style={{ fontFamily: mono, fontSize: 7, padding: "3px 6px", borderRadius: 3, background: "#31405F", color: "#E6EBF6", border: "1px solid #43537A" }}>
                {s}
              </div>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontFamily: mono, fontSize: 7, letterSpacing: "0.16em", color: "#9FADCB" }}>IDIOMAS</div>
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            {([
              ["Inglés", 1],
              ["Portugués", 0.8],
              ["Alemán", 0.5],
            ] as Array<[string, number]>).map((l, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontSize: 7.5, color: "#DCE3F1" }}>{l[0]}</div>
                <div style={{ height: 2, background: "#3A4A6E" }}>
                  <div style={{ height: 2, width: `${l[1] * 100}%`, background: accentOnDark }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ padding: "38px 30px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 20 }}>
        <div>
          <Eyebrow c="#8C93A1" s={7.5}>
            Experiencia
          </Eyebrow>
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 15 }}>
            {jobs.map((j, i) => (
              <div key={i}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 600 }}>{j[0]}</div>
                  <div style={{ fontFamily: mono, fontSize: 7, color: "#8C93A1", whiteSpace: "nowrap" }}>{j[2]}</div>
                </div>
                <div style={{ fontSize: 8.5, color: accent, marginTop: 2 }}>{j[1]}</div>
                <div style={{ fontSize: 8.5, lineHeight: 1.6, color: "#4C5462", marginTop: 4 }}>{j[3]}</div>
              </div>
            ))}
          </div>
        </div>
        <Rule c="#E6E9EF" />
        <div>
          <Eyebrow c="#8C93A1" s={7.5}>
            Proyectos destacados
          </Eyebrow>
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 7 }}>
            {([
              ["shardcast", "librería open-source de tensor sharding, 4.1k estrellas"],
              ["kvstack", "paper — cache-aware KV offload, MLSys '24"],
            ] as Array<[string, string]>).map((w, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                <span style={{ fontFamily: mono, fontSize: 8, color: ink }}>{w[0]}</span>
                <span style={{ fontSize: 8, color: "#6B7280" }}>{w[1]}</span>
              </div>
            ))}
          </div>
        </div>
        <Rule c="#E6E9EF" />
        <div>
          <Eyebrow c="#8C93A1" s={7.5}>
            Educación
          </Eyebrow>
          <div style={{ marginTop: 9, fontSize: 8.5, lineHeight: 1.65, color: "#4C5462" }}>
            Maestría en Ciencias de la Computación — UBA, 2016
            <br />
            Ingeniería en Sistemas — UTN, 2014
          </div>
        </div>
      </div>
    </div>
  );
}

// CV 3 — bold contemporáneo, la tarjeta focal. Localizado: Londres -> Rosario.
function CVBold() {
  const ink = "#14171B",
    muted = "#767C86";
  const accent = "oklch(0.60 0.13 158)";
  const grotesk = '"Space Grotesk", system-ui, sans-serif';
  const sans = '"DM Sans", system-ui, sans-serif';
  const jobs = [
    ["2021 —", "VP de Marca y Crecimiento", "Lumen Financial", "Rediseñó la marca de punta a punta y llevó la adquisición paga y orgánica de 3 a 9 mercados."],
    ["2018 — 21", "Directora de Growth Marketing", "Perch", "Multiplicó por 6 los ingresos self-serve en tres años; armó la práctica de lifecycle y experimentación."],
    ["2015 — 18", "Estratega de Marca", "Ferment & Co.", "Posicionamiento y lanzamiento para clientes de suscripción de consumo."],
  ];
  return (
    <div style={{ width: "100%", height: "100%", boxSizing: "border-box", background: "#FCFCFB", padding: "46px 44px 38px", fontFamily: sans, color: ink, display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 18 }}>
        <div>
          <div style={{ fontFamily: grotesk, fontSize: 40, fontWeight: 700, lineHeight: 0.96, letterSpacing: "-0.035em" }}>
            Milagros
            <br />
            Aráoz
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 13 }}>
            <div style={{ width: 26, height: 3, background: accent, borderRadius: 2 }} />
            <div style={{ fontSize: 9.5, fontWeight: 500, color: "#3D434B" }}>Líder de Marca y Crecimiento</div>
          </div>
        </div>
        <div style={{ textAlign: "right", fontSize: 8, lineHeight: 1.85, color: muted }}>
          milagros@example.com
          <br />
          +54 9 11 0000 0005
          <br />
          Rosario, Argentina
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, background: "#E7E9E6", border: "1px solid #E7E9E6", borderRadius: 4, overflow: "hidden" }}>
        {([
          ["11", "años en growth"],
          ["9", "mercados lanzados"],
          ["6×", "ingresos self-serve"],
        ] as Array<[string, string]>).map((s, i) => (
          <div key={i} style={{ background: "#fff", padding: "13px 12px" }}>
            <div style={{ fontFamily: grotesk, fontSize: 21, fontWeight: 700, letterSpacing: "-0.03em" }}>{s[0]}</div>
            <div style={{ fontSize: 7.5, color: muted, marginTop: 3, letterSpacing: "0.02em" }}>{s[1]}</div>
          </div>
        ))}
      </div>
      <div>
        <Eyebrow c={muted} s={7.5}>
          Experiencia
        </Eyebrow>
        <div style={{ marginTop: 13, display: "flex", flexDirection: "column", gap: 15 }}>
          {jobs.map((j, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "64px 1fr", gap: 12 }}>
              <div style={{ fontFamily: grotesk, fontSize: 8, color: muted, paddingTop: 3, letterSpacing: "0.02em" }}>{j[0]}</div>
              <div>
                <div style={{ fontFamily: grotesk, fontSize: 12, fontWeight: 600, letterSpacing: "-0.015em" }}>{j[1]}</div>
                <div style={{ fontSize: 8.5, color: accent, marginTop: 2, fontWeight: 500 }}>{j[2]}</div>
                <div style={{ fontSize: 8.5, lineHeight: 1.6, color: "#565C65", marginTop: 4 }}>{j[3]}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
        <Rule c="#E9EAE7" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
          <div>
            <Eyebrow c={muted} s={7.5}>
              Capacidades
            </Eyebrow>
            <div style={{ marginTop: 9, display: "flex", flexWrap: "wrap", gap: 5 }}>
              {["Posicionamiento", "Lifecycle", "Paid social", "SEO", "Pricing", "Comunicación"].map((c, i) => (
                <div key={i} style={{ fontSize: 7.5, padding: "4px 8px", borderRadius: 20, background: "#F1F3F1", color: "#3D434B" }}>
                  {c}
                </div>
              ))}
            </div>
          </div>
          <div>
            <Eyebrow c={muted} s={7.5}>
              Educación
            </Eyebrow>
            <div style={{ marginTop: 9, fontSize: 8.5, lineHeight: 1.65, color: "#565C65" }}>
              Lic. en Economía y Comunicación
              <br />
              <span style={{ color: muted }}>Universidad de San Andrés, 2014</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Piece() {
  const { T, CUES } = useComposition();
  const spread = 1;
  const targets: Target[] = [
    { i: 0, x: -202 * spread, y: -54 * spread, z: 0, rz: 45 },
    { i: 1, x: 204 * spread, y: 62 * spread, z: 28, rz: -45 },
    { i: 2, x: 0, y: 0, z: 58, rz: 0 },
  ];
  const starts = [CUES.First, CUES.Second, CUES.Third];
  const bodies = [<CVEditorial key="a" />, <CVTechnical key="b" />, <CVBold key="c" />];

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "transparent" }}>
      <div style={{ position: "absolute", inset: 0, perspective: 2400, perspectiveOrigin: "50% 46%" }}>
        <div style={{ position: "absolute", inset: 0, transformStyle: "preserve-3d" }}>
          {targets.map((t, i) => (
            <Card key={i} T={T} start={starts[i]} target={t}>
              {bodies[i]}
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

export function CvTresScene() {
  return (
    <CompositionStage width={STAGE_W} height={STAGE_H} scenes={SCENES} driver={{ kind: "loop", gated: true, threshold: 0.4, hold: 2, restartOnEnter: true }} bg="transparent">
      <Piece />
    </CompositionStage>
  );
}
