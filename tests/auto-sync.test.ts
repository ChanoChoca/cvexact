import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_SYNC_BACKOFF_MS,
  AUTO_SYNC_DELAY_MS,
  AUTO_SYNC_MAX_WAIT_MS,
  autoSyncLine,
  createAutoSync,
  decideUpload,
  type AccountProbe,
} from "@/lib/profile/auto-sync";
import { autoSyncOn } from "@/lib/profile/sync-status";
import { parseSyncState, type SyncState } from "@/lib/storage/sync-state";

/**
 * «Mantener sincronizado»: when it sends, when it does not, and how it stops. The engine reads and does everything through what
 * it is given, so all of it runs here with a clock and no network.
 */

const second = 1000;

function harness(initial: Partial<{ userId: string | null; rev: number; state: SyncState; online: boolean; probe: AccountProbe }> = {}) {
  const world = {
    userId: ("userId" in initial ? initial.userId : "u1") as string | null,
    rev: initial.rev ?? 1,
    state: initial.state ?? ({ userId: "u1", rev: 1, accountAt: "A", auto: { userId: "u1", at: "2026-10-01T00:00:00.000Z" } } as SyncState),
    online: initial.online ?? true,
    probe: initial.probe ?? ({ kind: "profile", updatedAt: "A" } as AccountProbe),
    pushes: [] as string[],
    probes: 0,
    failPush: null as string | null,
    pushTime: 0,
  };
  const engine = createAutoSync({
    userId: () => world.userId,
    profile: () => ({ rev: world.rev }),
    state: () => world.state,
    probe: async () => {
      world.probes += 1;
      return world.probe;
    },
    push: async (userId) => {
      // The profile is read when it is sent, not when the answer arrives: a change made while it goes up is not in it.
      const sentRev = world.rev;
      if (world.pushTime > 0) await new Promise((resolve) => setTimeout(resolve, world.pushTime));
      if (world.failPush) throw new Error(world.failPush);
      world.pushes.push(userId);
      // What `recordSynced` writes, and what the account has now: the version that went up.
      const accountAt = `B${world.pushes.length}`;
      world.state = { ...world.state, userId, rev: sentRev, accountAt };
      if (world.probe.kind !== "unreachable") world.probe = { kind: "profile", updatedAt: accountAt };
    },
    online: () => world.online,
    now: () => Date.now(),
    schedule: (run, ms) => {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    },
  });
  /** The person edits their profile: the browser saves, and the screen tells the engine. */
  const edit = () => {
    world.rev += 1;
    engine.poke();
  };
  return { world, engine, edit };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T12:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

describe("when it is not asked for", () => {
  it("does nothing: no timer, no question to the account", async () => {
    const { world, engine, edit } = harness({ state: { userId: "u1", rev: 1, accountAt: "A" } });
    edit();
    await vi.advanceTimersByTimeAsync(10 * 60 * second);
    expect(engine.status()).toEqual({ phase: "off" });
    expect(world.probes).toBe(0);
    expect(world.pushes).toEqual([]);
  });

  it("is about one account: another one signed in on this browser has not asked", async () => {
    const { world, engine, edit } = harness({ userId: "u2" });
    edit();
    await vi.advanceTimersByTimeAsync(10 * 60 * second);
    expect(engine.status().phase).toBe("off");
    expect(world.pushes).toEqual([]);
    expect(autoSyncOn(world.state, "u2")).toBe(false);
    expect(autoSyncOn(world.state, "u1")).toBe(true);
    expect(autoSyncOn(world.state, null)).toBe(false);
  });

  it("is off when nobody who can sync is signed in", async () => {
    const { world, engine, edit } = harness({ userId: null });
    edit();
    await vi.advanceTimersByTimeAsync(10 * 60 * second);
    expect(engine.status().phase).toBe("off");
    expect(world.probes).toBe(0);
  });
});

describe("when it is on", () => {
  it("rests while the account has everything", () => {
    const { engine } = harness();
    engine.poke();
    expect(engine.status()).toEqual({ phase: "idle" });
  });

  it("sends a change once the changes stop, and rests again", async () => {
    const { world, engine, edit } = harness();
    edit();
    expect(engine.status().phase).toBe("waiting");
    await vi.advanceTimersByTimeAsync(AUTO_SYNC_DELAY_MS - 1);
    expect(world.pushes).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(world.pushes).toEqual(["u1"]);
    expect(engine.status().phase).toBe("idle");
    expect(world.probes).toBe(1);
  });

  it("waits through a person typing, and not forever", async () => {
    const { world, edit } = harness();
    edit();
    // A change every ten seconds: the pause never gets to be twenty…
    for (let at = 10 * second; at < AUTO_SYNC_MAX_WAIT_MS; at += 10 * second) {
      await vi.advanceTimersByTimeAsync(10 * second);
      expect(world.pushes).toEqual([]);
      edit();
    }
    // …until the longest it waits.
    await vi.advanceTimersByTimeAsync(AUTO_SYNC_MAX_WAIT_MS);
    expect(world.pushes).toEqual(["u1"]);
  });

  it("asks the account before it sends, every time", async () => {
    const { world, edit } = harness();
    edit();
    await vi.advanceTimersByTimeAsync(AUTO_SYNC_DELAY_MS);
    edit();
    await vi.advanceTimersByTimeAsync(AUTO_SYNC_DELAY_MS);
    expect(world.pushes).toHaveLength(2);
    expect(world.probes).toBe(2);
  });

  it("sends what changed while it was going up, after that, and not in the same request", async () => {
    const { world, engine, edit } = harness();
    world.pushTime = 5 * second;
    edit();
    await vi.advanceTimersByTimeAsync(AUTO_SYNC_DELAY_MS + 1);
    expect(engine.status().phase).toBe("sending");
    edit(); // while it goes
    await vi.advanceTimersByTimeAsync(5 * second);
    expect(world.pushes).toHaveLength(1);
    expect(engine.status().phase).toBe("waiting");
    await vi.advanceTimersByTimeAsync(AUTO_SYNC_DELAY_MS + 5 * second);
    expect(world.pushes).toHaveLength(2);
    expect(engine.status().phase).toBe("idle");
  });

  it("goes now when the page is closing, not after the pause", async () => {
    const { world, engine, edit } = harness();
    edit();
    engine.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(world.pushes).toEqual(["u1"]);
  });

  it("goes up over an account with nothing in it", async () => {
    const { world, edit } = harness({ probe: { kind: "none" } });
    edit();
    await vi.advanceTimersByTimeAsync(AUTO_SYNC_DELAY_MS);
    expect(world.pushes).toEqual(["u1"]);
  });
});

describe("an account that was changed from another device", () => {
  const away: AccountProbe = { kind: "profile", updatedAt: "Z-from-the-phone" };

  it("is not written over: it stops and says so, and keeps what was changed here", async () => {
    const { world, engine, edit } = harness({ probe: away });
    edit();
    await vi.advanceTimersByTimeAsync(AUTO_SYNC_DELAY_MS);
    expect(world.pushes).toEqual([]);
    expect(engine.status()).toEqual({ phase: "diverged" });
    // More changes here do not end it, and do not try again: it is for the person to say.
    edit();
    await vi.advanceTimersByTimeAsync(10 * 60 * second);
    expect(world.probes).toBe(1);
    expect(world.pushes).toEqual([]);
    expect(engine.status().phase).toBe("diverged");
  });

  it("ends when the person settles it, and goes on from there", async () => {
    const { world, engine, edit } = harness({ probe: away });
    edit();
    await vi.advanceTimersByTimeAsync(AUTO_SYNC_DELAY_MS);
    expect(engine.status().phase).toBe("diverged");
    // They joined, or took one side: this browser and the account say the same, and what the account has is now known.
    world.state = { ...world.state, rev: world.rev, accountAt: "Z-from-the-phone" };
    engine.poke();
    expect(engine.status().phase).toBe("idle");
    world.probe = { kind: "profile", updatedAt: "Z-from-the-phone" };
    edit();
    await vi.advanceTimersByTimeAsync(AUTO_SYNC_DELAY_MS);
    expect(world.pushes).toEqual(["u1"]);
  });

  it("is told apart from the account being the same: only a different `updatedAt` is another device", () => {
    expect(decideUpload({ kind: "profile", updatedAt: "A" }, { accountAt: "A" })).toBe("upload");
    expect(decideUpload({ kind: "profile", updatedAt: "Z" }, { accountAt: "A" })).toBe("diverged");
    // This browser never settled any version of it: nothing says the account's is one it has seen.
    expect(decideUpload({ kind: "profile", updatedAt: "A" }, {})).toBe("diverged");
    expect(decideUpload({ kind: "none" }, { accountAt: "A" })).toBe("upload");
    expect(decideUpload({ kind: "unreachable", reason: "x" }, { accountAt: "A" })).toBe("unreachable");
  });
});

describe("when it cannot", () => {
  it("tries again after growing pauses, and then stops and says so", async () => {
    const { world, engine, edit } = harness({ probe: { kind: "unreachable", reason: "Tu cuenta no respondió." } });
    edit();
    await vi.advanceTimersByTimeAsync(AUTO_SYNC_DELAY_MS);
    expect(engine.status()).toEqual({ phase: "retrying", message: "Tu cuenta no respondió." });
    for (const pause of AUTO_SYNC_BACKOFF_MS) {
      await vi.advanceTimersByTimeAsync(pause - 1);
      const asked = world.probes;
      await vi.advanceTimersByTimeAsync(1);
      expect(world.probes).toBe(asked + 1);
    }
    expect(engine.status()).toEqual({ phase: "paused", message: "Tu cuenta no respondió." });
    expect(world.probes).toBe(1 + AUTO_SYNC_BACKOFF_MS.length);
    // Paused is paused: neither time nor another change ends it.
    edit();
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * second);
    expect(world.probes).toBe(1 + AUTO_SYNC_BACKOFF_MS.length);
    expect(world.pushes).toEqual([]);
  });

  it("says what the server said when the upload is what failed", async () => {
    const { world, engine, edit } = harness();
    world.failPush = "El contenido a subir es demasiado grande.";
    edit();
    await vi.advanceTimersByTimeAsync(AUTO_SYNC_DELAY_MS);
    expect(engine.status()).toEqual({ phase: "retrying", message: "El contenido a subir es demasiado grande." });
  });

  it("recovers: a later attempt that works goes up, and the count starts over", async () => {
    const { world, engine, edit } = harness();
    world.failPush = "No hay conexión.";
    edit();
    await vi.advanceTimersByTimeAsync(AUTO_SYNC_DELAY_MS);
    expect(engine.status().phase).toBe("retrying");
    world.failPush = null;
    await vi.advanceTimersByTimeAsync(AUTO_SYNC_BACKOFF_MS[0]!);
    expect(world.pushes).toEqual(["u1"]);
    expect(engine.status().phase).toBe("idle");
  });

  it("«Reintentar» ends a pause and tries now", async () => {
    const { world, engine, edit } = harness({ probe: { kind: "unreachable", reason: "Sin respuesta." } });
    edit();
    await vi.advanceTimersByTimeAsync(AUTO_SYNC_DELAY_MS + AUTO_SYNC_BACKOFF_MS.reduce((total, pause) => total + pause, 0));
    expect(engine.status().phase).toBe("paused");
    world.probe = { kind: "profile", updatedAt: "A" };
    engine.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(world.pushes).toEqual(["u1"]);
    expect(engine.status().phase).toBe("idle");
  });

  it("does not try without a connection, and goes when it is back", async () => {
    const { world, engine, edit } = harness({ online: false });
    edit();
    await vi.advanceTimersByTimeAsync(AUTO_SYNC_DELAY_MS);
    expect(world.probes).toBe(0);
    expect(engine.status().phase).toBe("waiting");
    expect(autoSyncLine(engine.status())).toMatch(/Sin conexión/);
    world.online = true;
    engine.poke();
    await vi.advanceTimersByTimeAsync(AUTO_SYNC_DELAY_MS);
    expect(world.pushes).toEqual(["u1"]);
  });

  it("stops what it was going to do when the person signs out, or turns it off", async () => {
    const { world, engine, edit } = harness();
    edit();
    world.userId = null;
    engine.poke();
    await vi.advanceTimersByTimeAsync(AUTO_SYNC_DELAY_MS * 2);
    expect(engine.status().phase).toBe("off");
    expect(world.probes).toBe(0);

    world.userId = "u1";
    edit();
    const withoutAuto = { ...world.state };
    delete withoutAuto.auto;
    world.state = withoutAuto;
    engine.poke();
    await vi.advanceTimersByTimeAsync(AUTO_SYNC_DELAY_MS * 2);
    expect(engine.status().phase).toBe("off");
    expect(world.pushes).toEqual([]);
  });
});

