import { fnv1a } from "@/lib/tracker/cv-version";
import type { CVDocument } from "@/lib/schemas/cv";

/**
 * Hash del `cv` completo, sensible a cualquier cambio de contenido — lo
 * opuesto de `cvVersionFingerprint` (lib/tracker/cv-version.ts), que
 * deliberadamente ignora el contenido para agrupar adaptaciones del mismo CV
 * base. Este hash es para `ReviewGate` (components/cv/ReviewGate.tsx): sirve
 * para saber si el CV que se ve en pantalla es, bit a bit, el mismo que el
 * usuario ya confirmó. No necesita resistir colisiones adversarias, sólo
 * detectar una edición o una regeneración — para eso alcanza con FNV-1a sobre
 * un `JSON.stringify` determinístico del documento.
 */
export function cvContentHash(cv: CVDocument): string {
  return fnv1a(JSON.stringify(cv));
}
