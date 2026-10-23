"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Badge, Button, SectionTitle } from "@/components/ui";
import { CrashGuard } from "@/components/ui/CrashGuard";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/toast";
import {
  APPLICATION_STATUS_LABEL,
  CLOSED_BOARD_STATUSES,
  OPEN_BOARD_STATUSES,
  isValidTransition,
  type ApplicationStatus,
} from "@/lib/tracker/status";
import { positionBetween } from "@/lib/tracker/board";
import { FOLLOW_UP_DAYS } from "@/lib/tracker/constants";
import type { TrackerApplication } from "@/lib/tracker/client-types";
import type { MutationResult } from "@/lib/tracker/useTracker";
import { ApplicationCard } from "./ApplicationCard";

/**
 * El kanban. Cada columna es una zona `useDroppable` que envuelve un
 * `SortableContext` de sus propias tarjetas — soltar sobre una tarjeta
 * reordena, soltar sobre la columna vacía la manda al final.
 *
 * `PointerSensor` con `activationConstraint: { distance: 8 }` (para que un
 * click quieto abra el detalle en vez de arrancar un arrastre por el
 * mínimo temblor del mouse) + `TouchSensor` con
 * `activationConstraint: { delay: 200, tolerance: 8 }` (para no robarle el
 * scroll a un dedo que sólo quería desplazar la página) + `KeyboardSensor`
 * intacto — dnd-kit ya trae el soporte de teclado, no hay que escribirlo.
 */

function Column({
  status,
  applications,
  onOpen,
}: {
  status: ApplicationStatus;
  applications: TrackerApplication[];
  onOpen: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div
      ref={setNodeRef}
      className={`flex min-w-[240px] flex-1 flex-col gap-2 border border-rule p-2 ${isOver ? "bg-paper-2" : "bg-paper"}`}
    >
      <SectionTitle action={<span className="font-mono text-[11px] text-ink-3">{applications.length}</span>}>
        {APPLICATION_STATUS_LABEL[status]}
      </SectionTitle>
      <CrashGuard
        title="No pudimos mostrar esta columna"
        hint="El resto del tablero sigue funcionando."
      >
        <SortableContext items={applications.map((a) => a.id)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-2">
            {applications.map((application) => (
              <ApplicationCard key={application.id} application={application} onOpen={() => onOpen(application.id)} />
            ))}
          </div>
        </SortableContext>
      </CrashGuard>
    </div>
  );
}

export function KanbanBoard({
  applications,
  moveCard,
  onOpen,
}: {
  applications: TrackerApplication[];
  moveCard: (id: string, toStatus: ApplicationStatus, boardPosition: number, force?: boolean) => Promise<MutationResult>;
  onOpen: (id: string) => void;
}) {
  const [showClosed, setShowClosed] = useState(false);
  const confirm = useConfirm();
  const toast = useToast();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const byStatus = useMemo(() => {
    const map = new Map<ApplicationStatus, TrackerApplication[]>();
    for (const status of [...OPEN_BOARD_STATUSES, ...CLOSED_BOARD_STATUSES]) map.set(status, []);
    for (const application of applications) {
      const list = map.get(application.status as ApplicationStatus);
      list?.push(application);
    }
    for (const list of map.values()) list.sort((a, b) => a.boardPosition - b.boardPosition);
    return map;
  }, [applications]);

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;

    const application = applications.find((a) => a.id === active.id);
    if (!application) return;

    const overIsColumn = byStatus.has(over.id as ApplicationStatus);
    const toStatus = (overIsColumn ? over.id : applications.find((a) => a.id === over.id)?.status) as
      | ApplicationStatus
      | undefined;
    if (!toStatus) return;

    const columnItems = (byStatus.get(toStatus) ?? []).filter((a) => a.id !== application.id);
    const overIndex = overIsColumn ? columnItems.length : columnItems.findIndex((a) => a.id === over.id);
    const before = overIndex > 0 ? columnItems[overIndex - 1].boardPosition : null;
    const after = overIndex >= 0 && overIndex < columnItems.length ? columnItems[overIndex].boardPosition : null;
    const boardPosition = positionBetween(before, after) ?? (after ?? before ?? 0) + 1;

    if (toStatus === application.status) {
      await moveCard(application.id, toStatus, boardPosition);
      return;
    }

    if (!isValidTransition(application.status as ApplicationStatus, toStatus)) {
      const confirmed = await confirm(
        `"${APPLICATION_STATUS_LABEL[application.status as ApplicationStatus]}" a "${APPLICATION_STATUS_LABEL[toStatus]}" no es un movimiento habitual. ¿Forzarlo igual?`,
        { title: "Cambio de estado inusual", confirmLabel: "Forzar" },
      );
      if (!confirmed) return;
      const result = await moveCard(application.id, toStatus, boardPosition, true);
      if (!result.ok) toast({ tone: "bad", message: result.error });
      else if (toStatus === "postulado") offerFollowUp(application.id);
      return;
    }

    const result = await moveCard(application.id, toStatus, boardPosition);
    if (!result.ok) toast({ tone: "bad", message: result.error });
    else if (toStatus === "postulado") offerFollowUp(application.id);
  }

  /** Se ofrece, nunca se crea sola — la persona decide si la quiere. Mismo
   *  umbral (`FOLLOW_UP_DAYS`) que el selector de estado explícito del
   *  detalle (`DetailPanel.tsx`); arrastrar una tarjeta al kanban es la
   *  forma más común de llegar a "postulado", así que la oferta tiene que
   *  vivir acá también, no sólo ahí. */
  function offerFollowUp(applicationId: string) {
    toast({
      tone: "info",
      message: `¿Te recordamos hacer seguimiento en ${FOLLOW_UP_DAYS} días?`,
      action: {
        label: "Sí, avisame",
        onClick: () => {
          const dueAt = new Date(Date.now() + FOLLOW_UP_DAYS * 24 * 60 * 60 * 1000);
          void fetch(`/api/tracker/applications/${applicationId}/reminders`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ dueAt: dueAt.toISOString(), kind: "follow_up" }),
          }).then((r) => {
            toast({ tone: r.ok ? "good" : "bad", message: r.ok ? `Te vamos a avisar en ${FOLLOW_UP_DAYS} días.` : "No se pudo crear el recordatorio." });
          });
        },
      },
    });
  }

  return (
    <div className="space-y-4">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void handleDragEnd(e)}>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {OPEN_BOARD_STATUSES.map((status) => (
            <Column key={status} status={status} applications={byStatus.get(status) ?? []} onOpen={onOpen} />
          ))}
        </div>

        <div>
          <Button variant="ghost" onClick={() => setShowClosed((v) => !v)}>
            {showClosed ? "Ocultar cerrados" : "Mostrar cerrados"}{" "}
            <Badge tone="neutral">{CLOSED_BOARD_STATUSES.reduce((n, s) => n + (byStatus.get(s)?.length ?? 0), 0)}</Badge>
          </Button>
          {showClosed ? (
            <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
              {CLOSED_BOARD_STATUSES.map((status) => (
                <Column key={status} status={status} applications={byStatus.get(status) ?? []} onOpen={onOpen} />
              ))}
            </div>
          ) : null}
        </div>
      </DndContext>
    </div>
  );
}
