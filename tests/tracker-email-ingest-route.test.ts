import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/tracker/email/ingest` es el único endpoint que escribe sin sesión.
 *
 * Lo llama el Worker de `workers/tracker-email/` por la URL pública de siempre, y
 * `x-origin-auth` no lo distingue de un visitante: Cloudflare se lo agrega a todo.
 * Lo que lo protege es que el alias no se puede adivinar, y el tope por IP es defensa
 * en profundidad encima de eso. Lo que se fija acá es el orden —el limitador corre
 * antes de leer el cuerpo y antes de tocar la base— y que el número no se apriete
 * hasta tirar correos legítimos: el Worker no reintenta un 429, ese correo se pierde.
 */

const ingestEmail = vi.fn();
const rateLimit = vi.fn();

vi.mock("@/lib/db", () => ({ databaseConfigured: true }));
vi.mock("@/lib/tracker/email-ingest", () => ({ ingestEmail }));
vi.mock("@/lib/api/guards", () => ({ enforceRateLimit: rateLimit }));

const { POST } = await import("@/app/api/tracker/email/ingest/route");

const VALID = {
  alias: "u_7f3a9b1c2d4e@tracker.cvexact.test",
  from: "selección@example.com",
  subject: "Novedades de tu postulación",
  bodyText: "Gracias por postularte.",
};

const post = (body: unknown) =>
  POST(
    new Request("https://cvexact.test/api/tracker/email/ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

const tooMany = () =>
  NextResponse.json({ error: "demasiadas", reason: "rate_limited" }, { status: 429 });

beforeEach(() => {
  ingestEmail.mockReset().mockResolvedValue({ outcome: "no_inbox" });
  rateLimit.mockReset().mockResolvedValue(null);
});

describe("POST /api/tracker/email/ingest — tope por IP", () => {
  it("con el tope agotado responde 429 y no toca la base", async () => {
    rateLimit.mockResolvedValue(tooMany());

    const response = await post(VALID);

    expect(response.status).toBe(429);
    expect(ingestEmail).not.toHaveBeenCalled();
  });

  it("un cuerpo que no es JSON también cuenta contra el tope", async () => {
    // El limitador corre antes de parsear: si no, la basura sería gratis y sólo
    // se limitaría lo bien formado.
    rateLimit.mockResolvedValue(tooMany());

    const response = await post("esto no es json");

    expect(rateLimit).toHaveBeenCalledOnce();
    expect(response.status).toBe(429);
  });

  it("dentro del tope, procesa el correo y devuelve el resultado de siempre", async () => {
    ingestEmail.mockResolvedValue({ outcome: "applied" });

    const response = await post(VALID);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "applied" });
    expect(ingestEmail).toHaveBeenCalledWith(
      expect.objectContaining({ alias: VALID.alias, from: VALID.from }),
    );
  });

  it("dentro del tope, un payload inválido sigue dando 400", async () => {
    const response = await post({ alias: "" });

    expect(response.status).toBe(400);
    expect(ingestEmail).not.toHaveBeenCalled();
  });

  it("usa un cubo propio y un tope holgado: no puede tirar correos legítimos", async () => {
    await post(VALID);

    const [name, headers, rule] = rateLimit.mock.calls[0];
    expect(name).toBe("tracker-email-ingest");
    expect(headers).toBeInstanceOf(Headers);
    // Al menos 60 por minuto. El Worker comparte cubo entre todas las cuentas y no
    // reintenta: apretar esto por debajo del volumen real pierde correos sin avisar.
    expect((rule.max / rule.window) * 60).toBeGreaterThanOrEqual(60);
  });
});
