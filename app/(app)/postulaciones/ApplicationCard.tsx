"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge } from "@/components/ui";
import { formatDaysSince } from "@/lib/tracker/format";
import type { TrackerApplication } from "@/lib/tracker/client-types";

const SOURCE_LABEL: Record<string, string> = {
  buscador_interno: "Buscador",
  url: "URL",
  manual: "Manual",
  csv: "CSV",
};

/** Una tarjeta del kanban. `useSortable` le da el drag handle, el transform
 *  durante el arrastre y el soporte de teclado — no hay nada de eso escrito
 *  a mano acá, es lo que dnd-kit resuelve por sí solo. */
export function ApplicationCard({
  application,
  onOpen,
}: {
  application: TrackerApplication;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: application.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        // Space además de Enter: es la activación estándar de un
        // `role="button"`, y sin `preventDefault` scrollearía la página.
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="cursor-grab touch-none border border-rule bg-paper p-3 text-left text-sm wrap-break-word active:cursor-grabbing"
    >
      <p className="text-ink">{application.jobTitle || "Sin título"}</p>
      <p className="mt-0.5 text-ink-2">{application.company || "Empresa sin nombre"}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 font-solar text-xs tracking-widest text-ink-3 uppercase">
        {application.source ? <Badge tone="neutral">{SOURCE_LABEL[application.source] ?? application.source}</Badge> : null}
        {application.cvVersionId ? <Badge tone="good">CV vinculado</Badge> : null}
        <span>{formatDaysSince(application.lastActivityAt)}</span>
      </div>
      {application.location ? <p className="mt-1 text-xs text-ink-3">{application.location}</p> : null}
    </div>
  );
}
