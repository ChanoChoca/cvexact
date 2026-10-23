"use client";

import { Alert, Button, PageHeading } from "@/components/ui";
import { useIsPhone } from "@/components/ui/useIsPhone";
import { AccountOffer } from "@/components/account/AccountOffer";
import { DOCUMENT_ACCEPT } from "@/lib/onboarding/content";
import { LinkedInGuide } from "./LinkedInGuide";
import { SourceInput } from "./SourceInput";
import { TrustLine } from "./TrustLine";
import { useImport, type ImportSuccess } from "./useImport";
import { useRecoverHere } from "./useRecoverHere";

/**
 * S0: bringing what they have. One place to drop it — a CV, a LinkedIn profile, both at once — and one way to go on for whoever has
 * nothing to bring. Nobody is asked first which of those they are: what a document is can be read from the document, and asking put
 * the person's first decision before their first result. What was read goes where its reading says (`afterImportStep`).
 *
 * Under them, three things said once (`TrustLine`) and nothing else: the way back for a profile that was lost is the same drop zone, which takes
 * the copy a person made (`onCopy`), and the guide to getting a LinkedIn profile out of LinkedIn is for whoever a link sent to it
 * (`?ruta=linkedin`: the phone handing the task to a computer). Whoever signed in on a browser with nothing in it is offered what their account holds.
 */
export function IntakeStep({
  mailAvailable,
  turnstileSiteKey,
  guideOpen,
  onImported,
  onScratch,
  onManual,
}: {
  /** Whether "Enviarme un enlace" can work at all — the server's `magicLink` plugin only loads with mail configured. */
  mailAvailable: boolean;
  turnstileSiteKey: string;
  /** A link asked for the LinkedIn guide (`?ruta=linkedin`: the phone handing the task to a computer). */
  guideOpen: boolean;
  onImported: (success: ImportSuccess) => void;
  onScratch: () => void;
  onManual: (file?: File) => void;
}) {
  const importer = useImport();
  const phone = useIsPhone();
  const here = useRecoverHere();

  return (
    <div className="space-y-8">
      <PageHeading eyebrow="Tu perfil" title="Vamos a construir tu perfil profesional">
        Lo vas a usar para crear CVs adaptados a cada oferta. Empezá con lo que ya tenés: tu CV, tu perfil de LinkedIn, o los dos.
      </PageHeading>

      {/* Someone who signed in on a browser with nothing in it is offered what their account already holds, before being asked for it again. */}
      <AccountOffer />

      <SourceInput
        importer={importer}
        accept={`${DOCUMENT_ACCEPT},application/json,.json`}
        multiple
        dropTitle={phone ? "Elegí tu CV o tu perfil de LinkedIn" : "Arrastrá tu CV o tu perfil de LinkedIn acá, o elegí los archivos"}
        dropHint="PDF, Word (.docx) o texto (.txt), o el ZIP de datos de LinkedIn. Podés agregar los dos a la vez; y si tenés una copia de tu perfil de cvexact (.json), también la recuperás acá."
        pasteName="Texto pegado"
        pastePlaceholder="Pegá acá el texto de tu CV o de tu perfil de LinkedIn…"
        draftKey="paste:start"
        onImported={onImported}
        onManual={onManual}
        onCopy={(file) => void here.recoverFile(file)}
      >
        {/* Said where the file was chosen: a copy that is not one cvexact made. */}
        {here.error ? <Alert tone="bad">{here.error}</Alert> : null}
      </SourceInput>

      {guideOpen ? <LinkedInGuide open handoff={{ mailAvailable, turnstileSiteKey }} /> : null}

      <div>
        <Button variant="secondary" onClick={onScratch}>
          Crear perfil vacío
        </Button>
      </div>

      <TrustLine />
    </div>
  );
}
