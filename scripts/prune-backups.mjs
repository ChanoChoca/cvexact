// Poda de backups viejos en Bunny Storage.
//
// scripts/backup.mjs sube un `.dump.enc` cada 2 horas y nunca borra nada, así
// que el storage zone crece para siempre — B6 #3 del audit legal
// (la auditoría legal interna). A diferencia de backup.mjs, que es agnóstico
// del backend (un PUT autenticado sirve contra cualquier destino), este script
// SÍ es específico de Bunny Storage: el listado de un directorio y el DELETE
// por nombre son su API, no un estándar que S3/R2/otros compartan. Si el
// destino cambia de proveedor algún día, este script cambia con él — ver
// `app/legales/privacidad/page.tsx`, cláusula 9, que nombra a Bunny.net.
//
//   GET    $BACKUP_URL/           → JSON: [{ ObjectName, IsDirectory, ... }, ...]
//   DELETE $BACKUP_URL/<nombre>   → borra un objeto
//
// BACKUP_RETENTION_DAYS decide qué es "viejo". Se lee la fecha del propio
// nombre del archivo (`cvexact-<ISO>.dump.enc`, ver backup.mjs) en vez de
// confiar en que Bunny informe bien `LastChanged`.
//
// Corre como CronJob diario (ver los CronJobs de tu despliegue), después de cvexact-backup:
// borrar antes de que el backup del día termine de subir dejaría, en el peor
// caso, cero copias en el storage zone.

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`[prune-backups] ${name} no está seteada. El job no corre a medias.`);
    process.exit(1);
  }
  return value;
};

const uploadUrl = required("BACKUP_URL").replace(/\/+$/, "");
const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS?.trim() || "10");

if (!Number.isFinite(retentionDays) || retentionDays < 1) {
  console.error("[prune-backups] BACKUP_RETENTION_DAYS tiene que ser un entero positivo.");
  process.exit(1);
}

function authHeaders() {
  const headers = {};
  const authHeader = process.env.BACKUP_AUTH_HEADER?.trim();
  if (authHeader) {
    const separator = authHeader.indexOf(":");
    if (separator === -1) {
      throw new Error('BACKUP_AUTH_HEADER tiene que ser "Nombre: valor".');
    }
    headers[authHeader.slice(0, separator).trim()] = authHeader.slice(separator + 1).trim();
  }
  return headers;
}

// Mismo formato que arma `backup.mjs`: `new Date().toISOString().replace(/[:.]/g, "-")`.
const NAME_PATTERN = /^cvexact-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.dump\.enc$/;

function parsedAt(objectName) {
  const match = NAME_PATTERN.exec(objectName);
  if (!match) return null;
  const iso = match[1].replace(
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
    "$1T$2:$3:$4.$5Z",
  );
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

try {
  const listResponse = await fetch(`${uploadUrl}/`, { headers: authHeaders() });
  if (!listResponse.ok) {
    throw new Error(`el listado respondió ${listResponse.status} ${listResponse.statusText}`);
  }

  const entries = await listResponse.json();
  if (!Array.isArray(entries)) {
    throw new Error("el listado no devolvió un array — ¿$BACKUP_URL apunta a un directorio de Bunny Storage?");
  }

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  let deleted = 0;
  let kept = 0;
  let skipped = 0;

  for (const entry of entries) {
    if (entry.IsDirectory) continue;
    const at = parsedAt(entry.ObjectName);
    if (at === null) {
      // Un objeto que no matchea el patrón de nombre no se toca: puede ser
      // otra cosa guardada a mano en el mismo storage zone.
      skipped += 1;
      continue;
    }
    if (at.getTime() >= cutoff) {
      kept += 1;
      continue;
    }

    const response = await fetch(`${uploadUrl}/${entry.ObjectName}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (!response.ok) {
      throw new Error(
        `no se pudo borrar ${entry.ObjectName}: ${response.status} ${response.statusText}`,
      );
    }
    deleted += 1;
  }

  console.log(
    `[prune-backups] ${deleted} borrados, ${kept} dentro de los ${retentionDays} días, ` +
      `${skipped} ignorados (nombre no reconocido).`,
  );
} catch (err) {
  console.error("[prune-backups] falló:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
