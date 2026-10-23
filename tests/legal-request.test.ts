import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El endpoint del botón de arrepentimiento y el de baja.
 *
 * Lo que se fija acá no es que funcione sino que siga siendo *público y ciego*.
 * Es un endpoint sin sesión —la Res. SCI 424/2020 no admite exigir contraseña
 * para ejercer el derecho de revocación— y esa apertura es exactamente lo que lo
 * vuelve frágil: la mejora bienintencionada que un día valide el mail contra la
 * tabla `user` para "no registrar pedidos truchos" lo convierte en un oráculo de
 * enumeración de cuentas, y la que espere el envío del correo para responder
 * hace que una caída de SMTP le reporte al usuario que su pedido no se registró.
 * Los dos casos están abajo.
 */

const insert = vi.fn();
const sendMail = vi.fn();
const rateLimit = vi.fn();

vi.mock("@/lib/db", () => ({
  databaseConfigured: true,
  getDb: () => ({ insert: () => ({ values: insert }) }),
  schema: { legalRequest: Symbol("legal_request") },
}));

vi.mock("@/lib/email/mailer", () => ({ sendMail }));

vi.mock("@/lib/api/guards", () => ({ enforceRateLimit: rateLimit }));

// Estos tests fijan el comportamiento del trámite en sí, que existe con venta
// o sin ella en la base de código aunque hoy esté inalcanzable desde la UI
// (`/arrepentimiento` y `/baja` dan 404 sin venta). Sin este mock, `salesEnabled`
// leería el entorno real de quien corre la suite y el endpoint devolvería 503
// para todo, que no es lo que este archivo se propone comprobar.
vi.mock("@/lib/payments/sales", () => ({ salesEnabled: true }));

const { POST } = await import("@/app/api/legales/solicitud/route");

const post = (body: unknown) =>
  POST(
    new Request("https://cvexact.test/api/legales/solicitud", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  insert.mockReset().mockResolvedValue(undefined);
  sendMail.mockReset().mockResolvedValue(undefined);
  rateLimit.mockReset().mockResolvedValue(null);
});

describe("POST /api/legales/solicitud", () => {
  it("registra el pedido y devuelve un código", async () => {
    const response = await post({ kind: "arrepentimiento", email: "vos@ejemplo.com" });

    expect(response.status).toBe(200);
    const { code } = await response.json();
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ id: code, kind: "arrepentimiento", email: "vos@ejemplo.com" }),
    );
  });

  it("el código no usa caracteres que se transcriben mal", async () => {
    // Se dicta por teléfono y se copia a un reclamo: O/0 y l/1/I son el modo
    // de falla de un código de trámite.
    for (let i = 0; i < 40; i += 1) {
      const response = await post({ kind: "baja", email: "a@example.com" });
      const { code } = await response.json();
      expect(code).not.toMatch(/[O0lI1]/);
    }
  });

  it("no consulta la tabla de usuarios: una dirección desconocida se registra igual", async () => {
    // El día que esto falle, alguien agregó una búsqueda por email y convirtió
    // el formulario en un oráculo de enumeración de cuentas.
    const conocida = await post({ kind: "baja", email: "existe@ejemplo.com" });
    const desconocida = await post({ kind: "baja", email: "no-existe@ejemplo.com" });

    expect(conocida.status).toBe(desconocida.status);
    expect(insert).toHaveBeenCalledTimes(2);
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it("normaliza el mail a minúsculas y sin espacios", async () => {
    await post({ kind: "baja", email: "  VOS@Ejemplo.COM  " });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ email: "vos@ejemplo.com" }),
    );
  });

  it("manda la constancia como 'unsolicited'", async () => {
    // Cualquiera puede tipear cualquier dirección acá. Si el presupuesto de
    // `lib/email/budget.ts` lo tratara como correo de cuenta, el botón de
    // arrepentimiento sería un remitente abierto con reserva propia.
    await post({ kind: "arrepentimiento", email: "vos@ejemplo.com" });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "vos@ejemplo.com", kind: "unsolicited" }),
    );
  });

  it("si no se pudo registrar, no dice que se registró", async () => {
    insert.mockRejectedValue(new Error("base caída"));
    const response = await post({ kind: "baja", email: "vos@ejemplo.com" });

    expect(response.status).toBe(503);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("un fallo de correo no invalida un pedido ya registrado", async () => {
    // `sendMail` no lanza nunca por diseño, pero si algún día lo hiciera, la
    // fila ya está: el correo es la copia, no la constancia.
    sendMail.mockRejectedValue(new Error("smtp caído"));
    await expect(post({ kind: "baja", email: "vos@ejemplo.com" })).rejects.toThrow();
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("rechaza un mail inválido sin tocar la base", async () => {
    const response = await post({ kind: "baja", email: "no-es-un-mail" });
    expect(response.status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it("rechaza un tipo que no existe", async () => {
    const response = await post({ kind: "reembolso-total", email: "vos@ejemplo.com" });
    expect(response.status).toBe(400);
  });

  it("respeta el límite de tasa antes de hacer nada", async () => {
    rateLimit.mockResolvedValue(new Response(null, { status: 429 }));
    const response = await post({ kind: "baja", email: "vos@ejemplo.com" });

    expect(response.status).toBe(429);
    expect(insert).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });
});
