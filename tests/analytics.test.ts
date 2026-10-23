import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import nextConfig from "@/next.config";
import {
  ANALYTICS_CONSENT_KEY,
  analyticsMode,
  gaCookieNames,
  gaMeasurementId,
  gtagInitScript,
  gtagSrc,
  isAnalyticsExcluded,
  parseAnalyticsChoice,
} from "@/lib/analytics";

/**
 * Google Analytics 4: cuándo se enciende, dónde no se carga y qué le permite la
 * CSP.
 *
 * Lo que estos tests defienden es sobre todo lo que falla en silencio. GA
 * apagado por una variable mal escrita, GA bloqueado por una CSP «endurecida» y
 * GA corriendo en la pantalla donde viaja el token de recuperación no tiran
 * ningún error: el sitio sigue andando y sólo se nota en la consola, o nunca.
 */

const ID = "G-H4LGP85PBY";

beforeEach(() => {
  delete process.env.GA_MEASUREMENT_ID;
  // El aviso de «formato inválido» es lo esperado en varios casos de abajo; los
  // tests que lo verifican vuelven a espiar y ven este mismo mock.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.GA_MEASUREMENT_ID;
  vi.restoreAllMocks();
});

describe("gaMeasurementId — apagado salvo que se configure", () => {
  it("sin variable devuelve null: es el estado por defecto y el de desarrollo", () => {
    expect(gaMeasurementId()).toBeNull();
  });

  it("vacío o en blanco cuenta como ausente (así viene en .env.example)", () => {
    process.env.GA_MEASUREMENT_ID = "";
    expect(gaMeasurementId()).toBeNull();
    process.env.GA_MEASUREMENT_ID = "   ";
    expect(gaMeasurementId()).toBeNull();
  });

  it("un ID válido se devuelve, recortado", () => {
    process.env.GA_MEASUREMENT_ID = `  ${ID}\n`;
    expect(gaMeasurementId()).toBe(ID);
  });

  it("relee la variable en cada llamada: es una función, no un const de módulo", () => {
    expect(gaMeasurementId()).toBeNull();
    process.env.GA_MEASUREMENT_ID = ID;
    expect(gaMeasurementId()).toBe(ID);
    delete process.env.GA_MEASUREMENT_ID;
    expect(gaMeasurementId()).toBeNull();
  });

  it.each([
    ["un ID de Universal Analytics", "UA-12345678-1"],
    ["un ID de Google Tag Manager", "GTM-ABC1234"],
    ["minúsculas", "g-h4lgp85pby"],
    ["sólo el prefijo", "G-"],
    ["la URL del script en vez del ID", "https://www.googletagmanager.com/gtag/js?id=G-H4LGP85PBY"],
    ["comillas: rompería el script en línea", "G-ABCDEF1234'); alert(1);//"],
    ["una etiqueta de cierre", "G-ABCDEF</script><script>alert(1)"],
    ["espacios en el medio", "G-ABC DEF123"],
  ])("rechaza %s: GA queda apagado en vez de inyectar el valor", (_caso, value) => {
    process.env.GA_MEASUREMENT_ID = value;
    expect(gaMeasurementId()).toBeNull();
  });

  it("un valor mal formado avisa una sola vez por proceso, sin imprimir el valor", async () => {
    // `warned` es estado de módulo: se importa una copia limpia.
    vi.resetModules();
    const { gaMeasurementId: fresh } = await import("@/lib/analytics");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    process.env.GA_MEASUREMENT_ID = "UA-12345678-1";
    fresh();
    fresh();
    fresh();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("GA_MEASUREMENT_ID");
    expect(String(warn.mock.calls[0][0])).not.toContain("UA-12345678-1");
  });

  it("ausente o vacío no avisa: apagado es un estado legítimo, no un error", async () => {
    vi.resetModules();
    const { gaMeasurementId: fresh } = await import("@/lib/analytics");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    fresh();
    process.env.GA_MEASUREMENT_ID = "";
    fresh();

    expect(warn).not.toHaveBeenCalled();
  });
});