describe("what is told of it", () => {
  it("is said in words for each state, and nothing when it is off", () => {
    expect(autoSyncLine({ phase: "off" })).toBeNull();
    expect(autoSyncLine({ phase: "idle" })).toBe("Lo que cambies en tu perfil se sube solo.");
    expect(autoSyncLine({ phase: "waiting" })).toBe("Subimos tus cambios en unos segundos.");
    expect(autoSyncLine({ phase: "sending" })).toBe("Subiendo tus cambios…");
    expect(autoSyncLine({ phase: "retrying", message: "Sin conexión." })).toBe("No pudimos subir tus cambios: Sin conexión. Probamos de nuevo en un rato.");
    expect(autoSyncLine({ phase: "diverged" })).toMatch(/otro celular o computadora/);
    expect(autoSyncLine({ phase: "paused", message: "Tu sesión se cerró." })).toBe("Se pausó después de varios intentos: Tu sesión se cerró. Tus cambios siguen a salvo en este navegador.");
  });

  it("tells the screens when it changes, and stops when they stop listening", async () => {
    const { engine, edit } = harness();
    const heard: string[] = [];
    const stop = engine.subscribe(() => heard.push(engine.status().phase));
    edit();
    await vi.advanceTimersByTimeAsync(AUTO_SYNC_DELAY_MS);
    expect(heard).toEqual(["waiting", "sending", "idle"]);
    stop();
    edit();
    expect(heard).toHaveLength(3);
  });
});

describe("what the browser remembers of the permission", () => {
  it("is read from what was stored, and ignored when it is not a permission for an account", () => {
    const auto = { userId: "u1", at: "2026-10-04T10:00:00.000Z" };
    expect(parseSyncState(JSON.stringify({ userId: "u1", rev: 3, auto }))).toEqual({ userId: "u1", rev: 3, auto });
    expect(parseSyncState(JSON.stringify({ auto: { userId: "", at: "x" } }))).toEqual({});
    expect(parseSyncState(JSON.stringify({ auto: "yes" }))).toEqual({});
    expect(parseSyncState(JSON.stringify({ auto: { userId: 7, at: "x" } }))).toEqual({});
  });
});
