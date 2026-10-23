"use client";

import { useState } from "react";

/** `icon` is the stroke of a 24×24 glyph, drawn like the app's others (`app/(app)/TabIcons.tsx`): no library, one path. */
type Tip = { title: string; body: string; icon: string; example?: { worse: string; better: string } };

// Only what the person can do and the app cannot do for them: the order of the sections, the sheets, the file's name and the posting's own words are the generator's and the template's.
// The icons say their tip, in order: a rising line, a question, a bulb, a bolt, layers, a check, scissors, a group, a link, bars, sparks, a speech bubble.
const TIPS: readonly Tip[] = [
  {
    title: "Mostrá resultados, no tareas.",
    icon: "M22 7l-8.5 8.5-5-5L2 17M16 7h6v6",
    body: "Que cada puesto tenga al menos una línea con lo que lograste: qué mejoraste, qué resolviste o qué pusiste a andar. Si tenés el número, ponelo; si no, contá el alcance: cuántas personas, clientes o sucursales.",
    example: {
      worse: "Responsable de atención al cliente.",
      better: "Atendí unos 60 clientes por día y bajé a la mitad los reclamos por cambios con una guía de talles.",
    },
  },
  {
    title: "Explicá lo que puede generar dudas.",
    icon: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01",
    body: "Una pausa, un puesto corto o un cambio de rumbo sin explicar dejan que quien lee saque sus propias conclusiones. Alcanza con una línea breve, como «Pausa por cuidado familiar».",
    example: {
      worse: "Recepcionista, marzo – mayo de 2022.",
      better: "Recepcionista, marzo – mayo de 2022. El área se cerró en una reestructuración.",
    },
  },
  {
    title: "Mostrá cómo usaste lo que sabés.",
    icon: "M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5M9 18h6M10 22h4",
    body: "Nombrar una habilidad no alcanza: contá dónde la usaste, qué resultado tuvo y por qué le sirve al puesto al que te postulás.",
    example: {
      worse: "Coordiné reuniones semanales con los encargados de cada sucursal.",
      better: "Coordiné a los encargados de 6 sucursales para resolver faltantes de stock y bajé los quiebres un 20%.",
    },
  },
  {
    title: "Empezá cada línea con un verbo que diga qué hiciste.",
    icon: "M13 2L3 14h9l-1 8 10-12h-9l1-8z",
    body: "Quien lee mira primero la primera palabra de cada línea. «Ayudé», «apoyé» o «trabajé en» hacen que tu parte parezca secundaria, aunque no lo haya sido. Elegí el verbo que describe lo que de verdad hiciste.",
    example: {
      worse: "Trabajé en el cambio de sistema de facturación.",
      better: "Lideré el cambio de sistema de facturación en 3 locales sin cortar la atención.",
    },
  },
  {
    title: "Mostrá más de un tipo de fortaleza.",
    icon: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
    body: "Si todo tu CV muestra lo mismo, tu perfil se ve incompleto. Cuando las tengas, combiná tres: lo que sabés hacer, lo que lograste para el negocio y cómo guiaste a otras personas.",
    example: {
      worse: "Creé una planilla de reportes de ventas.",
      better: "Creé un tablero de ventas que usan 12 vendedores y les ahorra 3 horas por semana. Capacité al resto del equipo para usarlo.",
    },
  },
  {
    title: "Respaldá cada habilidad con algo que hiciste.",
    icon: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8.5 12.5l2.5 2.5 4.5-5",
    body: "Nombrar «liderazgo», «trabajo en equipo» o una herramienta no la demuestra. Las que más le importan al puesto tienen que aparecer en un trabajo, un proyecto o un resultado.",
  },
  {
    title: "Sacá las frases que podrían ser de cualquiera.",
    icon: "M9 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12",
    body: "«Busco nuevos desafíos», «orientado a resultados», «proactivo»: si una línea podría estar en el CV de cualquiera, no dice nada de vos. Cambiala por un problema que resolviste y cómo lo hiciste.",
    example: {
      worse: "Persona proactiva, con excelente capacidad para trabajar en equipo.",
      better: "Organicé los turnos de 8 personas en temporada alta sin pagar horas extra.",
    },
  },
  {
    title: "Lo que hiciste fuera del trabajo también cuenta.",
    icon: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
    body: "Si tenés poca experiencia, un centro de estudiantes, un voluntariado, un proyecto propio o unas clases que diste muestran iniciativa. Enseñar, además, muestra que sabés explicar lo que sabés.",
  },
  {
    title: "Poné el link de tus proyectos.",
    icon: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
    body: "Si tenés poca experiencia laboral, un proyecto que se puede abrir suele decir más que un certificado: un portfolio, una web publicada o un repositorio.",
  },
  {
    title: "Ordená tus habilidades por cuánto las dominás.",
    icon: "M3 14h5v7H3zM9.5 9h5v12h-5zM16 4h5v17h-5z",
    body: "Una lista larga sin orden no deja ver en qué sos fuerte. Poné primero lo que más usás y, aparte, lo que conocés poco: por ejemplo, Excel avanzado y SAP como principales, y Power BI en nivel básico. En tu perfil podés marcar el nivel de cada una.",
  },
  {
    title: "Usá la IA para decirlo mejor, no para inventar.",
    icon: "M11 3c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7zM19 15v4M17 17h4",
    body: "Sirve para que tus líneas se entiendan mejor y sean más breves. Revisá que no ponga logros, cifras ni habilidades que no tenés, y que el texto siga sonando a vos y no a cualquiera.",
  },
  {
    title: "Asegurate de poder explicar cada línea.",
    icon: "M7.9 20A9 9 0 1 0 4 16.1L2 22z",
    body: "Tu CV es el comienzo de una conversación en la entrevista. Antes de mandarlo, leelo entero: cada dato tiene que ser cierto y tenés que poder contarlo con detalle.",
  },
];

