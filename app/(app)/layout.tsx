import type { ReactNode } from "react";
import { AppFooter } from "@/components/legal/parts";
import { NO_INDEX } from "@/lib/site";
import { AppShell } from "./AppShell";

// Ninguna de estas páginas se indexa: sin sesión un bot recibe un shell vacío
// (el control de acceso es del cliente y de la API, no hay redirect del lado del
// servidor), y `/cuenta/reset` es un formulario de contraseña que vive de un
// token en la query. Un solo export cubre todas, la de ingreso incluida; ver `NO_INDEX`.
export const metadata = NO_INDEX;

// Route-group layouts have no params, and the group is not part of the route
// literal, so LayoutProps has nothing to key off here.
//
// `AppLayout` is a Server Component and `AppShell` is not: `AppFooter` is
// resolved here, on the server, and handed to `AppShell` as a prop rather than
// imported inside it — see `AppFooter`'s own comment for why crossing that
// boundary the other way would mismatch on hydration.
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell footer={<AppFooter />}>{children}</AppShell>;
}
