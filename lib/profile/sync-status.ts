import type { StoredProfile } from "@/lib/schemas/profile-v2";
import type { SyncState } from "@/lib/storage/sync-state";
import type { AutoSyncStatus } from "./auto-sync";

/**
 * Whether the account has what is on this screen, said in words.
 *
 * Signing in did not put the profile anywhere, an upload left no trace, and so a person could not tell whether their
 * account was up to date, or had anything of theirs at all, without uploading again. `SyncState` is the trace; this
 * reads it against the profile and says what it means: «Entraste: falta subirlo», «Cambios sin subir», or that it is
 * all there. Pure, so the words are tested. Nothing here uploads anything — it only tells, and what happens next is
 * the person's tap, or what they asked for once, for good, with «Mantener sincronizado» (clause 2 of the privacy policy).
 */

export type SyncStatus =
  /** No account to be up to date with: nobody signed in, or an address not confirmed yet, which cannot sync. */
  | "off"
  /** Signed in, and this browser has never sent its profile to this account, nor taken it from it. */
  | "never"
  /** The profile has been saved since it last met the account. */
  | "pending"
  /** Nothing has changed since. */
  | "synced";

/** Whether the person asked, for this account, that their profile go up on its own when it changes («Mantener sincronizado»). */
export const autoSyncOn = (state: Pick<SyncState, "auto">, userId: string | null): boolean => userId !== null && userId !== "" && state.auto?.userId === userId;

/**
 * `userId` is the account that is signed in and able to sync, or `null`. The state of another account says nothing
 * about this one, and neither does a state with no `rev`.
 *
 * A `rev` that is not the one remembered counts as a change whichever way it went: a save raises it, and a profile put
 * in by import or by taking the account's own down replaces it wholesale, with a `rev` that can be lower.
 */
export function syncStatus(profile: Pick<StoredProfile, "rev">, state: SyncState, userId: string | null): SyncStatus {
  if (!userId) return "off";
  if (state.userId !== userId || state.rev === undefined) return "never";
  return profile.rev === state.rev ? "synced" : "pending";
}

/** «el 3 de octubre» — and the year, only when it is not this one. */
export function whenWords(iso: string, now: Date, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const zone = timeZone ? { timeZone } : {};
  const yearOf = (value: Date) => new Intl.DateTimeFormat("en-US", { year: "numeric", ...zone }).format(value);
  const options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", ...zone, ...(yearOf(date) === yearOf(now) ? {} : { year: "numeric" }) };
  return `el ${date.toLocaleDateString("es-AR", options)}`;
}

/** «el 3 de octubre, 14:32»: the same day, for what is listed one under another and needs the hour to tell them apart. */
export function whenAtWords(iso: string, now: Date, timeZone?: string): string {
  const day = whenWords(iso, now, timeZone);
  if (!day) return "";
  const hour = new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, ...(timeZone ? { timeZone } : {}) });
  return `${day}, ${hour}`;
}

/** The one line that says it, wherever it is asked: Ajustes, the end of the first-run flow. */
export function syncLine(status: SyncStatus, state: SyncState, now: Date, timeZone?: string): string | null {
  const when = state.at ? whenWords(state.at, now, timeZone) : "";
  switch (status) {
    case "off":
      return null;
    case "never":
      return "Tu cuenta todavía no tiene tu perfil.";
    case "pending":
      return when ? `Cambios sin subir: tu cuenta tiene tu perfil como estaba ${when}.` : "Cambios sin subir.";
    case "synced":
      return when ? `Tu cuenta tiene tu perfil al día: lo igualaste ${when}.` : "Tu cuenta tiene tu perfil al día.";
  }
}

/** The notices about the account that can be put off: what it lacks, and the two ways the automatic upload can be stuck. */
export type NoticeKind = "never" | "pending" | "diverged" | "paused";
export const NOTICE_KINDS: readonly NoticeKind[] = ["never", "pending", "diverged", "paused"];

