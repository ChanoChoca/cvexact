import { PrintToolbar } from "@/components/cv/PrintToolbar";
import { StoredVideoScript } from "./StoredVideoScript";

export const metadata = { title: "Guion del video" };

export default async function VideoPrintPage({ params }: PageProps<"/video/[id]/print">) {
  const { id } = await params;

  return (
    <>
      <PrintToolbar title="Guion del video" backHref={`/postular?app=${id}`} />
      <StoredVideoScript id={id} />
    </>
  );
}
