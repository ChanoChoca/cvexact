"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Alert, Badge, Button, ButtonLink, Checkbox, PageHeading, Row, Rows, Select } from "@/components/ui";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/toast";
import { DownloadDocxButton } from "@/components/cv/DownloadDocxButton";
import {
  useApplications,
  useApplicationsReady,
  useApplicationsStatus,
  useHydrated,
} from "@/lib/storage/hooks";
import {
  APPLICATION_STATUSES,
  APPLICATION_STATUS_LABEL,
  archiveApplications,
  buildArchive,
  clearApplications,
  deleteApplication,
  deleteApplications,
  dismissLocalOnlyNotice,
  hasSeenLocalOnlyNotice,
  saveApplication,
  type Application,
  type ApplicationStatus,
  type SaveOutcome,
} from "@/lib/storage/local";
import { STORAGE_MESSAGES } from "@/lib/storage/errors";
import { InterviewQuestion, useInterviewQuestion } from "./InterviewQuestion";
import { applicationSize } from "@/lib/storage/applications/normalize";
import { downloadJson, todayStamp } from "@/lib/storage/download";
import { useCopyActions } from "@/components/storage/useCopyActions";
import { backupReminderDue, useBackupReminderState } from "@/lib/storage/backup-reminder";

/** How long a "Borrar" stays reversible before it actually happens. Matches
 * the toast's own display time, so the row and the undo offer disappear
 * together. */
const UNDO_WINDOW_MS = 6000;

/**
 * «Más pesadas primero» exists for one moment: the browser has run out of room
 * and the person wants to know what to let go of. It is also what the «sin
 * guardar» notice links to (`?orden=tamano`), so arriving from there lands on
 * the answer. Nothing is ever removed without being asked.
 */
type Order = "recientes" | "tamano";

function initialOrder(): Order {
  if (typeof window === "undefined") return "recientes";
  return new URLSearchParams(window.location.search).get("orden") === "tamano" ? "tamano" : "recientes";
}

