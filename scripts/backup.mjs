// Copia de seguridad cifrada, fuera del nodo.
//
// El README lo tenía anotado en "Lo que falta" y era el agujero más caro del
// despliegue: el PVC es `local-path`, o sea un directorio en el disco del nodo,
// sin réplica y compartido con el CRM. Perder ese disco es perder los perfiles
// sincronizados y los saldos comprados a la vez — que además de ser una falla
// del deber de seguridad del art. 9 de la Ley 25.326, es plata cobrada por un
// servicio que después no se puede prestar.
//
// Un backup en el mismo nodo no es un backup: se pierde con lo que respalda. Por
// eso este script no escribe en disco, sube.
//
//   pg_dump --format=custom  →  AES-256-GCM  →  PUT a BACKUP_URL
//
// El formato custom ya viene comprimido y lo restaura `pg_restore`, así que no
// hace falta gzip aparte.
//
// --- CÓMO SE RESTAURA -------------------------------------------------------
//
// Un backup que no se sabe restaurar no es un backup. El archivo es
// `IV(12) || authTag(16) || ciphertext`, y se descifra con la misma
// BACKUP_ENCRYPTION_KEY:
//
//   node -e '
//     const fs=require("fs"),c=require("crypto");
//     const b=fs.readFileSync(process.argv[1]);
//     const d=c.createDecipheriv("aes-256-gcm",Buffer.from(process.env.BACKUP_ENCRYPTION_KEY,"hex"),b.subarray(0,12));
//     d.setAuthTag(b.subarray(12,28));
//     fs.writeFileSync("restore.dump",Buffer.concat([d.update(b.subarray(28)),d.final()]));
//   ' cvexact-2026-08-28.dump.enc
//   pg_restore --clean --if-exists -d "$DATABASE_URL" restore.dump
//
// `d.final()` tira si el authTag no valida, así que un archivo corrupto o
// manipulado falla al descifrar en vez de restaurar basura silenciosamente.
//
// **Probar esto contra una base vacía antes de necesitarlo.** Es el único paso
// que convierte este script en un backup y no en un archivo cifrado.
import { spawn } from "node:child_process";
import { createCipheriv, randomBytes } from "node:crypto";

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) {
    // Ruidoso y con salida distinta de cero: un backup que "anda" sin destino
    // configurado es peor que ninguno, porque nadie vuelve a mirarlo.
    console.error(`[backup] ${name} no está seteada. El job no corre a medias.`);
    process.exit(1);
  }
  return value;
};

const databaseUrl = required("DATABASE_URL");
const uploadUrl = required("BACKUP_URL").replace(/\/+$/, "");
const keyHex = required("BACKUP_ENCRYPTION_KEY");

if (!/^[0-9a-f]{64}$/i.test(keyHex)) {
  console.error(
    "[backup] BACKUP_ENCRYPTION_KEY tiene que ser 32 bytes en hexadecimal " +
      "(64 caracteres). Generar con: openssl rand -hex 32",
  );
  process.exit(1);
}

/**
 * Corre pg_dump y devuelve el volcado entero en memoria.
 *
 * Se bufferea a propósito en vez de streamear al PUT: el authTag de GCM se
 * calcula al final, así que streamear obliga a mandarlo aparte o a usar un body
 * duplex, y ninguna de las dos cosas vale la pena para una base que hoy pesa
 * decenas de MB en un volumen de 5 GiB. Si algún día el volcado pasa los ~200
 * MB, este es el lugar que hay que cambiar — a `rclone` o a un stream con el tag
 * en un trailer — y el límite de memoria del CronJob es lo que va a avisar.
 */
function dump() {
  return new Promise((resolve, reject) => {
    // `--format=custom` para poder restaurar selectivamente; `--no-owner` porque
    // el rol destino puede no ser el mismo en una restauración de emergencia.
    const child = spawn(
      "pg_dump",
      ["--format=custom", "--no-owner", "--no-acl", databaseUrl],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    const chunks = [];
    let stderr = "";
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      // El bug clásico de los backups: subir lo que alcanzó a salir de un
      // pg_dump que falló. Un volcado truncado se restaura sin error aparente y
      // se descubre cuando ya no hay original.
      if (code !== 0) {
        reject(new Error(`pg_dump salió con código ${code}: ${stderr.trim()}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
}

try {
  const plain = await dump();
  if (plain.length === 0) throw new Error("pg_dump devolvió un volcado vacío.");

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const payload = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);

  const name = `cvexact-${new Date().toISOString().replace(/[:.]/g, "-")}.dump.enc`;

  const headers = { "content-type": "application/octet-stream" };
  // Un solo header, con el nombre y el valor que pida el destino. Así el mismo
  // script sirve para un bucket con bearer, para uno con una API key propia, o
  // para un Worker de Cloudflare delante de R2, sin que este archivo tenga que
  // saber de ninguno de los tres.
  const authHeader = process.env.BACKUP_AUTH_HEADER?.trim();
  if (authHeader) {
    const separator = authHeader.indexOf(":");
    if (separator === -1) {
      throw new Error('BACKUP_AUTH_HEADER tiene que ser "Nombre: valor".');
    }
    headers[authHeader.slice(0, separator).trim()] = authHeader.slice(separator + 1).trim();
  }

  const response = await fetch(`${uploadUrl}/${name}`, {
    method: "PUT",
    headers,
    body: payload,
  });

  if (!response.ok) {
    throw new Error(`el destino respondió ${response.status} ${response.statusText}`);
  }

  console.log(
    `[backup] ${name}: ${(plain.length / 1024 ** 2).toFixed(1)} MiB en claro, ` +
      `${(payload.length / 1024 ** 2).toFixed(1)} MiB cifrados, subidos.`,
  );
} catch (err) {
  console.error("[backup] falló:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
