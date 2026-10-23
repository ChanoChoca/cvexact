"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, Badge, Button, Input, SectionTitle, Select, Textarea } from "@/components/ui";
import { Modal } from "@/components/ui/Modal";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/toast";
import { APPLICATION_STATUSES, APPLICATION_STATUS_LABEL, type ApplicationStatus } from "@/lib/tracker/status";
import { FOLLOW_UP_DAYS, GHOSTING_DAYS } from "@/lib/tracker/constants";
import { formatDate, formatSalary } from "@/lib/tracker/format";
import type { TrackerApplication, TrackerContact, TrackerEvent, TrackerReminder } from "@/lib/tracker/client-types";
import type { MutationResult } from "@/lib/tracker/useTracker";

const EVENT_ICON: Record<string, string> = {
  creada: "＋",
  nota: "✎",
  ghosting_detectado: "…",
};

const REMINDER_KIND_LABEL: Record<string, string> = {
  follow_up: "Seguimiento",
  entrevista: "Entrevista",
  custom: "Personalizado",
};

type Detail = {
  application: TrackerApplication;
  events: TrackerEvent[];
  contacts: TrackerContact[];
  reminders: TrackerReminder[];
};

async function fetchDetail(id: string): Promise<Detail | null> {
  const response = await fetch(`/api/tracker/applications/${id}`);
  if (!response.ok) return null;
  return (await response.json()) as Detail;
}

/**
 * Panel lateral del detalle: datos del puesto, timeline en orden
 * cronológico inverso, notas, contactos, el CV vinculado y el link al aviso
 * original. Vive en un `Modal placement="right"`: Escape, un click en el
 * fondo y el botón × cierran los tres por el mismo `onClose`, y el tablero
 * sigue viéndose (aunque ya no es interactivo) detrás mientras se lee.
 */
