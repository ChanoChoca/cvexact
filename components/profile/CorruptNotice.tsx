"use client";

import { Alert, Button } from "@/components/ui";
import { todayStamp } from "@/lib/storage/download";
import { discardCorruptProfile } from "@/lib/storage/local";
import { useCorruptProfileCopy } from "@/lib/storage/hooks";

/**
 * Shown when this browser found a saved profile it could not read.
 *
 * The copy was set aside untouched the moment it was found (see
 * `quarantineProfile` in `lib/storage/local.ts`), so nothing is lost; what this
 * does is say so, and hand it over. Without it the person would open the app to
 * an empty profile and no explanation, which from where they sit is the same as
 * losing it.
 */
export function CorruptNotice() {
  const copy = useCorruptProfileCopy();
  if (copy === null) return null;

  const download = () => {
    const blob = new Blob([copy], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `cvexact-perfil-sin-leer-${todayStamp()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Alert tone="warn" title="No pudimos leer tu perfil guardado">
      <p>
        Guardamos una copia sin tocar, por si sirve. Descargala antes de seguir: es lo único
        que queda de lo que había.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={download}>
          Descargar la copia
        </Button>
        <Button type="button" variant="ghost" onClick={discardCorruptProfile}>
          Ya la descargué, ocultar
        </Button>
      </div>
    </Alert>
  );
}
