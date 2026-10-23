import { browser } from "wxt/browser";
import {
  ApiError,
  clearAuth,
  createApplication,
  getAuth,
  lookupByUrl,
  parseHtml,
  setAuth,
  type ParsedJob,
} from "../../lib/api";

/**
 * El popup entero, sin framework — es chico y no vale la pena la
 * dependencia. Cada `render*` reemplaza el contenido de `#app` y cablea sus
 * propios listeners; no hay nada async "en segundo plano" salvo lo que el
 * propio popup dispara (buscar el estado al abrir, capturar al apretar el
 * botón) — coherente con "nunca corre sola" del resto de la Fase 4.
 */

const DEFAULT_API_URL = "https://cvexact.com";

const app = document.getElementById("app")!;

async function activeTab(): Promise<{ id: number; url: string } | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) return null;
  // about:, chrome://, y las páginas de la propia tienda de extensiones no
  // son avisos de trabajo — evita intentar leerlas y fallar feo.
  if (!/^https?:\/\//.test(tab.url)) return null;
  return { id: tab.id, url: tab.url };
}

async function readPageHtml(tabId: number): Promise<string> {
  const [result] = await browser.scripting.executeScript({
    target: { tabId },
    // Corre inyectado en la página, no en el popup: no puede usar imports ni
    // closures de afuera, sólo el DOM global. Recorta lo que el parser del
    // servidor no lee (scripts, estilos, SVGs, nodos ocultos) para no mandar
    // el megabyte de payload interno que traen sitios como LinkedIn — el
    // JSON-LD, si existe, se preserva completo y aparte de este recorte,
    // porque es la fuente que ya resuelve todo lo demás cuando está.
    func: () => {
      const KEEP_HEAD_SELECTOR =
        'title, meta[property^="og:"], meta[name="description"], meta[name^="twitter:"], link[rel="canonical"]';
      const PRUNE_SELECTOR =
        'script, style, svg, noscript, iframe, template, [hidden], [style*="display: none" i], [style*="display:none" i]';
      const jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
        .map((el) => el.outerHTML)
        .join("");
      const head = Array.from(document.head.querySelectorAll(KEEP_HEAD_SELECTOR))
        .map((el) => el.outerHTML)
        .join("");

      const pruneClone = (el: Element, markAnchor: boolean): Element => {
        const clone = el.cloneNode(true) as Element;
        // Marca que `lib/tracker/site-rules/linkedin-post.ts` busca en el
        // servidor para saber cuál de varias publicaciones es esta — nunca
        // se toca el DOM real de la página, sólo este clon descartable.
        if (markAnchor) clone.setAttribute("data-cvexact-anchor", "1");
        clone.querySelectorAll(PRUNE_SELECTOR).forEach((node) => node.remove());
        return clone;
      };

      // Una publicación del feed/búsqueda de contenido de LinkedIn no tiene
      // ningún id de aviso en la URL — la única señal de cuál de las varias
      // tarjetas visibles quiso la persona es lo que ya tenía seleccionado
      // al apretar "Capturar" (mismo gesto que ya hacía a mano: seleccionar
      // el texto del puesto). Sin selección, y sólo si hay una única
      // publicación en toda la página (el caso de abrir una publicación
      // sola), se ancla igual. Esto no lee nada que la persona no tuviera
      // ya en pantalla, y en cualquier página que no sea así (incluidos los
      // avisos de /jobs/, que no tienen este atributo) no encuentra nada y
      // sigue exactamente el camino de siempre.
      let card: Element | null = null;
      const selection = document.getSelection();
      const anchorNode = selection?.anchorNode ?? null;
      if (anchorNode) {
        const anchorEl = anchorNode.nodeType === Node.TEXT_NODE ? anchorNode.parentElement : (anchorNode as Element);
        card = anchorEl?.closest('[componentkey^="update-card-focus"]') ?? null;
      }
      if (!card) {
        const candidates = document.querySelectorAll('[componentkey^="update-card-focus"]');
        if (candidates.length === 1) card = candidates[0]!;
      }

      const fragment = card ? pruneClone(card, true).outerHTML : pruneClone(document.body, false).outerHTML;
      return `${jsonLd}${head}${fragment}`.replace(/\s+/g, " ");
    },
  });
  return (result?.result as string) ?? "";
}

function setBadge(tabId: number | undefined, text: string, color: string) {
  if (!tabId) return;
  void browser.action.setBadgeText({ tabId, text });
  void browser.action.setBadgeBackgroundColor({ tabId, color });
}

