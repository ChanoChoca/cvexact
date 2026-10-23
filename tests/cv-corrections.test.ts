import { describe, expect, it } from "vitest";
import { correctionsOf, originOf, revertCorrection, saveCorrection, unsettled, type Correction } from "@/lib/cv/corrections";
import { setItemBullet, setPair, setProject, setRole, setSummary } from "@/lib/cv/edit";
import { cvDocumentSchema, type CVDocument } from "@/lib/schemas/cv";
import { profileSchema } from "@/lib/schemas/profile";
import { editContext } from "@/lib/profile/edit";
import { emptyStoredProfile } from "@/lib/schemas/profile-v2";
import { migrateV1 } from "@/lib/profile/migrate";
import { NOW, STAMP, newId } from "./helpers/profiles";

/**
 * O11: what a person added or changed by hand in a generated CV, compared with the CV as the model generated it and with what the profile says
 * (`lib/cv/corrections.ts`): what is new is offered to the profile once, what contradicts it is kept as a disagreement, and a change of words is style,
 * which nobody learns from.
 */

const profile = profileSchema.parse({
  fullName: "Lucía Pérez",
  email: "lucia@example.com",
  city: "Córdoba",
  country: "Argentina",
  experience: [
    {
      id: "e1",
      company: "Nubia Retail",
      role: "Analista de Marketing",
      start: "2021-03",
      current: true,
      bullets: ["Llevo las campañas de Google Ads y Meta", "Preparo los informes mensuales", "Subí las ventas un 20%"],
      tags: ["Google Ads", "Meta Ads"],
    },
  ],
  skills: ["Google Ads", "Meta Ads"],
  certifications: [{ id: "c1", name: "Google Analytics", issuer: "Google", date: "2023" }],
  languages: [{ id: "l1", name: "Inglés", level: "Avanzado" }],
});

const generated: CVDocument = cvDocumentSchema.parse({
  language: "es",
  header: { fullName: "Lucía Pérez", location: "Córdoba, Argentina", phone: "", email: "lucia@example.com", links: [] },
  summary: "Analista de marketing con experiencia en campañas pagas.",
  sections: [
    {
      kind: "experience",
      title: "EXPERIENCIA PROFESIONAL",
      items: [
        {
          company: "Nubia Retail",
          role: "Analista de Marketing",
          location: "Córdoba, Argentina",
          dateRange: "Marzo 2021 – Actualidad",
          bullets: ["Llevo las campañas de Google Ads y Meta.", "Preparo los informes mensuales.", "Subí las ventas un 20 %."],
        },
      ],
    },
    { kind: "pairs", title: "CERTIFICACIONES", items: [{ label: "Google Analytics", value: "Google, 2023" }] },
  ],
});

const found = (edited: CVDocument, original: CVDocument = generated) => correctionsOf({ original, edited, profile });
const keys = (list: Correction[]) => list.map((entry) => entry.key).sort();

describe("what an edit leaves as it was", () => {
  it("is nothing when nothing was edited", () => {
    expect(found(generated)).toEqual([]);
  });

  it("is nothing for a change of words: style is not a fact", () => {
    const styled = setItemBullet(setSummary(generated, "Analista de marketing con experiencia en campañas de pago."), 0, 0, 1, "Armo los informes de cada mes.");
    expect(found(styled)).toEqual([]);
  });

  it("is nothing for what an edit took out: a line that was removed says nothing the profile should forget", () => {
    const without: CVDocument = { ...generated, sections: [{ ...generated.sections[0]!, items: [{ ...(generated.sections[0] as { items: Array<{ company: string; role: string; location: string; dateRange: string; bullets: string[] }> }).items[0]!, bullets: ["Llevo las campañas de Google Ads y Meta."] }] } as CVDocument["sections"][number], generated.sections[1]!] };
    expect(found(without)).toEqual([]);
  });

  it("is nothing for a tool the profile has, even if the model had left it out and the person put it back", () => {
    expect(found(setItemBullet(generated, 0, 0, 1, "Preparo los informes mensuales y llevo Meta Ads."))).toEqual([]);
  });
});

