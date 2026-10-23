import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Per-account lockout.
 *
 * The rate limiter keys on the client address, which an attacker spread across
 * a proxy pool never trips. This counts failures against the account instead,
 * so the interesting cases are the ones where the two disagree: many addresses,
 * one account.
 *
 * The property that matters most is the last one — an account that does not
 * exist must lock exactly like one that does. A lockout that only fired for
 * real accounts would be a faster way to enumerate users than the login form.
 *
 * In-memory path, as with `tests/quota.test.ts`.
 */

async function loadLockout() {
  vi.resetModules();
  return import("@/lib/auth-lockout");
}

beforeEach(() => {
  delete process.env.DATABASE_URL;
  delete process.env.SMTP_HOST;
  delete process.env.MAIL_FROM;
});

describe("el backoff", () => {
  it("no bloquea por debajo del umbral", async () => {
    const { lockMinutes } = await loadLockout();
    for (let failures = 0; failures < 5; failures += 1) {
      expect(lockMinutes(failures), `${failures} fallos`).toBe(0);
    }
  });

  it("duplica la espera en cada fallo nuevo", async () => {
    const { lockMinutes } = await loadLockout();
    expect(lockMinutes(5)).toBe(1);
    expect(lockMinutes(6)).toBe(2);
    expect(lockMinutes(7)).toBe(4);
    expect(lockMinutes(8)).toBe(8);
    expect(lockMinutes(9)).toBe(16);
  });

  it("topea en 30 minutos por más que sigan los intentos", async () => {
    const { lockMinutes } = await loadLockout();
    expect(lockMinutes(10)).toBe(30);
    expect(lockMinutes(50)).toBe(30);
    // Sin techo, cualquiera que sepa un correo podría dejar afuera a su dueño
    // para siempre: el lockout se volvería el ataque.
    expect(lockMinutes(500)).toBe(30);
  });
});

describe("checkLockout", () => {
  it("deja pasar una cuenta sin fallos", async () => {
    const { checkLockout } = await loadLockout();
    expect(await checkLockout("nadie@ejemplo.com")).toEqual({ locked: false });
  });

  it("deja pasar mientras los fallos no lleguen al umbral", async () => {
    const { checkLockout, recordFailure } = await loadLockout();
    for (let i = 0; i < 4; i += 1) await recordFailure("a@ejemplo.com");
    expect(await checkLockout("a@ejemplo.com")).toEqual({ locked: false });
  });

  it("bloquea al quinto fallo", async () => {
    const { checkLockout, recordFailure } = await loadLockout();
    for (let i = 0; i < 5; i += 1) await recordFailure("a@ejemplo.com");

    const result = await checkLockout("a@ejemplo.com");
    expect(result.locked).toBe(true);
  });

  it("cuenta los fallos vengan de donde vengan", async () => {
    // El punto entero del lockout: `recordFailure` no toma ninguna dirección,
    // así que cinco intentos desde cinco IPs distintas pesan lo mismo que cinco
    // desde una — que es justo lo que el límite por IP no puede ver.
    const { checkLockout, recordFailure } = await loadLockout();
    for (let i = 0; i < 5; i += 1) await recordFailure("a@ejemplo.com");
    expect((await checkLockout("a@ejemplo.com")).locked).toBe(true);
  });

  it("trata el correo sin distinguir mayúsculas", async () => {
    const { checkLockout, recordFailure } = await loadLockout();
    for (let i = 0; i < 5; i += 1) await recordFailure("A@Ejemplo.com");
    // Si no, `A@x` y `a@x` serían dos presupuestos de intentos para la misma cuenta.
    expect((await checkLockout("a@ejemplo.com  ")).locked).toBe(true);
  });

  it("no mezcla cuentas distintas", async () => {
    const { checkLockout, recordFailure } = await loadLockout();
    for (let i = 0; i < 5; i += 1) await recordFailure("a@ejemplo.com");
    expect(await checkLockout("b@ejemplo.com")).toEqual({ locked: false });
  });

  it("se abre sola cuando pasa la espera", async () => {
    vi.useFakeTimers();
    try {
      const { checkLockout, recordFailure } = await loadLockout();
      for (let i = 0; i < 5; i += 1) await recordFailure("a@ejemplo.com");
      expect((await checkLockout("a@ejemplo.com")).locked).toBe(true);

      // Cinco fallos son un minuto.
      vi.advanceTimersByTime(60_001);
      expect(await checkLockout("a@ejemplo.com")).toEqual({ locked: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it("un bloqueo vencido no arrastra los fallos viejos", async () => {
    vi.useFakeTimers();
    try {
      const { checkLockout, recordFailure } = await loadLockout();
      for (let i = 0; i < 5; i += 1) await recordFailure("a@ejemplo.com");
      vi.advanceTimersByTime(60_001);

      // El contador arranca de cero: si no, la cuenta quedaría bloqueada media
      // hora por los tipeos de la semana pasada.
      await recordFailure("a@ejemplo.com");
      expect(await checkLockout("a@ejemplo.com")).toEqual({ locked: false });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("clearFailures", () => {
  it("un ingreso exitoso limpia la cuenta", async () => {
    const { checkLockout, clearFailures, recordFailure } = await loadLockout();
    for (let i = 0; i < 4; i += 1) await recordFailure("a@ejemplo.com");
    await clearFailures("a@ejemplo.com");

    // Sin limpiar, el quinto fallo de dentro de un mes bloquearía a alguien que
    // ya demostró saber su contraseña.
    await recordFailure("a@ejemplo.com");
    expect(await checkLockout("a@ejemplo.com")).toEqual({ locked: false });
  });
});

describe("no revela qué cuentas existen", () => {
  it("una dirección sin cuenta se bloquea igual que una real", async () => {
    const { checkLockout, recordFailure } = await loadLockout();

    for (let i = 0; i < 5; i += 1) await recordFailure("no-existe@ejemplo.com");
    const fake = await checkLockout("no-existe@ejemplo.com");

    for (let i = 0; i < 5; i += 1) await recordFailure("existe@ejemplo.com");
    const real = await checkLockout("existe@ejemplo.com");

    // `recordFailure` nunca consulta la tabla de usuarios, así que no puede
    // responder distinto según exista o no la cuenta.
    expect(fake).toEqual(real);
  });
});
