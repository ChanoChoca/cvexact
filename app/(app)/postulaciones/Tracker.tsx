"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Alert, Button, ButtonAnchor, PageHeading, Tabs } from "@/components/ui";
import { useSession } from "@/lib/auth-client";
import { useTracker } from "@/lib/tracker/useTracker";
import type { ApplicationStatus } from "@/lib/tracker/status";
import { ApplicationsList } from "./ApplicationsList";
import { TrackerSettingsSection } from "./TrackerSettingsSection";
import { ImportBanner } from "./ImportBanner";
import { PendingLocalChip } from "./PendingLocalChip";
import { usePendingLocalApplications } from "./pending-local";
import { ImportUrlForm } from "./ImportUrlForm";
import { ImportCsvDialog } from "./ImportCsvDialog";
import { KanbanBoard } from "./KanbanBoard";
import { TableView } from "./TableView";
import { DetailPanel } from "./DetailPanel";
import { InterviewQuestion, useInterviewQuestion } from "./InterviewQuestion";
import { Metrics } from "./Metrics";

type View = "kanban" | "tabla" | "metricas";

const VIEW_TABS: { id: View; label: string }[] = [
  { id: "kanban", label: "Kanban" },
  { id: "tabla", label: "Tabla" },
  { id: "metricas", label: "Métricas" },
];

/**
 * El seguimiento de postulaciones. Sin cuenta sigue siendo lo de siempre —
 * el historial local con su CV, en este navegador nomás — porque el kanban,
 * el ghosting y los recordatorios corren en un servidor y no tienen un
 * equivalente que tenga sentido sin uno. Con cuenta, el tablero completo.
 */
export function Tracker({ initialView }: { initialView: View }) {
  const { data: session, isPending } = useSession();
  const userId = session?.user?.id;

  if (isPending) return <p className="text-sm text-ink-3">Cargando…</p>;
  if (!userId) return <SignedOutTracker />;
  return <SignedInTracker initialView={initialView} userId={userId} />;
}

function SignedOutTracker() {
  return (
    <div className="space-y-10">
      <Alert tone="info" title="El tablero completo pide una cuenta">
        Guardar avisos con un click desde Empleos, arrastrar tarjetas entre estados, detectar
        cuando un proceso quedó sin respuesta y mandarte un recordatorio corren en nuestro
        servidor — así que necesitan una cuenta. Tu historial de acá abajo sigue siendo tuyo,
        en este navegador, como siempre.{" "}
        <Link href="/cuenta" className="underline underline-offset-4 hover:text-ink">
          Creá una cuenta desde Mi cuenta
        </Link>
        .
      </Alert>
      <ApplicationsList />
    </div>
  );
}