describe("isAnalyticsExcluded — dónde GA no se carga", () => {
  it.each([
    ["el token de recuperación viaja en ?token=", "/cuenta/reset"],
    ["con barra final", "/cuenta/reset/"],
    ["render que abre el Chromium del PDF (CV)", "/cv/render"],
    ["render (preparación de entrevista)", "/prep/render"],
    ["render (guion de video)", "/video/render"],
    ["impresión de un CV guardado", "/cv/8f3a2c1e/print"],
    ["el CV de ejemplo, enlazado desde el landing", "/cv/demo/print"],
    ["impresión de una preparación", "/prep/abc/print"],
    ["impresión de un guion", "/video/abc/print"],
  ])("excluye %s", (_motivo, path) => {
    expect(isAnalyticsExcluded(path)).toBe(true);
  });

  it.each([
    "/",
    "/precios",
    "/apoyar",
    "/legales/privacidad",
    "/legales/terminos",
    "/postular",
    "/perfil",
    "/empleos",
    "/postulaciones",
    "/ajustes",
    // El límite es por segmento: `/cv-ats` y `/plantillas-de-cv` son páginas
    // públicas previstas en docs/seo-palabras-clave.md, y esas sí se miden.
    "/cv-ats",
    "/cvs",
    "/plantillas-de-cv",
    "/videos",
    "/prepara",
    // Sólo `/cuenta/reset` lleva el token, no el resto de `/cuenta`.
    "/cuenta",
    "/cuenta/otra",
  ])("no excluye %s", (path) => {
    expect(isAnalyticsExcluded(path)).toBe(false);
  });
});

describe("el snippet de Google", () => {
  it("el script apunta a gtag.js con el ID", () => {
    expect(gtagSrc(ID)).toBe(`https://www.googletagmanager.com/gtag/js?id=${ID}`);
  });

  it("el bloque en línea es el snippet oficial, con el ID como literal", () => {
    const script = gtagInitScript(ID);
    expect(script).toBe(
      [
        "window.dataLayer = window.dataLayer || [];",
        "function gtag(){dataLayer.push(arguments);}",
        "gtag('js', new Date());",
        `gtag('config', "${ID}");`,
      ].join("\n"),
    );
  });

  it("escapa el ID como literal de JS aunque llegue sin validar", () => {
    // Defensa en profundidad: `gaMeasurementId` ya lo filtra, pero este módulo
    // no debería depender de que nadie lo llame con otra cosa.
    const script = gtagInitScript(`G-X"); alert(1); ("`);
    expect(script).toContain(`gtag('config', "G-X\\"); alert(1); (\\"");`);
    expect(script.split("\n")).toHaveLength(4);
  });
});

describe("CSP: lo que gtag.js necesita, y nada más", () => {
  async function directives(): Promise<Record<string, string[]>> {
    const rules = await nextConfig.headers!();
    const rule = rules.find((r) => r.source === "/:path*")!;
    const value = rule.headers.find((h) => h.key === "Content-Security-Policy")!.value;
    return Object.fromEntries(
      value.split("; ").map((directive) => {
        const [name, ...sources] = directive.split(" ");
        return [name, sources];
      }),
    );
  }

  it("script-src permite gtag.js", async () => {
    expect((await directives())["script-src"]).toContain("https://www.googletagmanager.com");
  });

  it("connect-src permite los envíos de GA4, incluidos los regionales", async () => {
    // `region1.google-analytics.com` y compañía: de ahí el comodín.
    expect((await directives())["connect-src"]).toEqual(
      expect.arrayContaining([
        "https://*.google-analytics.com",
        "https://*.analytics.google.com",
        "https://*.googletagmanager.com",
      ]),
    );
  });

  it("img-src permite el envío por imagen que GA usa de respaldo", async () => {
    expect((await directives())["img-src"]).toEqual(
      expect.arrayContaining(["https://*.google-analytics.com", "https://*.googletagmanager.com"]),
    );
  });

  it("no se afloja nada más: sin comodines sueltos y sin marcos de Google", async () => {
    // Cada host de GA en `connect-src` es un destino adonde un XSS podría mandar
    // una key robada (ver next.config.ts). Por eso lo que se suma es sólo lo que
    // Google documenta, y nada de `*` ni `https:` a secas.
    const d = await directives();
    for (const directive of ["script-src", "connect-src", "img-src"]) {
      expect(d[directive]).not.toContain("*");
      expect(d[directive]).not.toContain("https:");
    }
    expect(d["frame-src"]?.some((source) => /google|doubleclick/.test(source))).toBe(false);

    // Lo que ya protegía sigue igual.
    expect(d["default-src"]).toEqual(["'self'"]);
    expect(d["object-src"]).toEqual(["'none'"]);
    expect(d["base-uri"]).toEqual(["'none'"]);
    expect(d["frame-ancestors"]).toEqual(["'none'"]);
  });
});

