// Comprueba, sin Git, qué archivos formarían parte de una publicación y si
// alguno es sensible. Git todavía no está inicializado en este checkout, así
// que no hay índice ni historial que auditar: la fuente de verdad es el árbol
// de trabajo más las reglas de `.gitignore` que este script verifica.
//
// Uso:
//   pnpm audit:publication           resumen y errores
//   pnpm audit:publication -- --list lista los archivos publicables
//
// Sale con código 1 si falta una regla crítica de `.gitignore`, si aparece un
// archivo que debería estar ignorado o si un patrón de secreto coincide.
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Reglas que sostienen la publicación. No se valida el archivo completo: se
// exige que estas líneas sigan presentes para que un cambio accidental no
// abra un agujero silencioso.
const REQUIRED_GITIGNORE = [
  "/node_modules",
  "/.next/",
  "/coverage",
  ".env*",
  "!.env.example",
  ".dev.vars*",
  "workers/*/.dev.vars*",
  "*.pem",
  "*.tsbuildinfo",
  "next-env.d.ts",
  "/public/pdf.worker.min.mjs",
  "/public/embedder.worker.js",
  "/public/ort/",
  "/public/ocr/",
  "/public/*.json",
  "/frontend.yaml",
  "/postgres.yaml",
  "/cvexact-production.yaml",
  "/cvexact-postgres-bootstrap.yaml",
  "/backend-test.yaml",
  "/frontend-test.yaml",
  "workers/*/node_modules",
  "workers/*/.wrangler",
  "extension/node_modules",
  "extension/.wxt",
  "extension/.output",
  "/*-perfil.json",
  "**/*-perfil.json",
  "*.zip",
  "/public/*.pdf",
  "/public/*.docx",
];

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "coverage",
  ".vercel",
  ".vscode",
  ".claude",
  ".wxt",
  ".output",
  ".wrangler",
]);

const SECRET_PATTERNS = [
  ["Google API key", /AIza[0-9A-Za-z_-]{30,}/g],
  ["OpenAI-style key", /sk-(?!test-|example-|not-a-real)[A-Za-z0-9_-]{20,}/g],
  ["GitHub token", /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/g],
  ["Slack token", /xox[baprs]-[A-Za-z0-9-]{10,}/g],
  ["Mercado Pago token", /APP_USR-[A-Za-z0-9-]{10,}/g],
  ["Resend key", /re_[A-Za-z0-9]{20,}/g],
  ["JWT", /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g],
  ["AWS key", /AKIA[0-9A-Z]{16}/g],
  ["Private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  [
    "Generic secret assignment",
    /\b(?:api[_-]?key|secret|token|password|passwd|access[_-]?key)\b\s*[:=]\s*["']([^"']{16,})["']/gi,
  ],
  [
    "Generic secret in YAML",
    /^\s*(?:api[_-]?key|secret|token|password|passwd|access[_-]?key)\s*:\s*([A-Za-z0-9_./+-]{16,})\s*$/gim,
  ],
];

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".yml", ".yaml",
  ".toml", ".css", ".html", ".sql", ".txt", ".conf", ".sh", ".example",
]);

const ROOT_MANIFESTS = new Set([
  "frontend.yaml",
  "postgres.yaml",
  "cvexact-production.yaml",
  "cvexact-postgres-bootstrap.yaml",
  "backend-test.yaml",
  "frontend-test.yaml",
]);

function toPosix(path) {
  return path.split(sep).join("/");
}

function isPublishableFile(rel) {
  const base = rel.split("/").at(-1) ?? rel;

  if (ROOT_MANIFESTS.has(rel)) return false;
  if (rel === ".env.example") return true;
  if (base.startsWith(".env")) return false;
  if (base.startsWith(".dev.vars")) return false;
  if (/\.(?:pem|key|p12|pfx)$/i.test(base)) return false;
  if (/\.(?:log|tsbuildinfo)$/i.test(base)) return false;
  if (base === "next-env.d.ts") return false;
  if (rel === "public/pdf.worker.min.mjs" || rel === "public/embedder.worker.js") return false;
  if (rel.startsWith("public/ort/") || rel.startsWith("public/ocr/")) return false;
  if (/^public\/[^/]+\.json$/i.test(rel)) return false;
  if (/^public\/[^/]+\.(?:pdf|docx)$/i.test(rel)) return false;
  if (/(?:^|\/)[^/]*-perfil\.json$/i.test(rel)) return false;
  if (/\.zip$/i.test(base)) return false;
  return true;
}