// --- Pantallas ---------------------------------------------------------------

function renderConnect(error?: string) {
  // El campo de URL sólo tiene sentido en desarrollo, para apuntar a un
  // backend local sin recompilar (ver README). En producción la extensión
  // sólo habla con https://cvexact.com, así que no tiene caso pedírselo al
  // usuario.
  const urlField = import.meta.env.DEV
    ? `<label for="apiUrl">URL de la app</label>
       <input id="apiUrl" value="${DEFAULT_API_URL}" />`
    : "";
  app.innerHTML = `
    <p class="eyebrow">Conectar cuenta</p>
    <h1>cvexact</h1>
    <p>Pegá el token que generaste desde <strong>Postulaciones</strong> en la app.</p>
    ${urlField}
    <label for="token">Token</label>
    <input id="token" placeholder="cvt_…" />
    ${error ? `<p class="error">${error}</p>` : ""}
    <button id="connect">Conectar</button>
  `;
  document.getElementById("connect")!.addEventListener("click", async () => {
    const apiUrlInput = document.getElementById("apiUrl") as HTMLInputElement | null;
    const apiUrl = apiUrlInput ? apiUrlInput.value.trim() : DEFAULT_API_URL;
    const token = (document.getElementById("token") as HTMLInputElement).value.trim();
    if (!apiUrl || !token) {
      renderConnect(apiUrlInput ? "Completá los dos campos." : "Completá el token.");
      return;
    }
    await setAuth({ apiUrl, token });
    await boot();
  });
}

function renderLoading(message: string) {
  app.innerHTML = `<p class="loading"><span class="spinner"></span>${message}</p>`;
}

function renderError(message: string, retry: () => void) {
  app.innerHTML = `
    <p class="error">${message}</p>
    <button id="retry" class="secondary">Reintentar</button>
    <button id="disconnect" class="ghost">Desconectar</button>
  `;
  document.getElementById("retry")!.addEventListener("click", retry);
  document.getElementById("disconnect")!.addEventListener("click", async () => {
    await clearAuth();
    renderConnect();
  });
}

function renderNoTab() {
  app.innerHTML = `<p>Esta pestaña no es una página de un aviso — abrí uno para capturarlo.</p>`;
}

function renderTracked(job: { status: string; jobTitle: string | null }, apiUrl: string) {
  app.innerHTML = `
    <p class="eyebrow">Ya está en tu seguimiento</p>
    <h1>${job.jobTitle ?? "Sin título"}</h1>
    <span class="badge good">${job.status}</span>
    <div class="footer">
      <a href="${apiUrl}/postulaciones" target="_blank" rel="noopener">Ver en cvexact →</a>
      <button id="disconnect" class="ghost">Desconectar</button>
    </div>
  `;
  document.getElementById("disconnect")!.addEventListener("click", async () => {
    await clearAuth();
    renderConnect();
  });
}

/**
 * `isFeedUrl` distingue sólo el texto de ayuda — no cambia qué se lee ni
 * cuándo (eso lo decide `readPageHtml`, mirando la selección real, no la
 * URL). En una búsqueda de contenido o el feed no hay un único aviso que
 * "este" botón pueda identificar solo, así que el copy se lo dice antes de
 * que la persona apriete y no pase nada reconocible.
 */
function renderCapturePrompt(onCapture: () => void, onDisconnect: () => void, isFeedUrl: boolean) {
  app.innerHTML = `
    <p class="eyebrow">cvexact</p>
    <h1>Capturar este aviso</h1>
    <p>${
      isFeedUrl
        ? "Esto es un feed con varias publicaciones. Seleccioná el texto de la que te interesa y después apretá el botón — sólo se lee esa publicación, no el resto."
        : "Lee el título, la empresa y el resto del aviso desde esta página — recién cuando apretás el botón, nunca sola."
    }</p>
    <button id="capture">Capturar este aviso</button>
    <div class="footer">
      <span></span>
      <button id="disconnect" class="ghost">Desconectar</button>
    </div>
  `;
  document.getElementById("capture")!.addEventListener("click", onCapture);
  document.getElementById("disconnect")!.addEventListener("click", onDisconnect);
}

/** LinkedIn sin un aviso individual identificable por URL — búsqueda de
 *  contenido o el feed principal (a diferencia de `/jobs/…`, que si trae un
 *  id). Sólo para elegir el copy de `renderCapturePrompt`. */
