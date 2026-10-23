import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";

/**
 * El limitador de Better Auth no puede escribir la dirección del visitante en
 * claro.
 *
 * Con `storage: "database"` Better Auth arma cada bucket con la clave
 * `<ip>|<ruta>` (`createRateLimitKey`) y la guarda tal cual en `rate_limit`. La
 * cláusula 3 de la política de privacidad dice, para quien no tiene cuenta, que
 * "no guardamos la IP: lo que se almacena es un hash con sal". Durante un
 * tiempo eso fue falso justo en las rutas de alta, ingreso y recuperación.
 *
 * Postgres se reemplaza por un driver proxy que registra el SQL y simula el
 * upsert de ventana fija de `consume()` (mismo recurso que
 * tests/rate-limit-db.test.ts). Lo que se fija acá es qué valores llegan a la
 * base — no la semántica de la ventana, cubierta en tests/rate-limit.test.ts.
 */

const captured: Array<{ sql: string; params: unknown[] }> = [];
const buckets = new Map<string, { count: number; windowStart: number }>();

const db = drizzle(async (sql, params) => {
  captured.push({ sql, params });
  // Sólo el upsert de `app_rate_limit` devuelve fila: el resto de lo que hace
  // Better Auth y el lockout (buscar el usuario, leer `login_attempt`) ve una
  // base vacía, que es justo lo que pasa con un correo que no existe.
  if (!sql.includes('"app_rate_limit"')) return { rows: [] };
  // `values($1 id, $2 key, $3 count, $4 last_request)`: el bucket es el segundo.
  const key = String(params[1]);
  // Como el upsert real: `last_request` queda en el inicio de la ventana, no en
  // el pedido actual. Devolver `Date.now()` hacía que `retryAfter` saliera 301
  // cada vez que entre un pedido y otro pasaba un milisegundo (la suite
  // completa bajo carga), y el test fallaba sin que nada estuviera roto.
  const bucket = buckets.get(key) ?? { count: 0, windowStart: Number(params[3]) };
  bucket.count += 1;
  buckets.set(key, bucket);
  return { rows: [[bucket.count, bucket.windowStart]] };
});

vi.mock("@/lib/db", async () => ({
  databaseConfigured: true,
  getDb: () => db,
  schema: await import("@/lib/db/schema"),
}));

/** Todo lo que viajó a la base, como texto, para buscar una IP adentro. */
function everythingSent(): string {
  return captured.map((c) => JSON.stringify(c.params)).join("\n");
}

function bucketKeys(): string[] {
  return captured.map((c) => String(c.params[1]));
}

beforeEach(() => {
  captured.length = 0;
  buckets.clear();
  vi.unstubAllEnvs();
});

describe("authRateLimitStorage", () => {
  it("guarda el bucket bajo un hash: ni la IP ni la ruta llegan a la base", async () => {
    const { authRateLimitStorage } = await import("@/lib/auth-rate-limit");

    await authRateLimitStorage.consume("203.0.113.7|/sign-in/email", { window: 300, max: 10 });

    const sent = everythingSent();
    expect(sent).not.toContain("203.0.113.7");
    expect(sent).not.toContain("/sign-in/email");
    expect(bucketKeys()[0]).toMatch(/^auth:[0-9a-f]{32}$/);
  });

  it("tampoco deja pasar una IPv6", async () => {
    const { authRateLimitStorage } = await import("@/lib/auth-rate-limit");

    await authRateLimitStorage.consume("2001:db8:85a3:0:0:0:0:0|/sign-up/email", {
      window: 3600,
      max: 5,
    });

    expect(everythingSent()).not.toContain("2001:db8");
  });

  it("no depende del formato de la clave: una sin '|' se hashea igual", async () => {
    const { authRateLimitStorage } = await import("@/lib/auth-rate-limit");

    // Si Better Auth cambiara `<ip>|<ruta>` por otra cosa, lo que falla tiene
    // que ser el agrupamiento, no la promesa de no guardar la dirección.
    await authRateLimitStorage.consume("198.51.100.9", { window: 60, max: 3 });

    expect(everythingSent()).not.toContain("198.51.100.9");
    expect(bucketKeys()[0]).toMatch(/^auth:[0-9a-f]{32}$/);
  });

  it("mantiene un bucket por (dirección, ruta): mismo par, mismo bucket; otro par, otro", async () => {
    const { authRateLimitStorage } = await import("@/lib/auth-rate-limit");
    const rule = { window: 300, max: 10 };

    await authRateLimitStorage.consume("203.0.113.7|/sign-in/email", rule);
    await authRateLimitStorage.consume("203.0.113.7|/sign-in/email", rule);
    await authRateLimitStorage.consume("203.0.113.8|/sign-in/email", rule);
    await authRateLimitStorage.consume("203.0.113.7|/sign-up/email", rule);

    const [a, b, otraIp, otraRuta] = bucketKeys();
    expect(a).toBe(b);
    expect(otraIp).not.toBe(a);
    expect(otraRuta).not.toBe(a);
  });

  it("está salado: cambiar QUOTA_IP_SALT cambia el bucket", async () => {
    const { authRateLimitStorage } = await import("@/lib/auth-rate-limit");
    const rule = { window: 300, max: 10 };

    vi.stubEnv("QUOTA_IP_SALT", "sal-a");
    await authRateLimitStorage.consume("203.0.113.7|/sign-in/email", rule);
    vi.stubEnv("QUOTA_IP_SALT", "sal-b");
    await authRateLimitStorage.consume("203.0.113.7|/sign-in/email", rule);

    const [conA, conB] = bucketKeys();
    expect(conA).not.toBe(conB);
  });

  it("dentro del tope permite; pasado el tope niega y dice cuánto esperar", async () => {
    const { authRateLimitStorage } = await import("@/lib/auth-rate-limit");
    const rule = { window: 300, max: 2 };
    const key = "203.0.113.7|/sign-in/email";

    expect(await authRateLimitStorage.consume(key, rule)).toEqual({ allowed: true, retryAfter: null });
    expect(await authRateLimitStorage.consume(key, rule)).toEqual({ allowed: true, retryAfter: null });

    const denied = await authRateLimitStorage.consume(key, rule);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfter).toBeGreaterThanOrEqual(1);
    expect(denied.retryAfter).toBeLessThanOrEqual(300);
  });
});

