import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CVDocument } from "@/components/cv/CVDocument";
import { baseCv, hasCareerEntries, isPreviewReady, isThinPreview, previewEntryCount, previewFactRefs, profileToCVDocument } from "@/lib/cv/from-profile";
import { addEntry, blankForm } from "@/lib/onboarding/entries";
import { addCertification, addLanguage, addSkill } from "@/lib/profile/entities";
import { parseCv } from "@/lib/parse/cv-heuristic";
import { linesFromText } from "@/lib/parse/lines";
import { applyParsedDocument } from "@/lib/parse/to-profile";
import { factToBullet } from "@/lib/profile/project";
import { cvDocumentSchema } from "@/lib/schemas/cv";
import { emptyStoredProfile, type StoredProfile } from "@/lib/schemas/profile-v2";
import { SPANISH_BULLETS } from "./fixtures/cv-samples";

const NOW = "2026-09-21T12:00:00.000Z";
let n = 0;
const newId = () => `id-${++n}`;

const fromCv = (): StoredProfile =>
  applyParsedDocument(emptyStoredProfile(), parseCv(linesFromText(SPANISH_BULLETS)), { name: "cv.pdf", fileHash: "h", pasted: false, chars: 1 }, { sourceId: "s", now: NOW, newId }).profile;

describe("profileToCVDocument", () => {
  const doc = profileToCVDocument(fromCv());

  it("is a CV document the rest of the app accepts", () => {
    expect(cvDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it("fills the header from the contact details", () => {
    expect(doc.header).toMatchObject({
      fullName: "LUCÍA FERNÁNDEZ",
      location: "Valencia, España",
      phone: "+34 611 22 33 44",
      email: "lucia.fernandez@example.com",
    });
    expect(doc.header.links.map((l) => l.url)).toEqual(["https://linkedin.com/in/perfil-ejemplo"]);
  });

  it("has an experience section, newest first, with the person's own words as bullets", () => {
    const section = doc.sections.find((s) => s.kind === "experience");
    expect(section?.kind === "experience" && section.items.map((i) => [i.company, i.role, i.dateRange])).toEqual([
      ["Nubia Retail", "Analista de Marketing Digital", "marzo 2021 – Actualidad"],
      ["Grupo Lumen", "Asistente de Marketing", "septiembre 2018 – febrero 2021"],
    ]);
    const first = section?.kind === "experience" ? section.items[0]! : null;
    expect(first?.bullets).toEqual([
      "Llevo las campañas de Google Ads y Meta para tres marcas.",
      "Preparo los informes mensuales para dirección.",
      "Coordino a la agencia que nos hace el contenido.",
    ]);
  });

  it("has education, and one place for skills, languages and certifications", () => {
    const education = doc.sections.find((s) => s.kind === "education");
    expect(education?.kind === "education" && education.items[0]).toMatchObject({
      institution: "Universidad de Valencia",
      degree: "Grado en Administración y Dirección de Empresas",
      date: "2013 – 2017",
    });
    const pairs = doc.sections.find((s) => s.kind === "pairs");
    expect(pairs?.title).toBe("HABILIDADES · IDIOMAS · CERTIFICACIONES");
    expect(pairs?.kind === "pairs" && pairs.items.map((i) => i.label)).toEqual([
      "Habilidades",
      "Español",
      "Inglés",
      "Google Ads Certification",
      "Curso de HubSpot Inbound",
    ]);
    // The skills section's five, then Google Ads, read out of a job's own line at import.
    expect(pairs?.kind === "pairs" && pairs.items[0]!.value).toBe("Google Analytics, SEO, HubSpot, Email marketing, Copywriting, Google Ads");
  });

  it("renders with the app's own template", () => {
    const html = renderToStaticMarkup(createElement(CVDocument, { data: doc }));
    expect(html).toContain("LUCÍA FERNÁNDEZ");
    expect(html).toContain("Nubia Retail");
    expect(html).toContain("Llevo las campañas de Google Ads y Meta para tres marcas.");
  });

  it("writes no summary: nobody said one", () => {
    expect(doc.summary).toBe("");
  });
});

describe("what goes in and what stays out", () => {
  it("leaves out blank entries, tools and archived facts", () => {
    const stored = fromCv();
    stored.experience.push({ ...structuredClone(stored.experience[0]!), id: "vacio", company: { value: "", status: "confirmed" }, role: { value: "", status: "confirmed" }, facts: [] });
    stored.experience[0]!.facts.push({ id: "t", kind: "tool", text: "Photoshop", source: { kind: "manual", at: NOW }, status: "confirmed" });
    const doc = profileToCVDocument(stored);
    const section = doc.sections.find((s) => s.kind === "experience");
    expect(section?.kind === "experience" && section.items).toHaveLength(2);
    expect(JSON.stringify(doc)).not.toContain("Photoshop");
  });

  it("puts the role where the company would be when there is no company", () => {
    const stored = emptyStoredProfile();
    addEntry(stored, { ...blankForm("job"), what: "Cajero" }, { newId, now: NOW });
    const doc = profileToCVDocument(stored);
    const item = doc.sections[0]?.kind === "experience" ? doc.sections[0].items[0]! : null;
    expect(item).toMatchObject({ company: "Cajero", role: "" });
  });

  it("orders what is still going first, then by when it ended, undated last", () => {
    const stored = emptyStoredProfile();
    const add = (what: string, from: { year: number }, to: { year: number } | null) =>
      addEntry(stored, { ...blankForm("job"), what, where: "X", from, to: to ?? {}, current: to === null }, { newId, now: NOW });
    addEntry(stored, { ...blankForm("job"), what: "Sin fechas", where: "X" }, { newId, now: NOW });
    add("Viejo", { year: 2010 }, { year: 2012 });
    add("Actual", { year: 2022 }, null);
    add("Medio", { year: 2015 }, { year: 2019 });
    const doc = profileToCVDocument(stored);
    const items = doc.sections[0]?.kind === "experience" ? doc.sections[0].items : [];
    expect(items.map((i) => i.company === "X" ? i.role : i.company)).toEqual(["Actual", "Medio", "Viejo", "Sin fechas"]);
  });

  it("cuts a bullet longer than the template allows, and no more than eight", () => {
    const stored = fromCv();
    const job = stored.experience[0]!;
    job.facts = Array.from({ length: 12 }, (_, i) => ({ id: `f${i}`, kind: "responsibility" as const, text: "x".repeat(550), source: { kind: "manual" as const, at: NOW }, status: "confirmed" as const }));
    const item = profileToCVDocument(stored).sections[0]?.kind === "experience" ? (profileToCVDocument(stored).sections[0] as { items: Array<{ bullets: string[] }> }).items[0]! : null;
    expect(item?.bullets).toHaveLength(8);
    expect(item?.bullets[0]!.length).toBeLessThanOrEqual(400);
    expect(item?.bullets[0]!.endsWith("…")).toBe(true);
  });

  it("does not print the tags of a project as a fact", () => {
    const stored = emptyStoredProfile();
    addEntry(stored, { ...blankForm("project"), what: "Sistema de turnos", where: "Trabajo final" }, { newId, now: NOW });
    const doc = profileToCVDocument(stored);
    expect(doc.sections[0]).toMatchObject({ kind: "projects", title: "PROYECTOS" });
  });
});

describe("previewFactRefs", () => {
  it("names the fact and the job behind every line of the experience section, at the same position", () => {
    const stored = fromCv();
    const doc = profileToCVDocument(stored);
    const refs = previewFactRefs(stored);
    const section = doc.sections.find((s) => s.kind === "experience");
    if (section?.kind !== "experience") throw new Error("expected an experience section");
    expect(section.items.some((item) => item.bullets.length > 0)).toBe(true);

    section.items.forEach((item, itemIndex) => {
      item.bullets.forEach((bulletText, bulletIndex) => {
        const ref = refs.get(`${itemIndex}:${bulletIndex}`);
        expect(ref).toBeDefined();
        const job = stored.experience.find((entry) => entry.id === ref!.experienceId);
        const fact = job?.facts.find((entry) => entry.id === ref!.factId);
        // The line as shown, not just the fact's stored text — a metric suffix
        // would otherwise make this pass by accident on a fixture that has none.
        expect(fact && factToBullet(fact)).toBe(bulletText);
      });
    });
  });

  it("has nothing to say about a section that has no facts behind it", () => {
    const stored = emptyStoredProfile();
    addEntry(stored, { ...blankForm("project"), what: "Sistema de turnos", where: "Trabajo final" }, { newId, now: NOW });
    expect(previewFactRefs(stored).size).toBe(0);
  });
});

describe("when there is enough to show", () => {
  it("counts jobs, studies, projects and certifications", () => {
    expect(previewEntryCount(emptyStoredProfile())).toBe(0);
    // Two jobs and a study, and the two certifications the sample CV has.
    expect(previewEntryCount(fromCv())).toBe(5);
  });

  it("is ready with only projects or only certifications: a CV of one section is a start, not nothing", () => {
    const projects = emptyStoredProfile();
    addEntry(projects, { ...blankForm("project"), what: "Sistema de turnos", where: "Trabajo final" }, { newId, now: NOW });
    expect(isPreviewReady(projects)).toBe(true);
    expect(isThinPreview(projects)).toBe(true);
    expect(hasCareerEntries(projects)).toBe(false);
    expect(profileToCVDocument(projects).sections.map((section) => section.title)).toEqual(["PROYECTOS"]);

    const certifications = emptyStoredProfile();
    addCertification(certifications, { name: "Curso de Excel", issuer: "Instituto" });
    expect(isPreviewReady(certifications)).toBe(true);
    expect(hasCareerEntries(certifications)).toBe(false);
  });

  it("knows a career from the rest: a job or a study", () => {
    expect(hasCareerEntries(emptyStoredProfile())).toBe(false);
    expect(hasCareerEntries(fromCv())).toBe(true);
    const study = emptyStoredProfile();
    addEntry(study, { ...blankForm("study"), what: "Secundario" }, { newId, now: NOW });
    expect(hasCareerEntries(study)).toBe(true);
  });

  it("is one entry, from wherever it came: every screen asks the same question", () => {
    const stored = emptyStoredProfile();
    expect(isPreviewReady(stored)).toBe(false);
    addEntry(stored, { ...blankForm("job"), what: "Cajero" }, { newId, now: NOW });
    expect(isPreviewReady(stored)).toBe(true);
    // How it was started no longer changes it: someone building by hand used to need two, and the review showed a CV
    // that the next screen then called "too little".
    stored.onboarding.route = "scratch";
    expect(isPreviewReady(stored)).toBe(true);
  });

  it("calls a CV of a single entry thin: shown, and said to be a start", () => {
    const stored = emptyStoredProfile();
    expect(isThinPreview(stored)).toBe(false);
    addEntry(stored, { ...blankForm("job"), what: "Cajero" }, { newId, now: NOW });
    expect(isThinPreview(stored)).toBe(true);
    addEntry(stored, { ...blankForm("study"), what: "Secundario" }, { newId, now: NOW });
    expect(isThinPreview(stored)).toBe(false);
  });
});

describe("what the base CV had no room for", () => {
  const job = (stored: StoredProfile, i: number) =>
    addEntry(stored, { ...blankForm("job"), what: `Puesto ${i}`, where: `Empresa ${i}`, from: { year: 2000 + i }, to: { year: 2001 + i } }, { newId, now: NOW });
  const pairsOf = (doc: ReturnType<typeof profileToCVDocument>) => doc.sections.find((section) => section.kind === "pairs");

  it("says nothing when everything fits", () => {
    const { document, omissions } = baseCv(fromCv());
    expect(omissions).toEqual([]);
    expect(document.coverage.omitted).toEqual([]);
  });

  it("is the same CV profileToCVDocument gives, and one the rest of the app accepts", () => {
    const stored = emptyStoredProfile();
    for (let i = 0; i < 12; i++) job(stored, i);
    expect(baseCv(stored).document).toEqual(profileToCVDocument(stored));
    expect(cvDocumentSchema.safeParse(profileToCVDocument(stored)).success).toBe(true);
  });

  it("names the older jobs and studies there was no room for, and keeps the newest", () => {
    const stored = emptyStoredProfile();
    for (let i = 0; i < 12; i++) job(stored, i);
    for (let i = 0; i < 10; i++) addEntry(stored, { ...blankForm("study"), what: `Carrera ${i}`, where: `Instituto ${i}`, from: { year: 1990 + i }, to: { year: 1991 + i } }, { newId, now: NOW });
    const { document, omissions } = baseCv(stored);
    const experience = document.sections.find((section) => section.kind === "experience");
    expect(experience?.kind === "experience" && experience.items).toHaveLength(10);
    expect(experience?.kind === "experience" && experience.items[0]!.company).toBe("Empresa 11");
    expect(omissions).toEqual([
      { item: "2 puestos más antiguos", reason: "El CV base muestra los 10 más recientes.", section: "experience" },
      { item: "2 estudios más antiguos", reason: "El CV base muestra los 8 más recientes.", section: "education" },
    ]);
    // In the schema's own words for it, without the part of the profile it is in.
    expect(document.coverage.omitted).toEqual(omissions.map(({ item, reason }) => ({ item, reason })));
  });

  it("counts the tasks past eight in a job and the ones cut short", () => {
    const stored = fromCv();
    stored.experience[0]!.facts = Array.from({ length: 12 }, (_, i) => ({ id: `f${i}`, kind: "responsibility" as const, text: "x".repeat(550), source: { kind: "manual" as const, at: NOW }, status: "confirmed" as const }));
    const { omissions } = baseCv(stored);
    expect(omissions).toContainEqual({ item: "4 tareas", reason: "El CV base muestra hasta 8 por puesto.", section: "experience" });
    expect(omissions).toContainEqual({ item: "8 tareas acortadas", reason: "Cada tarea muestra hasta 400 caracteres.", section: "experience" });
  });

  it("stops the skills line at a skill and not in the middle of one, and counts the rest", () => {
    const stored = emptyStoredProfile();
    job(stored, 1);
    for (let i = 1; i <= 30; i++) addSkill(stored, `Habilidad ${i}`);
    const { document, omissions } = baseCv(stored);
    const value = pairsOf(document)?.kind === "pairs" ? (pairsOf(document) as { items: Array<{ value: string }> }).items[0]!.value : "";
    const shown = value.split(", ");
    expect(value.length).toBeLessThanOrEqual(160);
    expect(value).not.toContain("…");
    expect(shown.at(-1)).toMatch(/^Habilidad \d+$/);
    expect(shown.length).toBeGreaterThan(5);
    expect(omissions).toContainEqual({ item: `${30 - shown.length} habilidades`, reason: "La línea de habilidades muestra hasta 160 caracteres.", section: "skills" });
  });

  const withLines = (stored: StoredProfile) => {
    addSkill(stored, "Excel");
    for (let i = 1; i <= 3; i++) addLanguage(stored, `Idioma ${i}`, "B2");
    for (let i = 1; i <= 4; i++) addCertification(stored, { name: `Certificación ${i}`, issuer: "Instituto" });
  };

  /** A project with the link the person gave, set the way the profile holds it. */
  const project = (stored: StoredProfile, name: string, description: string, url = "") => {
    const id = addEntry(stored, { ...blankForm("project"), what: name, where: description }, { newId, now: NOW });
    const entry = stored.projects.find((candidate) => candidate.id === id)!;
    if (url) entry.url = { ...entry.url, value: url };
    return entry;
  };

  it("fits eight short lines for skills, languages and certifications, and the projects are not among them", () => {
    const stored = emptyStoredProfile();
    job(stored, 1);
    withLines(stored);
    for (let i = 1; i <= 3; i++) project(stored, `Proyecto ${i}`, "Trabajo final");
    const { document, omissions } = baseCv(stored);
    const pairs = pairsOf(document);
    expect(pairs?.kind === "pairs" && pairs.items).toHaveLength(8);
    expect(pairs?.title).toBe("HABILIDADES · IDIOMAS · CERTIFICACIONES");
    // Three projects used to take three of the eight; now they do not compete for a place.
    expect(omissions).toEqual([]);
  });

  it("…and says what the eight had no room for: a project is never the one that goes", () => {
    const stored = emptyStoredProfile();
    withLines(stored);
    addCertification(stored, { name: "Certificación 5", issuer: "Instituto" });
    project(stored, "Proyecto 1", "Trabajo final");
    const { document, omissions } = baseCv(stored);
    const pairs = pairsOf(document);
    expect(pairs?.kind === "pairs" && pairs.items.map((item) => item.label)).toEqual(["Habilidades", "Idioma 1", "Idioma 2", "Idioma 3", "Certificación 1", "Certificación 2", "Certificación 3", "Certificación 4"]);
    expect(omissions).toEqual([{ item: "1 certificación", reason: "Entre habilidades, idiomas y certificaciones entran 8 líneas.", section: "other" }]);
    expect(document.sections.some((section) => section.kind === "projects")).toBe(true);
  });

  it("gives the projects a section of their own, ahead of the labelled facts, with the profile's id and link", () => {
    const stored = emptyStoredProfile();
    job(stored, 1);
    addSkill(stored, "Excel");
    const turnos = project(stored, "Sistema de turnos", "Agenda para una clínica.", "github.com/perfil-ejemplo/turnos");
    const { document } = baseCv(stored);
    expect(document.sections.map((section) => section.kind)).toEqual(["experience", "projects", "pairs"]);
    const section = document.sections.find((candidate) => candidate.kind === "projects");
    expect(section).toMatchObject({ title: "PROYECTOS" });
    // The link keeps its scheme, which is what makes it a link anywhere it is used as an href.
    expect(section?.kind === "projects" && section.items).toEqual([{ ref: turnos.id, name: "Sistema de turnos", description: "Agenda para una clínica.", url: "https://github.com/perfil-ejemplo/turnos" }]);
    expect(cvDocumentSchema.safeParse(document).success).toBe(true);
  });

  it("shows a project with a link and no description as its name and link, and writes nothing to fill it", () => {
    const stored = emptyStoredProfile();
    project(stored, "Sitio de la cooperativa", "", "https://coop.example.com");
    project(stored, "Solo el nombre", "");
    const { document, omissions } = baseCv(stored);
    const section = document.sections[0];
    expect(section?.kind === "projects" && section.items.map(({ name, description, url }) => [name, description, url])).toEqual([
      ["Sitio de la cooperativa", "", "https://coop.example.com"],
      ["Solo el nombre", "", ""],
    ]);
    expect(omissions).toEqual([]);
    const html = renderToStaticMarkup(createElement(CVDocument, { data: document }));
    expect(html).toContain('<a href="https://coop.example.com">coop.example.com</a>');
  });

  it("shows up to four projects and says how many it left out", () => {
    const stored = emptyStoredProfile();
    for (let i = 1; i <= 6; i++) project(stored, `Proyecto ${i}`, "x");
    const { document, omissions } = baseCv(stored);
    const section = document.sections[0];
    expect(section?.kind === "projects" && section.items.map((item) => item.name)).toEqual(["Proyecto 1", "Proyecto 2", "Proyecto 3", "Proyecto 4"]);
    expect(omissions).toEqual([{ item: "2 proyectos", reason: "La sección de proyectos muestra hasta 4.", section: "projects" }]);
  });

  it("counts the project descriptions it cut short", () => {
    const stored = emptyStoredProfile();
    project(stored, "Sistema de turnos", "x".repeat(310));
    const { document, omissions } = baseCv(stored);
    expect(omissions).toEqual([{ item: "1 descripción de proyecto acortada", reason: "Cada una muestra hasta 300 caracteres.", section: "projects" }]);
    const section = document.sections[0];
    expect(section?.kind === "projects" && section.items[0]!.description).toHaveLength(300);
  });
});

describe("activities", () => {
  const withExtras = (extras: string[]) => {
    const stored = emptyStoredProfile();
    addEntry(stored, { ...blankForm("project"), what: "Sistema de turnos", where: "Trabajo final" }, { newId, now: NOW });
    stored.legacy.extras = { value: extras, status: "confirmed", source: { kind: "manual", at: NOW } };
    return stored;
  };
  const activitiesOf = (stored: ReturnType<typeof withExtras>) => {
    const { document, omissions } = baseCv(stored);
    return { sections: document.sections.map((section) => section.kind), items: document.sections.flatMap((s) => (s.kind === "activities" ? s.items : [])), omissions };
  };

  it("prints what the profile keeps under «otros datos» in a section of its own, after the projects and before the labelled facts", () => {
    const found = activitiesOf(withExtras(["Presido el Club de Robótica.", "  ", "Doy clases de apoyo."]));
    expect(found.sections).toEqual(["projects", "activities"]);
    expect(found.items).toEqual([{ ref: "O1", text: "Presido el Club de Robótica." }, { ref: "O3", text: "Doy clases de apoyo." }]);
    expect(found.omissions).toEqual([]);
  });

  it("prints no section for a profile with nothing there", () => {
    expect(activitiesOf(withExtras(["", "  "])).sections).toEqual(["projects"]);
  });

  it("is what the page shows, as a list under the section's heading", () => {
    const markup = renderToStaticMarkup(createElement(CVDocument, { data: baseCv(withExtras(["Presido el Club de Robótica."])).document })).replace(/<!-- -->/g, "");
    expect(markup).toContain("ACTIVIDADES");
    expect(markup).toContain("<li>Presido el Club de Robótica.</li>");
    expect(markup).not.toContain("O1");
  });

  it("says what the section had no room for: more than four, and a line cut at the limit", () => {
    const found = activitiesOf(withExtras(["Uno.", "Dos.", "Tres.", "Cuatro.", "Cinco.", "x".repeat(400)]));
    expect(found.items).toHaveLength(4);
    expect(found.omissions.map((o) => o.item)).toEqual(["2 actividades"]);

    const cut = activitiesOf(withExtras(["x".repeat(400)]));
    expect(cut.items[0]!.text).toHaveLength(300);
    expect(cut.omissions.map((o) => o.item)).toEqual(["1 actividad acortada"]);
  });
});