/** Whether a «Ahora no» said for `snoozedFor` holds off a notice of `kind`: only that one — and, said before this was told apart, what it was for. */
export function snoozeCovers(snoozedFor: NoticeKind | undefined, kind: NoticeKind): boolean {
  return snoozedFor === undefined ? kind === "never" || kind === "pending" : snoozedFor === kind;
}

export type SyncNotice = {
  /** `diverged` and `paused` are the two ways «Mantener sincronizado» can be stuck: the rest is about what the account lacks. */
  status: NoticeKind;
  title: string;
  detail: string;
};

/**
 * What to say when the account lacks something of the profile: that it has nothing of it yet, or that what changed since
 * is only here. `null` when there is nothing to say (no account, or all of it is up there). Said as it is wherever it is
 * asked — the end of the first-run flow shows it always; the list of what is left to do, only when it is due.
 */
export function syncNoticeText({
  status,
  state,
  email,
  now,
  timeZone,
  auto,
}: {
  status: SyncStatus;
  state: SyncState;
  email?: string | undefined;
  now: Date;
  timeZone?: string;
  /** How «Mantener sincronizado» is doing, when the person turned it on. Then what changed is on its way, unless it is stuck. */
  auto?: AutoSyncStatus | undefined;
}): SyncNotice | null {
  if (auto && status !== "off") {
    if (auto.phase === "diverged") {
      return {
        status: "diverged",
        title: "Tu cuenta tiene cambios de otro celular o computadora",
        detail: "Subir los de este navegador los borraría, y por eso lo frenamos. Podés juntar los dos perfiles, o quedarte con uno solo.",
      };
    }
    if (auto.phase === "paused") {
      return {
        status: "paused",
        title: "Se pausó la sincronización",
        detail: `${auto.message ?? "No pudimos subir tus cambios."} Siguen a salvo en este navegador: probá de nuevo, o subilos a mano cuando puedas.`,
      };
    }
    // On, and not stuck: what changed is waiting its turn, and there is nothing for the person to do about it.
    if (status === "pending") return null;
  }
  if (status === "never") {
    return {
      status,
      title: "Entraste: falta subir tu perfil",
      detail:
        `${email ? `Tu cuenta, ${email}, todavía` : "Tu cuenta todavía"} no lo tiene: sigue viviendo solo en este navegador. ` +
        "Subilo para tenerlo en cualquier celular o computadora y a salvo si se borran los datos de acá.",
    };
  }
  if (status === "pending") {
    const when = state.at ? whenWords(state.at, now, timeZone) : "";
    return {
      status,
      title: "Cambios sin subir",
      detail: `${when ? `Tu cuenta tiene tu perfil como estaba ${when}` : "Tu cuenta tiene una versión anterior de tu perfil"}; lo que cambiaste desde entonces sigue solo en este navegador.`,
    };
  }
  return null;
}

/**
 * The notice that goes in the list of what is left to do: when the account lacks something, there is something in the
 * profile worth having there, and the person has not put it off for now. `null` otherwise — an empty profile has
 * nothing to keep, and a notice that cannot be silenced would be the one thing here that nags.
 */
export function syncNotice({
  status,
  substance,
  state,
  email,
  now,
  timeZone,
  auto,
}: {
  status: SyncStatus;
  /** There is something in the profile worth keeping (`hasSubstance`). */
  substance: boolean;
  state: SyncState;
  email?: string | undefined;
  now: Date;
  timeZone?: string;
  auto?: AutoSyncStatus | undefined;
}): SyncNotice | null {
  if (!substance) return null;
  const notice = syncNoticeText({ status, state, email, now, auto, ...(timeZone ? { timeZone } : {}) });
  if (!notice) return null;
  // «Ahora no» holds off the notice it was said to: one that says something else — the upload stuck, after the changes not uploaded were
  // put off — is news, and a failure that nobody heard of would be hidden for as long as the other was.
  if (state.snoozedUntil && state.snoozedUntil > now.toISOString() && snoozeCovers(state.snoozedFor, notice.status)) return null;
  return notice;
}
