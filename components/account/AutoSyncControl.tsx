"use client";

import { useState } from "react";
import { Alert, Button } from "@/components/ui";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/toast";
import { autoSync, useAutoSyncStatus } from "@/lib/api/auto-sync";
import { describeUpload, disableAutoSync, enableAutoSync, joinWithAccount } from "@/lib/api/sync-client";
import { autoSyncLine } from "@/lib/profile/auto-sync";
import { describeJoin } from "@/lib/profile/join";
import { autoSyncOn, whenWords } from "@/lib/profile/sync-status";
import { useSyncState } from "@/lib/storage/sync-state";

/**
 * «Mantener sincronizado», where it is turned on and off: in the account, under the two buttons that put the profile up
 * and bring it down.
 *
 * Off is how everyone starts, and the sentence says what turning it on does before the button does it — the permission is
 * asked again, with the whole of it, when it is pressed (`enableAutoSync`). On, it says how it is doing in words
 * (`autoSyncLine`), because something that acts on its own is only fair if it can be seen acting, and it can be turned off
 * as plainly as it was turned on. When the account was changed from another device it does not decide: it says so, and
 * offers to join the two.
 */
export function AutoSyncControl({ userId, verified }: { userId: string; verified: boolean }) {
  const confirm = useConfirm();
  const toast = useToast();
  const state = useSyncState();
  const live = useAutoSyncStatus();
  const [busy, setBusy] = useState<"enable" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => new Date());
  const on = autoSyncOn(state, verified ? userId : null);
  const line = autoSyncLine(live);

  const enable = async () => {
    setBusy("enable");
    setError(null);
    try {
      const outcome = await enableAutoSync(userId, confirm);
      if (outcome.status === "on") {
        toast({ tone: "good", message: `${outcome.uploaded ? describeUpload(outcome.uploaded) : "Tu cuenta ya tenía tu perfil."} Desde ahora lo que cambies se sube solo.` });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos activarlo.");
    } finally {
      setBusy(null);
    }
  };

  const join = async () => {
    setBusy("join");
    setError(null);
    try {
      const outcome = await joinWithAccount(userId, confirm);
      if (outcome.status === "joined") {
        const adds = describeJoin(outcome.added);
        toast({ tone: "good", message: adds ? `Juntamos los dos perfiles: agregamos ${adds}. Tu cuenta ya los tiene.` : "Listo: tu cuenta ya tiene este perfil." });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos juntarlos.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-4 space-y-3 border-t border-rule pt-4" data-auto-sync>
      <p className="text-sm font-medium text-ink-2">Mantener sincronizado</p>
      {on ? (
        <>
          <p className="text-sm text-ink-2">
            Activado{state.auto ? ` ${whenWords(state.auto.at, now)}` : ""}. Lo que cambies en tu perfil se sube solo a tu cuenta, después de mirar que no haya cambios hechos desde otro celular o computadora. Tus postulaciones no se suben solas.
          </p>
          {line ? (
            <p className="text-sm text-ink" role="status" data-auto-sync-status data-phase={live.phase}>
              {line}
            </p>
          ) : null}
          {live.phase === "diverged" ? (
            <p className="text-sm text-ink-2">
              Podés juntar los dos perfiles, o quedarte con uno solo: «Subir a mi cuenta» deja el de este navegador y «Bajar de mi cuenta» el de tu cuenta, y los dos te bajan antes una copia de lo que reemplazan.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {live.phase === "diverged" ? (
              <Button variant="secondary" disabled={busy !== null} onClick={join}>
                {busy === "join" ? "Juntando…" : "Juntar los dos"}
              </Button>
            ) : null}
            {live.phase === "paused" || live.phase === "retrying" ? (
              <Button variant="secondary" onClick={() => autoSync().retry()}>
                Probar de nuevo ahora
              </Button>
            ) : null}
            <Button variant="ghost" disabled={busy !== null} onClick={() => disableAutoSync(userId)}>
              Apagarlo
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-ink-2">
            Hoy tu perfil se sube cuando vos lo pedís. Si querés, lo subimos solos cada vez que lo cambies, y lo apagás cuando quieras.
          </p>
          <Button variant="secondary" disabled={busy !== null || !verified} onClick={enable}>
            {busy === "enable" ? "Activando…" : "Activar"}
          </Button>
        </>
      )}
      {error ? <Alert tone="bad">{error}</Alert> : null}
    </div>
  );
}