describe("parseAnalyticsChoice — la elección guardada", () => {
  it("lee lo que guarda `write` (JSON)", () => {
    expect(parseAnalyticsChoice('"granted"')).toBe("granted");
    expect(parseAnalyticsChoice('"denied"')).toBe("denied");
  });

  it("un valor pegado a mano, sin comillas, se lee igual", () => {
    expect(parseAnalyticsChoice("granted")).toBe("granted");
  });

  it.each([
    ["nada guardado", null],
    ["null guardado (es como se vuelve a preguntar)", "null"],
    ["vacío", ""],
    ["un valor desconocido", '"maybe"'],
    ["verdadero, que no es una elección válida", "true"],
    ["un objeto", '{"choice":"granted"}'],
    ["mayúsculas", '"GRANTED"'],
  ])("%s cuenta como «sin elegir»: se vuelve a preguntar, nunca se carga GA", (_caso, raw) => {
    expect(parseAnalyticsChoice(raw)).toBeNull();
  });
});

describe("analyticsMode — sólo con consentimiento", () => {
  it("sin elección pregunta y no carga", () => {
    expect(analyticsMode(null, "/")).toBe("ask");
    expect(analyticsMode(null, "/precios")).toBe("ask");
  });

  it("aceptar carga", () => {
    expect(analyticsMode("granted", "/")).toBe("load");
    expect(analyticsMode("granted", "/postular")).toBe("load");
  });

  it("rechazar no carga ni vuelve a preguntar", () => {
    expect(analyticsMode("denied", "/")).toBe("off");
  });

  it("en el servidor y el primer render (pending) no muestra ni carga nada", () => {
    // Sin esto el aviso saldría en el HTML de quien ya había elegido.
    expect(analyticsMode("pending", "/")).toBe("off");
  });

  it.each(["/cuenta/reset", "/cv/render", "/prep/render", "/video/render", "/cv/demo/print"])(
    "en %s ni pregunta ni carga, aunque haya aceptado",
    (path) => {
      for (const choice of ["granted", "denied", null, "pending"] as const) {
        expect(analyticsMode(choice, path)).toBe("off");
      }
    },
  );
});

describe("gaCookieNames", () => {
  it("encuentra `_ga` y `_ga_<ID>` y nada más", () => {
    expect(gaCookieNames("session=abc; _ga=GA1.1.1.2; _ga_H4LGP85PBY=GS2.1.s1; theme=dark")).toEqual([
      "_ga",
      "_ga_H4LGP85PBY",
    ]);
  });

  it("no toca cookies que sólo se parecen", () => {
    expect(gaCookieNames("_gaming=1; ga=2; my_ga=3; __ga=4")).toEqual([]);
    expect(gaCookieNames("")).toEqual([]);
  });
});

