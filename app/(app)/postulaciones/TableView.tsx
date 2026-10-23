"use client";

import { useMemo, useState } from "react";
import { Button, Checkbox, Input, Select } from "@/components/ui";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/toast";
import { APPLICATION_STATUSES, APPLICATION_STATUS_LABEL, type ApplicationStatus } from "@/lib/tracker/status";
import { formatDate, formatDaysSince } from "@/lib/tracker/format";
import type { TrackerApplication } from "@/lib/tracker/client-types";
import type { MutationResult } from "@/lib/tracker/useTracker";
import { normalizeForSearch } from "@/lib/text/normalize";

type SortKey = "jobTitle" | "company" | "status" | "createdAt" | "lastActivityAt";

const SORTERS: Record<SortKey, (a: TrackerApplication, b: TrackerApplication) => number> = {
  jobTitle: (a, b) => (a.jobTitle ?? "").localeCompare(b.jobTitle ?? ""),
  company: (a, b) => (a.company ?? "").localeCompare(b.company ?? ""),
  status: (a, b) => a.status.localeCompare(b.status),
  createdAt: (a, b) => a.createdAt.localeCompare(b.createdAt),
  lastActivityAt: (a, b) => a.lastActivityAt.localeCompare(b.lastActivityAt),
};

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "jobTitle", label: "Puesto" },
  { key: "company", label: "Empresa" },
  { key: "status", label: "Estado" },
  { key: "createdAt", label: "Creada" },
  { key: "lastActivityAt", label: "Actividad" },
];

/**
 * Vista tabla: filtros por estado/empresa/fuente/modalidad, orden por
 * cualquier columna, selección múltiple para archivar o cambiar estado en
 * lote. Sin TanStack Table — para el volumen de una sola cuenta, un
 * `useMemo` con `.filter()`/`.sort()` hace lo mismo sin sumar una
 * dependencia.
 */
