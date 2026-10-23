"use client";

import { Button, Checkbox } from "@/components/ui";
import { Modal } from "@/components/ui/Modal";
import { useWipeWithCopy } from "@/components/storage/useWipeWithCopy";
import { signOut } from "@/lib/auth-client";
import { clearBrowserData } from "@/lib/storage/local";

/**
 * Sign-out runs through its own dialog rather than `useConfirm`, because the
 * choice it offers is not yes/no: plain sign-out keeps this browser's data,
 * the destructive variant wipes it for whoever sits down next. Two labelled
 * actions state both outcomes; a confirm's single danger button could not.
 *
 * Opened from the «Cuenta» menu of the bar and from the «Sesión» card of Ajustes; `onError` says, where each of them can, why the session is still open.
 */
export function SignOutDialog({
  open,
  onClose,
  email,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  email: string;
  onError: (message: string) => void;
}) {
  /** The copy that comes before erasing what this browser holds, the same as «Borrar los datos de este navegador» takes: open, or with a password. */
  const wipeCopy = useWipeWithCopy();

  const signOutAndReload = async (wipe: boolean) => {
    if (wipe) {
      // Nothing is erased without its copy: the way back is the condition, and «Cerrar y borrar datos» used to erase without one.
      if (!(await wipeCopy.takeCopy())) {
        onClose();
        onError(wipeCopy.locked ? "No bajamos la copia, así que no borramos nada y tu sesión sigue abierta." : "No pudimos bajar la copia, así que no borramos nada y tu sesión sigue abierta.");
        return;
      }
      // Wipe before the network call: if signOut stalls or fails, the local data
      // is already gone, which is the outcome the user asked for.
      // Awaited: the applications and imported documents live in the browser
      // database now, and a reload that races the wipe could show them again.
      await clearBrowserData();
    }
    // The session cookie is better-auth's to clear either way.
    await signOut();
    window.location.reload();
  };

  return (
    <Modal open={open} onClose={onClose} labelledBy="signout-dialog-message" className="max-w-sm p-6">
      <p id="signout-dialog-message" className="text-[14.5px] leading-relaxed text-ink-2">
        ¿Cerrar sesión en {email}?
      </p>
      <p className="mt-2 text-[13.5px] leading-relaxed text-ink-3">
        Salvo que borres los datos, tu perfil y tus postulaciones se quedan en este
        navegador. Elegí borrarlos si estás en una computadora compartida: antes te bajamos la copia completa, que se recupera con «Introducir perfil», en Ajustes.
      </p>
      <div className="mt-3 text-[13.5px] leading-relaxed text-ink-3">
        <Checkbox
          checked={wipeCopy.locked}
          onChange={(event) => wipeCopy.setLocked(event.target.checked)}
          label="Si borrás, con contraseña, que elegís vos: así nadie más que use esta computadora puede abrir la copia. Conviene si es compartida."
        />
      </div>
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <Button variant="secondary" type="button" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="secondary" type="button" autoFocus onClick={() => void signOutAndReload(false)}>
          Cerrar sesión
        </Button>
        <Button variant="danger" type="button" onClick={() => void signOutAndReload(true)}>
          Cerrar y borrar datos
        </Button>
      </div>
    </Modal>
  );
}
