"use client";

import { useMemo, useState } from "react";
import { Alert, Button, Field, Select } from "@/components/ui";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/toast";
import {
  TRACKER_CSV_FIELDS,
  TRACKER_CSV_FIELD_LABEL,
  guessMapping,
  mapRows,
  parseCsv,
  type MappedApplicationRow,
  type TrackerCsvField,
} from "@/lib/tracker/csv";

type Step = "pegar" | "mapear" | "listo";

/**
 * Pegar CSV → mapear columnas → preview → confirmar. Todo el parseo y el
 * mapeo corren acá mismo, en el navegador (`lib/tracker/csv.ts` es puro, sin
 * IO) — lo único que sale al servidor es el resultado ya mapeado y
 * validado, a `POST /api/tracker/import/csv`, que valida todo de nuevo y
 * es quien de verdad crea las postulaciones.
 */
export function ImportCsvDialog({ onImported, onClose }: { onImported: () => void; onClose: () => void }) {
  const [step, setStep] = useState<Step>("pegar");
  const [raw, setRaw] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Partial<Record<TrackerCsvField, string>>>({});
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<{ created: number; duplicates: number; rejected: number } | null>(null);
  const toast = useToast();

  const parsed = useMemo(() => mapRows(headers, rows, mapping), [headers, rows, mapping]);

  const parseAndContinue = () => {
    const { headers: h, rows: r } = parseCsv(raw);
    if (h.length === 0 || r.length === 0) {
      toast({ tone: "bad", message: "No pudimos leer ese CSV — ¿tiene encabezado y al menos una fila?" });
      return;
    }
    setHeaders(h);
    setRows(r);
    setMapping(guessMapping(h));
    setStep("mapear");
  };

  const confirmImport = async () => {
    setImporting(true);
    try {
      const response = await fetch("/api/tracker/import/csv", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rows: sanitizeForServer(parsed.valid) }),
      });
      const body = await response.json();
      if (!response.ok) {
        toast({ tone: "bad", message: body.error ?? "No se pudo importar." });
        return;
      }
      setSummary({ created: body.created, duplicates: body.duplicates.length, rejected: body.rejected.length });
      setStep("listo");
      onImported();
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="import-csv-title"
      className="max-h-[90vh] max-w-2xl overflow-y-auto p-5"
    >
      <div className="mb-4 flex items-center justify-between">
        <p id="import-csv-title" className="font-solar text-[12.5px] font-bold tracking-[0.18em] text-ink-3 uppercase">
          Importar CSV
        </p>
        <button type="button" onClick={onClose} aria-label="Cerrar" className="text-ink-3 hover:text-ink">
          ×
        </button>
      </div>

      {step === "pegar" ? (
        <div className="space-y-3">
          <p className="text-sm text-ink-2">
            Pegá el contenido de tu planilla (exportada como CSV desde Google Sheets o Excel).
            La primera fila tiene que ser el encabezado.
          </p>
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={10}
            className="w-full border border-white/40 bg-white/[0.03] p-2 font-mono text-xs text-ink focus:border-ink focus:outline-none"
            placeholder="Puesto,Empresa,Estado&#10;Backend,Acme,postulado"
          />
          <Button disabled={!raw.trim()} onClick={parseAndContinue}>
            Continuar
          </Button>
        </div>
      ) : null}

      {step === "mapear" ? (
        <div className="space-y-4">
          <p className="text-sm text-ink-2">
            {rows.length} fila{rows.length === 1 ? "" : "s"} encontrada{rows.length === 1 ? "" : "s"}. Revisá el
            mapeo de columnas — ya adivinamos lo que pudimos.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {TRACKER_CSV_FIELDS.map((field) => (
              <Field key={field} label={TRACKER_CSV_FIELD_LABEL[field]}>
                <Select
                  value={mapping[field] ?? ""}
                  onChange={(e) => setMapping({ ...mapping, [field]: e.target.value || undefined })}
                >
                  <option value="">— sin mapear —</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
          </div>

          <div>
            <p className="mb-2 font-solar text-[12.5px] font-bold tracking-[0.18em] text-ink-3 uppercase">
              Preview — {parsed.valid.length} válidas, {parsed.rejected.length} rechazadas
            </p>
            {parsed.rejected.length > 0 ? (
              <Alert tone="warn">
                {parsed.rejected.slice(0, 5).map((r) => (
                  <p key={r.row}>
                    Fila {r.row}: {r.reason}
                  </p>
                ))}
                {parsed.rejected.length > 5 ? <p>y {parsed.rejected.length - 5} más…</p> : null}
              </Alert>
            ) : null}
            <div className="max-h-48 overflow-y-auto border border-rule">
              <table className="w-full text-left text-xs">
                <tbody>
                  {parsed.valid.slice(0, 20).map((row, i) => (
                    <tr key={i} className="border-b border-rule">
                      <td className="p-1.5 text-ink">{row.jobTitle}</td>
                      <td className="p-1.5 text-ink-2">{row.company}</td>
                      <td className="p-1.5 text-ink-3">{row.status ?? "guardado"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex gap-3">
            <Button disabled={parsed.valid.length === 0 || importing} onClick={() => void confirmImport()}>
              {importing ? "Importando…" : `Importar ${parsed.valid.length} postulación(es)`}
            </Button>
            <Button variant="ghost" onClick={() => setStep("pegar")}>
              Volver
            </Button>
          </div>
        </div>
      ) : null}

      {step === "listo" && summary ? (
        <div className="space-y-3">
          <Alert tone="good">Se importaron {summary.created} postulaciones.</Alert>
          {summary.duplicates > 0 ? (
            <Alert tone="warn">
              {summary.duplicates} se parecían a algo que ya tenías — no se bloquearon, revisalas en la tabla.
            </Alert>
          ) : null}
          {summary.rejected > 0 ? <Alert tone="bad">{summary.rejected} filas no se pudieron crear.</Alert> : null}
          <Button onClick={onClose}>Cerrar</Button>
        </div>
      ) : null}
    </Modal>
  );
}

/** El servidor valida `appliedAt` como datetime ISO completo — el CSV trae
 *  fechas sueltas ("2026-01-05"), así que acá se normalizan antes de mandar. */
function sanitizeForServer(rows: MappedApplicationRow[]) {
  return rows.map((row) => ({
    ...row,
    appliedAt: row.appliedAt ? new Date(row.appliedAt).toISOString() : undefined,
  }));
}
