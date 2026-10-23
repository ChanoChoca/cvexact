"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Alert, Button } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { useCopyActions } from "./useCopyActions";
import { useApplicationsStatus, useProfileSaveProblem } from "@/lib/storage/hooks";
import {
  retryPendingProfile,
  retryUnsavedApplications,
  type StorageErrorKind,
  type UnsavedApplication,
} from "@/lib/storage/local";

/**
 * What the person is told when the browser refused to keep something.
 *
 * Written for someone who has never heard of localStorage and should not have
 * to: what happened, that nothing is lost, what happens if they close the tab —
 * honestly, according to where the waiting copy actually went — and the ways
 * out, none of which is regenerating. Nothing here deletes anything.
 */

const WHY: Record<StorageErrorKind, string> = {
  quota: "este navegador no tiene más espacio para CV Exact",
  unavailable: "este navegador no nos deja guardar datos (pasa en algunas ventanas privadas)",
  unknown: "el navegador no pudo guardarlo",
};

const IF_CLOSED: Record<UnsavedApplication["rescued"], string> = {
  local: "Si cerrás esta pestaña, lo vas a encontrar acá cuando vuelvas.",
  session:
    "Si recargás la página no se pierde, pero si cerrás la pestaña sí: bajá la copia completa antes.",
  none: "Si cerrás o recargás esta pestaña se pierde: bajá la copia completa antes.",
};

function useRecoveryActions() {
  const toast = useToast();
  const copies = useCopyActions();
  const [busy, setBusy] = useState<"retry" | "download" | null>(null);

  const retry = async () => {
    setBusy("retry");
    try {
      const profileOk = retryPendingProfile();
      const outcomes = await retryUnsavedApplications();
      const failed = outcomes.filter((outcome) => !outcome.ok).length;
      if (failed === 0 && profileOk) {
        toast({ tone: "good", message: "Listo, quedó guardado." });
      } else {
        toast({
          tone: "bad",
          message: "Todavía no se pudo guardar. Sigue abierto acá; bajá la copia completa si vas a cerrar la pestaña.",
        });
      }
    } finally {
      setBusy(null);
    }
  };

  const download = async () => {
    setBusy("download");
    try {
      // Says where it went and what is left to do, and says when it could not be made (`useCopyActions`).
      await copies.saveComplete();
    } finally {
      setBusy(null);
    }
  };

  return { busy, retry, download };
}

/**
 * On the application the Wizard has open, which is the one the person is
 * looking at: the CV is on screen, and the PDF and Word buttons below it work
 * from memory, so the message can say exactly that.
 */
export function UnsavedApplicationAlert({ entry }: { entry: UnsavedApplication }) {
  const { busy, retry, download } = useRecoveryActions();
  return (
    <Alert tone="warn" title="Tu CV está listo, pero todavía no quedó guardado">
      No pudimos guardarlo porque {WHY[entry.kind]}. No hace falta volver a generarlo: está acá, y los
      botones de PDF y Word funcionan igual. {IF_CLOSED[entry.rescued]}
      <span className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="secondary" disabled={busy !== null} onClick={() => void retry()}>
          {busy === "retry" ? "Guardando…" : "Reintentar guardado"}
        </Button>
        <Button variant="ghost" disabled={busy !== null} onClick={() => void download()}>
          {busy === "download" ? "Preparando…" : "Bajar la copia completa"}
        </Button>
        {entry.kind === "quota" ? (
          <Link
            href="/postulaciones?orden=tamano"
            className="text-sm underline underline-offset-4 hover:text-ink"
          >
            Ver qué ocupa espacio
          </Link>
        ) : null}
      </span>
    </Alert>
  );
}

/**
 * Everywhere else: one line for whatever is waiting — applications, the
 * profile, or both. Not on `/postular`, where the Wizard says it in context.
 */
export function UnsavedNotice() {
  const pathname = usePathname();
  const { unsaved } = useApplicationsStatus();
  const profileProblem = useProfileSaveProblem();
  const { busy, retry, download } = useRecoveryActions();

  const inWizard = pathname === "/postular";
  const applications = inWizard ? [] : unsaved;
  if (applications.length === 0 && profileProblem === null) return null;

  const kind = applications[0]?.kind ?? profileProblem ?? "unknown";
  const parts: string[] = [];
  if (applications.length > 0) {
    parts.push(
      applications.length === 1
        ? `«${applications[0]!.label || "Una postulación"}» no quedó guardada`
        : `${applications.length} postulaciones no quedaron guardadas`,
    );
  }
  if (profileProblem !== null) parts.push("los últimos cambios de tu perfil no quedaron guardados");
  const lost = applications.some((entry) => entry.rescued !== "local");

  return (
    <div className="mb-6">
      <Alert tone="warn" title="Hay cambios sin guardar en este navegador">
        {parts.join(", y ")}: {WHY[kind]}. Siguen abiertos acá; no se perdió nada.
        {lost ? " Si vas a cerrar la pestaña, bajá la copia completa antes." : ""}
        <span className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="secondary" disabled={busy !== null} onClick={() => void retry()}>
            {busy === "retry" ? "Guardando…" : "Reintentar"}
          </Button>
          <Button variant="ghost" disabled={busy !== null} onClick={() => void download()}>
            {busy === "download" ? "Preparando…" : "Bajar la copia completa"}
          </Button>
          {applications.length > 0 ? (
            <Link href="/postulaciones" className="text-sm underline underline-offset-4 hover:text-ink">
              Ver cuáles
            </Link>
          ) : null}
        </span>
      </Alert>
    </div>
  );
}
