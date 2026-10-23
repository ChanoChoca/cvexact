/** Sin `"server-only"` a propósito: tanto el cron (`lib/tracker/ghosting.ts`)
 *  como la UI (`DetailPanel.tsx`, para el copy del aviso) necesitan este
 *  número, y es un dato puro — no hay nada de IO que proteger acá. */
export const GHOSTING_DAYS = 21;

/** Cuántos días después de marcar "postulado" ofrece la UI el recordatorio
 *  de seguimiento — lo ofrece, nunca lo crea sola. Usado tanto en
 *  `DetailPanel.tsx` (el selector explícito) como en `KanbanBoard.tsx`
 *  (arrastrar una tarjeta a Postulado, la forma más común de llegar ahí). */
export const FOLLOW_UP_DAYS = 7;
