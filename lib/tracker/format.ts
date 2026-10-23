/** Formato de fecha del resto de la app — sin dependencia nueva. */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
}

/** "hace 3 días" / "hoy" / "ayer" — lo que la card del kanban y la fila de la
 *  tabla muestran para `lastActivityAt`, la señal que alimenta el ghosting. */
export function daysSince(iso: string, now: Date = new Date()): number {
  const ms = now.getTime() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

export function formatDaysSince(iso: string, now: Date = new Date()): string {
  const days = daysSince(iso, now);
  if (days === 0) return "hoy";
  if (days === 1) return "ayer";
  return `hace ${days} días`;
}

/**
 * «hace 5 min» / «hace 3 h» / «hace 2 días» — la antigüedad de una nota de
 * proveedor, que se mide en minutos y horas antes que en días.
 *
 * `formatDaysSince` no sirve para esto: redondea a días y una nota de hace 25
 * horas le queda «ayer», que es correcto y no dice nada útil sobre si el
 * proveedor ya se volvió a intentar.
 */
export function formatElapsed(iso: string, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "hace instantes";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return formatDaysSince(iso, now);
}

export function formatSalary(min: number | null, max: number | null, currency: string | null): string {
  if (!min && !max) return "";
  const c = currency ?? "";
  const fmt = (n: number) => n.toLocaleString("es-AR");
  if (min && max && min !== max) return `${c} ${fmt(min)} – ${fmt(max)}`.trim();
  return `${c} ${fmt(min ?? max ?? 0)}`.trim();
}
