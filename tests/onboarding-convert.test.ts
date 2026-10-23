import { describe, expect, it } from "vitest";
import { experienceLeftover, isExperienceLeftover } from "@/lib/onboarding/convert";
import type { Unassigned } from "@/lib/schemas/profile-v2";

const TEXT = `Cajero en Kiosco del Centro (2022)
Atención al cliente, manejo de caja y arqueo diario.
Repositor en Supermercado Sur
Reposición de mercadería y armado de pedidos del depósito.`;

const item = (over: Partial<Unassigned> = {}): Unassigned => ({ id: "u1", text: TEXT, kind: "other", heading: "EXPERIENCIA", sourceId: "src-1", ...over });

describe("what an experience section leaves in the tray", () => {
  it("is told by the heading it was under, in the words CVs use", () => {
    for (const heading of ["EXPERIENCIA", "Experiencia laboral", "Work Experience", "Trayectoria profesional"]) {
      expect(experienceLeftover({ kind: "other", heading }), heading).toBe("job");
    }
    for (const heading of ["Voluntariado", "Volunteer experience"]) expect(experienceLeftover({ kind: "other", heading }), heading).toBe("volunteer");
  });

  it("is not told of any other section, nor of a text that had none", () => {
    for (const heading of ["ESTUDIOS", "Idiomas", "Habilidades", "Intereses", "Proyectos"]) expect(experienceLeftover({ kind: "other", heading }), heading).toBeNull();
    expect(experienceLeftover({ kind: "other" })).toBeNull();
    expect(experienceLeftover({ kind: "summary", heading: "EXPERIENCIA" })).toBeNull();
    expect(experienceLeftover({ kind: "interests", heading: "EXPERIENCIA" })).toBeNull();
  });

  it("is a section only when there is something written in it", () => {
    expect(isExperienceLeftover(item())).toBe(true);
    expect(isExperienceLeftover(item({ text: "Sin experiencia previa." }))).toBe(false);
    expect(isExperienceLeftover(item({ heading: "ESTUDIOS" }))).toBe(false);
  });
});
