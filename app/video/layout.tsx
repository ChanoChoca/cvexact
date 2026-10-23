import type { ReactNode } from "react";
import { NO_INDEX } from "@/lib/site";

// `/video/[id]/print` es el guion de video de una persona y `/video/render` un
// handoff que renderiza en blanco sin payload.
//
// Layout de paso: no agrega DOM. Existe para exportar `metadata` por el
// segmento entero — `/render` es un componente de cliente y no puede — sin
// tocar las páginas; el `title` propio de cada una se conserva. Ver `NO_INDEX`.
export const metadata = NO_INDEX;

export default function VideoLayout({ children }: { children: ReactNode }) {
  return children;
}
