import type { ReactNode } from "react";
import { TEMPLATE_SECTION_TITLES } from "@/lib/schemas/cv";
import { APPLICATION_STATUS_LABEL, type ApplicationStatus } from "@/lib/tracker/status";

/**
 * Four small cards between the parts of «de cero», each saying what the profile that is being filled in is for. They are not a step and
 * hold nothing to press: a drawing, what it shows in words, and nothing the person has to do.
 *
 * Everything they say is true of the product as it is, and was checked against the code it speaks of (`tests/illustrations.test.ts`
 * keeps it so): «Tiempo» against `build-cv` (it reads the posting, rewrites, cuts and orders) and «ATS» against `CVDocument` (one column,
 * the template's own headings) and `build-cv` (the posting's words only where the profile has them); «Respuestas» against what
 * `answer-questions` is given and what it checks; «Tu semana» against the tracker's own states and what it does with an account.
 * Nothing in them is a number or a promise: «3x más entrevistas» is a claim about someone else's hiring, and the product has no
 * way to know it.
 *
 * The drawings are shapes only, abstract on purpose like `StepArt`; the words are the page's, so they wrap, scale and are read.
 */

const LINE = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;
/** What is the person's own, and what the page is about. */
const MINE = "stroke-solar-g4";
const ART = "mx-auto h-auto w-full max-w-xs text-ink-3";

/** What each step looks like, around (0, 0): the same few marks wherever a step is drawn. */
const GLYPH = {
  read: "M-8-5h16M-8 0h16M-8 5h9",
  write: "M-6 3L3-6l4 4-9 9-5 1z",
  cut: "M-5-7L6 5M5-7L-6 5M-9 6.5a2 2 0 1 0 4 0 2 2 0 1 0-4 0M5 6.5a2 2 0 1 0 4 0 2 2 0 1 0-4 0",
  order: "M-4 7V-7m-3.5 3.5L-4-7l3.5 3.5M4-7V7m-3.5-3.5L4 7l3.5-3.5",
  paste: "M-6-5h12v13h-12zM-3-8h6v4h-6zM-3 1h6M-3 4.5h4",
  check: "M-7 0l4.5 5L7-5",
} as const;
type Glyph = keyof typeof GLYPH;

/** The drawing beside the words where the card is wide enough for both, and above them where it is not: by the card's own width, because the same card sits in a wide column and in a narrow one beside the view of the profile. */
function Frame({ id, kicker, title, art, children }: { id: string; kicker: string; title: string; art: ReactNode; children: ReactNode }) {
  return (
    <figure data-illustration={id} className="@container border border-l-2 border-rule border-l-solar-g4 bg-paper-2 p-4 sm:p-5">
      <figcaption>
        <span className="block font-solar text-[12.5px] font-bold tracking-[0.18em] text-ink-3 uppercase">{kicker}</span>
        <span className="mt-1 block text-[17px] text-ink">{title}</span>
      </figcaption>
      <div className="mt-3 grid items-center gap-4 @min-[36rem]:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] @min-[36rem]:gap-6">
        {art}
        <div className="space-y-3 text-sm text-ink-2">{children}</div>
      </div>
    </figure>
  );
}

/** The same steps as the drawing counts them, in the order they are done. */
function Steps({ label, items, mine }: { label: string; items: readonly string[]; mine?: boolean }) {
  return (
    <div>
      <p className={`font-solar text-[12.5px] font-bold tracking-[0.18em] uppercase ${mine ? "text-ink" : "text-ink-3"}`}>
        <span aria-hidden className={`mr-2 inline-block h-0.5 w-3 align-middle ${mine ? "bg-solar-g4" : "bg-ink-3"}`} />
        {label}
      </p>
      <ol className="mt-1.5 list-decimal space-y-1 pl-5 marker:text-ink-3">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ol>
    </div>
  );
}

/** A heading of the CV as the CV prints it, which is how the template's words are told apart from ours. */
function Heading({ children }: { children: ReactNode }) {
  return <span className="mt-1 mr-1 inline-block border border-white/15 px-1.5 py-0.5 font-solar text-[11.5px] leading-tight tracking-widest whitespace-nowrap text-ink">{children}</span>;
}

