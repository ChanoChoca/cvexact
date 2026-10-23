import { describe, expect, it } from "vitest";
import { applicationSchema, type Application } from "@/lib/storage/local";
import type { TrackerApplication } from "@/lib/tracker/client-types";
import { pendingLocalApplications } from "@/app/(app)/postulaciones/pending-local";

function localApp(id: string): Application {
  return applicationSchema.parse({
    id,
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    jobText: "Aviso de prueba",
    label: "Puesto de prueba",
  });
}

function trackedApp(id: string): TrackerApplication {
  // La función sólo lee `id`; el resto de la fila server-side no entra acá.
  return { id } as TrackerApplication;
}

describe("pendingLocalApplications", () => {
  it("deja sólo las que no están en el seguimiento", () => {
    const local = [localApp("a"), localApp("b"), localApp("c")];
    const tracked = [trackedApp("b")];
    expect(pendingLocalApplications(local, tracked).map((a) => a.id)).toEqual(["a", "c"]);
  });

  it("trata una postulación con el mismo id como la misma, aunque el título difiera", () => {
    const local = [{ ...localApp("a"), label: "Título distinto en el navegador" }];
    const tracked = [
      { ...trackedApp("a"), jobTitle: "Título distinto en el servidor" } as TrackerApplication,
    ];
    expect(pendingLocalApplications(local, tracked)).toEqual([]);
  });

  it("sin seguimiento, todo lo local está pendiente", () => {
    const local = [localApp("a"), localApp("b")];
    expect(pendingLocalApplications(local, [])).toHaveLength(2);
  });

  it("sin nada local, no hay pendientes", () => {
    expect(pendingLocalApplications([], [trackedApp("a")])).toEqual([]);
  });

  it("no pisa la lista que recibe", () => {
    const local = [localApp("a"), localApp("b")];
    const copia = [...local];
    pendingLocalApplications(local, [trackedApp("a")]);
    expect(local).toEqual(copia);
  });
});