/**
 * Contrato con la librería, no con nuestro código — y con la configuración REAL:
 * `getAuth()` de lib/auth.ts, con su `drizzleAdapter` y su mapa de esquema, sus
 * reglas y sus hooks de lockout, sobre el mismo driver simulado. Un Better Auth
 * de juguete no probaba lo que importa: que el limitador de producción corta de
 * verdad y que lo que llega a la base no lleva la IP. Si una versión futura
 * cambia cómo arma la clave o cómo llama a `consume`, esto es lo que se rompe.
 */
describe("Better Auth con la configuración de producción", () => {
  async function loadAuth() {
    vi.resetModules();
    vi.stubEnv("BETTER_AUTH_SECRET", "un-secreto-de-prueba-de-32-caracteres!!");
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    // Igual que en el Deployment detrás de Cloudflare (lib/client-ip.ts).
    vi.stubEnv("CLIENT_IP_HEADERS", "cf-connecting-ip,x-forwarded-for");
    const { getAuth } = await import("@/lib/auth");
    return getAuth();
  }

  function signIn(auth: Awaited<ReturnType<typeof loadAuth>>, ip: string) {
    return auth.handler(
      new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": ip },
        body: JSON.stringify({ email: "nadie@example.com", password: "una-clave-cualquiera" }),
      }),
    );
  }

  it("corta los intentos de ingreso repetidos desde una IP, sin escribir la IP", async () => {
    const auth = await loadAuth();

    // No se fija el número exacto (es una regla que se puede afinar en
    // lib/auth.ts): se pide que exista un corte, que no sea absurdamente
    // holgado, y que todo lo anterior haya llegado a autenticar.
    const statuses: number[] = [];
    for (let i = 0; i < 20; i++) {
      const { status } = await signIn(auth, "203.0.113.7");
      statuses.push(status);
      if (status === 429) break;
    }

    const cutAt = statuses.indexOf(429);
    expect(cutAt).toBeGreaterThan(1);
    expect(cutAt).toBeLessThan(20);
    // Un correo que no existe es un 401, no un error nuestro: el limitador
    // dejó pasar los intentos anteriores hasta el handler.
    expect(statuses.slice(0, cutAt).every((status) => status === 401)).toBe(true);

    // Otra dirección tiene su propio bucket: el corte no es global.
    expect((await signIn(auth, "203.0.113.99")).status).toBe(401);

    // Lo que llegó a la base: ni la dirección, ni el prefijo de red.
    expect(everythingSent()).not.toContain("203.0.113");
    const rateLimitKeys = captured
      .filter((c) => c.sql.includes('"app_rate_limit"'))
      .map((c) => String(c.params[1]));
    expect(rateLimitKeys.length).toBeGreaterThan(0);
    for (const key of rateLimitKeys) expect(key).toMatch(/^auth:[0-9a-f]{32}$/);
  });

  it("no usa la tabla propia de Better Auth para el limitador", async () => {
    const auth = await loadAuth();

    await signIn(auth, "203.0.113.7");

    // `"rate_limit"` con comillas: sin ellas también matchea dentro de
    // `"app_rate_limit"`.
    expect(captured.map((c) => c.sql).join("\n")).not.toContain('"rate_limit"');
  });
});