export function DetailPanel({
  applicationId,
  onClose,
  onChanged,
  onStatusChanged,
  onDelete,
}: {
  applicationId: string;
  onClose: () => void;
  onChanged: () => void;
  /** The person changed the status here, and it was saved: for whoever has something to ask when an application reaches a state (O12). */
  onStatusChanged?: (application: TrackerApplication, from: string | undefined, to: ApplicationStatus) => void;
  onDelete: (ids: string[]) => Promise<MutationResult>;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [reminderDate, setReminderDate] = useState("");
  const [reminderMessage, setReminderMessage] = useState("");
  const toast = useToast();
  const confirm = useConfirm();

  useEffect(() => {
    let cancelled = false;
    void fetchDetail(applicationId).then((d) => {
      if (!cancelled) setDetail(d);
    });
    return () => {
      cancelled = true;
    };
  }, [applicationId]);

  const refresh = async () => {
    const next = await fetchDetail(applicationId);
    if (next) setDetail(next);
    onChanged();
  };

  const changeStatus = async (status: ApplicationStatus) => {
    // El selector explícito del detalle siempre fuerza: es justamente el
    // "cambiar estado" del requerimiento, distinto de arrastrar en el
    // kanban, que sí valida contra la tabla de transiciones antes de pedir
    // confirmación.
    const before = detail?.application;
    const response = await fetch(`/api/tracker/applications/${applicationId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status, force: true }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: "No se pudo cambiar el estado." }));
      toast({ tone: "bad", message: body.error });
      return;
    }
    await refresh();
    if (before) onStatusChanged?.(before, before.status, status);

    // Se ofrece, nunca se crea sola — la persona decide si la quiere.
    if (status === "postulado") {
      toast({
        tone: "info",
        message: `¿Te recordamos hacer seguimiento en ${FOLLOW_UP_DAYS} días?`,
        action: { label: "Sí, avisame", onClick: () => void addFollowUpReminder() },
      });
    }
  };

  const addFollowUpReminder = async () => {
    const dueAt = new Date(Date.now() + FOLLOW_UP_DAYS * 24 * 60 * 60 * 1000);
    const response = await fetch(`/api/tracker/applications/${applicationId}/reminders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dueAt: dueAt.toISOString(), kind: "follow_up" }),
    });
    if (!response.ok) {
      toast({ tone: "bad", message: "No se pudo crear el recordatorio." });
      return;
    }
    toast({ tone: "good", message: `Te vamos a avisar en ${FOLLOW_UP_DAYS} días.` });
    await refresh();
  };

  const addManualReminder = async () => {
    if (!reminderDate) return;
    const response = await fetch(`/api/tracker/applications/${applicationId}/reminders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        dueAt: new Date(reminderDate).toISOString(),
        kind: "custom",
        message: reminderMessage.trim() || undefined,
      }),
    });
    if (!response.ok) {
      toast({ tone: "bad", message: "No se pudo crear el recordatorio." });
      return;
    }
    setReminderDate("");
    setReminderMessage("");
    await refresh();
  };

  const dismissReminder = async (reminderId: string) => {
    const response = await fetch(`/api/tracker/applications/${applicationId}/reminders/${reminderId}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      toast({ tone: "bad", message: "No se pudo descartar el recordatorio." });
      return;
    }
    await refresh();
  };

  const handleDelete = async () => {
    const confirmed = await confirm(
      `¿Eliminar "${detail?.application.jobTitle || "esta postulación"}"? No se puede deshacer.`,
      { title: "Eliminar postulación", confirmLabel: "Eliminar" },
    );
    if (!confirmed) return;
    const result = await onDelete([applicationId]);
    if (!result.ok) {
      toast({ tone: "bad", message: result.error });
      return;
    }
    onClose();
  };

  const addNote = async () => {
    if (!note.trim()) return;
    setSavingNote(true);
    try {
      const response = await fetch(`/api/tracker/applications/${applicationId}/notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: note.trim() }),
      });
      if (!response.ok) {
        toast({ tone: "bad", message: "No se pudo guardar la nota." });
        return;
      }
      setNote("");
      await refresh();
    } finally {
      setSavingNote(false);
    }
  };

  return (
    <Modal open onClose={onClose} placement="right" labelledBy="detail-panel-title" className="max-w-lg p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-solar text-[12.5px] font-bold tracking-[0.18em] text-ink-3 uppercase">Postulación</p>
          <h2 id="detail-panel-title" className="mt-1 text-xl text-ink">
            {detail?.application.jobTitle || "Sin título"}
          </h2>
          <p className="text-ink-2">{detail?.application.company}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Button variant="danger" onClick={() => void handleDelete()}>
            Eliminar
          </Button>
          <button type="button" aria-label="Cerrar" onClick={onClose} className="text-ink-3 hover:text-ink">
            ×
          </button>
        </div>
      </div>

      {!detail ? (
        <p className="mt-6 text-sm text-ink-3">Cargando…</p>
      ) : (
        <div className="mt-6 space-y-6">
          {detail.application.status === "sin_respuesta" ? (
            <Alert tone="neutral">
              Sin respuesta hace {GHOSTING_DAYS} días. Es lo más común: la mayoría de los procesos
              terminan así, sin aviso. Si en realidad seguís en carrera, cambiá el estado de acá abajo.
            </Alert>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={detail.application.status}
              onChange={(e) => void changeStatus(e.target.value as ApplicationStatus)}
            >
              {APPLICATION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {APPLICATION_STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
            {detail.application.cvVersionId ? (
              <>
                <Badge tone="good">CV vinculado</Badge>
                {/* El documento vive sólo en el navegador que lo generó — el
                    id de la postulación es el mismo que el de esa `Application`
                    local cuando el CV se encontró automáticamente al capturar
                    desde Empleos, así que el link resuelve acá si es este el
                    dispositivo, y si no, no rompe: sólo muestra "no encontrado". */}
                <a
                  href={`/cv/${detail.application.id}/print`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs underline underline-offset-4 hover:text-ink"
                >
                  Ver / descargar CV
                </a>
              </>
            ) : (
              <Badge tone="neutral">Sin CV vinculado</Badge>
            )}
          </div>

          <dl className="grid grid-cols-2 gap-3 text-sm text-ink-2">
            <div>
              <dt className="font-solar text-xs tracking-widest text-ink-3 uppercase">Ubicación</dt>
              <dd>{detail.application.location || "—"}</dd>
            </div>
            <div>
              <dt className="font-solar text-xs tracking-widest text-ink-3 uppercase">Modalidad</dt>
              <dd>{detail.application.remote === null ? "—" : detail.application.remote ? "Remoto" : "Presencial"}</dd>
            </div>
            <div>
              <dt className="font-solar text-xs tracking-widest text-ink-3 uppercase">Salario</dt>
              <dd>{formatSalary(detail.application.salaryMin, detail.application.salaryMax, detail.application.currency) || "—"}</dd>
            </div>
            <div>
              <dt className="font-solar text-xs tracking-widest text-ink-3 uppercase">Creada</dt>
              <dd>{formatDate(detail.application.createdAt)}</dd>
            </div>
          </dl>

          <div className="flex flex-wrap items-center gap-4">
            {detail.application.jobUrl ? (
              <a
                href={detail.application.jobUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block underline underline-offset-4 hover:text-ink"
              >
                Abrir aviso original
              </a>
            ) : null}
            {/* Sólo si hay texto capturado — sin él, /postular no tendría con
                qué prellenar el textarea y el link llevaría a lo mismo que
                pegar a mano. */}
            {detail.application.jdText ? (
              <Link
                href={`/postular?desde=${detail.application.id}`}
                className="inline-block underline underline-offset-4 hover:text-ink"
              >
                Generar CV con este aviso →
              </Link>
            ) : null}
          </div>

          <div>
            <SectionTitle>Nota</SectionTitle>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Contacto, feedback, lo que sea…" />
            <Button className="mt-2" variant="secondary" disabled={savingNote || !note.trim()} onClick={() => void addNote()}>
              Agregar nota
            </Button>
          </div>

          {detail.contacts.length > 0 ? (
            <div>
              <SectionTitle>Contactos</SectionTitle>
              <ul className="space-y-1 text-sm text-ink-2">
                {detail.contacts.map((c) => (
                  <li key={c.id}>
                    {c.name} {c.role ? `— ${c.role}` : ""} {c.email ? `· ${c.email}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div>
            <SectionTitle>Recordatorios</SectionTitle>
            {detail.reminders.length > 0 ? (
              <ul className="mb-3 space-y-1 text-sm text-ink-2">
                {detail.reminders.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2">
                    <span>
                      {REMINDER_KIND_LABEL[r.kind] ?? r.kind} — {formatDate(r.dueAt)}
                      {r.message ? `: ${r.message}` : ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => void dismissReminder(r.id)}
                      className="shrink-0 text-xs text-ink-3 hover:text-ink"
                    >
                      Descartar
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex flex-wrap items-end gap-2">
              <Input type="date" value={reminderDate} onChange={(e) => setReminderDate(e.target.value)} />
              <Input
                value={reminderMessage}
                onChange={(e) => setReminderMessage(e.target.value)}
                placeholder="Mensaje (opcional)"
                className="flex-1"
              />
              <Button variant="secondary" disabled={!reminderDate} onClick={() => void addManualReminder()}>
                Agregar
              </Button>
            </div>
          </div>

          <div>
            <SectionTitle>Línea de tiempo</SectionTitle>
            <ul className="space-y-2 text-sm">
              {detail.events.map((e) => (
                <li key={e.id} className="border-b border-rule pb-2">
                  <span className="text-ink-3">{EVENT_ICON[e.eventType] ?? "•"}</span>{" "}
                  <span className="text-ink">
                    {e.toStatus ? APPLICATION_STATUS_LABEL[e.toStatus as ApplicationStatus] ?? e.eventType : e.eventType}
                  </span>{" "}
                  <span className="text-ink-3">— {formatDate(e.occurredAt)}</span>
                  {e.detectedFrom === "email" ? (
                    <Badge tone="info" className="ml-2">
                      detectado por email{e.confidence ? ` · ${Math.round(e.confidence * 100)}%` : ""}
                    </Badge>
                  ) : null}
                  {e.body ? <p className="mt-0.5 text-ink-2">{e.body}</p> : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Modal>
  );
}
