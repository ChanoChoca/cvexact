import { z } from "zod";
import { isApplicationStatus, type ApplicationStatus } from "./status";
import { normalizeForSearch } from "@/lib/text/normalize";

/**
 * Import de CSV con columnas libres — la gente viene de una planilla de
 * Google Sheets o Excel armada a su manera, no con nuestros nombres de
 * columna. Todo acá es puro: parsear el texto, adivinar el mapeo, y validar
 * fila por fila son tres funciones sin IO, para que la pantalla de preview
 * pueda mostrar el resultado antes de que nada llegue al servidor.
 */

// --- Parser RFC4180 a mano -----------------------------------------------

/**
 * No usa `split(",")`: un campo entre comillas puede contener comas, saltos
 * de línea y comillas escapadas (`""`), que es exactamente lo que produce
 * Excel al exportar una celda con una descripción larga. Sniffea `;` como
 * delimitador además de `,` porque es lo que Excel en configuración
 * regional en español exporta por defecto.
 */
export function parseCsv(raw: string): { headers: string[]; rows: string[][] } {
  const text = raw.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const delimiter = sniffDelimiter(text);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  // Última fila, si el archivo no termina en salto de línea.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const nonEmpty = rows.filter((r) => r.some((cell) => cell.trim() !== ""));
  const [headers, ...dataRows] = nonEmpty;
  return { headers: (headers ?? []).map((h) => h.trim()), rows: dataRows };
}

function sniffDelimiter(text: string): "," | ";" {
  const firstLine = text.slice(0, text.indexOf("\n") === -1 ? text.length : text.indexOf("\n"));
  const commas = (firstLine.match(/,/g) ?? []).length;
  const semicolons = (firstLine.match(/;/g) ?? []).length;
  return semicolons > commas ? ";" : ",";
}

// --- Mapeo de columnas -----------------------------------------------------

export const TRACKER_CSV_FIELDS = [
  "jobTitle",
  "company",
  "location",
  "remote",
  "source",
  "jobUrl",
  "status",
  "salaryMin",
  "salaryMax",
  "currency",
  "appliedAt",
  "notes",
] as const;

export type TrackerCsvField = (typeof TRACKER_CSV_FIELDS)[number];

export const TRACKER_CSV_FIELD_LABEL: Record<TrackerCsvField, string> = {
  jobTitle: "Puesto",
  company: "Empresa",
  location: "Ubicación",
  remote: "Modalidad",
  source: "Fuente",
  jobUrl: "URL del aviso",
  status: "Estado",
  salaryMin: "Salario mínimo",
  salaryMax: "Salario máximo",
  currency: "Moneda",
  appliedAt: "Fecha de postulación",
  notes: "Notas",
};

/** Sinónimos es/en por columna, para adivinar el mapeo a partir de los
 *  encabezados reales de la planilla — el usuario lo puede corregir a mano
 *  antes de confirmar, esto es sólo el punto de partida. */
const SYNONYMS: Record<TrackerCsvField, string[]> = {
  jobTitle: ["puesto", "titulo", "título", "cargo", "job title", "position", "role", "rol"],
  company: ["empresa", "compania", "compañía", "company", "employer"],
  location: ["ubicacion", "ubicación", "location", "ciudad", "city"],
  remote: ["modalidad", "remoto", "remote", "presencial"],
  source: ["fuente", "source", "portal", "sitio"],
  jobUrl: ["url", "link", "enlace", "aviso"],
  status: ["estado", "status", "etapa"],
  salaryMin: ["salario minimo", "salario mínimo", "salary min", "sueldo minimo"],
  salaryMax: ["salario maximo", "salario máximo", "salary max", "sueldo maximo"],
  currency: ["moneda", "currency"],
  appliedAt: ["fecha", "fecha de postulacion", "fecha de postulación", "applied", "date"],
  notes: ["notas", "notes", "comentarios", "observaciones"],
};

function normalizeHeader(header: string): string {
  return normalizeForSearch(header);
}

