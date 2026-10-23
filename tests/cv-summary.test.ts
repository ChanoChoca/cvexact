import { describe, expect, it } from "vitest";
import { summarizeCV } from "@/lib/ai/prompts/cv-summary";
import { NAME_PLACEHOLDER } from "@/lib/ai/prompts/shared";
import { templateCV } from "@/lib/fixtures/template-cv";
import { cvDocumentSchema, type CVDocument } from "@/lib/schemas/cv";

/**
 * `summarizeCV()` is the only thing the answers, cover-email and interview-prep
 * prompts see of the CV the employer already has. Anything it drops, those three
 * generators cannot mention and may contradict.
 */

function cv(sections: CVDocument["sections"]): CVDocument {
  return cvDocumentSchema.parse({ ...templateCV, sections });
}

describe("summarizeCV", () => {
  it("carries a pairs section, not just its heading", () => {
    const summary = summarizeCV(
      cv([
        {
          kind: "pairs",
          title: "CERTIFICACIONES E IDIOMAS",
          items: [
            { label: "AWS Cloud Practitioner", value: "AWS, 2024" },
            { label: "Inglés", value: "Avanzado" },
          ],
        },
      ]),
    );

    expect(summary).toContain("CERTIFICACIONES E IDIOMAS");
    expect(summary).toContain("AWS Cloud Practitioner: AWS, 2024");
    expect(summary).toContain("Inglés: Avanzado");
  });

  it("omits the separator for a pair with no value", () => {
    const summary = summarizeCV(
      cv([
        {
          kind: "pairs",
          title: "DISPONIBILIDAD",
          items: [{ label: "Disponibilidad inmediata", value: "" }],
        },
      ]),
    );

    expect(summary).toContain("- Disponibilidad inmediata");
    expect(summary).not.toContain("Disponibilidad inmediata:");
  });

  it("carries a projects section: the name, what it is and where it lives", () => {
    const summary = summarizeCV(
      cv([
        {
          kind: "projects",
          title: "PROYECTOS",
          items: [
            { ref: "P1", name: "Sistema de turnos", description: "Agenda para una clínica.", url: "https://github.com/perfil-ejemplo/turnos" },
            { ref: "P2", name: "Solo el nombre", description: "", url: "" },
            { ref: "P3", name: "Sitio de la cooperativa", description: "", url: "https://coop.example.com" },
          ],
        },
      ]),
    );

    expect(summary).toContain("PROYECTOS");
    expect(summary).toContain("- Sistema de turnos: Agenda para una clínica. — https://github.com/perfil-ejemplo/turnos");
    expect(summary).toContain("- Solo el nombre\n");
    expect(summary).toContain("- Sitio de la cooperativa: https://coop.example.com");
    // The reference is how the generator points at the profile, not something the reader needs.
    expect(summary).not.toContain("P1");
  });

  it("carries every other kind of section too", () => {
    const summary = summarizeCV(templateCV);

    expect(summary).toContain(templateCV.summary);

    for (const section of templateCV.sections) {
      expect(summary).toContain(section.title);
    }
  });

  it("does not carry the real name — same withholding as serializeProfile", () => {
    // Ver la auditoría legal pre-lanzamiento: hasta acá, este era el único
    // canal por el que el nombre real llegaba igual al modelo en answers,
    // write-email, video-script e interview-prep, pese a que las cuatro rutas
    // ya reponen el nombre con `restoreCandidateName` bajo el supuesto de que
    // el modelo nunca lo vio (ver `IDENTITY_WITHHELD` en `lib/ai/prompts/shared.ts`).
    const summary = summarizeCV(templateCV);

    expect(summary).not.toContain(templateCV.header.fullName);
    expect(summary).toContain(NAME_PLACEHOLDER);
  });

  it("leaves the coverage audit out — it is notes to itself, not the CV", () => {
    const audited = cvDocumentSchema.parse({
      ...templateCV,
      coverage: {
        requirements: [
          {
            requirement: "Kubernetes en producción",
            covered: false,
            evidence: "El perfil no lo menciona",
            inferred: false,
          },
        ],
        omitted: [{ item: "Trabajo de verano", reason: "No aporta al puesto" }],
      },
    });

    const summary = summarizeCV(audited);

    expect(summary).not.toContain("Kubernetes");
    expect(summary).not.toContain("Trabajo de verano");
  });
});

describe("summarizeCV — activities", () => {
  it("carries an activities section: the line, without the reference the generator points by", () => {
    const summary = summarizeCV(cv([{ kind: "activities", title: "ACTIVIDADES", items: [{ ref: "O1", text: "Presido el Club de Robótica." }, { ref: "O2", text: "Doy clases de apoyo." }] }]));
    expect(summary).toContain("ACTIVIDADES");
    expect(summary).toContain("- Presido el Club de Robótica.");
    expect(summary).toContain("- Doy clases de apoyo.");
    expect(summary).not.toContain("O1");
  });
});
