import type { ReactNode } from "react";
import { NO_INDEX } from "@/lib/site";

// `/prep/[id]/print` es la preparación de entrevista de una persona y
// `/prep/render` un handoff que renderiza en blanco sin payload.
//
// Layout de paso: no agrega DOM. Existe para exportar `metadata` por el
// segmento entero — `/render` es un componente de cliente y no puede — sin
// tocar las páginas; el `title` propio de cada una se conserva. Ver `NO_INDEX`.
export const metadata = NO_INDEX;

export default function PrepLayout({ children }: { children: ReactNode }) {
  return children;
}
