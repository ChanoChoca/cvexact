import { QuestionsPage } from "@/components/onboarding/QuestionsPage";

export const metadata = { title: "Mejorar tu perfil" };

/** Dinámica por lo mismo que el resto de `/perfil`: comparte layout con `AppFooter`, que lee el entorno. */
export const dynamic = "force-dynamic";

const one = (value: string | string[] | undefined) => (typeof value === "string" && value ? value : undefined);

export default async function Page({ searchParams }: { searchParams: Promise<{ puesto?: string | string[]; pregunta?: string | string[]; regreso?: string | string[] }> }) {
  // `?puesto=<id>`: solo preguntas sobre ese puesto, desde su tarjeta en el perfil.
  // `?pregunta=<id>`: esa pregunta primero, desde «Pendientes».
  // `?regreso=1`: la revisión de qué cambió desde la última vez: hasta tres preguntas, del tiempo y de nada más.
  const { puesto, pregunta, regreso } = await searchParams;
  return <QuestionsPage only={one(puesto)} startWith={one(pregunta)} returning={one(regreso) === "1"} />;
}
