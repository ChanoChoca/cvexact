import { describe, expect, it } from "vitest";
import {
  normalizeStoredApplication,
  withEditedCV,
  withGeneratedCV,
  withRestoredCV,
} from "@/lib/storage/applications/normalize";
import { templateCV } from "@/lib/fixtures/template-cv";
import type { Application } from "@/lib/storage/application";
import type { CVDocument } from "@/lib/schemas/cv";

/**
 * `cvOriginal` is kept only while there is something to restore. It used to be
 * a second full copy of every generated CV — identical to `cv` in 127 of 127
 * applications of a real export, 30 % of everything stored.
 */

const base: Application = {
  id: "a1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  jobText: "aviso",
  label: "Postulación",
};

const generated: CVDocument = templateCV;
const edited: CVDocument = { ...templateCV, summary: "Resumen editado a mano." };
const editedAgain: CVDocument = { ...templateCV, summary: "Otra edición." };

describe("cvOriginal, sólo cuando hay algo que restaurar", () => {
  it("un CV recién generado no guarda una segunda copia", () => {
    const app = withGeneratedCV({ ...base, cvOriginal: edited, cvEdited: true }, generated);
    expect(app.cv).toBe(generated);
    expect(app.cvOriginal).toBeUndefined();
    expect(app.cvEdited).toBe(false);
  });

  it("la primera edición guarda el generado; las siguientes no lo pisan", () => {
    const first = withEditedCV(withGeneratedCV(base, generated), edited);
    expect(first.cvOriginal).toBe(generated);
    expect(first.cv).toBe(edited);
    expect(first.cvEdited).toBe(true);

    const second = withEditedCV(first, editedAgain);
    expect(second.cvOriginal).toBe(generated);
    expect(second.cv).toBe(editedAgain);
  });

  it("restaurar vuelve al generado y ya no deja nada que restaurar", () => {
    const restored = withRestoredCV(withEditedCV(withGeneratedCV(base, generated), edited));
    expect(restored?.cv).toBe(generated);
    expect(restored?.cvOriginal).toBeUndefined();
    expect(restored?.cvEdited).toBe(false);
    expect(withRestoredCV(withGeneratedCV(base, generated))).toBeNull();
  });

  it("de los datos viejos quita sólo la copia idéntica de un CV sin editar", () => {
    const duplicate = { ...base, cv: generated, cvOriginal: structuredClone(generated), cvEdited: false };
    expect(normalizeStoredApplication(duplicate).cvOriginal).toBeUndefined();

    // Edited: the original is what "restaurar" needs.
    const editedApp = { ...base, cv: edited, cvOriginal: generated, cvEdited: true };
    expect(normalizeStoredApplication(editedApp)).toBe(editedApp);

    // Different for a reason this code does not know: left alone.
    const different = { ...base, cv: edited, cvOriginal: generated, cvEdited: false };
    expect(normalizeStoredApplication(different)).toBe(different);
  });
});
