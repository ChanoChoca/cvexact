"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/toast";
import { SourceAdder, useSourceAdder } from "@/components/onboarding/AddSource";
import { RemovedNotice, useRemovedNotice, useRemoval } from "@/components/profile/hub/removal";
import { ReminderForm } from "@/components/profile/ReminderForm";
import { useCopyActions } from "@/components/storage/useCopyActions";
import { useRecoverCopy } from "@/components/storage/useRecoverCopy";
import { resetQuestions } from "@/lib/onboarding/answer";
import { readReceipts } from "@/lib/onboarding/review";
import { isRemovableSource, removeSource } from "@/lib/onboarding/remove-source";
import { startOver } from "@/lib/onboarding/restart";
import { useStoredProfile } from "@/lib/storage/hooks";
import { updateStoredProfile } from "@/lib/storage/local";
import { exportOwnProfile } from "@/lib/storage/profile-copy";
import { useExperiment } from "@/lib/use-experiment";

/**
 * Everything the ficha needs that is not a field.
 *
 * Export/import here is the profile alone — not the postulaciones, not what
 * the assistant left behind — because someone who exports from their profile
 * page is asking for their profile. It is how an anonymous user moves it
 * between devices or recovers from clearing site data, so losing it would be
 * data loss rather than a simplification. The fuller copy, with applications
 * and the assistant's history along for the ride, lives in Ajustes. Reading a
 * CV sits beside it because after the first visit the offer under the heading
 * is gone and this is where someone comes looking for it.
 *
 * The app's own links are not here: the ficha is an ordinary page inside
 * `AppShell` again, so the nav is back above it.
 *
 * Plain buttons in a row, not a «⋯» menu: nobody looks for «Bajar una copia» or «Empezar de nuevo» behind three dots. A row wraps on a phone,
 * and the one thing here that cannot be taken back is last and apart.
 */

