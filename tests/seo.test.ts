import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import robots from "@/app/robots";
import { absoluteUrl, NO_INDEX, siteUrl } from "@/lib/site";

/**
 * SEO técnico: qué entra al sitemap, qué dice robots.txt y qué zonas quedan
 * fuera del índice.
 *
 * El diseño descansa en una regla que estos tests defienden en las dos
 * direcciones: robots.txt impide RASTREAR, no indexar, y una URL que no se
 * rastrea nunca deja leer su `<meta name="robots" content="noindex">`. Por eso
 * lo que lleva `noindex` tiene que seguir siendo rastreable, y lo que se lista en
 * el sitemap no puede estar bloqueado. Un futuro «endurecimiento» de robots.txt
 * rompería lo primero sin que nada falle, salvo acá.
 */

const SITE = "https://cvexact.com";

const PUBLIC_PATHS = [
  "/",
  "/precios",
  "/apoyar",
  "/legales/privacidad",
  "/legales/terminos",
];
const SALES_PATHS = ["/arrepentimiento", "/baja"];

/** Zonas que no se indexan: (app), las rutas de impresión/render y la API. */
const PRIVATE_PREFIXES = [
  "/api",
  "/postular",
  "/empleos",
  "/perfil",
  "/postulaciones",
  "/ajustes",
  "/ingresar",
  "/cuenta",
  "/cv",
  "/prep",
  "/video",
];

/** Ejemplos concretos de páginas que llevan `noindex`, incluidas las dinámicas. */
const NOINDEX_PAGES = [
  "/postular",
  "/empleos",
  "/perfil",
  "/postulaciones",
  "/ajustes",
  "/ingresar",
  "/cuenta/reset",
  "/cv/demo/print",
  "/cv/render",
  "/prep/abc/print",
  "/prep/render",
  "/video/abc/print",
  "/video/render",
];

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SITE_URL;
  vi.resetModules();
  vi.doUnmock("@/lib/payments/sales");
});

/**
 * `salesEnabled` es un const de módulo, así que cambiarlo exige volver a
 * importar el sitemap con el mock nuevo.
 */
async function loadSitemap(salesEnabled: boolean) {
  vi.resetModules();
  vi.doMock("@/lib/payments/sales", () => ({ salesEnabled }));
  const { default: sitemap } = await import("@/app/sitemap");
  return sitemap();
}

async function sitemapPaths(salesEnabled: boolean): Promise<string[]> {
  return (await loadSitemap(salesEnabled)).map((entry) => new URL(entry.url).pathname);
}

/** Entradas `Disallow` de todas las reglas de robots.txt. */
function disallowed(): string[] {
  const { rules } = robots();
  return (Array.isArray(rules) ? rules : [rules]).flatMap((rule) => [rule.disallow ?? []].flat());
}

/** robots.txt compara por prefijo. Ninguna regla usa comodines: si aparece una, revisar acá. */
function isBlocked(path: string): boolean {
  return disallowed().some((rule) => path.startsWith(rule));
}

describe("sitemap.xml", () => {
  it("con la venta apagada lista exactamente las páginas públicas", async () => {
    // Igualdad estricta y no subconjunto: es la aserción que salta cuando
    // alguien agrega una ruta, para que decida a conciencia si se indexa.
    expect((await sitemapPaths(false)).sort()).toEqual([...PUBLIC_PATHS].sort());
  });

  it("suma /arrepentimiento y /baja sólo cuando la venta está encendida", async () => {
    // Las dos responden 404 sin venta. Un 404 en el sitemap es una URL enviada
    // que no existe, y Search Console lo marca como error.
    const off = await sitemapPaths(false);
    for (const path of SALES_PATHS) expect(off).not.toContain(path);

    const on = await sitemapPaths(true);
    expect(on.sort()).toEqual([...PUBLIC_PATHS, ...SALES_PATHS].sort());
  });

  it("no lista nada de las zonas privadas, con la venta en cualquiera de los dos estados", async () => {
    // Redundante con la igualdad de arriba a propósito: ésta es la que se lee
    // como intención, y sobrevive si alguien actualiza la lista sin pensar.
    for (const salesEnabled of [false, true]) {
      for (const path of await sitemapPaths(salesEnabled)) {
        for (const prefix of PRIVATE_PREFIXES) {
          expect(path === prefix || path.startsWith(`${prefix}/`)).toBe(false);
        }
      }
    }
  });

  it("todas las URL son absolutas y salen de NEXT_PUBLIC_SITE_URL", async () => {
    const urls = (await loadSitemap(true)).map((entry) => entry.url);
    for (const url of urls) expect(url.startsWith(`${SITE}`)).toBe(true);
    // La raíz sin barra final: es como Next resuelve el canonical de `/`.
    expect(urls).toContain(SITE);
    expect(urls).not.toContain(`${SITE}/`);
  });

  it("sigue a la variable de entorno en cada consulta, no al valor del build", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://otro.example";
    const urls = (await loadSitemap(false)).map((entry) => entry.url);
    expect(urls).toContain("https://otro.example/precios");
    expect(urls.some((url) => url.includes("cvexact.com"))).toBe(false);
  });

  it("ninguna URL del sitemap está bloqueada por robots.txt", async () => {
    // Una URL enviada y bloqueada es un error de Search Console.
    for (const path of await sitemapPaths(true)) expect(isBlocked(path)).toBe(false);
  });
});

