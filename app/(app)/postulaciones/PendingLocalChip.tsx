"use client";

import { Badge } from "@/components/ui";

/**
 * El contador persistente de postulaciones generadas en este navegador que
 * siguen sin estar en el seguimiento. Visible mientras quede alguna —aun
 * después de "Ahora no"— para que el descarte esconda la oferta, no la
 * información de que hay una decisión pendiente. El click reabre el banner:
 * mostrarlo es ofrecer, no ejecutar — importar sigue necesitando su click
 * propio, nunca automático (misma regla que `app/api/sync`: el usuario
 * decide cuándo una copia local pasa al servidor).
 */
export function PendingLocalChip({ count, onShow }: { count: number; onShow: () => void }) {
  if (count === 0) return null;
  return (
    <button
      type="button"
      onClick={onShow}
      title="Ver las postulaciones generadas en este navegador que podés importar al seguimiento"
    >
      <Badge tone="info" className="cursor-pointer transition-colors hover:bg-sky-400/20">
        {count} locales pendientes
      </Badge>
    </button>
  );
}