function SignedInTracker({ initialView, userId }: { initialView: View; userId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [view, setView] = useState<View>(initialView);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showImportUrl, setShowImportUrl] = useState(false);
  const [showImportCsv, setShowImportCsv] = useState(false);
  /** `forceImport` reabre el banner aunque "Ahora no" lo haya descartado en
   * la sesión; `bannerVisible` es lo que el banner reporta de sí, para que
   * el estado vacío no repita el conteo de locales que ya se está mostrando. */
  const [forceImport, setForceImport] = useState(false);
  const [bannerVisible, setBannerVisible] = useState(false);
  const handleBannerVisible = useCallback((visible: boolean) => setBannerVisible(visible), []);
  const { applications, loading, failed, refresh, moveCard: move, changeStatus: change, archive, remove } = useTracker();
  const pending = usePendingLocalApplications(applications);

  // O12, switched off: when an application reaches the interview, whoever moved it is asked, once, what they were asked. The status it came from is read
  // before the change, because the change is applied to the list at once.
  const interview = useInterviewQuestion();
  const moved = useCallback(
    (id: string, to: ApplicationStatus) => {
      const before = applications.find((application) => application.id === id);
      return before ? { application: { id, label: [before.jobTitle, before.company].filter(Boolean).join(" · ") || "Postulación" }, from: before.status as string | undefined, to } : null;
    },
    [applications],
  );
  const askedAfter = interview.moved;
  const moveCard: typeof move = useCallback(
    async (id, toStatus, boardPosition, force) => {
      const seen = moved(id, toStatus);
      const result = await move(id, toStatus, boardPosition, force);
      if (result.ok && seen) askedAfter(seen.application, seen.from, seen.to);
      return result;
    },
    [move, moved, askedAfter],
  );
  const changeStatus: typeof change = useCallback(
    async (id, toStatus, force) => {
      const seen = moved(id, toStatus);
      const result = await change(id, toStatus, force);
      if (result.ok && seen) askedAfter(seen.application, seen.from, seen.to);
      return result;
    },
    [change, moved, askedAfter],
  );

  const setViewAndUrl = (next: View) => {
    setView(next);
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", next);
    router.replace(`${pathname}?${params}`);
  };

  // Many at once is not a person telling how one interview went: only one application changed asks (the table changes states through here, one or many).
  const bulkStatus = async (ids: string[], status: ApplicationStatus) => {
    await Promise.all(ids.map((id) => (ids.length === 1 ? changeStatus : change)(id, status, true)));
  };

  return (
    <div className="space-y-10" data-panel="full">
      <PageHeading
        eyebrow="Seguimiento"
        title="Postulaciones"
        action={
          <div className="flex flex-wrap items-center gap-4">
            <Tabs label="Vista" activeId={view} onChange={setViewAndUrl} tabs={VIEW_TABS} />
            <div className="flex flex-wrap items-center gap-2">
              {loading ? null : (
                <PendingLocalChip count={pending.length} onShow={() => setForceImport(true)} />
              )}
              <ButtonAnchor href="/api/tracker/export?format=csv" variant="secondary">
                Exportar CSV
              </ButtonAnchor>
              <ButtonAnchor href="/api/tracker/export?format=json" variant="secondary">
                Exportar JSON
              </ButtonAnchor>
            </div>
          </div>
        }
      >
        Cada postulación queda vinculada al CV exacto que mandaste, para saber cuál convierte más.
      </PageHeading>

      <ImportBanner
        tracked={applications}
        onImported={() => void refresh()}
        forceOpen={forceImport}
        onDismiss={() => setForceImport(false)}
        onVisibleChange={handleBannerVisible}
      />

      {view !== "metricas" ? (
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => setShowImportUrl((v) => !v)}>
            {showImportUrl ? "Cerrar" : "Importar por URL"}
          </Button>
          <Button variant="secondary" onClick={() => setShowImportCsv(true)}>
            Importar CSV
          </Button>
        </div>
      ) : null}

      {showImportUrl ? (
        <ImportUrlForm
          onImported={() => {
            void refresh();
            setShowImportUrl(false);
          }}
          onCancel={() => setShowImportUrl(false)}
        />
      ) : null}

      {showImportCsv ? (
        <ImportCsvDialog onImported={() => void refresh()} onClose={() => setShowImportCsv(false)} />
      ) : null}

      {failed ? <Alert tone="bad">No pudimos traer tus postulaciones. Probá de nuevo en un rato.</Alert> : null}

      {interview.pending ? <InterviewQuestion key={interview.pending.id} application={interview.pending} onClose={interview.close} /> : null}

      {view === "metricas" ? (
        <Metrics />
      ) : loading ? (
        <p className="text-sm text-ink-3">Cargando…</p>
      ) : applications.length === 0 ? (
        <div className="space-y-4 border-t border-b border-rule py-8">
          <p className="text-[14.5px] text-ink-2">
            Todavía no tenés nada en el seguimiento. Guardá un aviso desde{" "}
            <Link href="/empleos" className="underline underline-offset-4 hover:text-ink">
              Empleos
            </Link>{" "}
            o importalo por URL o CSV arriba.
          </p>
          {!bannerVisible && pending.length > 0 ? (
            <p className="text-[14.5px] text-ink-2">
              Tenés {pending.length} postulación{pending.length === 1 ? "" : "es"} generada
              {pending.length === 1 ? "" : "s"} en este navegador que todavía no están acá.{" "}
              <Button variant="secondary" onClick={() => setForceImport(true)}>
                Importarlas
              </Button>
            </p>
          ) : null}
        </div>
      ) : view === "kanban" ? (
        <KanbanBoard applications={applications} moveCard={moveCard} onOpen={setOpenId} />
      ) : (
        <TableView
          applications={applications}
          onOpen={setOpenId}
          onArchive={archive}
          onBulkStatus={bulkStatus}
          onDelete={remove}
        />
      )}

      {view !== "metricas" ? <TrackerSettingsSection userId={userId} /> : null}

      {openId ? (
        <DetailPanel
          applicationId={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => void refresh()}
          onStatusChanged={(application, from, to) => interview.moved({ id: application.id, label: [application.jobTitle, application.company].filter(Boolean).join(" · ") || "Postulación" }, from, to)}
          onDelete={remove}
        />
      ) : null}
    </div>
  );
}
