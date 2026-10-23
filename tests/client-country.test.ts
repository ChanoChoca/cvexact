import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

async function load(clientIpHeaders: string | undefined) {
  vi.resetModules();
  if (clientIpHeaders === undefined) delete process.env.CLIENT_IP_HEADERS;
  else process.env.CLIENT_IP_HEADERS = clientIpHeaders;
  return (await import("@/lib/client-country")).clientCountry;
}

afterEach(() => {
  process.env = { ...originalEnv };
});

const withCountry = (value: string) => new Headers({ "cf-ipcountry": value });

describe("clientCountry", () => {
  it("cree en cf-ipcountry sólo si se declaró que Cloudflare está adelante", async () => {
    const clientCountry = await load("cf-connecting-ip");
    expect(clientCountry(withCountry("AR"))).toBe("AR");
    expect(clientCountry(withCountry(" ar "))).toBe("AR");
  });

  it("lo ignora sin Cloudflare declarado: ahí lo escribe cualquiera", async () => {
    expect((await load(undefined))(withCountry("AR"))).toBeNull();
    expect((await load("x-forwarded-for"))(withCountry("AR"))).toBeNull();
  });

  it("descarta valores que no son un país", async () => {
    const clientCountry = await load("cf-connecting-ip");
    for (const value of ["XX", "T1", "", "ARG", "1A", "A"]) {
      expect(clientCountry(withCountry(value))).toBeNull();
    }
    expect(clientCountry(new Headers())).toBeNull();
  });
});
