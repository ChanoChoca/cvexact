"use client";

import { useState } from "react";
import { Button, Checkbox } from "@/components/ui";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/toast";
import { freeSpace } from "@/lib/storage/local";
import { useWipeWithCopy } from "./useWipeWithCopy";

/**
 * «Liberar espacio»: for a browser with no room left, everything that can go and nothing that cannot — the profile and the keys stay (`freeSpace`).
 *
 * What goes is the person's work too (the postings saved here), so it is not done without the way back: the complete copy is taken first, open or with a password,
 * the same as before erasing the data of the browser (`useWipeWithCopy`), and if it cannot be taken nothing is erased.
 */
export function FreeSpaceButton() {
  const confirm = useConfirm();
  const toast = useToast();
  const copy = useWipeWithCopy();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    const ok = await confirm(
      "Vamos a borrar de este navegador tus postulaciones guardadas, tus borradores y lo que se guardó para ir más rápido. " +
        "Tu perfil, tus keys y tu cuenta no se tocan. " +
        `Antes te bajamos la copia completa${copy.locked ? ", con la contraseña que elijas" : ""}, que se recupera con «Introducir perfil», en Ajustes. ¿Seguimos?`,
      { title: "Liberar espacio", confirmLabel: "Bajar la copia y liberar" },
    );
    if (!ok) return;
    setBusy(true);
    try {
      // Nothing is deleted without its copy: the way back is the condition.
      if (!(await copy.takeCopy())) {
        toast({ tone: "bad", message: copy.locked ? "No bajamos la copia, así que no borramos nada." : "No pudimos bajar la copia, así que no borramos nada." });
        return;
      }
      await freeSpace();
      toast({ tone: "good", message: "Liberamos espacio. Tu perfil y tus keys siguen acá." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <Button variant="secondary" disabled={busy} onClick={() => void run()}>
        {busy ? "Liberando…" : "Liberar espacio"}
      </Button>
      <Checkbox
        checked={copy.locked}
        onChange={(event) => copy.setLocked(event.target.checked)}
        label="Copia con contraseña, que elegís vos"
      />
    </span>
  );
}