function isLinkedInFeedUrl(url: string): boolean {
  try {
    const { hostname, pathname } = new URL(url);
    return hostname.endsWith("linkedin.com") && (pathname.startsWith("/search/results/content") || pathname === "/feed/" || pathname === "/feed");
  } catch {
    return false;
  }
}

function renderMaybeNotAJob(onContinue: () => void, onCancel: () => void) {
  app.innerHTML = `
    <p class="eyebrow">cvexact</p>
    <h1>¿Esto es un aviso?</h1>
    <div class="alert warn">No encontramos ni empresa ni datos estructurados en esta página — puede
    ser un listado o una búsqueda, no un aviso individual.</div>
    <div class="row">
      <button id="continue" class="secondary">Cargar igual, a mano</button>
      <button id="cancel" class="ghost">Cancelar</button>
    </div>
  `;
  document.getElementById("continue")!.addEventListener("click", onContinue);
  document.getElementById("cancel")!.addEventListener("click", onCancel);
}

function renderReview(job: ParsedJob, onSave: (status: "guardado" | "postulado") => void) {
  // Una publicación del feed nunca trae empresa/ubicación estructuradas —
  // eso es lo normal ahí, no una falla como sí lo sería en un aviso de
  // /jobs/ (ver `job.extractedFrom` en lib/tracker/jsonld.ts). El texto,
  // acá, viaja a la vista y editable — es lo único que distingue "esto es
  // lo que vas a generar el CV con" de un campo de metadata más.
  const isPost = job.extractedFrom === "site-post";
  const hasAttachedJob = job.jobUrl.includes("/jobs/view/");
  // Una publicación puede nombrar varios puestos a la vez (un reclutador que
  // abre 2 a 7 búsquedas en un mismo texto) — no hay "el" título correcto
  // para adivinar ahí, así que se ofrecen todos como chips y un click
  // reemplaza el valor del input, en vez de forzar uno solo (ver
  // `lib/tracker/site-rules/linkedin-post.ts`).
  const titleCandidates = job.jobTitleCandidates ?? [];
  // Empresa/ubicación mencionadas en prosa sin link ni etiqueta son una señal
  // débil a propósito (ver el mismo archivo) — nunca pisan el campo real,
  // sólo se ofrecen como sugerencia cuando quedó vacío.
  app.innerHTML = `
    ${
      isPost
        ? `<p class="eyebrow">Leído de la publicación</p>`
        : job.fromFallback
          ? `<div class="alert warn">No había datos estructurados — revisá y completá.</div>`
          : `<p class="eyebrow">Leído del aviso</p>`
    }
    <div class="card">
      <label for="jobTitle">Puesto</label>
      <input id="jobTitle" value="${escapeAttr(job.jobTitle)}" />
      ${
        titleCandidates.length > 0
          ? `<div class="chips">
              ${titleCandidates
                .map((candidate, i) => `<button type="button" class="chip" data-candidate="${i}">${escapeAttr(candidate)}</button>`)
                .join("")}
            </div>`
          : ""
      }
      <label for="company">Empresa</label>
      <input id="company" value="${escapeAttr(job.company)}" />
      ${
        !job.company && job.suggestedCompany
          ? `<button type="button" class="chip" id="useSuggestedCompany">¿Es «${escapeAttr(job.suggestedCompany)}»? Usar</button>`
          : ""
      }
      <label for="location">Ubicación</label>
      <input id="location" value="${escapeAttr(job.location)}" />
      ${
        !job.location && job.suggestedLocation
          ? `<button type="button" class="chip" id="useSuggestedLocation">¿Es «${escapeAttr(job.suggestedLocation)}»? Usar</button>`
          : ""
      }
      ${
        isPost
          ? `<label for="jdText">Texto de la publicación</label>
             <textarea id="jdText" rows="8">${escapeAttr(job.jdText)}</textarea>`
          : ""
      }
    </div>
    ${
      isPost && hasAttachedJob
        ? `<p class="alert">Esta publicación tiene un aviso adjunto — abrilo y capturalo desde ahí si querés empresa y ubicación.</p>`
        : ""
    }
    <div class="row">
      <button id="save">Guardar</button>
      <button id="applied" class="secondary">Ya me postulé</button>
    </div>
  `;

  document.querySelectorAll<HTMLButtonElement>("[data-candidate]").forEach((chip) => {
    chip.addEventListener("click", () => {
      const candidate = titleCandidates[Number(chip.dataset.candidate)];
      if (candidate) (document.getElementById("jobTitle") as HTMLInputElement).value = candidate;
    });
  });
  document.getElementById("useSuggestedCompany")?.addEventListener("click", (e) => {
    (document.getElementById("company") as HTMLInputElement).value = job.suggestedCompany ?? "";
    (e.currentTarget as HTMLButtonElement).remove();
  });
  document.getElementById("useSuggestedLocation")?.addEventListener("click", (e) => {
    (document.getElementById("location") as HTMLInputElement).value = job.suggestedLocation ?? "";
    (e.currentTarget as HTMLButtonElement).remove();
  });

  const read = () => ({
    jobTitle: (document.getElementById("jobTitle") as HTMLInputElement).value.trim(),
    company: (document.getElementById("company") as HTMLInputElement).value.trim(),
    location: (document.getElementById("location") as HTMLInputElement).value.trim(),
    ...(isPost ? { jdText: (document.getElementById("jdText") as HTMLTextAreaElement).value.trim() } : {}),
  });
  document.getElementById("save")!.addEventListener("click", () => {
    Object.assign(job, read());
    onSave("guardado");
  });
  document.getElementById("applied")!.addEventListener("click", () => {
    Object.assign(job, read());
    onSave("postulado");
  });
}

