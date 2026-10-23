// Verifica el enlace AGPL del artefacto de publicación.
//
// El bug que esto atrapa: `NEXT_PUBLIC_SOURCE_URL` es una variable
// `NEXT_PUBLIC_*`, así que Next la reemplaza en el bundle durante `next build`.
// Definirla en el pod después de compilar no cambia el HTML. Este script exige
// que el build haya usado una URL real y arranca el standalone SIN la variable
// en runtime para comprobar que el valor quedó horneado en las tres páginas
// públicas que muestran el pie.
//
// Uso:
//   NEXT_PUBLIC_SOURCE_URL='https://.../tree/<tag-o-commit>' pnpm build
//   NEXT_PUBLIC_SOURCE_URL='https://.../tree/<tag-o-commit>' pnpm verify:publication-source
//
// Sin `--require`, un build de desarrollo/CI con la variable vacía se omite con
// exit 0. El script de package.json usa `--require`: un build de publicación
// sin URL falla.
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const requireConfigured = process.argv.includes("--require");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const standaloneDir = join(root, ".next", "standalone");
const serverFile = join(standaloneDir, "server.js");

const LINK_TEXT = "Código fuente";
const ROUTES = ["/", "/legales/privacidad", "/legales/terminos"];
const FAKE_HOSTS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
]);
const FAKE_TLDS = [".test", ".invalid", ".example"];

function normalizeUrl(value) {
  return value.replace(/\/+$/, "");
}

function validateSourceUrl(raw) {
  if (/[<>]/.test(raw) || /\b(?:OWNER|REPO|RAMA)\b/.test(raw)) {
    throw new Error(`la URL parece un placeholder, no una URL real: ${raw}`);
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`NEXT_PUBLIC_SOURCE_URL no es una URL válida: ${raw}`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`NEXT_PUBLIC_SOURCE_URL tiene que ser http(s): ${raw}`);
  }

  const host = url.hostname.toLowerCase();
  if (FAKE_HOSTS.has(host) || [...FAKE_HOSTS].some((fake) => host.endsWith(`.${fake}`))) {
    throw new Error(`NEXT_PUBLIC_SOURCE_URL usa un host ficticio: ${host}`);
  }
  if (FAKE_TLDS.some((suffix) => host.endsWith(suffix))) {
    throw new Error(`NEXT_PUBLIC_SOURCE_URL usa un dominio reservado para pruebas: ${host}`);
  }

  if (/\/(?:tree|blob)\/(?:main|master)(?:\/|$)/i.test(url.pathname)) {
    throw new Error(
      `NEXT_PUBLIC_SOURCE_URL apunta a una rama móvil; usá el tag o commit desplegado: ${raw}`,
    );
  }

  const pointsToVersion =
    /\/(?:tree|commit|releases\/tag)\/[^/]+/.test(url.pathname) ||
    /\/archive\/refs\/tags\/[^/]+/.test(url.pathname);
  if (!pointsToVersion) {
    throw new Error(
      `NEXT_PUBLIC_SOURCE_URL no apunta a un tag o commit identificable: ${raw}\n` +
        "Se espera /tree/<tag>, /commit/<sha>, /releases/tag/<tag> o /archive/refs/tags/<tag>.",
    );
  }

  return normalizeUrl(url.toString());
}

function findSourceHref(html) {
  const links = html.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi);
  for (const [, href, inner] of links) {
    const text = inner
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (text === LINK_TEXT) return href.replace(/&amp;/g, "&");
  }
  return null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url, child, logs) {
  const deadline = Date.now() + 30_000;
  let lastError;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `el standalone terminó antes de responder (exit ${child.exitCode}).\n${logs()}`,
      );
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await wait(250);
  }

  throw new Error(`el standalone no respondió en 30 s: ${lastError?.message ?? "sin detalle"}`);
}

async function main() {
  const raw = process.env.NEXT_PUBLIC_SOURCE_URL?.trim();
  if (!raw) {
    const message =
      "NEXT_PUBLIC_SOURCE_URL no está definida; no se puede verificar el enlace AGPL del build.";
    if (requireConfigured) throw new Error(`${message} Un build de publicación necesita una URL real.`);
    console.log(`verify-public-source: omitido — ${message}`);
    return;
  }

  const expectedHref = validateSourceUrl(raw);

  try {
    await access(serverFile);
  } catch {
    throw new Error(
      `no existe ${serverFile}. Corré "pnpm build" con NEXT_PUBLIC_SOURCE_URL antes de verificar.`,
    );
  }

  const port = await freePort();
  const env = { ...process.env, PORT: String(port), HOSTNAME: "127.0.0.1" };
  // A propósito: si el build horneó la URL, el HTML la muestra aunque el
  // runtime no la tenga. Si dependiera del entorno del pod, este test fallaría.
  delete env.NEXT_PUBLIC_SOURCE_URL;

  const child = spawn(process.execPath, [serverFile], {
    cwd: standaloneDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  const collect = (chunk) => {
    output = `${output}${chunk}`.slice(-4_000);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);

  try {
    const base = `http://127.0.0.1:${port}`;
    await waitForServer(`${base}/`, child, () => output);

    for (const route of ROUTES) {
      const response = await fetch(`${base}${route}`);
      if (!response.ok) throw new Error(`${route} respondió HTTP ${response.status}`);

      const html = await response.text();
      const href = findSourceHref(html);
      if (!href) {
        throw new Error(
          `${route} no muestra el enlace «${LINK_TEXT}». ` +
            "El build no incluyó NEXT_PUBLIC_SOURCE_URL o la página dejó de renderizar el pie.",
        );
      }
      if (normalizeUrl(href) !== expectedHref) {
        throw new Error(
          `${route} muestra un href distinto del esperado:\n  esperado: ${expectedHref}\n  obtenido: ${href}`,
        );
      }
    }

    console.log(
      `verify-public-source: OK — enlace «${LINK_TEXT}» presente en ${ROUTES.length} rutas ` +
        `con el valor horneado ${expectedHref} (runtime sin la variable).`,
    );
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await wait(500);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  }
}

main().catch((error) => {
  console.error(`verify-public-source: ${error.message}`);
  process.exitCode = 1;
});

