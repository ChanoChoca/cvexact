import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { NextConfig } from "next";
import { experimentOnServer } from "./lib/experiments";

/**
 * Security headers, set here rather than at the proxy.
 *
 * They used to exist only in the reverse-proxy config of the docker-compose
 * deployment, which covered that path and nothing else — the k3s path this
 * actually runs on goes through HAProxy, which never replicated them. A header
 * that protects one of two deployments protects the one nobody uses. Setting
 * them in the framework makes them true wherever the app runs, and leaves no
 * copy at the proxy to drift from this one.
 */
/**
 * Google Analytics (`components/analytics/GoogleAnalytics.tsx`), con los hosts
 * que documenta Google para gtag.js y GA4. Sin ellos el navegador bloquea el
 * script y los envíos, y GA falla en silencio: sólo lo dice la consola.
 *
 * Esto cambia el modelo de amenaza que explica `connect-src` más abajo. Los
 * endpoints de `*.google-analytics.com` aceptan eventos para CUALQUIER ID de
 * medición, así que un XSS podría mandar una key robada como parámetro de un
 * evento a una propiedad propia: es un destino adonde una key robada SÍ se puede
 * enviar. Se acepta a sabiendas, porque se quiere medir el sitio.
 *
 * Estos headers se calculan en el build, donde `GA_MEASUREMENT_ID` no existe, así
 * que los hosts quedan permitidos aunque GA esté apagado. Si el costo deja de
 * valer la pena, la salida es medir desde el servidor o detrás de un proxy
 * propio —con lo que `connect-src` vuelve a ser `'self'`—, no aflojar más esta
 * lista. `tests/analytics.test.ts` fija estos hosts, y falla si alguien
 * «endurece» la CSP y apaga GA sin darse cuenta.
 *
 * El script sale de un solo host; los envíos van a regiones distintas según la
 * propiedad (`region1.google-analytics.com`), de ahí los comodines.
 */
const GA_SCRIPT_SRC = "https://www.googletagmanager.com";
const GA_IMG_SRC = "https://*.google-analytics.com https://*.googletagmanager.com";
const GA_CONNECT_SRC =
  "https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com";

/**
 * `api.github.com`, and only when the build turns on reading GitHub from the browser (`github_projects`, `lib/experiments.ts`: e5, O19), which it does
 * not by default. With it off the policy is exactly what it was, and `connect-src` says nothing of GitHub: a destination that is not used is not one to
 * leave open.
 *
 * Turned on, it is one more place a stolen BYOK key could be sent — the same cost as GA's hosts above, and for the same reason it cannot be avoided:
 * the browser has to be the one that asks GitHub, because the sixty questions an hour that GitHub allows without an account are counted per address,
 * and a server asking for everyone would use them up for everyone. What keeps the cost narrow is that it is one host and not a wildcard, that a
 * request to it can only *read* without a token of the attacker's own, and that `tests/github-csp.test.ts` fixes all three. It is read when the
 * headers are built, so it is the build that decides, like the switch itself; and in production a switch that asks for the policy is not on, whatever
 * the build says, until `LEGAL_VERSION` covers it.
 */
const GITHUB_CONNECT_SRC = experimentOnServer("github_projects") ? " https://api.github.com" : "";

