import type { ReactNode } from "react";
import { isPlaceholder } from "@/lib/legal/operator";

/**
 * Un dato que el titular todavía no cargó.
 *
 * Se marca visualmente en vez de renderizarse como texto común: si el sitio sale
 * a producción con el CUIT sin poner, tiene que cantar en la página y no pasar
 * por un guion más. Antes sólo se fijaba en si el texto empieza con `[`, que es
 * la forma de `PENDING` — pero el Secret de producción despliega `"XXXXX"` en
 * cada campo por llenar, y esa cadena no empieza con `[`, así que pasaba como
 * texto común. `isPlaceholder`, de `lib/legal/operator.ts`, es la misma regla
 * que ya usa `operatorConfigured()` para decidir si falta cargar un dato;
 * acá se reutiliza en vez de duplicarla con otro criterio.
 *
 * Vive en su propio archivo, separado de `./parts.tsx`, porque ese módulo
 * importa `Footer`/`Nav` DESDE `@/components/landing/parts` — y ese es
 * exactamente el otro lugar que necesita este componente (`OperatorIdentity`,
 * el pie legal del landing). Definirlo en `parts.tsx` e importarlo desde ahí
 * habría cerrado un ciclo entre los dos módulos; este archivo no importa nada
 * de ninguno de los dos, así que ambos pueden importarlo sin uno.
 *
 * Un solo color de marcador ahora — ya no dos: `tone` distinguía el pie claro
 * de `/legales` del pie oscuro "Solar" de la landing, y con todo el producto
 * en un único tema esa distinción no correspondía a nada real. Los call sites
 * que todavía pasan `tone` siguen andando sin cambios: el prop se ignora en
 * vez de romper, porque no vale la pena tocar cada uno solo para borrar un
 * argumento que ya no hace nada.
 */
export function Pending({ children }: { children: ReactNode; tone?: "light" | "dark" }) {
  const value = String(children);
  if (!isPlaceholder(value)) return <>{value}</>;
  return <mark className="bg-oro-soft/40 px-1 font-mono text-[13px] text-ink">{value}</mark>;
}
