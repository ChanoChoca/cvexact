import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which tier gets which model, and where.
 *
 * This is a cost decision as much as a product one: the large model runs eight
 * to fifteen times the price per token, so widening the set below silently
 * doubles what a paid application costs to serve. It was once every action the
 * employer reads, which put the expensive model on the three longest outputs —
 * email, prep sheet, video script — for a difference nobody could point at.
 */

async function loadProvider() {
  vi.resetModules();
  return import("@/lib/ai/provider");
}

const STANDARD = "modelo-chico";
const PRO = "modelo-grande";

beforeEach(() => {
  process.env.SERVICE_PROVIDER = "together";
  process.env.SERVICE_API_KEY = "clave-de-servicio";
  process.env.SERVICE_MODEL = STANDARD;
  process.env.SERVICE_PRO_MODEL = PRO;
});

afterEach(() => {
  delete process.env.SERVICE_PROVIDER;
  delete process.env.SERVICE_API_KEY;
  delete process.env.SERVICE_MODEL;
  delete process.env.SERVICE_PRO_MODEL;
});

describe("qué modelo corre cada tier", () => {
  it("le da el modelo grande al que paga, donde se nota", async () => {
    const { resolveModel } = await loadProvider();

    for (const action of ["cv", "answers", "import"] as const) {
      for (const tier of ["pro", "credits"] as const) {
        expect((await resolveModel({ tier, action })).used.modelId).toBe(PRO);
      }
    }
  });

  it("no gasta el modelo grande donde no cambia nada", async () => {
    // Las tres salidas más largas y las que menos ganan con un modelo mayor.
    const { resolveModel } = await loadProvider();

    for (const action of ["email", "interview", "video"] as const) {
      expect((await resolveModel({ tier: "pro", action })).used.modelId).toBe(STANDARD);
    }
  });

  it("deja la entrevista de perfil en el modelo chico para todos", async () => {
    const { resolveModel } = await loadProvider();

    for (const action of ["intake", "metrics"] as const) {
      expect((await resolveModel({ tier: "pro", action })).used.modelId).toBe(STANDARD);
    }
  });

  it("no le da ningún modelo al tier free — no hay prueba gratuita que correr", async () => {
    const { resolveModel, ProviderConfigError } = await loadProvider();
    await expect(resolveModel({ tier: "free", action: "cv" })).rejects.toBeInstanceOf(
      ProviderConfigError,
    );
  });

  it("sigue funcionando sin SERVICE_PRO_MODEL configurado", async () => {
    // Una instalación que no configuró uno simplemente no tiene nada extra que
    // vender; lo que no puede es dejar de generar.
    delete process.env.SERVICE_PRO_MODEL;
    const { resolveModel } = await loadProvider();
    expect((await resolveModel({ tier: "pro", action: "cv" })).used.modelId).toBe(STANDARD);
  });

  it("usa la key del usuario en byok, sin mirar el tier pago", async () => {
    const { resolveModel } = await loadProvider();
    const choice = await resolveModel({
      tier: "byok",
      action: "cv",
      byok: [{ provider: "google", apiKey: "AIzaDELUSUARIO", model: "el-que-eligio" }],
    });
    expect(choice.used.modelId).toBe("el-que-eligio");
  });
});

/**
 * El primario del servicio estuvo cableado a Google hasta que dejó de estarlo.
 * Lo que sigue no es el detalle de una variable: es que mover de proveedor sea
 * configuración y no una edición de `candidatesFor`.
 */
describe("qué proveedor corre con nuestra key", () => {
  it("corre el que nombra SERVICE_PROVIDER", async () => {
    const { resolveModel } = await loadProvider();

    const choice = await resolveModel({ tier: "credits", action: "cv" });
    expect(choice.used.provider).toBe("together");
    expect(choice.used.modelId).toBe(PRO);
  });

  it("no le presta nuestra key al que no paga, ni con el servicio configurado", async () => {
    // La invariante del producto, no un detalle de este refactor: `free` es
    // nadie, y que haya una key de servicio andando no lo cambia.
    const { resolveModel, ProviderConfigError } = await loadProvider();

    await expect(resolveModel({ tier: "free", action: "cv" })).rejects.toBeInstanceOf(
      ProviderConfigError,
    );
  });

  it("no deja que el primario se filtre a la cadena de quien trajo su key", async () => {
    const { resolveModel } = await loadProvider();

    const choice = await resolveModel({
      tier: "byok",
      action: "cv",
      byok: [{ provider: "groq", apiKey: "gsk_delusuario" }],
    });
    expect(choice.candidates).toHaveLength(1);
    expect(choice.used.provider).toBe("groq");
  });

  it("cae al modelo por defecto del proveedor si no le nombran uno", async () => {
    delete process.env.SERVICE_MODEL;
    delete process.env.SERVICE_PRO_MODEL;
    const { resolveModel, DEFAULT_MODEL } = await loadProvider();

    expect((await resolveModel({ tier: "pro", action: "cv" })).used.modelId).toBe(
      DEFAULT_MODEL.together,
    );
  });

  it("ignora un SERVICE_PROVIDER que no existe en vez de no arrancar", async () => {
    // Mismo criterio que `AI_FALLBACKS` con una entrada rota: un typo en el
    // environment no puede impedir que el módulo importe, porque ahí no sirve
    // nada — ni las pantallas que dirían qué pasó.
    process.env.SERVICE_PROVIDER = "togheter";
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { resolveModel } = await loadProvider();

    expect((await resolveModel({ tier: "pro", action: "cv" })).used.provider).toBe("google");
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("avisa cuando el deploy quedó con los nombres viejos de las variables", async () => {
    // El único síntoma que distingue "no configuré nada" de "deployé el yaml
    // viejo" es este log: sin él las dos se ven como el mismo 400.
    delete process.env.SERVICE_API_KEY;
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "AIzaVIEJA";
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { serviceKeyConfigured } = await loadProvider();

    expect(serviceKeyConfigured()).toBe(false);
    expect(error.mock.calls.flat().join(" ")).toContain("SERVICE_API_KEY");

    error.mockRestore();
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  });
});

