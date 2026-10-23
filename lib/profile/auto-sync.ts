import type { StoredProfile } from "@/lib/schemas/profile-v2";
import type { SyncState } from "@/lib/storage/sync-state";
import { autoSyncOn, syncStatus } from "./sync-status";

/**
 * «Mantener sincronizado»: the profile goes up to the account on its own, when the person asked for that and for as long as
 * they want it.
 *
 * Everything here is about not doing harm while doing it. It sends after the changes stop (a person typing is not
 * a stream of uploads), never over a profile the account has changed from another device — which it would silently erase —
 * and it keeps trying, with growing pauses, when the account cannot be reached, until it says so and stops. Nothing it does
 * is hidden: the state it is in is `status()`, which the screens show.
 *
 * The profile only. Applications go when the person taps «Subir a mi cuenta» — they are many, and big, and a change in
 * one of them is not what a profile edit means.
 *
 * The engine knows nothing of the browser: what it reads and what it does come in as `AutoSyncDeps`, so the whole of how it
 * waits, retries and stops is tested without a clock or a network.
 */

/** What a question to the account about its profile comes back with. */
export type AccountProbe =
  /** The account could not be asked, or did not answer: nothing is known, so nothing is done. */
  | { kind: "unreachable"; reason: string }
  /** The account has no profile with anything in it: there is nothing there to lose. */
  | { kind: "none" }
  /** It has one, last changed (by whichever device) at `updatedAt`. */
  | { kind: "profile"; updatedAt: string };

export type UploadDecision = "upload" | "diverged" | "unreachable";

/**
 * What to do about an account that was just asked. Its profile is still the one this browser last put there or brought
 * down when its `updatedAt` is the one remembered (`accountAt`): then going up replaces nothing that this browser has not
 * seen. Any other `updatedAt` is a change from somewhere else — the clocks of two devices are not one clock, so only
 * "the same or not" is read from it, never which is later.
 */
export function decideUpload(probe: AccountProbe, state: Pick<SyncState, "accountAt">): UploadDecision {
  if (probe.kind === "unreachable") return "unreachable";
  if (probe.kind === "none") return "upload";
  return probe.updatedAt === state.accountAt ? "upload" : "diverged";
}

export type AutoSyncPhase =
  /** Not asked for, or nobody who can sync is signed in. */
  | "off"
  /** On, and the account has everything. */
  | "idle"
  /** On, and something changed that is waiting for the changes to stop. */
  | "waiting"
  | "sending"
  /** It failed and will be tried again after a pause. */
  | "retrying"
  /** The account has changes from another device: it does not go up until the person says how. */
  | "diverged"
  /** It failed too many times in a row: it stops until the person says so, or something changes. */
  | "paused";

export type AutoSyncStatus = { phase: AutoSyncPhase; /** What went wrong, for `retrying` and `paused`; or why it waits. */ message?: string };

/** How long after the last change it goes up, and the longest it waits through a stream of them. */
export const AUTO_SYNC_DELAY_MS = 20_000;
export const AUTO_SYNC_MAX_WAIT_MS = 120_000;
/** The pauses between attempts after a failure: after the last one, it stops and says so. */
export const AUTO_SYNC_BACKOFF_MS = [30_000, 120_000, 600_000, 1_800_000] as const;

export type AutoSyncDeps = {
  /** The account that is signed in and able to sync, or `null`. */
  userId: () => string | null;
  profile: () => Pick<StoredProfile, "rev">;
  state: () => SyncState;
  probe: () => Promise<AccountProbe>;
  /** Puts this browser's profile in the account and records it (`recordSynced`); throws, with a sentence for the person, when it cannot. */
  push: (userId: string) => Promise<void>;
  online: () => boolean;
  now: () => number;
  /** Runs `run` once after `ms`; returns what cancels it. */
  schedule: (run: () => void, ms: number) => () => void;
};

export type AutoSync = {
  /** Something that matters changed — the profile, what is remembered, who is signed in, the connection: look again. */
  poke: () => void;
  /** The page is going away: what is waiting goes now, not after the pause. */
  flush: () => void;
  /** «Reintentar»: a stop, a pause or a wait ends and it is tried now. */
  retry: () => void;
  dispose: () => void;
  status: () => AutoSyncStatus;
  subscribe: (listener: () => void) => () => void;
};

