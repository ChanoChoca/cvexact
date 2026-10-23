import { JobsList } from "./JobsList";

export const metadata = { title: "Empleos" };

/**
 * Dinámica: esta ruta comparte layout con `AppFooter`
 * (`components/legal/parts.tsx`), que lee la identidad legal de
 * `lib/legal/operator.ts` desde el entorno. Sin este export, Next prerenderiza
 * la página en el build —antes de que exista el Secret de producción— y el
 * pie queda grabado con «[pendiente de carga]». Ver `app/page.tsx` para el
 * detalle completo.
 */
export const dynamic = "force-dynamic";

export default function JobsPage() {
  return <JobsList />;
}
