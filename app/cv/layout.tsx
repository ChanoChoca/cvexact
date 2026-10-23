import type { ReactNode } from "react";
import { NO_INDEX } from "@/lib/site";

// `/cv/[id]/print` es el CV de una persona y `/cv/render` un handoff que
// renderiza en blanco sin payload. `/cv/demo/print`, enlazada desde el
// landing, también queda afuera: un CV suelto es contenido delgado que
// compite con `/`.
//
// Layout de paso: no agrega DOM. Existe para exportar `metadata` por el
// segmento entero — `/render` es un componente de cliente y no puede — sin
// tocar las páginas; el `title` propio de cada una se conserva. Ver `NO_INDEX`.
export const metadata = NO_INDEX;

export default function CvLayout({ children }: { children: ReactNode }) {
  return children;
}