describe("la elección en el navegador", () => {
  const store = new Map<string, string>();
  const cookieWrites: string[] = [];
  let cookieJar = "";
  const reload = vi.fn();

  beforeEach(() => {
    store.clear();
    cookieWrites.length = 0;
    cookieJar = "session=abc; _ga=GA1.1.1.2; _ga_H4LGP85PBY=GS2.1.s1";
    reload.mockClear();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
      addEventListener: () => {},
      removeEventListener: () => {},
      location: { hostname: "www.cvexact.com", reload },
    });
    vi.stubGlobal("document", {
      get cookie() {
        return cookieJar;
      },
      set cookie(value: string) {
        cookieWrites.push(value);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function load() {
    return import("@/components/analytics/consent");
  }

  function expectCookiesCleared() {
    const expired = cookieWrites.filter((w) => w.includes("expires=Thu, 01 Jan 1970"));
    // Sólo las de GA, nunca la de sesión.
    expect(expired.length).toBeGreaterThan(0);
    expect(expired.every((w) => w.startsWith("_ga=") || w.startsWith("_ga_H4LGP85PBY="))).toBe(true);
    expect(cookieWrites.some((w) => w.startsWith("session="))).toBe(false);
    // Sin dominio, el host y cada padre: no se sabe con cuál las puso la etiqueta.
    for (const name of ["_ga", "_ga_H4LGP85PBY"]) {
      const forName = expired.filter((w) => w.startsWith(`${name}=`));
      expect(forName.some((w) => !w.includes("domain="))).toBe(true);
      expect(forName.some((w) => w.includes("domain=.www.cvexact.com"))).toBe(true);
      expect(forName.some((w) => w.includes("domain=.cvexact.com"))).toBe(true);
      expect(forName.every((w) => w.includes("path=/"))).toBe(true);
    }
  }

  it("aceptar se guarda y se lee de vuelta, sin recargar", async () => {
    const { getAnalyticsChoice, setAnalyticsChoice } = await load();
    expect(getAnalyticsChoice()).toBeNull();

    setAnalyticsChoice("granted");
    expect(store.get(ANALYTICS_CONSENT_KEY)).toBe('"granted"');
    expect(getAnalyticsChoice()).toBe("granted");
    expect(reload).not.toHaveBeenCalled();
  });

  it("rechazar con GA cargado borra las cookies de GA y recarga: gtag.js ya está en memoria", async () => {
    (window as unknown as { gtag: () => void }).gtag = () => {};
    const { getAnalyticsChoice, setAnalyticsChoice } = await load();
    setAnalyticsChoice("granted");
    setAnalyticsChoice("denied");
    expectCookiesCleared();
    expect(getAnalyticsChoice()).toBe("denied");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("rechazar sin GA cargado no recarga, pero igual borra cookies viejas", async () => {
    const { getAnalyticsChoice, setAnalyticsChoice } = await load();
    setAnalyticsChoice("denied");
    expect(getAnalyticsChoice()).toBe("denied");
    expect(reload).not.toHaveBeenCalled();
    expectCookiesCleared();
  });

  it("retirar desde «Preferencias» funciona: aceptó, reabrió el aviso (null) y recién ahí rechaza", async () => {
    // Regresión. Reabrir el aviso borra la elección, y rechazar decidía por «antes
    // había aceptado»: ya no lo sabía, no borraba cookies ni recargaba, y GA
    // seguía corriendo con la persona convencida de que lo había apagado.
    (window as unknown as { gtag: () => void }).gtag = () => {};
    const { getAnalyticsChoice, setAnalyticsChoice } = await load();
    setAnalyticsChoice("granted");
    setAnalyticsChoice(null);
    expect(reload).not.toHaveBeenCalled();
    setAnalyticsChoice("denied");

    expect(getAnalyticsChoice()).toBe("denied");
    expect(reload).toHaveBeenCalledTimes(1);
    expectCookiesCleared();
  });

  it("«Preferencias de analítica» (null) vuelve a preguntar, sin recargar ni borrar nada todavía", async () => {
    const { getAnalyticsChoice, setAnalyticsChoice } = await load();
    setAnalyticsChoice("granted");
    setAnalyticsChoice(null);

    expect(getAnalyticsChoice()).toBeNull();
    expect(analyticsMode(getAnalyticsChoice(), "/")).toBe("ask");
    expect(reload).not.toHaveBeenCalled();
    expect(cookieWrites).toEqual([]);
  });

  it("después de rechazar, volver a preguntar y aceptar deja aceptado", async () => {
    const { getAnalyticsChoice, setAnalyticsChoice } = await load();
    setAnalyticsChoice("denied");
    setAnalyticsChoice(null);
    setAnalyticsChoice("granted");
    expect(getAnalyticsChoice()).toBe("granted");
  });
});
