import { ProfileHub } from "@/components/profile/ProfileHub";
import { TOUR_PARAM } from "@/components/wizard/postular-tour";

/**
 * Dinámica: mismo motivo que `/empleos` — comparte layout con `AppFooter`,
 * que lee `lib/legal/operator.ts` del entorno. Ver `app/page.tsx` para el
 * detalle completo.
 */
export const dynamic = "force-dynamic";

type Param = string | string[];

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ tarea?: Param; revisar?: Param; [TOUR_PARAM]?: Param }> }) {
  // `?tarea=<id>`: la línea de un puesto que se abre y se muestra, desde «Pendientes»
  // (una cifra que faltaba y no hay pregunta que hacer, solo un número por sumar).
  // `?revisar=1`: se llega de leer un documento que dejó algo marcado; las secciones lo dicen con «Para revisar».
  // `?guia=1`: además, es la primera lectura, y el perfil ofrece el recorrido de Postular en una tarjeta.
  const { tarea, revisar, [TOUR_PARAM]: guia } = await searchParams;
  return <ProfileHub focusFactId={typeof tarea === "string" && tarea ? tarea : undefined} justRead={revisar === "1"} guide={guia === "1"} />;
}
