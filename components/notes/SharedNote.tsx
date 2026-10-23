"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeading } from "@/components/ui";
import { experimentOn } from "@/lib/experiments";
import { takeShared } from "@/lib/notes/share";
import { useExperiment } from "@/lib/use-experiment";
import { NoteForm } from "./NoteForm";

/**
 * Where what is shared to the app from another one lands (e5, O15; `public/share-sw.js`): the same box as «Anotá algo», with what was shared already in it, to
 * keep as a note or not. What the worker kept is read here once and taken out; the box is the person's to change before it is saved, and nothing was saved until then.
 *
 * Not there unless «Anotá algo» is on: whoever arrives here with it off is taken to their profile.
 */

export function SharedNote() {
  const on = useExperiment("note_capture");
  const router = useRouter();
  const params = useSearchParams();
  const [shared, setShared] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    // Asked here, in the browser, and not of `on`: the render that hydrates the page still says what the server said, and a switch that only this browser has
    // (the development one) would send the person away before it was read.
    if (!experimentOn("note_capture")) {
      router.replace("/perfil");
      return;
    }
    let cancelled = false;
    void takeShared().then((text) => {
      if (!cancelled) setShared(text);
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!on || shared === undefined) return <p className="text-sm text-ink-3">Cargando…</p>;

  const missing = params.get("compartido") === "falta";
  return (
    <div className="space-y-8" data-shared-note>
      <PageHeading eyebrow="Anotá algo" title={shared ? "Lo que compartiste" : "Anotá algo"}>
        {shared
          ? "Llegó a tu navegador y a ningún otro lado. Cambialo si querés y guardalo como una nota, o cerrá esto y no queda nada."
          : missing
            ? "No llegamos a recibir lo que compartiste. Pegalo acá si querés guardarlo."
            : "Escribí lo que no quieras olvidar. Se guarda con la fecha de hoy."}
      </PageHeading>
      <NoteForm via={shared ? "share" : "capture"} initial={shared ?? ""} closeLabel="Cerrar sin guardar" onSaved={() => router.push("/perfil")} onClose={() => router.push("/perfil")} />
    </div>
  );
}
