"use client";

import { useState } from "react";
import { Alert, CollapsibleCard } from "@/components/ui";
import { DOCUMENT_ACCEPT, DOCUMENT_HINT } from "@/lib/onboarding/content";
import type { StoredProfile } from "@/lib/schemas/profile-v2";
import { LinkedInGuide } from "./LinkedInGuide";
import { SourceInput } from "./SourceInput";
import { useImport, type ImportSuccess } from "./useImport";

/**
 * "¿Agregamos tu LinkedIn?": the other half of a person's history, offered where it is most
 * useful — at the top of the review, before there is anything to check twice. What comes in is merged
 * with what is there: the same job read from both is one job, and where the two disagree the review
 * says so and asks. The profile has no card of this: its «Agregar un CV o un perfil de LinkedIn» button opens the same `SourceAdder`.
 *
 * Says what is missing: with a CV read it asks for LinkedIn, with LinkedIn it asks for the CV,
 * with neither (a profile built by hand) it asks for either. Once both are there there is nothing
 * to ask — but not until the person has seen that what they just added went in.
 */
/**
 * What a place that adds a document keeps: the reader and what it last brought in. Held by whoever shows the adder,
 * not by the adder itself, because the review's card renders nothing once both documents are there — and the
 * moment the second one goes in is the moment it must go on saying that it did.
 */
export function useSourceAdder() {
  const importer = useImport();
  const [added, setAdded] = useState<ImportSuccess | null>(null);
  return { importer, added, setAdded };
}
type Adder = ReturnType<typeof useSourceAdder>;

export function AddSource({ profile }: { profile: StoredProfile }) {
  const adder = useSourceAdder();
  const hasCv = profile.sources.some((source) => source.kind === "cv");
  const hasLinkedin = profile.sources.some((source) => source.kind === "linkedin_pdf" || source.kind === "linkedin_csv");
  const both = hasCv && hasLinkedin;
  if (both && !adder.added) return null;

  const title = both ? "¿Tenés una versión más nueva?" : hasCv ? "¿Agregamos tu LinkedIn?" : hasLinkedin ? "¿Agregamos tu CV?" : "¿Tenés un CV o tu LinkedIn? Agregalo";
  const text = both
    ? "Agregá tu CV o tu LinkedIn actualizado: lo juntamos con lo que ya tenés, sin repetir lo que dicen igual, y te mostramos solo lo que cambió."
    : hasCv
      ? "Si tenés también tu perfil de LinkedIn, agregalo antes de revisar: lo juntamos con lo que ya leímos, sin repetir lo que dicen igual, y te marcamos lo que no coincide."
      : hasLinkedin
        ? "Si tenés también un CV, agregalo antes de revisar: lo juntamos con lo que ya leímos, sin repetir lo que dicen igual, y te marcamos lo que no coincide."
        : "Si tenés un CV o tu perfil de LinkedIn, agregalo: lo leemos y lo juntamos con lo que cargaste, sin repetir lo que dicen igual.";

  return (
    <CollapsibleCard title={title} defaultOpen={false}>
      <div className="space-y-4">
        <p className="text-sm text-ink-2">{text}</p>
        <SourceAdder adder={adder} profile={profile} />
      </div>
    </CollapsibleCard>
  );
}

/**
 * The part of "sumar un documento" that does it: the drop zone, the paste box and every way out of a file that cannot
 * be read, and what to tell once it went in. Apart from the card so that the profile's menu — which used to have a
 * reader of its own, for one file, whose error had no way out — opens exactly this, with the same exits.
 */
export function SourceAdder({
  adder,
  profile,
  onAdded,
  draftKey = "paste:add",
}: {
  adder: Adder;
  profile: StoredProfile;
  onAdded?: ((added: readonly ImportSuccess[]) => void) | undefined;
  /** Where the text pasted and not yet read is kept: the card and the profile's menu are not the same box. */
  draftKey?: string;
}) {
  const { importer, added, setAdded } = adder;
  const hasLinkedin = profile.sources.some((source) => source.kind === "linkedin_pdf" || source.kind === "linkedin_csv");

  return (
    <div className="space-y-4">
      <SourceInput
        importer={importer}
        accept={DOCUMENT_ACCEPT}
        multiple
        dropTitle="Arrastrá el archivo acá, o elegilo"
        dropHint={DOCUMENT_HINT}
        pasteName="Texto pegado"
        pastePlaceholder="Pegá acá el texto de tu CV o de tu perfil de LinkedIn…"
        draftKey={draftKey}
        onImported={(last, all) => {
          setAdded(last);
          // Only what changed something is worth a review: a file already read, or one that said nothing new, is said here.
          const changed = all.filter((success) => success.outcome.kind === "added");
          if (onAdded && changed.length > 0) onAdded(changed);
        }}
      />
      {added ? (
        <Alert tone="good">
          {added.outcome.kind === "unchanged"
            ? "No encontramos nada nuevo en ese archivo: ya estaba todo en tu perfil."
            : onAdded
              ? "Listo. Te llevamos a ver qué cambió."
              : "Listo. Arriba ves qué leímos y, más abajo, lo que cambió y en qué no coincide con lo que ya tenías."}
        </Alert>
      ) : null}
      {hasLinkedin ? null : <LinkedInGuide title="¿Cómo consigo mi perfil de LinkedIn?" />}
    </div>
  );
}
