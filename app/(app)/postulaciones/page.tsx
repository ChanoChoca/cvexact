import { Tracker } from "./Tracker";

export const metadata = { title: "Postulaciones" };

export default async function ApplicationsPage({ searchParams }: PageProps<"/postulaciones">) {
  const { view } = await searchParams;
  const initialView = view === "tabla" ? "tabla" : view === "metricas" ? "metricas" : "kanban";
  return <Tracker initialView={initialView} />;
}
