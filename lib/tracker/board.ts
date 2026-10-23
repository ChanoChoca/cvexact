/**
 * Posición fraccional dentro de una columna del kanban.
 *
 * Insertar una tarjeta entre otras dos es escribir un número entre los dos
 * que ya tienen, nunca reindexar la columna entera — eso es lo que hace que
 * arrastrar una tarjeta sea una sola escritura optimista en vez de un
 * `UPDATE` por cada tarjeta que quedó debajo.
 */

/** Cuánto se separan dos tarjetas nuevas — arbitrario, sólo tiene que ser
 *  mayor que `MIN_GAP` varias veces para que el rebalanceo no sea constante. */
const DEFAULT_GAP = 1024;

/** Por debajo de esto, seguir insertando en el mismo hueco pierde precisión
 *  de punto flotante antes de que el usuario note nada raro — es la señal de
 *  rebalancear la columna entera en vez de calcular un punto medio más. */
const MIN_GAP = 1e-9;

/**
 * Un número entre `before` y `after`, para insertar ahí. `before` es la
 * posición de la tarjeta previa en la columna (o `null` si va primera);
 * `after`, la de la siguiente (o `null` si va última).
 *
 * Devuelve `null` cuando el hueco ya es demasiado angosto — la señal para que
 * el llamador rebalancee (`rebalance`) en vez de seguir subdividiendo un
 * intervalo que ya no tiene margen.
 */
export function positionBetween(before: number | null, after: number | null): number | null {
  if (before === null && after === null) return 0;
  if (before === null) return (after as number) - DEFAULT_GAP;
  if (after === null) return before + DEFAULT_GAP;

  const gap = after - before;
  if (gap <= MIN_GAP) return null;
  return before + gap / 2;
}

/**
 * Nuevas posiciones, en el mismo orden que `ids`, espaciadas por
 * `DEFAULT_GAP`. El llamador es responsable de escribir cada una — esto sólo
 * calcula los números.
 */
export function rebalance(ids: readonly string[]): Map<string, number> {
  const positions = new Map<string, number>();
  ids.forEach((id, index) => positions.set(id, index * DEFAULT_GAP));
  return positions;
}
