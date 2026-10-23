"use client";

import { useCallback, useEffect, useState } from "react";
import type { ApplicationStatus } from "./status";
import type { TrackerApplication } from "./client-types";

/**
 * Dueño único de la lista de postulaciones del servidor — el kanban y la
 * tabla la leen del mismo estado, así que arrastrar una tarjeta y filtrar la
 * tabla nunca muestran dos copias que no coinciden.
 *
 * Sin TanStack Query: un solo array en `useState`, una función de refetch, y
 * una mutación optimista de pocas líneas por acción — alcanza para el volumen
 * de esta pantalla y no suma una segunda forma de manejar datos de servidor
 * al lado de `fetch`+`useEffect`, que es lo que ya usa el resto del repo
 * (`useJobsFeed`, `useBillingStatus`).
 */

export type TrackerFilters = {
  includeArchived?: boolean;
  company?: string;
  source?: string;
  remote?: boolean;
};

function buildQuery(filters: TrackerFilters): string {
  const params = new URLSearchParams();
  if (filters.includeArchived) params.set("includeArchived", "true");
  if (filters.company) params.set("company", filters.company);
  if (filters.source) params.set("source", filters.source);
  if (filters.remote !== undefined) params.set("remote", String(filters.remote));
  return params.toString();
}

async function fetchApplications(filters: TrackerFilters): Promise<TrackerApplication[] | null> {
  try {
    const response = await fetch(`/api/tracker/applications?${buildQuery(filters)}`);
    if (!response.ok) return null;
    const body = (await response.json()) as { applications: TrackerApplication[] };
    return body.applications;
  } catch {
    return null;
  }
}

export type MutationResult = { ok: true } | { ok: false; error: string };

type TrackerState = { applications: TrackerApplication[]; loading: boolean; failed: boolean };

export function useTracker(filters: TrackerFilters = {}) {
  const { includeArchived, company, source, remote } = filters;
  const [state, setState] = useState<TrackerState>({ applications: [], loading: true, failed: false });

  useEffect(() => {
    // Mismo cuidado que `useJobsFeed`: un cambio de filtro o un unmount a
    // mitad de camino no debe dejar que una respuesta vieja pise a una más
    // nueva, y `loading` sólo pasa de `true` a `false` una vez.
    let cancelled = false;

    void fetchApplications({ includeArchived, company, source, remote }).then((next) => {
      if (cancelled) return;
      setState((prev) => ({
        applications: next ?? prev.applications,
        loading: false,
        failed: next === null,
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [includeArchived, company, source, remote]);

  /** Re-trae la lista a mano — después de una mutación cuyo resultado
   *  optimista conviene reconciliar contra el servidor. */
  const refresh = useCallback(async () => {
    const next = await fetchApplications({ includeArchived, company, source, remote });
    setState((prev) => ({
      applications: next ?? prev.applications,
      loading: false,
      failed: next === null ? true : false,
    }));
  }, [includeArchived, company, source, remote]);

  const setApplications = useCallback(
    (updater: (prev: TrackerApplication[]) => TrackerApplication[]) => {
      setState((prev) => ({ ...prev, applications: updater(prev.applications) }));
    },
    [],
  );

  /** Aplica un patch optimista ya mismo, y lo revierte si el servidor lo rechaza. */
  const applyOptimistic = useCallback(
    async (
      id: string,
      patch: Partial<TrackerApplication>,
      request: () => Promise<Response>,
    ): Promise<MutationResult> => {
      let previous: TrackerApplication | undefined;
      setApplications((prev) =>
        prev.map((a) => {
          if (a.id !== id) return a;
          previous = a;
          return { ...a, ...patch };
        }),
      );

      try {
        const response = await request();
        if (!response.ok) {
          const body = await response.json().catch(() => ({ error: "No se pudo guardar el cambio." }));
          const restored = previous;
          if (restored) setApplications((prev) => prev.map((a) => (a.id === id ? restored : a)));
          return { ok: false, error: body.error ?? "No se pudo guardar el cambio." };
        }
        return { ok: true };
      } catch {
        const restored = previous;
        if (restored) setApplications((prev) => prev.map((a) => (a.id === id ? restored : a)));
        return { ok: false, error: "No se pudo conectar con el servidor." };
      }
    },
    [setApplications],
  );

  const moveCard = useCallback(
    (id: string, toStatus: ApplicationStatus, boardPosition: number, force = false): Promise<MutationResult> =>
      applyOptimistic(id, { status: toStatus, boardPosition }, () =>
        fetch(`/api/tracker/applications/${id}/move`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ toStatus, boardPosition, force }),
        }),
      ),
    [applyOptimistic],
  );

  const changeStatus = useCallback(
    (id: string, toStatus: ApplicationStatus, force = false): Promise<MutationResult> =>
      applyOptimistic(id, { status: toStatus }, () =>
        fetch(`/api/tracker/applications/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: toStatus, force }),
        }),
      ),
    [applyOptimistic],
  );

  const archive = useCallback(
    async (ids: string[], archived: boolean): Promise<MutationResult> => {
      let removed: TrackerApplication[] = [];
      setApplications((prev) => {
        removed = prev.filter((a) => ids.includes(a.id));
        return prev.filter((a) => !ids.includes(a.id));
      });
      try {
        const response = await fetch("/api/tracker/applications/bulk", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "archive", ids, archived }),
        });
        if (!response.ok) {
          setApplications((prev) => [...prev, ...removed]);
          return { ok: false, error: "No se pudo archivar." };
        }
        return { ok: true };
      } catch {
        setApplications((prev) => [...prev, ...removed]);
        return { ok: false, error: "No se pudo conectar con el servidor." };
      }
    },
    [setApplications],
  );

  /** Borra definitivamente — no hay endpoint en lote, así que dispara un
   *  DELETE por id en paralelo contra el mismo endpoint que usa el panel
   *  de detalle. */
  const remove = useCallback(
    async (ids: string[]): Promise<MutationResult> => {
      let removed: TrackerApplication[] = [];
      setApplications((prev) => {
        removed = prev.filter((a) => ids.includes(a.id));
        return prev.filter((a) => !ids.includes(a.id));
      });
      try {
        const responses = await Promise.all(
          ids.map((id) => fetch(`/api/tracker/applications/${id}`, { method: "DELETE" })),
        );
        if (responses.some((r) => !r.ok)) {
          setApplications((prev) => [...prev, ...removed]);
          return { ok: false, error: "No se pudo eliminar." };
        }
        return { ok: true };
      } catch {
        setApplications((prev) => [...prev, ...removed]);
        return { ok: false, error: "No se pudo conectar con el servidor." };
      }
    },
    [setApplications],
  );

  return {
    applications: state.applications,
    loading: state.loading,
    failed: state.failed,
    refresh,
    moveCard,
    changeStatus,
    archive,
    remove,
    setApplications,
  };
}