/** A row of steps with what is no longer done drawn as the space it leaves: by hand there are four, here there are two. */
function TimeArt() {
  const byHand: Glyph[] = ["read", "write", "cut", "order"];
  const here: Glyph[] = ["paste", "check"];
  const at = (i: number) => 8 + i * 78;
  const row = (glyphs: Glyph[], y: number, mine: boolean) =>
    glyphs.map((glyph, i) => (
      <g key={glyph} transform={`translate(${at(i)} ${y})`} {...LINE} className={mine ? MINE : undefined}>
        <rect width="64" height="30" rx="2" className={mine ? "fill-solar-g4/15" : undefined} />
        <path d={GLYPH[glyph]} transform="translate(32 15)" />
        {i < glyphs.length - 1 ? <path d="M68 11l4 4-4 4" /> : null}
      </g>
    ));
  return (
    <svg viewBox="0 0 320 100" aria-hidden className={ART}>
      {row(byHand, 6, false)}
      {row(here, 62, true)}
      {[2, 3].map((i) => (
        <rect key={i} x={at(i)} y="62" width="64" height="30" rx="2" {...LINE} strokeDasharray="3 4" opacity="0.3" />
      ))}
    </svg>
  );
}

export function TimeIllustration() {
  return (
    <Frame id="tiempo" kicker="Tiempo" title="Un CV a medida para cada aviso" art={<TimeArt />}>
      <div className="grid grid-cols-2 gap-4">
        <Steps label="A mano" items={["Leés el aviso", "Reescribís tu CV", "Recortás lo que sobra", "Reordenás lo que importa"]} />
        <Steps label="Con tu perfil" items={["Pegás el aviso", "Revisás lo que armamos"]} mine />
      </div>
      <p className="text-ink-3">Lo que cargás ahora es lo que usamos en cada aviso.</p>
    </Frame>
  );
}

/** The page of a CV as `CVDocument` lays it out: a name and a contact line over a rule, a summary, headings over rules, entries with the place and the dates at the right. */
function AtsArt() {
  /** Each line of the bullets, by where it sits and how far it runs. */
  const bullets: ReadonlyArray<readonly [y: number, length: number]> = [[76, 84], [81, 84], [86, 60], [104, 84]];
  return (
    <svg viewBox="0 0 320 150" aria-hidden className={ART}>
      <g transform="translate(106 4)">
        <rect width="108" height="142" rx="1.5" {...LINE} />
        <path d="M34 14h40" {...LINE} strokeWidth="3.5" />
        <path d="M26 22h56M9 35h90M9 40h74M9 68h22M9 132h24" {...LINE} strokeWidth="1" opacity="0.55" />
        <path d="M9 27.5h90M9 55h90M9 119h90" {...LINE} strokeWidth="0.75" opacity="0.6" />
        <path d="M9 51h40M9 115h28" {...LINE} strokeWidth="2.5" className={MINE} />
        <path d="M9 63h30M9 96h26M9 127h36" {...LINE} strokeWidth="2" />
        <path d="M77 63h22M82 96h17M82 127h17" {...LINE} strokeWidth="1" opacity="0.55" />
        <rect x="40" y="78" width="26" height="6" className="fill-solar-g4/45" />
        <g {...LINE} strokeWidth="1" opacity="0.7">
          {bullets.map(([y, length]) => (
            <path key={y} d={`M11 ${y}h.01M15 ${y}h${length}`} />
          ))}
        </g>
      </g>
      {/* 1 — one column, read from the top down. */}
      <g {...LINE} className={MINE}>
        <circle cx="84" cy="20" r="8" />
        <path d="M84 32V130m-4-6l4 6 4-6" />
      </g>
      {/* 2 — the headings. 3 — a word of the posting, where the experience has it. */}
      <g {...LINE} className={MINE}>
        {[55, 85, 119].map((y) => (
          <g key={y}>
            <path d="M216 0h14" transform={`translate(0 ${y})`} />
            <circle cx="238" cy={y} r="8" />
          </g>
        ))}
      </g>
      <g className="fill-ink text-[10px]" textAnchor="middle">
        <text x="84" y="23.5">1</text>
        <text x="238" y="58.5">2</text>
        <text x="238" y="88.5">3</text>
        <text x="238" y="122.5">2</text>
      </g>
    </svg>
  );
}

export function AtsIllustration() {
  return (
    <Frame id="ats" kicker="Sistemas de selección (ATS)" title="Un CV que un ATS puede leer en orden" art={<AtsArt />}>
      <ol className="list-decimal space-y-1.5 pl-5 marker:text-ink-3">
        <li>Una sola columna, de arriba hacia abajo</li>
        <li>
          Los títulos de siempre: <Heading>{TEMPLATE_SECTION_TITLES.es?.experience}</Heading> <Heading>{TEMPLATE_SECTION_TITLES.es?.education}</Heading>
        </li>
        <li>Las palabras del aviso, donde son ciertas en tu experiencia</li>
      </ol>
      <p className="text-ink-3">Si el aviso pide algo que tu perfil no tiene, no lo escribimos en el CV: queda marcado en «Qué pide el puesto».</p>
    </Frame>
  );
}

