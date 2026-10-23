"use client";

import { useEffect, useState } from "react";
import { Alert, Badge, Card, SectionTitle } from "@/components/ui";
import { APPLICATION_STATUS_LABEL, type ApplicationStatus } from "@/lib/tracker/status";

type Metric = {
  key: string;
  label: string;
  total: number;
  responseRate: number | null;
  interviewRate: number | null;
};

type MetricsData = {
  total: number;
  active: number;
  closed: number;
  responseRate: { totalPostulated: number; responded: number; rate: number | null };
  medianDaysToFirstResponse: number | null;
  stageConversion: { stage: ApplicationStatus; count: number }[];
  bySource: Metric[];
  byCvVersion: (Metric & { significant: boolean })[];
  weeklyApplications: { weekStart: string; count: number }[];
};

function pct(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <SectionTitle>{label}</SectionTitle>
      <p className="text-2xl text-ink">{value}</p>
    </Card>
  );
}

/**
 * Todo el número sale de `application_event`, calculado en
 * `lib/tracker/metrics.ts` y traído de una — nada de esto se recalcula acá,
 * este componente sólo dibuja. Sin librería de gráficos: un embudo y una
 * serie semanal son barras hechas con `<div>`, que es lo único que hace
 * falta para dos gráficos simples.
 */
export function Metrics() {
  const [data, setData] = useState<MetricsData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/tracker/metrics")
      .then((r) => (r.ok ? (r.json() as Promise<MetricsData>) : null))
      .then((next) => {
        if (cancelled) return;
        if (next) setData(next);
        else setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) return <Alert tone="bad">No pudimos calcular las métricas. Probá de nuevo en un rato.</Alert>;
  if (!data) return <p className="text-sm text-ink-3">Calculando…</p>;

  const maxStage = Math.max(1, ...data.stageConversion.map((s) => s.count));
  const maxWeek = Math.max(1, ...data.weeklyApplications.map((w) => w.count));

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total" value={String(data.total)} />
        <StatCard label="Activas" value={String(data.active)} />
        <StatCard label="Cerradas" value={String(data.closed)} />
        <StatCard label="Tasa de respuesta" value={pct(data.responseRate.rate)} />
      </div>

      <Card>
        <SectionTitle>Tiempo hasta la primera respuesta</SectionTitle>
        <p className="text-ink-2">
          {data.medianDaysToFirstResponse === null
            ? "Todavía no hay suficientes respuestas para calcularlo."
            : `Mediana: ${data.medianDaysToFirstResponse.toFixed(1)} días, sobre ${data.responseRate.responded} de ${data.responseRate.totalPostulated} postulaciones respondidas.`}
        </p>
      </Card>

      <div>
        <SectionTitle>Conversión por etapa</SectionTitle>
        <div className="space-y-2">
          {data.stageConversion.map((s) => (
            <div key={s.stage} className="flex items-center gap-3">
              <span className="w-28 shrink-0 text-sm text-ink-2">{APPLICATION_STATUS_LABEL[s.stage]}</span>
              <div className="h-4 flex-1 bg-paper-2">
                <div className="h-4 bg-oro-soft" style={{ width: `${(s.count / maxStage) * 100}%` }} />
              </div>
              <span className="w-8 text-right text-sm text-ink-3">{s.count}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <SectionTitle>Conversión por versión de CV — la métrica que ningún otro tracker puede mostrar</SectionTitle>
        <p className="mb-3 text-sm text-ink-2">
          Cada postulación queda vinculada a la versión exacta de CV que se mandó. Esto compara
          cuánto responde cada una — con menos de 10 postulaciones el porcentaje no se muestra:
          no alcanza para decir nada confiable.
        </p>
        {data.byCvVersion.length === 0 ? (
          <p className="text-sm text-ink-3">Todavía no hay postulaciones con una versión de CV vinculada.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-rule font-solar text-[12.5px] font-bold tracking-[0.18em] text-ink-3 uppercase">
                  <th className="py-2 pr-4">Versión</th>
                  <th className="py-2 pr-4">Enviadas</th>
                  <th className="py-2 pr-4">Respuesta</th>
                  <th className="py-2">Entrevista</th>
                </tr>
              </thead>
              <tbody>
                {data.byCvVersion.map((v) => (
                  <tr key={v.key} className="border-b border-rule text-ink-2">
                    <td className="py-2 pr-4 text-ink">{v.label}</td>
                    <td className="py-2 pr-4">{v.total}</td>
                    <td className="py-2 pr-4">
                      {v.significant ? pct(v.responseRate) : <Badge tone="neutral">no significativo</Badge>}
                    </td>
                    <td className="py-2">{v.significant ? pct(v.interviewRate) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <SectionTitle>Conversión por fuente</SectionTitle>
        {data.bySource.length === 0 ? (
          <p className="text-sm text-ink-3">Todavía no hay postulaciones para comparar.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-rule font-solar text-[12.5px] font-bold tracking-[0.18em] text-ink-3 uppercase">
                  <th className="py-2 pr-4">Fuente</th>
                  <th className="py-2 pr-4">Enviadas</th>
                  <th className="py-2 pr-4">Respuesta</th>
                  <th className="py-2">Entrevista</th>
                </tr>
              </thead>
              <tbody>
                {data.bySource.map((s) => (
                  <tr key={s.key} className="border-b border-rule text-ink-2">
                    <td className="py-2 pr-4 text-ink">{s.label}</td>
                    <td className="py-2 pr-4">{s.total}</td>
                    <td className="py-2 pr-4">{pct(s.responseRate)}</td>
                    <td className="py-2">{pct(s.interviewRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <SectionTitle>Postulaciones por semana</SectionTitle>
        {data.weeklyApplications.length === 0 ? (
          <p className="text-sm text-ink-3">Todavía no hay postulaciones marcadas como enviadas.</p>
        ) : (
          <div className="flex h-32 items-end gap-1 overflow-x-auto">
            {data.weeklyApplications.map((w) => (
              <div key={w.weekStart} className="flex w-8 shrink-0 flex-col items-center gap-1">
                <div
                  className="w-full bg-oro-soft"
                  style={{ height: `${Math.max(4, (w.count / maxWeek) * 100)}px` }}
                  title={`${w.weekStart}: ${w.count}`}
                />
                <span className="text-[9px] text-ink-3">{w.weekStart.slice(5)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