export function createAutoSync(deps: AutoSyncDeps): AutoSync {
  let current: AutoSyncStatus = { phase: "off" };
  const listeners = new Set<() => void>();
  let cancel: (() => void) | null = null;
  let sending = false;
  let attempt = 0;
  let waitingSince: number | null = null;

  const set = (next: AutoSyncStatus): void => {
    if (next.phase === current.phase && next.message === current.message) return;
    current = next;
    for (const listener of [...listeners]) listener();
  };
  const stop = (): void => {
    cancel?.();
    cancel = null;
  };
  const forget = (): void => {
    stop();
    attempt = 0;
    waitingSince = null;
  };

  /** Whether there is something to send, and to whom: on, signed in, and the profile is not what the account was left with. */
  const pending = (): string | null => {
    const userId = deps.userId();
    const state = deps.state();
    if (!userId || !autoSyncOn(state, userId)) return null;
    return syncStatus(deps.profile(), state, userId) === "pending" ? userId : null;
  };

  async function run(): Promise<void> {
    cancel = null;
    if (sending) return;
    const userId = pending();
    if (!userId) return poke();
    if (!deps.online()) {
      // Nothing to try: the connection coming back calls `poke`, which starts it again.
      set({ phase: "waiting", message: "Sin conexión: subimos tus cambios cuando vuelva." });
      return;
    }
    sending = true;
    set({ phase: "sending" });
    let failure: string | null = null;
    let diverged = false;
    try {
      const probe = await deps.probe();
      const decision = decideUpload(probe, deps.state());
      if (decision === "diverged") diverged = true;
      else if (decision === "unreachable") failure = probe.kind === "unreachable" ? probe.reason : "Tu cuenta no respondió.";
      else await deps.push(userId);
    } catch (error) {
      failure = error instanceof Error && error.message ? error.message : "No pudimos subir tus cambios.";
    } finally {
      sending = false;
    }
    if (diverged) {
      forget();
      set({ phase: "diverged" });
      return;
    }
    if (failure !== null) {
      attempt += 1;
      const pause = AUTO_SYNC_BACKOFF_MS[attempt - 1];
      if (pause === undefined) {
        forget();
        set({ phase: "paused", message: failure });
        return;
      }
      set({ phase: "retrying", message: failure });
      cancel = deps.schedule(() => void run(), pause);
      return;
    }
    attempt = 0;
    waitingSince = null;
    // What changed while it went up is not in it: this looks at the profile again, and waits for that.
    poke();
  }

  function poke(): void {
    const userId = deps.userId();
    if (!userId || !autoSyncOn(deps.state(), userId)) {
      if (!sending) {
        forget();
        set({ phase: "off" });
      }
      return;
    }
    if (pending() === null) {
      if (!sending) {
        // All of it is up there — or the person settled it themselves, which ends a pause or a divergence.
        forget();
        set({ phase: "idle" });
      }
      return;
    }
    // The person decides what to do about a divergence, and a pause waits for «Reintentar»; more changes do not end either.
    if (sending || current.phase === "diverged" || current.phase === "paused" || current.phase === "retrying") return;
    const now = deps.now();
    waitingSince ??= now;
    const wait = Math.max(0, Math.min(AUTO_SYNC_DELAY_MS, waitingSince + AUTO_SYNC_MAX_WAIT_MS - now));
    stop();
    cancel = deps.schedule(() => void run(), wait);
    set({ phase: "waiting" });
  }

  return {
    poke,
    flush() {
      if (current.phase !== "waiting" || sending) return;
      stop();
      void run();
    },
    retry() {
      if (sending) return;
      forget();
      if (current.phase === "paused" || current.phase === "retrying" || current.phase === "diverged") set({ phase: "idle" });
      void run();
    },
    dispose() {
      forget();
      listeners.clear();
    },
    status: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** What the screens say of the state it is in, or `null` when it is not on. Pure, so the words are tested. */
export function autoSyncLine(status: AutoSyncStatus): string | null {
  switch (status.phase) {
    case "off":
      return null;
    case "idle":
      return "Lo que cambies en tu perfil se sube solo.";
    case "waiting":
      return status.message ?? "Subimos tus cambios en unos segundos.";
    case "sending":
      return "Subiendo tus cambios…";
    case "retrying":
      return `No pudimos subir tus cambios${status.message ? `: ${status.message}` : "."} Probamos de nuevo en un rato.`;
    case "diverged":
      return "Se frenó: tu cuenta tiene cambios hechos desde otro celular o computadora, y subir los de este navegador los borraría. Elegí qué conservar.";
    case "paused":
      return `Se pausó después de varios intentos${status.message ? `: ${status.message}` : "."} Tus cambios siguen a salvo en este navegador.`;
  }
}
