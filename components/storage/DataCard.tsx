"use client";

import { useRef, useState } from "react";
import { Alert, Button, Card, Checkbox, SectionTitle } from "@/components/ui";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { clearBrowserData } from "@/lib/storage/local";
import { useCopyActions } from "./useCopyActions";
import { useRecoverCopy } from "./useRecoverCopy";
import { useWipeWithCopy } from "./useWipeWithCopy";

/**
 * «Mis datos»: the three things a person does with what this browser holds, and nothing else —download it as a file, bring a file back, erase it. It took the place of
 * «Tu perfil a salvo», «Espacio en este navegador» and «Tu actividad en este navegador»: what those said about where the profile lives and how much room is left is
 * said, where it matters, by the warnings of the app (`SpaceWarning`, `UnsavedNotice`), and asking the browser to keep the data is done by itself after a CV came out
 * (`keepDataQuietly`).
 *
 * «Descargar perfil» is the complete copy (the profile and the postings, never the keys) and «Introducir perfil» reads either size of copy, open or with a password.
 * The password is one choice for both the file that is downloaded and the one that is taken before erasing.
 */
export function DataCard() {
  const confirm = useConfirm();
  const copies = useCopyActions();
  const recover = useRecoverCopy();
  const fileInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ tone: "good" | "bad" | "info"; text: string } | null>(null);
  /** The copy taken before wiping —open, or with a password: on a shared computer, an open one in Downloads would undo the wipe— and the way it is taken. */
  const wipeCopy = useWipeWithCopy();

  const download = () => void (wipeCopy.locked ? copies.saveLocked("complete") : copies.saveComplete());

  /**
   * "Borrar los datos de este navegador": for a shared computer, or for leaving none behind. It was only reachable by
   * signing out of an account, which someone with no account cannot do. The copy comes first and is the way back: what
   * is taken from this browser is not kept anywhere else unless the person has put it somewhere. The same copy, in the same
   * words, as «Cerrar y borrar datos» of the session (`useWipeWithCopy`).
   */
  const wipe = async () => {
    const ok = await confirm(
      "Vamos a borrar de este navegador tu perfil, tus ajustes —tu key incluida—, tus borradores y tus postulaciones guardadas. " +
        `Antes te bajamos la copia completa${wipeCopy.locked ? ", con la contraseña que elijas" : ""}: lleva tu perfil y tus postulaciones, no tus keys, y se recupera con «Introducir perfil». ` +
        "Tu cuenta, si tenés una, y lo que subiste a ella no se tocan. ¿Seguimos?",
      { title: "Borrar los datos de este navegador", confirmLabel: "Bajar la copia y borrar" },
    );
    if (!ok) return;
    // Nothing is deleted without its copy: the way back is the condition.
    if (!(await wipeCopy.takeCopy())) {
      setMessage({ tone: "info", text: wipeCopy.locked ? "No bajamos la copia, así que no borramos nada." : "No pudimos bajar la copia, así que no borramos nada." });
      return;
    }
    await clearBrowserData();
    // A reload, as the sign-out does after its own wipe: nothing held in memory by this page should outlive what was just erased.
    window.location.reload();
  };

  return (
    <Card>
      <SectionTitle>Mis datos</SectionTitle>
      <div className="space-y-4 text-sm text-ink-2">
        <Checkbox
          checked={wipeCopy.locked}
          onChange={(event) => wipeCopy.setLocked(event.target.checked)}
          label="Con contraseña, que elegís vos: sin ella nadie puede abrir la copia, ni nosotros. Conviene si usás una computadora compartida."
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={download}>
            Descargar perfil
          </Button>
          <Button variant="secondary" onClick={() => fileInput.current?.click()}>
            Introducir perfil
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            aria-label="Elegir una copia"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              // Read as whatever it is — a profile, a complete copy —, open or with a password, and what it would replace said first.
              const result = await recover(file);
              if (result.status === "cancelled") return;
              setMessage({ tone: result.status === "recovered" ? "good" : "bad", text: result.message });
            }}
          />
          <Button variant="danger" onClick={() => void wipe()}>
            Borrar los datos de este navegador
          </Button>
        </div>
        {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      </div>
    </Card>
  );
}
