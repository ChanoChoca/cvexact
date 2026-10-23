import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The client IP is a security boundary in two places at once: it is the key
 * Better Auth rate-limits logins by, and the subject anonymous quota counts
 * against. Believing the wrong header, or the wrong entry of a forwarded chain,
 * hands both keys to whoever is sending the requests.
 *
 * NODE_ENV matters here: outside production Better Auth resolves anything
 * unresolvable to 127.0.0.1, so the cases that document production behaviour
 * have to load the module with NODE_ENV=production.
 */
const originalEnv = { ...process.env };

async function loadClientIp(env: Record<string, string | undefined> = {}) {
  vi.resetModules();
  // Better Auth reads NODE_ENV once, when its module is first loaded, and
  // resetModules does not re-evaluate an externalized dependency: the first
  // call here pins it to production for the whole file. `TEST` it does read
  // live, and vitest sets it, so clear it or everything looks like dev.
  const overrides = { NODE_ENV: "production", TEST: undefined, ...env };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return import("@/lib/client-ip");
}

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("clientIp", () => {
  it("por defecto sólo cree en un x-forwarded-for de un solo valor", async () => {
    const { clientIp } = await loadClientIp({
      CLIENT_IP_HEADERS: undefined,
      TRUSTED_PROXIES: undefined,
    });
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("no toma la primera entrada de una cadena sin proxies declarados", async () => {
    // La primera entrada la escribe el cliente: creerla es regalarle la clave.
    const { clientIp } = await loadClientIp();
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
    expect(clientIp(headers)).toBe("unknown");
  });

  it("resuelve la cadena hasta el primer salto no confiable", async () => {
    const { clientIp } = await loadClientIp({ TRUSTED_PROXIES: "10.0.0.0/24" });
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
    expect(clientIp(headers)).toBe("203.0.113.7");
  });

  it("ignora cf-connecting-ip mientras el despliegue no lo declare", async () => {
    // Sin Cloudflare adelante ese header lo puede escribir cualquiera.
    const { clientIp } = await loadClientIp();
    const headers = new Headers({ "cf-connecting-ip": "203.0.113.7" });
    expect(clientIp(headers)).toBe("unknown");
  });

  it("prefiere cf-connecting-ip cuando el despliegue lo declara primero", async () => {
    // Producción: el x-forwarded-for que llega es la edge de Cloudflare.
    const { clientIp } = await loadClientIp({
      CLIENT_IP_HEADERS: "cf-connecting-ip,x-forwarded-for",
    });
    const headers = new Headers({
      "cf-connecting-ip": "203.0.113.7",
      "x-forwarded-for": "172.71.0.1",
    });
    expect(clientIp(headers)).toBe("203.0.113.7");
  });

  it("cae al header siguiente si el primero no resuelve", async () => {
    const { clientIp } = await loadClientIp({
      CLIENT_IP_HEADERS: "cf-connecting-ip,x-forwarded-for",
    });
    expect(clientIp(new Headers({ "x-forwarded-for": "198.51.100.9" }))).toBe("198.51.100.9");
  });

  it("cae en un centinela en vez de tirar", async () => {
    const { clientIp } = await loadClientIp();
    expect(clientIp(new Headers())).toBe("unknown");
  });

  it("en dev y en test resuelve a localhost en vez del centinela", async () => {
    const { clientIp } = await loadClientIp({ TEST: "true" });
    expect(clientIp(new Headers())).toBe("127.0.0.1");
  });
});
