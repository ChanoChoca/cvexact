"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Alert, Button } from "@/components/ui";
import { useApplications, useApplicationsReady } from "@/lib/storage/hooks";
import { STORAGE_FULL_EVENT } from "@/lib/storage/errors";
import { databaseEstimate, localStorageUsage, spaceWarning } from "@/lib/storage/usage";
import { FreeSpaceButton } from "./FreeSpaceButton";
import { useCopyActions } from "./useCopyActions";

const DISMISS_KEY = "cvexact.spaceWarningDismissed.v1";

/**
 * «Te estás quedando sin espacio», said while there is still room to act on it.
 *
 * The incident this was built for gave no warning at all: the first sign was a
 * CV that could not be saved. After the move to IndexedDB that needs a very
 * full disk, but the small store that still holds the profile and the keys can
 * fill up too, and a browser without IndexedDB is on the old limits for good.
 *
 * Dismissed for the session, not forever: the condition does not go away by
 * itself, and the next visit is the next chance to act on it.
 *
 * Also said when it already happened: a write the browser refused (`STORAGE_FULL_EVENT`) —a change to the profile, a key— brings it back whatever was dismissed,
 * because now it is something that did not get saved, not a warning. In both, «Liberar espacio» is the way out that keeps the profile and the keys.
 */
export function SpaceWarning() {
  const ready = useApplicationsReady();
  const count = useApplications().length;
  const copies = useCopyActions();
  const [kind, setKind] = useState<"local" | "database" | null>(null);
  /** A write was refused since the last «Ahora no». */
  const [full, setFull] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return typeof window !== "undefined" && window.sessionStorage.getItem(DISMISS_KEY) === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void (async () => {
      const next = spaceWarning(localStorageUsage(), await databaseEstimate());
      if (!cancelled) setKind(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, count]);

  useEffect(() => {
    const onFull = () => setFull(true);
    window.addEventListener(STORAGE_FULL_EVENT, onFull);
    return () => window.removeEventListener(STORAGE_FULL_EVENT, onFull);
  }, []);

  if (!full && (!kind || dismissed)) return null;

  const dismiss = () => {
    try {
      window.sessionStorage.setItem(DISMISS_KEY, "true");
    } catch {
      // Dismissed for this page, then.
    }
    setDismissed(true);
    setFull(false);
  };

  return (
    <div className="mb-6">
      <Alert tone="warn" title={full ? "Este navegador no tiene más espacio para CV Exact" : "Este navegador se está quedando sin espacio para CV Exact"}>
        {full
          ? "No pudimos guardar un cambio porque no queda lugar. Seguí con lo que tenés abierto acá: no se perdió nada, pero no queda guardado hasta que haya espacio. "
          : kind === "local"
            ? "Queda poco lugar para guardar tu perfil, tus ajustes y tus postulaciones. "
            : "Tu celular o tu computadora tiene poco espacio libre para lo que guarda el navegador. "}
        «Liberar espacio» borra tus postulaciones guardadas, tus borradores y lo que se guardó para ir más rápido, y deja tu perfil y tus keys; antes te bajamos la copia completa. Si preferís elegir,
        podés archivar postulaciones viejas en un archivo: no se borra nada sin que lo confirmes.
        <span className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <FreeSpaceButton />
          <Button variant="secondary" onClick={() => void copies.saveComplete()}>
            Bajar la copia completa
          </Button>
          <Link href="/postulaciones?orden=tamano" className="text-sm underline underline-offset-4 hover:text-ink">
            Ver qué ocupa espacio
          </Link>
          <Button variant="ghost" onClick={dismiss}>
            Ahora no
          </Button>
        </span>
        <span className="mt-2 block text-xs opacity-80">Con «Ahora no» no te lo repetimos mientras esta pestaña siga abierta.</span>
      </Alert>
    </div>
  );
}