export function ProfileActions() {
  const confirm = useConfirm();
  const copies = useCopyActions();
  const recover = useRecoverCopy();
  const toast = useToast();
  const [message, setMessage] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const router = useRouter();
  // Adding a document opens the same adder the profile's own card holds — several files, and every way out of one that cannot be read.
  const adder = useSourceAdder();
  const profile = useStoredProfile();
  const [adding, setAdding] = useState(false);
  // The way back from the wrong CV: taking a document out takes what it brought, and the notice offers it back.
  const { removed, onRemoved, restore, dismiss } = useRemovedNotice();
  const remove = useRemoval(onRemoved);
  const [documents, setDocuments] = useState(false);
  const readings = readReceipts(profile, profile.sources.length).filter((receipt) => profile.sources.some((source) => source.id === receipt.sourceId && isRemovableSource(source)));
  // A reminder in the person's own calendar, when that is switched on (`lib/experiments.ts`): nothing is offered otherwise.
  const reminderOn = useExperiment("calendar_reminder");
  const [reminding, setReminding] = useState(false);

  /**
   * «Recuperar una copia» brings a copy back: read as whatever it is — a profile, a whole backup, an archive of postings — open or with a password,
   * and what it would replace is said first with both sides in numbers and written down before it goes (`recoverCopy`). A copy with a
   * password is opened in its own dialog, so what comes of it is said in a toast.
   */
  const importFrom = async (file: File) => {
    const result = await recover(file);
    if (result.status === "cancelled") return;
    setMessage(null);
    toast({ tone: result.status === "recovered" ? "good" : "bad", message: result.message });
  };

  const reset = async () => {
    // Only what was answered with "ahora no" or "no aplica". The profile
    // itself stays as it is: this is asking again, not starting over.
    const ok = await confirm(
      "Vamos a volver a preguntarte lo que dejaste para después y lo que marcaste como «no aplica», y las cifras si habías dicho que en tu trabajo no se miden. Tus datos no cambian. ¿Seguimos?",
      { title: "Volver a preguntar", confirmLabel: "Sí, preguntame" },
    );
    if (ok) {
      updateStoredProfile((draft) => resetQuestions(draft));
      router.push("/perfil/preguntas");
    }
  };

  const restart = async () => {
    // Destructive, and not something the app can take back: so the copy comes first, and what is said is what happens.
    const ok = await confirm(
      "Vamos a vaciar tu perfil: puestos, estudios, habilidades, los documentos que leímos y todo lo demás. Antes te bajamos una copia (un archivo) para que puedas recuperarlo con «Recuperar una copia». Tus postulaciones y tus ajustes no se tocan. ¿Seguimos?",
      { title: "Empezar de nuevo", confirmLabel: "Bajar la copia y empezar de nuevo" },
    );
    if (!ok) return;
    exportOwnProfile();
    if (startOver()) router.push("/perfil/empezar");
    else setMessage("No pudimos vaciar tu perfil: el navegador no dejó guardar. La copia que bajamos sigue sirviendo.");
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" compact onClick={() => void copies.saveLocked("profile")}>
          Bajar una copia
        </Button>
        {/* Named for what it reads, not for the verb, so it cannot be
            confused with «Recuperar una copia» beside it — one reads a
            CV, the other restores a copy of the profile itself. */}
        <Button type="button" variant="secondary" compact onClick={() => setAdding(true)}>
          Agregar un CV o un perfil de LinkedIn
        </Button>
        {readings.length > 0 ? (
          <Button type="button" variant="secondary" compact onClick={() => setDocuments(true)}>
            Quitar un documento
          </Button>
        ) : null}
        <Button type="button" variant="secondary" compact onClick={() => fileInput.current?.click()}>
          Recuperar una copia
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          aria-label="Elegir una copia"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) await importFrom(file);
          }}
        />
        <Button type="button" variant="secondary" compact onClick={() => void reset()}>
          Volver a preguntar lo pendiente
        </Button>
        {reminderOn ? (
          <Button type="button" variant="secondary" compact onClick={() => setReminding(true)}>
            Recordatorio en mi calendario
          </Button>
        ) : null}
        {/* Apart and last: the one thing here that cannot be taken back, and not one to reach by a slip of the thumb. */}
        <span className="flex-1" />
        <Button type="button" variant="danger" compact onClick={() => void restart()}>
          Empezar de nuevo
        </Button>
      </div>

      {message ? <p className="mt-2 text-xs text-red-300">{message}</p> : null}

      {reminderOn ? (
        <Modal open={reminding} onClose={() => setReminding(false)} labelledBy="reminder-title" className="max-w-xl p-6">
          <ReminderForm onClose={() => setReminding(false)} />
        </Modal>
      ) : null}

      <Modal open={documents} onClose={() => setDocuments(false)} labelledBy="remove-document-title" className="max-w-xl p-6">
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <h2 id="remove-document-title" className="text-[17px] text-ink">
              Documentos que leímos
            </h2>
            <Button variant="ghost" compact onClick={() => setDocuments(false)}>
              Cerrar
            </Button>
          </div>
          <p className="text-sm text-ink-2">Se va lo que trajo y nadie más dice ni tocaste vos. Se puede deshacer.</p>
          <ul className="space-y-3">
            {readings.map((receipt) => (
              <li key={receipt.sourceId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm text-ink-2">
                <span className="min-w-0 wrap-break-word">
                  <span className="text-ink">«{receipt.name}»</span>: {receipt.text}.
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  compact
                  aria-label={`Quitar «${receipt.name}» y lo que trajo`}
                  onClick={() => {
                    setDocuments(false);
                    remove((draft) => removeSource(draft, receipt.sourceId));
                  }}
                >
                  Quitar este documento
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </Modal>

      <Modal open={adding} onClose={() => setAdding(false)} labelledBy="add-document-title" className="max-w-xl p-6">
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <h2 id="add-document-title" className="text-[17px] text-ink">
              Agregar un CV o un perfil de LinkedIn
            </h2>
            <Button variant="ghost" compact onClick={() => setAdding(false)}>
              Cerrar
            </Button>
          </div>
          <SourceAdder
            adder={adder}
            draftKey="paste:menu"
            profile={profile}
            onAdded={() => {
              setAdding(false);
              router.push("/perfil?revisar=1");
            }}
          />
        </div>
      </Modal>

      <RemovedNotice removed={removed} onRestore={restore} onDismiss={dismiss} />
    </div>
  );
}
