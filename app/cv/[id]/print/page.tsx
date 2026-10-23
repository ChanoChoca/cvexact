import { CVDocument } from "@/components/cv/CVDocument";
import { DownloadDocxButton } from "@/components/cv/DownloadDocxButton";
import { PrintToolbar } from "@/components/cv/PrintToolbar";
import { templateCV } from "@/lib/fixtures/template-cv";
import { StoredCV } from "./StoredCV";
import { StoredCVDocxButton } from "./StoredCVDocxButton";

export const metadata = { title: "CV" };

/**
 * Isolated print route: nothing but the document and a screen-only toolbar, so
 * the browser's own print-to-PDF produces the deliverable.
 *
 * The `demo` id renders the template fixture. It is the fidelity check — open
 * /cv/demo/print and public/plantilla-cv.html side by side; they must match.
 */
export default async function CVPrintPage({ params }: PageProps<"/cv/[id]/print">) {
  const { id } = await params;

  return (
    <>
      <PrintToolbar
        title={id === "demo" ? "Plantilla de referencia" : "Tu CV"}
        backHref={id === "demo" ? undefined : `/postular?app=${id}`}
        actions={
          id === "demo" ? (
            <DownloadDocxButton data={templateCV} label="plantilla">
              Descargar Word
            </DownloadDocxButton>
          ) : (
            <StoredCVDocxButton id={id} />
          )
        }
      />
      {id === "demo" ? (
        <div className="cv-page-frame">
          <CVDocument data={templateCV} />
        </div>
      ) : (
        <StoredCV id={id} />
      )}
    </>
  );
}
