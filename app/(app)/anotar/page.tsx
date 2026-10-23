import { Suspense } from "react";
import { SharedNote } from "@/components/notes/SharedNote";

export const metadata = { title: "Anotá algo" };

/**
 * Dinámica: mismo motivo que `/perfil` y `/empleos` — comparte layout con `AppFooter`, que lee `lib/legal/operator.ts` del entorno, y una página prerenderizada
 * en el build queda con la identidad legal de ese momento (`scripts/verify-build-legal.mjs` lo para). Ver `app/page.tsx` para el detalle completo.
 */
export const dynamic = "force-dynamic";

export default function NotePage() {
  // `SharedNote` reads the address (`?compartido=`), which asks for a boundary while the page is built.
  return (
    <Suspense fallback={<p className="text-sm text-ink-3">Cargando…</p>}>
      <SharedNote />
    </Suspense>
  );
}