const CSP = [
  "default-src 'self'",
  /**
   * `unsafe-inline` is not a choice: the App Router streams hydration data as
   * inline `<script>` tags, and the alternative is a per-request nonce, which
   * needs a middleware running on every request. `unsafe-eval` stays because
   * pdf.js — which parses the CVs people import, in the browser — reaches for
   * it on paths that are hard to prove unused from here.
   *
   * So this directive is not what stops an XSS. `connect-src` below is: the
   * payload that matters on this origin steals the BYOK provider keys out of
   * localStorage, and stealing them is only useful if it can also send them
   * somewhere. That step is what gets blocked.
   */
  // Cloudflare inyecta este script cuando Web Analytics está prendido en el
  // panel, en toda respuesta HTML que pasa por su proxy — no es algo que este
  // config controle, así que sin el allow-list rompe (bloqueado, no ausente).
  // `challenges.cloudflare.com` es Turnstile (`TurnstileWidget.tsx`, cargado
  // en alta, login y reenvío de verificación por correo cuando
  // `TURNSTILE_SECRET_KEY` está seteada): sin este origen acá, el script del
  // widget no carga y esos tres flujos quedan rotos, porque el plugin de
  // `lib/auth.ts` exige el token igual y el cliente nunca consigue uno.
  // Confirmado contra producción antes de este cambio.
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://static.cloudflareinsights.com https://challenges.cloudflare.com ${GA_SCRIPT_SRC}`,
  // El widget de Turnstile de arriba también renderiza un iframe desde el
  // mismo origen — sin esto, `default-src 'self'` lo bloquea aunque el script
  // sí haya cargado, y el resultado es el mismo: sin iframe no hay checkbox
  // que resolver, no hay token, y el POST del servidor lo rechaza.
  "frame-src 'self' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  // next/font/google self-hosts at build time, so no external font origin.
  "font-src 'self' data:",
  `img-src 'self' data: blob: ${GA_IMG_SRC}`,
  // Nothing in the browser talks to anyone but us: BYOK keys travel to our own
  // API in a header and the provider call happens server-side. One exception
  // is opt-in: turning on "afinidad semántica" in /empleos makes
  // `embedder.worker.ts` download `multilingual-e5-small` from Hugging Face
  // directly, in the browser — see the comment on SEMANTIC_JOBS_KEY in
  // lib/storage/local.ts. Small files (config.json, tokenizer.json) serve
  // straight off huggingface.co; the model weights themselves 302 to a
  // per-region LFS host under hf.co (verified: us.aws.cdn.hf.co) — hence the
  // wildcard rather than a fixed hostname, which would break for a visitor
  // whose request lands on a different region.
  // The ONNX runtime's WASM engine that model needs is served from /ort/ on our
  // own origin (`scripts/copy-ort-wasm.mjs`), not from jsDelivr as the library
  // defaults to: a CDN here would let a third party's script run in the page.
  // The beacon above still needs somewhere to report to; same origin,
  // narrowly scoped, not a place a stolen BYOK key could usefully be sent.
  // The other exception is Google Analytics, and unlike the two above it is not
  // narrow: see GA_CONNECT_SRC.
  `connect-src 'self' https://huggingface.co https://*.hf.co https://cloudflareinsights.com https://static.cloudflareinsights.com ${GA_CONNECT_SRC}${GITHUB_CONNECT_SRC}`,
  // pdf.js loads its worker from /pdf.worker.min.mjs; docx and pdf downloads
  // hand the browser a blob: URL.
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  // The same statement as X-Frame-Options below, for browsers that prefer it.
  "frame-ancestors 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Nothing here asks for any of them, so nothing should be able to.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
];

/**
 * `public/plantilla-cv.html` es el espécimen de referencia del CV: el diseño de
 * `docs/plantilla-cv.md` en un HTML autocontenido, con contenido ficticio, que
 * `/cv/demo/print` reproduce y que se abre al lado para comprobar que el
 * renderer no se movió. No se le mete el `noindex` en el HTML para poder
 * compararlo tal cual con el render; ningún enlace lo apunta, pero es rastreable
 * por cualquiera que conozca la URL y duplica esa página. Un header es la forma
 * de negarle la indexación sin tocar el archivo.
 *
 * No se suma además al `Disallow` de `app/robots.ts`: bloqueado el rastreo, el
 * header no se leería nunca.
 */
const NOINDEX_HEADERS = [{ key: "X-Robots-Tag", value: "noindex" }];

/**
 * A short hash of `public/embedder.worker.js`, which `JobsList.tsx` puts in the
 * worker's URL. Cloudflare gives every `.js` a 4 h browser cache lifetime, so
 * a worker requested at the same URL after a deploy can keep running the
 * previous version for hours — which is exactly how the toggle kept failing in
 * production after its fix was live. The file is written by `predev`/`prebuild`
 * (`scripts/build-embedder-worker.mjs`), before this config is read.
 */
function embedderWorkerVersion(): string {
  try {
    const bytes = readFileSync(new URL("./public/embedder.worker.js", import.meta.url));
    return createHash("sha1").update(bytes).digest("hex").slice(0, 10);
  } catch {
    return "dev";
  }
}

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_EMBEDDER_WORKER_V: embedderWorkerVersion() },

  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      { source: "/plantilla-cv.html", headers: NOINDEX_HEADERS },
    ];
  },

  // Emits .next/standalone/server.js so the Docker image can run without
  // installing node_modules. See Dockerfile for the public/ and .next/static
  // copies that server.js does not make on its own.
  output: "standalone",

  // playwright-core resolves parts of itself at runtime, so bundling it leaves
  // a module that cannot find its own files. External means the server
  // `require`s it instead.
  serverExternalPackages: ["playwright-core"],

  // ...and the tracer still does not follow it into .next/standalone on its
  // own — the dynamic requires it is external *for* are the same ones static
  // analysis cannot see. Without this the PDF route throws
  // "Cannot find module 'playwright-core'" in the Docker image and nowhere
  // else, since `pnpm dev` and `pnpm start` both read the real node_modules.
  outputFileTracingIncludes: {
    "/api/export/pdf": ["./node_modules/playwright-core/**/*"],
  },

  // Dev-only chrome, never shipped — but its default corner (bottom-left)
  // now sits under the mobile tab bar's first item (see AppShell.tsx), so
  // moving it is the difference between a dev build that is annoying to
  // click around in and one that isn't.
  devIndicators: {
    position: "top-right",
  },
};

export default nextConfig;
