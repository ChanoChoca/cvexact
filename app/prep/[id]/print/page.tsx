import { PrintToolbar } from "@/components/cv/PrintToolbar";
import { StoredPrep } from "./StoredPrep";

export const metadata = { title: "Preparación de entrevista" };

export default async function PrepPrintPage({ params }: PageProps<"/prep/[id]/print">) {
  const { id } = await params;

  return (
    <>
      <PrintToolbar
        title="Preparación de entrevista"
        backHref={`/postular?app=${id}`}
      />
      <StoredPrep id={id} />
    </>
  );
}