/** For people, not for disk accounting: the stored form's length, rounded. See `applicationSize`. */
function formatSize(chars: number): string {
  if (chars >= 1024 * 1024) return `${(chars / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
  return `${Math.max(1, Math.round(chars / 1024))} KB`;
}

export function ApplicationsList() {
  const applications = useApplications();
  const hydrated = useHydrated();
  const ready = useApplicationsReady();
  const { unsaved } = useApplicationsStatus();
  const reminderState = useBackupReminderState();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | "all">("all");
  const [order, setOrder] = useState<Order>(initialOrder);
  /** Rows mid-undo-window: hidden from the list, not yet actually deleted. */
  const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(new Set());
  const deleteTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [noticeDismissed, setNoticeDismissed] = useState(() => hasSeenLocalOnlyNotice());
  const confirm = useConfirm();
  const copies = useCopyActions();
  const toast = useToast();
  // O12, switched off: when an application reaches the interview, one optional question about what they were asked.
  const interview = useInterviewQuestion();

  // A pending delete is a live timer, not React state — if the person
  // navigates away inside the undo window, the row must still actually go
  // (deleteApplication does not depend on this component being mounted), but
  // the timers themselves have to be cleared so none of them touch state on
  // an unmounted component.
  useEffect(() => {
    const timers = deleteTimers.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, []);

  const sizes = useMemo(
    () => new Map(applications.map((application) => [application.id, applicationSize(application)])),
    [applications],
  );
  const unsavedIds = useMemo(() => new Set(unsaved.map((entry) => entry.id)), [unsaved]);

  // Ready, not merely hydrated: until the browser database has answered, an
  // empty list is "not loaded yet", and «Todavía no generaste ninguna» would be
  // a lie told for a moment on every visit.
  if (!hydrated || !ready) return <p className="text-sm text-ink-3">Cargando…</p>;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const filtered = applications.filter(
    (a) =>
      !pendingDeletes.has(a.id) &&
      (statusFilter === "all" ? true : (a.status ?? "borrador") === statusFilter),
  );
  const visible =
    order === "tamano"
      ? [...filtered].sort((a, b) => (sizes.get(b.id) ?? 0) - (sizes.get(a.id) ?? 0))
      : filtered;

  const allSelected = visible.length > 0 && visible.every((a) => selected.has(a.id));

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(visible.map((a) => a.id)));

  const dropSelection = (ids: string[]) =>
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });

  /** A delete the browser refused comes back into the list (the store puts it back); this says why. */
  const reportFailure = (outcome: SaveOutcome, what: string) => {
    if (!outcome.ok) toast({ tone: "bad", message: `${what} ${STORAGE_MESSAGES[outcome.kind]}` });
  };

  // In memory at once; a browser that refuses to store it marks the row «Sin
  // guardar» instead of losing the change.
  const setStatus = (application: Application, status: ApplicationStatus) => {
    interview.moved({ id: application.id, label: application.label }, application.status ?? "borrador", status);
    void saveApplication({ ...application, status });
  };

  /**
   * The single-row "Borrar" no longer asks first — it hides the row and
   * offers "Deshacer" instead, which is the better shape for a mistake this
   * cheap to reverse. Bulk delete keeps the confirm dialog: undoing eight
   * rows at once from a toast is a worse recovery than not deleting them
   * in the first place.
   */
  const requestDelete = (application: Application) => {
    dropSelection([application.id]);
    setPendingDeletes((prev) => new Set(prev).add(application.id));

    const commit = () => {
      void deleteApplication(application.id).then((outcome) =>
        reportFailure(outcome, "No pudimos borrar la postulación."),
      );
      setPendingDeletes((prev) => {
        const next = new Set(prev);
        next.delete(application.id);
        return next;
      });
      deleteTimers.current.delete(application.id);
    };

    deleteTimers.current.set(application.id, setTimeout(commit, UNDO_WINDOW_MS));

    toast({
      tone: "neutral",
      message: `Borraste «${application.label || "esta postulación"}».`,
      duration: UNDO_WINDOW_MS,
      action: {
        label: "Deshacer",
        onClick: () => {
          const timer = deleteTimers.current.get(application.id);
          if (timer) clearTimeout(timer);
          deleteTimers.current.delete(application.id);
          setPendingDeletes((prev) => {
            const next = new Set(prev);
            next.delete(application.id);
            return next;
          });
        },
      },
    });
  };

  const deleteSelected = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    const ok = await confirm(
      `¿Borrar ${ids.length} postulación${ids.length === 1 ? "" : "es"}? No se puede deshacer.`,
    );
    if (ok) {
      reportFailure(await deleteApplications(ids), "No pudimos borrarlas.");
      dropSelection(ids);
    }
  };

  const deleteAll = async () => {
    if (applications.length === 0) return;
    const ok = await confirm(
      `¿Borrar todas las postulaciones (${applications.length})? No se puede deshacer.`,
    );
    if (ok) {
      reportFailure(await clearApplications(), "No pudimos borrarlas.");
      setSelected(new Set());
    }
  };

  /**
   * «Archivar»: the file first, then — only once the person says they have it —
   * out of this browser. Not a deletion: no tombstones (see
   * `archiveApplications`), and the file goes back in, merged, from Ajustes.
   * Checking that a download actually finished is not something a page can do,
   * which is why the question is asked rather than assumed.
   */
  const archiveSelected = async () => {
    const chosen = applications.filter((application) => selected.has(application.id));
    if (chosen.length === 0) return;
    const ids = chosen.map((application) => application.id);
    downloadJson(`cvexact-archivo-${todayStamp()}.json`, buildArchive(chosen));
    const count = `${chosen.length} ${chosen.length === 1 ? "postulación" : "postulaciones"}`;
    const ok = await confirm(
      `Descargamos un archivo con ${count}. Cuando lo tengas guardado, las quitamos de este navegador para ` +
        "liberar espacio; podés volver a cargarlas cuando quieras desde Ajustes, con «Introducir perfil». " +
        "¿Ya guardaste el archivo?",
      { title: "Archivar postulaciones", confirmLabel: "Sí, quitarlas de este navegador", cancelLabel: "Todavía no" },
    );
    if (!ok) return;
    const outcome = await archiveApplications(ids);
    if (outcome.ok) {
      dropSelection(ids);
      toast({ tone: "good", message: `Archivamos ${count}.` });
    } else {
      reportFailure(outcome, "No pudimos quitarlas de este navegador.");
    }
  };

  const dismissNotice = () => {
    dismissLocalOnlyNotice();
    setNoticeDismissed(true);
  };

  const reminder = backupReminderDue(reminderState, applications);

  return (
    <div className="space-y-10" data-panel="wide">
      <PageHeading
        eyebrow="Historial"
        title="Postulaciones"
        action={
          applications.length > 0 ? (
            <ButtonLink href="/postular" className="px-6 py-3">
              Nueva postulación
            </ButtonLink>
          ) : undefined
        }
      >
        Cada CV que generaste, con el aviso que le dio origen. Se guardan en este
        navegador: bajá una copia desde Ajustes si vas a cambiar de celular o de computadora.
      </PageHeading>

      {/* The periodic reminder takes the place of the one-time tip below
          whenever it is due: both say the same thing, and saying it twice at
          once is how neither gets read. */}
      {reminder.due ? (
        <Alert tone="info" title="Guardá una copia de tus postulaciones">
          Tenés {reminder.newSince}{" "}
          {reminder.newSince === 1 ? "postulación nueva" : "postulaciones nuevas"} desde la última. Todo esto
          vive sólo en este navegador: si se
          borran los datos del sitio, se pierde.
          <span className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => void copies.saveComplete()}>
              Bajar la copia completa
            </Button>
            <Link href="/cuenta" className="text-sm underline underline-offset-4 hover:text-ink">
              Subir a mi cuenta
            </Link>
          </span>
        </Alert>
      ) : applications.length >= 3 && !noticeDismissed ? (
        // Said once, at the point it starts being true for more than a
        // couple of tries — the subtitle above says the same thing on every
        // visit, which is exactly why nobody reads it until it's too late.
        <div className="flex items-start justify-between gap-4 border border-rule bg-paper-2 px-4 py-3 text-sm text-ink-2">
          <p>
            Esto vive solo en este navegador. <Link href="/cuenta" className="underline underline-offset-4 hover:text-ink">Bajate una copia o creá una cuenta para sincronizar</Link> antes de perderlo con un cambio de celular o de computadora, o con un navegador limpio.
          </p>
          <button
            type="button"
            aria-label="Cerrar aviso"
            onClick={dismissNotice}
            className="shrink-0 text-ink-3 hover:text-ink"
          >
            ×
          </button>
        </div>
      ) : null}

      {interview.pending ? <InterviewQuestion key={interview.pending.id} application={interview.pending} onClose={interview.close} /> : null}

      {applications.length === 0 ? (
        <div className="space-y-4 border-t border-b border-rule py-8">
          <p className="text-[14.5px] text-ink-2">
            Todavía no generaste ninguna. Pegá una oferta y armá tu primer CV adaptado.
          </p>
          <ButtonLink href="/postular" className="px-6 py-3">
            Nueva postulación
          </ButtonLink>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule py-2">
            <div className="flex flex-wrap items-center gap-4">
              <Button variant="ghost" onClick={toggleAll}>
                {allSelected ? "Deseleccionar todas" : "Seleccionar todas"}
              </Button>
              {selected.size > 0 ? (
                <span className="font-solar text-xs tracking-widest text-ink-3">
                  {selected.size} seleccionada{selected.size === 1 ? "" : "s"}
                </span>
              ) : null}
              <label className="flex items-center gap-2 font-solar text-xs tracking-widest text-ink-3 uppercase">
                Estado
                <Select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as ApplicationStatus | "all")}
                >
                  <option value="all">Todas ({applications.length})</option>
                  {APPLICATION_STATUSES.map((status) => {
                    const count = applications.filter(
                      (a) => (a.status ?? "borrador") === status,
                    ).length;
                    return (
                      <option key={status} value={status}>
                        {APPLICATION_STATUS_LABEL[status]} ({count})
                      </option>
                    );
                  })}
                </Select>
              </label>
              <label className="flex items-center gap-2 font-solar text-xs tracking-widest text-ink-3 uppercase">
                Orden
                <Select value={order} onChange={(e) => setOrder(e.target.value as Order)}>
                  <option value="recientes">Más recientes</option>
                  <option value="tamano">Más pesadas primero</option>
                </Select>
              </label>
            </div>
            <div className="flex items-center gap-3">
              {selected.size > 0 ? (
                <>
                  <Button variant="secondary" onClick={() => void archiveSelected()}>
                    Archivar seleccionadas
                  </Button>
                  <Button variant="danger" onClick={deleteSelected}>
                    Eliminar seleccionadas
                  </Button>
                </>
              ) : null}
              <Button variant="danger" onClick={deleteAll}>
                Eliminar todas
              </Button>
            </div>
          </div>

          {visible.length === 0 && statusFilter !== "all" ? (
            <p className="border-b border-rule py-8 text-[14.5px] text-ink-2">
              Ninguna postulación en «{APPLICATION_STATUS_LABEL[statusFilter]}».
            </p>
          ) : visible.length > 0 ? (
            <Rows>
              {visible.map((application) => (
                <Row
                  key={application.id}
                  aside={
                    <>
                      {/* The three non-destructive actions stay grouped; "Borrar"
                          sits across a rule of its own so a thumb reaching for
                          "Abrir" on a phone does not land on it by mistake. */}
                      <div className="flex flex-wrap items-center gap-3">
                        {application.cv ? (
                          <>
                            <ButtonLink href={`/cv/${application.id}/print`} target="_blank" variant="secondary">
                              PDF
                            </ButtonLink>
                            <DownloadDocxButton data={application.cv} label={application.label}>
                              Word
                            </DownloadDocxButton>
                          </>
                        ) : null}
                        <ButtonLink href={`/postular?app=${application.id}`} variant="secondary">
                          Abrir
                        </ButtonLink>
                      </div>
                      <Button
                        variant="danger"
                        className="sm:border-l sm:border-l-rule sm:pl-3"
                        onClick={() => requestDelete(application)}
                      >
                        Borrar
                      </Button>
                    </>
                  }
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Checkbox
                      checked={selected.has(application.id)}
                      onChange={() => toggle(application.id)}
                      aria-label={`Seleccionar ${application.label || "postulación sin título"}`}
                      className="cursor-pointer"
                    />
                    {/* El título es la puerta de entrada a la ficha, como lo
                        es en las vistas con sesión: mismo destino que el
                        botón "Abrir", y `<Link>` real para teclado, lector de
                        pantalla y click del medio. */}
                    <Link
                      href={`/postular?app=${application.id}`}
                      className="min-w-0 truncate text-ink underline-offset-4 hover:underline"
                    >
                      {application.label || "Postulación sin título"}
                    </Link>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <span className="font-solar text-xs tracking-widest text-ink-3">
                      {new Date(application.updatedAt).toLocaleDateString("es", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </span>
                    <span
                      className="font-solar text-xs tracking-widest text-ink-3"
                      title="Espacio aproximado que ocupa en este navegador"
                    >
                      ≈ {formatSize(sizes.get(application.id) ?? 0)}
                    </span>
                    {unsavedIds.has(application.id) ? <Badge tone="warn">Sin guardar</Badge> : null}
                    {application.cv ? <Badge tone="good">CV</Badge> : null}
                    {application.answers ? <Badge tone="info">Respuestas</Badge> : null}
                    {application.email ? <Badge tone="info">Email</Badge> : null}
                    {application.interview ? <Badge tone="info">Entrevista</Badge> : null}
                    <label className="ml-auto flex items-center gap-1.5">
                      <span className="sr-only">Estado de la postulación</span>
                      <select
                        value={application.status ?? "borrador"}
                        onChange={(e) =>
                          setStatus(application, e.target.value as ApplicationStatus)
                        }
                        className="border-b border-white/40 bg-transparent py-0.5 font-solar text-xs tracking-widest text-ink-2 uppercase focus:border-ink focus:outline-none"
                      >
                        {APPLICATION_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {APPLICATION_STATUS_LABEL[status]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </Row>
              ))}
            </Rows>
          ) : null}
        </>
      )}
    </div>
  );
}
