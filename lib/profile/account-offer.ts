import { describeProfile, hasSubstance } from "@/lib/profile/replace-guard";
import { whenWords } from "@/lib/profile/sync-status";
import type { StoredProfile } from "@/lib/schemas/profile-v2";
import type { SyncState } from "@/lib/storage/sync-state";

/**
 * When to tell someone that their account has a profile worth bringing here.
 *
 * Signing in does not bring anything down: the profile an account holds only came to a browser by a button in Ajustes
 * that also downloads a file and reloads the page, which nobody looking for their profile on a new phone would think of.
 * Someone who signs in on a browser with nothing in it, or with a profile older than the account's, is offered theirs,
 * once and where they are — never taken without asking, and never again if they say no to that version of it. Bringing
 * it is still a tap, and replaces what is here only after saying so (`pullReplacesPrompt`), with a copy of it first.
 *
 * Pure, so the rule and the words are tested; `useAccountOffer` asks the account and the screens show what this says.
 */

export type AccountOffer = {
  /** `empty`: this browser has nothing worth keeping, so bringing it replaces nothing. `newer`: it has, and the account's is more recent. */
  reason: "empty" | "newer";
  account: StoredProfile;
  title: string;
  detail: string;
  /** Whether bringing it replaces something worth asking about first. */
  replaces: boolean;
};

export function accountOffer({
  local,
  account,
  state,
  now,
  timeZone,
}: {
  local: StoredProfile;
  account: StoredProfile | null;
  state: SyncState;
  now: Date;
  timeZone?: string;
}): AccountOffer | null {
  // A profile with a name and nothing else has nothing to bring.
  if (!account || !hasSubstance(account)) return null;
  // This version was settled here — brought, put there or turned down: a newer one is offered again, this one is not.
  if (state.accountAt && state.accountAt === account.updatedAt) return null;
  const accountWhen = whenWords(account.updatedAt, now, timeZone);

  if (!hasSubstance(local)) {
    return {
      reason: "empty",
      account,
      title: "Tu cuenta tiene un perfil guardado",
      detail: `Tiene ${describeProfile(account)}${accountWhen ? ` (guardado ${accountWhen})` : ""}. Traelo para seguir desde acá, sin cargar nada de nuevo.`,
      replaces: false,
    };
  }
  // Same moment, or older: this browser is the one that is up to date, or the one with something else — there is no "newer" to offer.
  if (account.updatedAt <= local.updatedAt) return null;
  const localWhen = whenWords(local.updatedAt, now, timeZone);
  return {
    reason: "newer",
    account,
    title: "Tu cuenta tiene un perfil más reciente",
    detail:
      `Tiene ${describeProfile(account)}${accountWhen ? ` (guardado ${accountWhen})` : ""}; este navegador tiene ${describeProfile(local)}${localWhen ? ` (del ${localWhen.replace(/^el /, "")})` : ""}. ` +
      "Si lo traés, reemplaza el de acá: antes te bajamos una copia.",
    replaces: true,
  };
}
