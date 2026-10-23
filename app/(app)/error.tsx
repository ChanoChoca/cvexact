"use client";

import { useEffect } from "react";
import { Button, ButtonLink, PageHeading } from "@/components/ui";

/**
 * Catches a throw anywhere under `/postular`, `/perfil`, `/postulaciones` or
 * `/ajustes` — a malformed stored application, a `ResizeObserver` failure in
 * the CV preview, anything that reaches render. It wraps the four pages but
 * not `AppShell` itself (Next scopes `error.js` to the segment's children),
 * so the nav stays up and the person can leave instead of being stuck on a
 * blank tab.
 *
 * The one thing this screen must say plainly: nothing was lost. Everything
 * lives in this browser's storage, and a render crash does not touch it.
 */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="py-12">
      <PageHeading eyebrow="Algo salió mal" title="Esta pantalla no cargó">
        Tus datos siguen en este navegador — nada se perdió. Podés intentar de
        nuevo o ir a tus postulaciones.
      </PageHeading>
      <div className="mt-7 flex flex-wrap items-center gap-5.5">
        <Button className="px-7 py-3.5" onClick={() => retry()}>
          Reintentar
        </Button>
        <ButtonLink href="/postulaciones" variant="secondary" className="px-6 py-3">
          Ir a mis postulaciones
        </ButtonLink>
      </div>
    </div>
  );
}