describe("what is new", () => {
  it("a tool the CV names that neither the generated CV nor the profile did", () => {
    const edited = setItemBullet(generated, 0, 0, 1, "Preparo los informes mensuales con Tableau.");
    const [tool] = found(edited);
    expect(tool).toMatchObject({ key: "tool:tableau", kind: "tool", text: "Tableau", field: "sections[0].items[0].bullets[1]", line: "Preparo los informes mensuales con Tableau." });
  });

  it("a tool that was already in the generated CV is not the edit's, even if the profile has no sign of it", () => {
    const wasThere = setItemBullet(generated, 0, 0, 2, "Subí las ventas un 20 % con ayuda de Tableau.");
    expect(keys(found(wasThere))).toContain("tool:tableau");
    expect(found(setItemBullet(generated, 0, 0, 1, "Preparo informes con Tableau."), wasThere)).toEqual([]);
  });

  it("a number nobody gave: it has its own way in, which asks where it comes from", () => {
    const edited = setItemBullet(generated, 0, 0, 1, "Preparo los informes mensuales para 45 clientes.");
    expect(found(edited)).toEqual([expect.objectContaining({ kind: "figure", key: "figure:45", text: "45", field: "sections[0].items[0].bullets[1]" })]);
    // A number the profile states is not new: it is theirs.
    expect(found(setItemBullet(generated, 0, 0, 2, "Subí las ventas un 20% el último año."))).toEqual([]);
  });

  it("a credential in a list of the CV that the profile has no sign of", () => {
    const edited = setPair(generated, 1, 0, { label: "Meta Certified Marketing Associate", value: "Meta, 2024" });
    const [credential] = found(edited);
    expect(credential).toMatchObject({ key: "credential:meta certified marketing associate", kind: "credential", text: "Meta Certified Marketing Associate", value: "Meta, 2024", field: "sections[1].items[0]" });
  });

  it("not a credential the profile has, nor how they can work, which is the profile's own and has its own check", () => {
    const sameCredential = setPair(generated, 1, 0, { label: "Google Analytics", value: "Google, 2022" });
    expect(found(sameCredential)).toEqual([]);
    const availability = setPair(generated, 1, 0, { label: "Disponibilidad", value: "Tiempo completo" });
    expect(found(availability)).toEqual([]);
  });

  it("says each thing once, however many lines carry it", () => {
    const twice = setItemBullet(setItemBullet(generated, 0, 0, 1, "Informes en Tableau."), 0, 0, 2, "Tableros de ventas en Tableau.");
    expect(keys(found(twice))).toEqual(["tool:tableau"]);
  });
});

describe("what contradicts the profile", () => {
  it("a title that shares nothing with what the profile says for the job — and that the edit wrote", () => {
    const edited = setRole(generated, 0, 0, "Gerente Comercial");
    const [role] = found(edited);
    expect(role).toMatchObject({ key: "role:gerente comercial", kind: "role", text: "Gerente Comercial", field: "sections[0].items[0].role", against: { current: "Analista de Marketing" } });
  });

  it("not a title that is still the profile's, said another way, and not one the model wrote", () => {
    expect(found(setRole(generated, 0, 0, "Analista de Marketing Digital"))).toEqual([]);
    const modelWrote = setRole(generated, 0, 0, "Gerente Comercial");
    expect(found(modelWrote, modelWrote)).toEqual([]);
  });
});

describe("what is still to settle", () => {
  it("leaves out what was left «solo en este CV»", () => {
    const edited = setItemBullet(setPair(generated, 1, 0, { label: "Meta Certified Marketing Associate", value: "Meta, 2024" }), 0, 0, 1, "Informes en Tableau.");
    const all = found(edited);
    expect(keys(all)).toEqual(["credential:meta certified marketing associate", "tool:tableau"]);
    expect(keys(unsettled(all, new Set(["tool:tableau"])))).toEqual(["credential:meta certified marketing associate"]);
    expect(unsettled(all, new Set(all.map((entry) => entry.key)))).toEqual([]);
  });
});

describe("«Guardar en el perfil»", () => {
  const stored = () => migrateV1(profile, { now: STAMP });
  const origin = originOf("Analista · Acme", "7 de octubre de 2026");
  const ctx = () => editContext({ now: STAMP, newId });

  it("says where it came from: the CV the person edited, and the day", () => {
    expect(origin).toBe("Agregado a mano en el CV de «Analista · Acme», 7 de octubre de 2026");
  });

  it("a tool becomes a skill of their own, with where it came from said", () => {
    const draft = stored();
    const [tool] = found(setItemBullet(generated, 0, 0, 1, "Informes en Tableau."));
    expect(saveCorrection(draft, tool!, origin, ctx())).toBe(true);
    const skill = draft.skills.find((entry) => entry.name.value === "Tableau")!;
    expect(skill).toBeDefined();
    expect(skill.name.source).toMatchObject({ kind: "manual", quote: origin, at: STAMP });
    expect(skill.name.status).toBe("confirmed");
    // Saved once: the same tool is not added twice.
    expect(draft.skills.filter((entry) => entry.name.value === "Tableau")).toHaveLength(1);
  });

  it("a credential becomes a certification, with its year and who gave it when the line says them", () => {
    const draft = stored();
    const [credential] = found(setPair(generated, 1, 0, { label: "Meta Certified Marketing Associate", value: "Meta, 2024" }));
    expect(saveCorrection(draft, credential!, origin, ctx())).toBe(true);
    const cert = draft.certifications.find((entry) => entry.name.value === "Meta Certified Marketing Associate")!;
    expect(cert.issuer.value).toBe("Meta");
    expect(cert.date.value).toEqual({ year: 2024 });
    expect(cert.name.source).toMatchObject({ kind: "manual", quote: origin });
  });

  it("a title that contradicts becomes a disagreement with the one the profile has, and does not overwrite it", () => {
    const draft = stored();
    const job = draft.experience[0]!;
    const [role] = found(setRole(generated, 0, 0, "Gerente Comercial"));
    expect(role!.against!.experienceId).toBe(job.id);
    expect(saveCorrection(draft, role!, origin, ctx())).toBe(true);
    expect(job.role.value).toBe("Analista de Marketing");
    expect(draft.conflicts).toHaveLength(1);
    expect(draft.conflicts[0]).toMatchObject({ entity: "experience", entityId: job.id, field: "role", current: { value: "Analista de Marketing" }, incoming: { value: "Gerente Comercial" } });
    expect(draft.conflicts[0]!.incoming.source).toMatchObject({ kind: "manual", quote: origin });
    // The same disagreement is not made twice.
    expect(saveCorrection(draft, role!, origin, ctx())).toBe(false);
    expect(draft.conflicts).toHaveLength(1);
  });

  it("a number is not saved here, and an empty profile has no job to disagree with", () => {
    const [figure] = found(setItemBullet(generated, 0, 0, 1, "Informes para 45 clientes."));
    expect(saveCorrection(stored(), figure!, origin, ctx())).toBe(false);
    const [role] = found(setRole(generated, 0, 0, "Gerente Comercial"));
    expect(saveCorrection(emptyStoredProfile(), role!, origin, ctx())).toBe(false);
  });
});