describe("robots.txt", () => {
  it("declara el sitemap con una URL absoluta", () => {
    expect(robots().sitemap).toBe(`${SITE}/sitemap.xml`);
  });

  it("bloquea la API", () => {
    expect(disallowed()).toContain("/api/");
    expect(isBlocked("/api/generate/cv")).toBe(true);
  });

  it("NO bloquea nada de lo que lleva noindex: hay que poder rastrearlo para leerlo", () => {
    // Aserción invertida, y es la importante. El instinto de quien llegue después
    // va a ser sumar `/perfil` o `/cv/` acá «por seguridad». Eso deja la página
    // sin rastrear, el `noindex` sin leer, y la URL libre de aparecer como
    // dirección pelada. Ver `NO_INDEX` en `lib/site.ts`.
    for (const path of NOINDEX_PAGES) expect(isBlocked(path)).toBe(false);
  });

  it("no bloquea las páginas públicas ni /_next/ (Google necesita el JS y el CSS)", () => {
    for (const path of [...PUBLIC_PATHS, ...SALES_PATHS]) expect(isBlocked(path)).toBe(false);
    expect(isBlocked("/_next/static/chunks/app.js")).toBe(false);
  });
});

describe("las zonas que no se indexan", () => {
  it("NO_INDEX niega index y follow", () => {
    expect(NO_INDEX).toEqual({ robots: { index: false, follow: false } });
  });

  // Los layouts de paso son pura declaración: importarlos no arrastra nada.
  it.each([
    ["cv", "@/app/cv/layout"],
    ["prep", "@/app/prep/layout"],
    ["video", "@/app/video/layout"],
  ])("app/%s/layout.tsx exporta NO_INDEX", async (_segment, path) => {
    const layout = await import(path);
    // `toEqual` y no `toBe`: los tests del sitemap resetean el registro de
    // módulos, así que el layout carga su propia copia de `lib/site`.
    expect(layout.metadata).toEqual(NO_INDEX);
  });

  it("app/(app)/layout.tsx exporta NO_INDEX (cubre todas las páginas de la app, la de ingreso incluida)", async () => {
    // El layout arma `AppShell` y `AppFooter`, que arrastran el árbol cliente
    // y la identidad legal. Acá sólo importa lo que exporta, así que se
    // reemplazan por nada.
    vi.doMock("@/app/(app)/AppShell", () => ({ AppShell: () => null }));
    vi.doMock("@/components/legal/parts", () => ({ AppFooter: () => null }));
    try {
      const layout = await import("@/app/(app)/layout");
      expect(layout.metadata).toEqual(NO_INDEX);
    } finally {
      vi.doUnmock("@/app/(app)/AppShell");
      vi.doUnmock("@/components/legal/parts");
    }
  });
});

describe("lib/site", () => {
  it("sin la variable cae a localhost", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(siteUrl()).toBe("http://localhost:3000");
  });

  it("una variable vacía cuenta como ausente (new URL('') tiraría abajo el layout)", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "";
    expect(siteUrl()).toBe("http://localhost:3000");
    process.env.NEXT_PUBLIC_SITE_URL = "   ";
    expect(siteUrl()).toBe("http://localhost:3000");
  });

  it("recorta espacios y barras finales", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "  https://cvexact.com///  ";
    expect(siteUrl()).toBe(SITE);
    expect(`${siteUrl()}/sitemap.xml`).toBe(`${SITE}/sitemap.xml`);
  });

  it("relee la variable en cada llamada: es una función, no un const de módulo", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://uno.example";
    expect(siteUrl()).toBe("https://uno.example");
    process.env.NEXT_PUBLIC_SITE_URL = "https://dos.example";
    expect(siteUrl()).toBe("https://dos.example");
  });

  it("absoluteUrl resuelve con o sin barra inicial, y la raíz queda sin barra final", () => {
    expect(absoluteUrl("/precios")).toBe(`${SITE}/precios`);
    expect(absoluteUrl("precios")).toBe(`${SITE}/precios`);
    expect(absoluteUrl("/legales/terminos")).toBe(`${SITE}/legales/terminos`);
    expect(absoluteUrl("/")).toBe(SITE);
    expect(absoluteUrl("")).toBe(SITE);
  });
});