export function guessMapping(headers: string[]): Partial<Record<TrackerCsvField, string>> {
  const mapping: Partial<Record<TrackerCsvField, string>> = {};
  const normalizedHeaders = headers.map((h) => ({ raw: h, normalized: normalizeHeader(h) }));

  for (const field of TRACKER_CSV_FIELDS) {
    const synonyms = SYNONYMS[field].map(normalizeHeader);
    const match = normalizedHeaders.find((h) => synonyms.includes(h.normalized));
    if (match) mapping[field] = match.raw;
  }
  return mapping;
}

// --- Fila mapeada y validada ------------------------------------------------

export type MappedApplicationRow = {
  jobTitle?: string;
  company?: string;
  location?: string;
  remote?: boolean;
  source?: string;
  jobUrl?: string;
  status?: ApplicationStatus;
  salaryMin?: number;
  salaryMax?: number;
  currency?: string;
  appliedAt?: string;
  notes?: string;
};

const REMOTE_TRUE = new Set(["si", "sí", "yes", "true", "remoto", "remote", "x", "1"]);
const REMOTE_FALSE = new Set(["no", "false", "presencial", "onsite", "0"]);

function parseRemote(value: string): boolean | undefined {
  const normalized = normalizeHeader(value);
  if (REMOTE_TRUE.has(normalized)) return true;
  if (REMOTE_FALSE.has(normalized)) return false;
  return undefined;
}

function parseSalary(value: string): number | undefined {
  const digits = value.replace(/[^\d]/g, "");
  if (!digits) return undefined;
  const n = Number(digits);
  return Number.isFinite(n) ? n : undefined;
}

function parseAppliedAt(value: string): string | undefined {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

const rowSchema = z
  .object({
    jobTitle: z.string().trim().max(200).optional(),
    company: z.string().trim().max(200).optional(),
  })
  .refine((v) => v.jobTitle || v.company, { message: "Falta el puesto y la empresa — al menos uno es obligatorio." });

export type CsvImportResult = {
  valid: MappedApplicationRow[];
  rejected: { row: number; reason: string }[];
};

/**
 * Aplica el mapeo elegido a cada fila cruda y valida. `row` en los
 * rechazos es 1-indexado y ya excluye el encabezado, para que el mensaje
 * apunte a la misma fila que el usuario ve resaltada en su planilla.
 */
export function mapRows(
  headers: string[],
  rows: string[][],
  mapping: Partial<Record<TrackerCsvField, string>>,
): CsvImportResult {
  const columnIndex = new Map(headers.map((h, i) => [h, i]));
  const valid: MappedApplicationRow[] = [];
  const rejected: { row: number; reason: string }[] = [];

  rows.forEach((cells, index) => {
    const get = (field: TrackerCsvField): string => {
      const header = mapping[field];
      if (!header) return "";
      const i = columnIndex.get(header);
      return i === undefined ? "" : (cells[i] ?? "").trim();
    };

    const mapped: MappedApplicationRow = {
      jobTitle: get("jobTitle") || undefined,
      company: get("company") || undefined,
      location: get("location") || undefined,
      remote: get("remote") ? parseRemote(get("remote")) : undefined,
      source: get("source") || undefined,
      jobUrl: get("jobUrl") || undefined,
      status: isApplicationStatus(get("status").toLocaleLowerCase())
        ? (get("status").toLocaleLowerCase() as ApplicationStatus)
        : undefined,
      salaryMin: get("salaryMin") ? parseSalary(get("salaryMin")) : undefined,
      salaryMax: get("salaryMax") ? parseSalary(get("salaryMax")) : undefined,
      currency: get("currency") || undefined,
      appliedAt: get("appliedAt") ? parseAppliedAt(get("appliedAt")) : undefined,
      notes: get("notes") || undefined,
    };

    const result = rowSchema.safeParse(mapped);
    if (!result.success) {
      rejected.push({ row: index + 1, reason: result.error.issues[0]?.message ?? "Fila inválida." });
      return;
    }
    valid.push(mapped);
  });

  return { valid, rejected };
}