const REFRESH = "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5";

function Glyph({ d, className }: { d: string; className: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d={d} />
    </svg>
  );
}

/**
 * A tip under the wait for a CV: a new one each time a wait starts, since it mounts with it, and another when the person asks.
 * It does not rotate by itself: a text that changes while someone reads it is not theirs to finish.
 */
export function GenerationTip() {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * TIPS.length));
  const tip = TIPS[index];

  return (
    <div className="liquid-glass mt-5 max-w-prose space-y-4 p-5 sm:p-6">
      <div className="flex items-center justify-between gap-4">
        <p className="font-solar text-[12.5px] font-bold tracking-[0.18em] text-ink/80 uppercase">Consejo</p>
        <button
          type="button"
          onClick={() => setIndex((i) => (i + 1) % TIPS.length)}
          className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3.5 py-1.5 font-solar text-xs font-bold tracking-[0.18em] text-ink uppercase transition-colors hover:bg-white/20 pointer-coarse:min-h-11 motion-reduce:transition-none"
        >
          <Glyph d={REFRESH} className="size-4" />
          Otro consejo
        </button>
      </div>
      <div aria-live="polite" aria-atomic="true" className="space-y-3 text-sm leading-relaxed">
        <div className="flex items-center gap-3.5">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full border border-white/25 bg-white/10 text-ink shadow-[inset_0_1px_1px_rgb(255_255_255/0.5)]">
            <Glyph d={tip.icon} className="size-6" />
          </span>
          <p className="text-[15px] font-bold text-ink">{tip.title}</p>
        </div>
        <p className="text-ink/90">{tip.body}</p>
        {tip.example ? (
          <div className="space-y-1 border-l-2 border-white/25 pl-3">
            <p className="text-ink/75">Peor: {tip.example.worse}</p>
            <p className="text-ink">Mejor: {tip.example.better}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