/** What was loaded, becoming the answers to a form: one of them drawn as a draft to check, because the profile does not say. */
function AnswersArt() {
  return (
    <svg viewBox="0 0 320 104" aria-hidden className={ART}>
      <rect x="8" y="6" width="100" height="92" rx="2" {...LINE} />
      {[24, 52, 80].map((y) => (
        <g key={y}>
          <circle cx="22" cy={y} r="3" className="fill-solar-g4" />
          <path d={`M32 ${y - 3}h50`} {...LINE} strokeWidth="2" />
          <path d={`M32 ${y + 5}h36`} {...LINE} strokeWidth="1" opacity="0.55" />
        </g>
      ))}
      <path d="M118 52h30m-6-5l6 5-6 5" {...LINE} strokeWidth="2" className={MINE} />
      {[6, 38, 70].map((y, i) => (
        <g key={y}>
          <rect x="160" y={y} width="152" height="28" rx="2" {...LINE} {...(i === 2 ? { strokeDasharray: "3 4", className: MINE } : {})} />
          <path d={`M170 ${y + 10}h${i === 2 ? 100 : 118}M170 ${y + 18}h${i === 2 ? 60 : 86}`} {...LINE} strokeWidth="1" opacity="0.55" />
        </g>
      ))}
      <g {...LINE} className={MINE}>
        <circle cx="296" cy="84" r="7" />
        <path d="M296 80.5v4M296 88h.01" strokeWidth="2" />
      </g>
    </svg>
  );
}

export function AnswersIllustration() {
  return (
    <Frame id="respuestas" kicker="Respuestas" title="Las preguntas del formulario, con lo que ya cargaste" art={<AnswersArt />}>
      <div className="grid grid-cols-2 gap-4">
        <Steps label="A mano" items={["Leés la pregunta", "Buscás qué contar", "La escribís de cero"]} />
        <Steps label="Con tu perfil" items={["Pegás las preguntas", "Las respondemos con tu experiencia", "Revisás y copiás"]} mine />
      </div>
      <p className="text-ink-3">Los años de experiencia se cuentan con tus fechas. Lo que tu perfil no dice queda marcado como borrador, para que lo revises.</p>
    </Frame>
  );
}

/** The columns of the board as the tracker has them, with what a real one looks like: more at the start than at the end, and none at the offer yet. */
const BOARD: ReadonlyArray<{ status: ApplicationStatus; cards: number }> = [
  { status: "postulado", cards: 2 },
  { status: "en_revision", cards: 1 },
  { status: "entrevista", cards: 1 },
  { status: "oferta", cards: 0 },
];

function WeekArt() {
  return (
    <svg viewBox="0 0 320 112" aria-hidden className={ART}>
      {BOARD.map(({ status, cards }, column) => {
        const x = 8 + column * 80;
        return (
          <g key={status} transform={`translate(${x} 6)`}>
            <rect width="68" height="100" rx="2" {...LINE} opacity="0.5" />
            <path d="M8 12h30" {...LINE} strokeWidth="2.5" />
            {cards === 0 ? <rect x="6" y="24" width="56" height="22" rx="2" {...LINE} strokeDasharray="3 4" opacity="0.3" /> : null}
            {Array.from({ length: cards }, (_, card) => (
              <g key={card} transform={`translate(6 ${24 + card * 26})`}>
                <rect width="56" height="22" rx="2" {...LINE} />
                <path d="M6 8h28" {...LINE} strokeWidth="1.5" />
                <path d="M6 15h18" {...LINE} strokeWidth="1" opacity="0.55" />
                {status === "postulado" && card === 0 ? (
                  <path d="M-4 3h8c-1.2-1-1.6-2-1.6-4.4a2.4 2.4 0 0 0-4.8 0C-2.4 1-2.8 2-4 3zM-1.2 5.4a1.3 1.3 0 0 0 2.4 0" transform="translate(46 8)" {...LINE} strokeWidth="1.2" className={MINE} />
                ) : null}
              </g>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

export function WeekIllustration() {
  const columns = BOARD.map(({ status }) => APPLICATION_STATUS_LABEL[status]).join(", ");
  return (
    <Frame id="semana" kicker="Tu semana" title="Cada postulación, en su estado" art={<WeekArt />}>
      <ul className="list-disc space-y-1.5 pl-5 marker:text-ink-3">
        <li>Cada una en su columna: {columns}</li>
        <li>Un recordatorio para hacer seguimiento, si lo querés</li>
        <li>Si pasan semanas sin novedades, la marcamos «{APPLICATION_STATUS_LABEL.sin_respuesta}»</li>
        <li>Cuántas postulaciones hiciste cada semana, en Métricas</li>
      </ul>
      <p className="text-ink-3">El tablero, los recordatorios y las métricas piden una cuenta.</p>
    </Frame>
  );
}
