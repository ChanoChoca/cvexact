"use client";

import { useState } from "react";
import { Alert, Badge, Button, Field, Input } from "@/components/ui";
import { useToast } from "@/components/ui/toast";

type ImportedFields = {
  jobTitle: string;
  company: string;
  location: string;
  remote: boolean | null;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  jdText: string;
  jsonld: unknown;
  fromFallback: boolean;
};

/**
 * Pegar una URL, revisar lo que el JSON-LD trajo (o completar a mano si no
 * había), confirmar. El fetch y el parseo pasan en
 * `POST /api/tracker/import/url` — acá sólo se arma el formulario con lo
 * que esa route devuelve, y la creación real es el mismo
 * `POST /api/tracker/applications` que usa todo lo demás, así que la
 * detección de duplicados corre igual que para cualquier otra alta.
 */
export function ImportUrlForm({ onImported, onCancel }: { onImported: () => void; onCancel: () => void }) {
  const [url, setUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<ImportedFields | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const fetchUrl = async () => {
    setFetching(true);
    setError(null);
    try {
      const response = await fetch("/api/tracker/import/url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "No pudimos leer esa URL.");
        return;
      }
      setFields(body);
    } catch {
      setError("No se pudo conectar con el servidor.");
    } finally {
      setFetching(false);
    }
  };

  const confirm = async () => {
    if (!fields) return;
    setSaving(true);
    try {
      const response = await fetch("/api/tracker/applications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jobTitle: fields.jobTitle,
          company: fields.company,
          location: fields.location,
          remote: fields.remote ?? undefined,
          salaryMin: fields.salaryMin ?? undefined,
          salaryMax: fields.salaryMax ?? undefined,
          currency: fields.currency ?? undefined,
          jdText: fields.jdText,
          jdJsonld: fields.jsonld,
          jobUrl: url,
          source: "url",
          status: "guardado",
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        toast({ tone: "bad", message: body.error ?? "No se pudo guardar." });
        return;
      }
      if (body.duplicates?.length > 0) {
        toast({ tone: "warn", message: "Ya tenías algo parecido guardado — lo agregamos igual, revisalo en la tabla." });
      } else {
        toast({ tone: "good", message: "Importado." });
      }
      onImported();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 border border-rule bg-paper-2 p-4">
      <div className="flex items-end gap-3">
        <Field label="URL del aviso" className="flex-1">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        </Field>
        <Button disabled={!url.trim() || fetching} onClick={() => void fetchUrl()}>
          {fetching ? "Leyendo…" : "Leer aviso"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>

      {error ? <Alert tone="bad">{error}</Alert> : null}

      {fields ? (
        <div className="space-y-3 border-t border-rule pt-4">
          {fields.fromFallback ? (
            <Alert tone="warn">
              Esa página no tenía datos estructurados de aviso — completá lo que falte a mano.
            </Alert>
          ) : (
            <Badge tone="good">Leído del JSON-LD del aviso</Badge>
          )}
          <Field label="Puesto">
            <Input value={fields.jobTitle} onChange={(e) => setFields({ ...fields, jobTitle: e.target.value })} />
          </Field>
          <Field label="Empresa">
            <Input value={fields.company} onChange={(e) => setFields({ ...fields, company: e.target.value })} />
          </Field>
          <Field label="Ubicación">
            <Input value={fields.location} onChange={(e) => setFields({ ...fields, location: e.target.value })} />
          </Field>
          <Button disabled={saving || (!fields.jobTitle && !fields.company)} onClick={() => void confirm()}>
            {saving ? "Guardando…" : "Guardar en el seguimiento"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