function shouldSkipDir(rel) {
  const parts = rel.split("/");
  if (parts.some((part) => SKIP_DIRS.has(part))) return true;
  // `.gitignore` sólo ignora `/notes/` en la raíz; `components/notes` etc. son código.
  if (rel === "notes") return true;
  return rel === "public/ort" || rel === "public/ocr";
}

async function walk(dir, out = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    const rel = toPosix(relative(ROOT, abs));
    if (entry.isDirectory()) {
      if (!shouldSkipDir(rel)) await walk(abs, out);
      continue;
    }
    if (entry.isFile() && isPublishableFile(rel)) out.push(rel);
  }
  return out;
}

function isText(rel) {
  if (rel === ".env.example") return true;
  const dot = rel.lastIndexOf(".");
  return dot !== -1 && TEXT_EXTENSIONS.has(rel.slice(dot).toLowerCase());
}

function allowedSecretValue(value) {
  const normalized = value.toLowerCase();
  return (
    normalized.startsWith("ci-only-") ||
    normalized.startsWith("test-") ||
    normalized.startsWith("example-") ||
    normalized.startsWith("not-a-real") ||
    normalized.startsWith("placeholder") ||
    normalized.startsWith("your-") ||
    normalized.startsWith("dummy") ||
    normalized.startsWith("una-") ||
    normalized.startsWith("un-") ||
    normalized.startsWith("secreto-") ||
    normalized.startsWith("clave-") ||
    normalized.startsWith("a-different-") ||
    normalized.startsWith("http://") ||
    normalized.startsWith("https://") ||
    normalized.includes("process.env") ||
    normalized.startsWith("$") ||
    normalized.startsWith("[") ||
    normalized.startsWith("xxxx")
  );
}

async function main() {
  const gitignore = await readFile(join(ROOT, ".gitignore"), "utf8");
  const lines = new Set(gitignore.split(/\r?\n/).map((line) => line.trim()));
  const missingRules = REQUIRED_GITIGNORE.filter((rule) => !lines.has(rule));

  const files = (await walk(ROOT)).sort();
  const offenders = [];
  const leaks = [];

  for (const rel of files) {
    // El propio auditor contiene los patrones que busca; escanearlo daría
    // siempre falsos positivos.
    if (rel === "scripts/audit-publication.mjs") continue;
    if (!isText(rel)) continue;

    const content = await readFile(join(ROOT, rel), "utf8");
    for (const [name, pattern] of SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      for (const match of content.matchAll(pattern)) {
        const value = match[1] ?? match[0];
        if (name === "Generic secret assignment" && allowedSecretValue(value)) continue;
        const line = content.slice(0, match.index ?? 0).split("\n").length;
        leaks.push(`${rel}:${line}: ${name}`);
      }
    }
  }

  if (missingRules.length > 0) {
    offenders.push(`Faltan reglas en .gitignore: ${missingRules.join(", ")}`);
  }
  if (leaks.length > 0) {
    offenders.push(...leaks);
  }

  console.log("CVExact · auditoría de publicación");
  console.log(`Archivos que se publicarían: ${files.length}`);
  console.log(
    `Reglas críticas de .gitignore: ${REQUIRED_GITIGNORE.length - missingRules.length}/${REQUIRED_GITIGNORE.length}`,
  );
  console.log(`Coincidencias de secretos: ${leaks.length}`);

  if (process.argv.includes("--list")) {
    console.log("\nArchivos:");
    for (const rel of files) console.log(`  ${rel}`);
  }

  if (offenders.length > 0) {
    console.error("\nProblemas:");
    for (const offender of offenders) console.error(`  - ${offender}`);
    process.exitCode = 1;
    return;
  }

  console.log("OK: no hay archivos sensibles ni secretos evidentes en la publicación.");
}

main().catch((error) => {
  console.error("audit-publication: error inesperado:", error);
  process.exitCode = 1;
});
