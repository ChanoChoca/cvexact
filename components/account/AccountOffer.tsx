"use client";

import { useState } from "react";
import { Alert, Button } from "@/components/ui";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { pullWithGuard } from "@/lib/api/sync-client";
import { declineAccountProfile } from "@/lib/storage/sync-state";
import { useAccountOffer } from "./useAccountOffer";

/**
 * «Tu cuenta tiene un perfil guardado · Traerlo»: where someone who has just signed in, on a browser with nothing in it or
 * with an older profile, is told that what they were looking for is already theirs. Signing in did not bring it, and the
 * only way to was a button in Ajustes that also downloads a file and reloads the page.
 *
 * It asks; it never takes. Bringing it is a tap, and where it would replace something worth keeping that is said first,
 * with both side by side, and what goes is written down before it does (`pullWithGuard`). «Ahora no» silences this version
 * of the account's profile, and not the next one. Nothing is shown to anyone without an account, or with an account that
 * has nothing to bring.
 */
export function AccountOffer() {
  const confirm = useConfirm();
  const { offer, userId } = useAccountOffer();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!offer || !userId) return null;

  const bring = async () => {
    setBusy(true);
    setError(null);
    try {
      await pullWithGuard(userId, confirm);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos traer tu perfil.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="account-offer-title" className="space-y-3 border border-rule bg-paper-2 p-5">
      <h2 id="account-offer-title" className="text-[16px] text-ink">
        {offer.title}
      </h2>
      <p className="text-sm text-ink-2">{offer.detail}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={busy} onClick={bring}>
          {busy ? "Trayendo…" : "Traerlo"}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => declineAccountProfile(offer.account.updatedAt)}>
          Ahora no
        </Button>
      </div>
      <p className="text-xs text-ink-3">Con «Ahora no» no te lo volvemos a ofrecer hasta que tu cuenta cambie.</p>
      {error ? <Alert tone="bad">{error}</Alert> : null}
    </section>
  );
}