export function TableView({
  applications,
  onOpen,
  onArchive,
  onBulkStatus,
  onDelete,
}: {
  applications: TrackerApplication[];
  onOpen: (id: string) => void;
  onArchive: (ids: string[], archived: boolean) => Promise<MutationResult>;
  onBulkStatus: (ids: string[], status: ApplicationStatus) => Promise<void>;
  onDelete: (ids: string[]) => Promise<MutationResult>;
}) {
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | "all">("all");
  const [companyFilter, setCompanyFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [remoteFilter, setRemoteFilter] = useState<"all" | "remote" | "onsite">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("lastActivityAt");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const confirm = useConfirm();
  const toast = useToast();

  const sources = useMemo(
    () => [...new Set(applications.map((a) => a.source).filter((s): s is string => Boolean(s)))].sort(),
    [applications],
  );

  const rows = useMemo(() => {
    const filtered = applications.filter((a) => {
      if (statusFilter !== "all" && a.status !== statusFilter) return false;
      if (companyFilter && !normalizeForSearch(a.company ?? "").includes(normalizeForSearch(companyFilter))) {
        return false;
      }
      if (sourceFilter !== "all" && a.source !== sourceFilter) return false;
      if (remoteFilter === "remote" && a.remote !== true) return false;
      if (remoteFilter === "onsite" && a.remote !== false) return false;
      if (dateFrom && a.createdAt < dateFrom) return false;
      if (dateTo && a.createdAt > `${dateTo}T23:59:59.999Z`) return false;
      return true;
    });
    return [...filtered].sort((a, b) => sortDir * SORTERS[sortKey](a, b));
  }, [applications, statusFilter, companyFilter, sourceFilter, remoteFilter, dateFrom, dateTo, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 1 ? -1 : 1) as 1 | -1);
    else {
      setSortKey(key);
      setSortDir(1);
    }
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  const archiveSelected = async () => {
    const ids = [...selected];
    const confirmed = await confirm(`¿Archivar ${ids.length} postulación(es)?`);
    if (!confirmed) return;
    const result = await onArchive(ids, true);
    if (!result.ok) toast({ tone: "bad", message: result.error });
    else setSelected(new Set());
  };

  const deleteSelected = async () => {
    const ids = [...selected];
    const confirmed = await confirm(`¿Eliminar ${ids.length} postulación(es)? No se puede deshacer.`, {
      title: "Eliminar postulaciones",
      confirmLabel: "Eliminar",
    });
    if (!confirmed) return;
    const result = await onDelete(ids);
    if (!result.ok) toast({ tone: "bad", message: result.error });
    else setSelected(new Set());
  };

  const deleteRow = async (a: TrackerApplication) => {
    const confirmed = await confirm(`¿Eliminar "${a.jobTitle || "esta postulación"}"? No se puede deshacer.`, {
      title: "Eliminar postulación",
      confirmLabel: "Eliminar",
    });
    if (!confirmed) return;
    const result = await onDelete([a.id]);
    if (!result.ok) toast({ tone: "bad", message: result.error });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4 border-b border-rule py-2">
        <label className="flex items-center gap-2 font-solar text-xs tracking-widest text-ink-3 uppercase">
          Estado
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as ApplicationStatus | "all")}>
            <option value="all">Todas</option>
            {APPLICATION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {APPLICATION_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-2 font-solar text-xs tracking-widest text-ink-3 uppercase">
          Modalidad
          <Select value={remoteFilter} onChange={(e) => setRemoteFilter(e.target.value as typeof remoteFilter)}>
            <option value="all">Todas</option>
            <option value="remote">Remoto</option>
            <option value="onsite">Presencial / híbrido</option>
          </Select>
        </label>
        {sources.length > 0 ? (
          <label className="flex items-center gap-2 font-solar text-xs tracking-widest text-ink-3 uppercase">
            Fuente
            <Select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
              <option value="all">Todas</option>
              {sources.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
        <Input
          value={companyFilter}
          onChange={(e) => setCompanyFilter(e.target.value)}
          placeholder="Buscar empresa…"
          className="w-48"
        />
        <label className="flex items-center gap-2 font-solar text-xs tracking-widest text-ink-3 uppercase">
          Desde
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="normal-case"
          />
        </label>
        <label className="flex items-center gap-2 font-solar text-xs tracking-widest text-ink-3 uppercase">
          Hasta
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="normal-case"
          />
        </label>
        {selected.size > 0 ? (
          <div className="ml-auto flex items-center gap-3">
            <span className="font-solar text-xs tracking-widest text-ink-3">{selected.size} seleccionada(s)</span>
            <label className="flex items-center gap-2 font-solar text-xs tracking-widest text-ink-3 uppercase">
              Mover a
              <Select
                defaultValue=""
                onChange={async (e) => {
                  const status = e.target.value as ApplicationStatus;
                  if (!status) return;
                  await onBulkStatus([...selected], status);
                  e.target.value = "";
                  setSelected(new Set());
                }}
              >
                <option value="" disabled>
                  Elegir estado…
                </option>
                {APPLICATION_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {APPLICATION_STATUS_LABEL[s]}
                  </option>
                ))}
              </Select>
            </label>
            <Button variant="danger" onClick={() => void archiveSelected()}>
              Archivar
            </Button>
            <Button variant="danger" onClick={() => void deleteSelected()}>
              Eliminar
            </Button>
          </div>
        ) : null}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-rule font-solar text-[12.5px] font-bold tracking-[0.18em] text-ink-3 uppercase">
              <th className="w-8 py-2">
                <Checkbox
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                  aria-label="Seleccionar todas"
                  className="cursor-pointer"
                />
              </th>
              {COLUMNS.map((c) => (
                <th key={c.key} className="cursor-pointer py-2 pr-4" onClick={() => toggleSort(c.key)}>
                  {c.label} {sortKey === c.key ? (sortDir === 1 ? "↑" : "↓") : ""}
                </th>
              ))}
              <th className="py-2">CV</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="border-b border-rule text-ink-2 hover:bg-paper-2">
                <td className="py-2">
                  <Checkbox
                    checked={selected.has(a.id)}
                    onChange={() => toggle(a.id)}
                    aria-label={`Seleccionar ${a.jobTitle}`}
                    className="cursor-pointer"
                  />
                </td>
                <td className="py-2 pr-4">
                  <button
                    type="button"
                    onClick={() => onOpen(a.id)}
                    className="text-left font-normal text-ink underline-offset-4 hover:underline"
                  >
                    {a.jobTitle || "Sin título"}
                  </button>
                </td>
                <td className="py-2 pr-4">{a.company || "—"}</td>
                <td className="py-2 pr-4">{APPLICATION_STATUS_LABEL[a.status as ApplicationStatus]}</td>
                <td className="py-2 pr-4">{formatDate(a.createdAt)}</td>
                <td className="py-2 pr-4">{formatDaysSince(a.lastActivityAt)}</td>
                <td className="py-2">{a.cvVersionId ? "Sí" : "—"}</td>
                <td className="py-2">
                  <button
                    type="button"
                    onClick={() => void deleteRow(a)}
                    className="text-xs text-ink-3 hover:text-ink"
                  >
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <p className="py-6 text-sm text-ink-3">Nada que coincida con estos filtros.</p> : null}
      </div>
    </div>
  );
}