describe("«Era un error»", () => {
  it("puts the line back to what the model generated", () => {
    const edited = setItemBullet(generated, 0, 0, 1, "Preparo los informes mensuales con Tableau.");
    const [tool] = found(edited);
    const back = revertCorrection(edited, generated, tool!);
    expect(back).toEqual(generated);
    expect(found(back!)).toEqual([]);
  });

  it("puts a summary, a title and a pair back, each where it was", () => {
    const summary = setSummary(generated, "Analista con experiencia en Tableau.");
    const [inSummary] = found(summary);
    expect(inSummary).toMatchObject({ kind: "tool", field: "summary" });
    expect(revertCorrection(summary, generated, inSummary!)).toEqual(generated);

    const retitled = setRole(generated, 0, 0, "Gerente Comercial");
    const [role] = found(retitled);
    expect(revertCorrection(retitled, generated, role!)).toEqual(generated);

    const pair = setPair(generated, 1, 0, { label: "Meta Certified Marketing Associate", value: "Meta, 2024" });
    const [credential] = found(pair);
    expect(revertCorrection(pair, generated, credential!)).toEqual(generated);
  });

  it("puts a project's description back, to the same project and no other", () => {
    const withProject = cvDocumentSchema.parse({
      ...generated,
      sections: [generated.sections[0], { kind: "projects", title: "PROYECTOS", items: [{ ref: "P1", name: "Tablero de campañas", description: "Tablero de las campañas pagas.", url: "" }] }, generated.sections[1]],
    });
    const edited = setProject(withProject, 1, 0, "Tablero de las campañas pagas en Tableau.");
    const [tool] = found(edited, withProject);
    expect(tool).toMatchObject({ kind: "tool", field: "sections[1].items[0].description" });
    expect(revertCorrection(edited, withProject, tool!)).toEqual(withProject);

    const other = cvDocumentSchema.parse({ ...edited, sections: [edited.sections[0], { kind: "projects", title: "PROYECTOS", items: [{ ref: "P2", name: "Otro proyecto", description: "Tableau.", url: "" }] }, edited.sections[2]] });
    expect(revertCorrection(other, withProject, tool!)).toBeNull();
  });

  it("takes out a line that the model had no line for", () => {
    const longer = cvDocumentSchema.parse({ ...generated, sections: [{ ...(generated.sections[0] as object), items: [{ ...(generated.sections[0] as { items: object[] }).items[0], bullets: ["Llevo las campañas de Google Ads y Meta.", "Preparo los informes mensuales.", "Subí las ventas un 20 %.", "Armé tableros en Tableau."] }] }, generated.sections[1]] });
    const [tool] = found(longer);
    expect(tool).toMatchObject({ kind: "tool", field: "sections[0].items[0].bullets[3]" });
    expect(revertCorrection(longer, generated, tool!)).toEqual(generated);
  });

  it("does not guess when the CV has changed shape: a section moved, or an item gone, and nothing says which line was the model's", () => {
    const moved: CVDocument = { ...generated, sections: [generated.sections[1]!, generated.sections[0]!] };
    expect(revertCorrection(moved, generated, { key: "tool:x", kind: "tool", text: "X", field: "sections[0].items[0].bullets[1]", line: "x" })).toBeNull();
    expect(revertCorrection(generated, generated, { key: "tool:x", kind: "tool", text: "X", field: "coverage", line: "x" })).toBeNull();
  });
});

describe("the day it was written", () => {
  it("is a fixed day for the fixtures", () => {
    expect(NOW.toISOString()).toBe(STAMP);
  });
});
