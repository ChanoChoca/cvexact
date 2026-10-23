// Falla el build si la identidad legal quedó horneada en HTML estático.
//
// El bug que esto atrapa: `operator()` (`lib/legal/operator.ts`) lee
// `LEGAL_OPERATOR_NAME`, `LEGAL_CONTACT_EMAIL`, `LEGAL_RNBD_NUMBER`, etc. del
// entorno. Esas variables sólo existen en el pod de producción — nunca
// durante `docker build`, porque `.dockerignore` excluye `.env` a propósito
// (ver su comentario de cabecera). Una ruta que Next prerenderiza en el build
// (`revalidate` en vez de `dynamic = "force-dynamic"`, o sin ninguna config)
// queda con el HTML de ESE momento grabado para siempre: el Secret de k3s es
// puro runtime y un `kubectl rollout restart` no lo corrige, porque no hay
// nuevo render que lo lea — sólo un nuevo build.
//
// Se verificó contra producción que la hipótesis "ISR de una hora lo
// corrige solo" no se cumple en este despliegue: `/legales/privacidad`
// sirvió «[pendiente de carga]» con `x-nextjs-cache: HIT` mucho después de
// vencido ese plazo, mientras rutas ya dinámicas (`/ajustes`) mostraban el
// valor correcto del mismo pod en el mismo momento. De ahí que todas las
// rutas que muestran identidad legal pasen a `force-dynamic` (ver
// `app/page.tsx` y las demás), y que este script exista para que, si alguien
// vuelve a agregar `revalidate` sin darse cuenta de por qué se sacó, el build
// avise en vez de servir la afirmación falsa en silencio.
//
// El placeholder es un literal y no un import de `lib/legal/operator.ts` a
// propósito: este script corre con `node` plano, sin loader de TypeScript
// (igual que el resto de `scripts/*.mjs`), después de que `next build` ya
// terminó — no antes, cuando `operator.ts` sí se transpila como parte de la
// app. Si `PENDING` cambia ahí, cambiar también acá.
//
// Corre como `postbuild` (ver package.json), así que un `pnpm run build`
// normal ya lo ejecuta — no hace falta acordarse de un paso aparte.
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PLACEHOLDER = "[pendiente de carga]";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const appDir = join(root, ".next", "server", "app");

// Tanto el `.html` (carga inicial) como el `.rsc` (navegación del lado del
// cliente entre rutas ya cargadas) llevan el mismo render horneado — un
// usuario puede llegar a cualquiera de los dos caminos.
const CHECKED_EXTENSIONS = new Set([".html", ".rsc"]);

async function collectFiles(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }

  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return collectFiles(path);
      const dot = entry.name.lastIndexOf(".");
      const ext = dot === -1 ? "" : entry.name.slice(dot);
      return CHECKED_EXTENSIONS.has(ext) ? [path] : [];
    }),
  );
  return files.flat();
}

async function main() {
  const files = await collectFiles(appDir);

  if (files.length === 0) {
    console.error(
      `verify-build-legal: no se encontró nada en ${appDir} — ¿corrió antes de "next build"?`,
    );
    process.exitCode = 1;
    return;
  }

  const offenders = [];
  for (const file of files) {
    const content = await readFile(file, "utf8");
    const count = content.split(PLACEHOLDER).length - 1;
    if (count > 0) offenders.push({ file: file.slice(root.length + 1), count });
  }

  if (offenders.length === 0) {
    console.log(`verify-build-legal: identidad legal OK en ${files.length} archivo(s).`);
    return;
  }

  console.error(
    `verify-build-legal: "${PLACEHOLDER}" quedó horneado en ${offenders.length} archivo(s) ` +
      `prerenderizado(s). Esto significa que alguna ruta que muestra identidad legal ` +
      `(footer, /legales/privacidad, /legales/terminos, ...) no tiene ` +
      `\`export const dynamic = "force-dynamic"\` — ver el comentario de cabecera de este ` +
      `script y de app/page.tsx.\n`,
  );
  for (const { file, count } of offenders) {
    console.error(`  ${file}  (${count}×)`);
  }
  process.exitCode = 1;
}

main().catch((err) => {
  console.error("verify-build-legal: error inesperado:", err);
  process.exitCode = 1;
});