function renderSaved(status: "guardado" | "postulado", duplicateWarning: boolean, apiUrl: string, applicationId: string) {
  app.innerHTML = `
    <p class="eyebrow">Listo</p>
    <h1>${status === "guardado" ? "Guardado" : "Marcado como postulado"}</h1>
    ${duplicateWarning ? '<p class="error">Ya tenías algo parecido guardado — revisalo en la tabla.</p>' : ""}
    <div class="row">
      <a href="${apiUrl}/postular?desde=${applicationId}" target="_blank" rel="noopener">Generar CV con este aviso →</a>
    </div>
    <a href="${apiUrl}/postulaciones" target="_blank" rel="noopener">Ver en cvexact →</a>
  `;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// --- Orquestación --------------------------------------------------------------

async function boot() {
  renderLoading("Cargando…");

  const auth = await getAuth();
  if (!auth) {
    renderConnect();
    return;
  }

  const tab = await activeTab();
  if (!tab) {
    renderNoTab();
    return;
  }

  try {
    const { application } = await lookupByUrl(tab.url);
    if (application) {
      setBadge(tab.id, "✓", "#34d399");
      renderTracked(application, auth.apiUrl);
      return;
    }

    setBadge(tab.id, "", "#000000");
    renderCapturePrompt(
      () => void capture(tab, auth.apiUrl),
      async () => {
        await clearAuth();
        renderConnect();
      },
      isLinkedInFeedUrl(tab.url),
    );
  } catch (err) {
    renderError(err instanceof ApiError ? err.message : "No se pudo consultar tu seguimiento.", boot);
  }
}

async function capture(tab: { id: number; url: string }, apiUrl: string) {
  renderLoading("Leyendo la página…");
  try {
    const html = await readPageHtml(tab.id);
    const job = await parseHtml(html, tab.url);
    const goToReview = () => renderReview(job, (status) => void save(job, status, apiUrl));
    if (job.extractedFrom === "generic" && !job.company) {
      renderMaybeNotAJob(goToReview, boot);
      return;
    }
    goToReview();
  } catch (err) {
    renderError(err instanceof ApiError ? err.message : "No se pudo leer esta página.", boot);
  }
}

async function save(job: ParsedJob, status: "guardado" | "postulado", apiUrl: string) {
  renderLoading("Guardando…");
  try {
    const { application, duplicates } = await createApplication({
      jobTitle: job.jobTitle || undefined,
      company: job.company || undefined,
      location: job.location || undefined,
      remote: job.remote ?? undefined,
      salaryMin: job.salaryMin ?? undefined,
      salaryMax: job.salaryMax ?? undefined,
      currency: job.currency ?? undefined,
      jdText: job.jdText || undefined,
      jdJsonld: job.jsonld ?? undefined,
      jobUrl: job.jobUrl,
      source: "extension",
      status,
      appliedAt: status === "postulado" ? new Date().toISOString() : undefined,
    });
    renderSaved(status, duplicates.length > 0, apiUrl, application.id);
  } catch (err) {
    renderError(err instanceof ApiError ? err.message : "No se pudo guardar.", boot);
  }
}

void boot();
