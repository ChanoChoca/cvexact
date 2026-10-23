import { describe, expect, it } from "vitest";
import { composeFromProfile, withinProfileBullets, withProfileActivities, withProfileHistory, withProfileProjects } from "@/lib/ai/profile-sources";
import { cvDocumentSchema, type CVDocument } from "@/lib/schemas/cv";
import { profileSchema } from "@/lib/schemas/profile";
import { backendProfile } from "./fixtures";

/**
 * The model chooses which of the person's projects go on the CV and how many bullets a job gets; the profile decides
 * everything that is printed about a project and the most a job may carry. These pin both against a model that
 * answers wrongly — the instructions in the prompt are what a quota beat the last time.
 */

const profile = profileSchema.parse({
  ...backendProfile,
  projects: [
    { id: "p1", name: "Turnero", description: "Agenda de turnos para una clínica, hecha con Next.js.", url: "turnero.app", tags: [] },
    { id: "p2", name: "Blog", description: "", url: "https://blog.example.com/", tags: [] },
    { id: "p3", name: "Solo nombre", description: "", url: "", tags: [] },
    { id: "p4", name: "Gastos", description: "Registro de gastos personales.", url: "", tags: [] },
    { id: "p5", name: "Gastos", description: "Otro proyecto con el mismo nombre.", url: "", tags: [] },
  ],
});

function cvWith(projects: Array<Record<string, string>>): CVDocument {
  return cvDocumentSchema.parse({
    language: "es",
    header: { fullName: "Ana", location: "Junín, Argentina" },
    summary: "Resumen.",
    sections: [
      { kind: "experience", title: "EXPERIENCIA", items: [{ company: "Flash Page", role: "Software Engineer", location: "", dateRange: "2024", bullets: ["Uno.", "Dos."] }] },
      { kind: "projects", title: "PROYECTOS", items: projects },
    ],
    coverage: { requirements: [], omitted: [] },
  });
}

const projectsOf = (cv: CVDocument) => cv.sections.flatMap((s) => (s.kind === "projects" ? s.items : []));

describe("withProfileProjects", () => {
  it("finds the project by its label and prints the profile's name, description and link", () => {
    const fixed = withProfileProjects(cvWith([{ ref: "P1", name: "turnero", description: "", url: "" }]), profile);
    expect(projectsOf(fixed)).toEqual([
      { ref: "P1", name: "Turnero", description: "Agenda de turnos para una clínica, hecha con Next.js.", url: "https://turnero.app" },
    ]);
  });

  it("reads the label however the model wrote it", () => {
    expect(projectsOf(withProfileProjects(cvWith([{ ref: " [p1] ", name: "x" }]), profile))[0]!.name).toBe("Turnero");
  });

  it("never lets through what the model wrote: not its description, not its link", () => {
    const fixed = withProfileProjects(
      cvWith([{ ref: "P1", name: "Turnero", description: "Lideré el desarrollo de todo el sistema.", url: "https://evil.example.com" }]),
      profile,
    );
    const [item] = projectsOf(fixed);
    expect(item!.description).toBe("Agenda de turnos para una clínica, hecha con Next.js.");
    expect(item!.url).toBe("https://turnero.app");
  });

  it("falls back to the name when there is no label, if the name is the profile's alone", () => {
    const fixed = withProfileProjects(cvWith([{ name: "TURNERO" }]), profile);
    expect(projectsOf(fixed).map((p) => p.ref)).toEqual(["P1"]);
  });

  it("says in the report when a description was cut to fit the CV, first so the schema's ten never drop it", () => {
    const long = profileSchema.parse({ ...backendProfile, projects: [{ id: "p1", name: "Turnero", description: "Agenda. ".repeat(60), url: "", tags: [] }] });
    const base = cvWith([{ ref: "P1", name: "Turnero" }]);
    const fixed = withProfileProjects({ ...base, coverage: { requirements: [], omitted: [{ item: "Otra", reason: "Poco espacio." }] } }, long);

    expect(projectsOf(fixed)[0]!.description.endsWith("…")).toBe(true);
    expect(fixed.coverage.omitted).toEqual([
      { item: "1 descripción de proyecto acortada", reason: "Cada una muestra hasta 300 caracteres." },
      { item: "Otra", reason: "Poco espacio." },
    ]);
    expect(withProfileProjects(cvWith([{ ref: "P1", name: "x" }]), profile).coverage.omitted).toEqual([]);
  });

  it("takes out a name that two projects of the profile share", () => {
    const fixed = withProfileProjects(cvWith([{ name: "Gastos" }]), profile);
    expect(fixed.sections.map((s) => s.kind)).toEqual(["experience"]);
  });

  it("takes out a project that is not in the profile, however it is labelled", () => {
    const fixed = withProfileProjects(
      cvWith([
        { ref: "P9", name: "Sistema de pagos" },
        { ref: "", name: "Inventado" },
        { ref: "P1", name: "Turnero" },
      ]),
      profile,
    );
    expect(projectsOf(fixed).map((p) => p.name)).toEqual(["Turnero"]);
  });

  it("takes out a project placed twice", () => {
    const fixed = withProfileProjects(cvWith([{ ref: "P1", name: "Turnero" }, { ref: "P1", name: "Otro nombre" }, { name: "Turnero" }]), profile);
    expect(projectsOf(fixed)).toHaveLength(1);
  });

  it("drops the section when nothing in it can be tied to the profile", () => {
    const fixed = withProfileProjects(cvWith([{ ref: "P7", name: "Nada" }]), profile);
    expect(fixed.sections.map((s) => s.kind)).toEqual(["experience"]);
  });

  it("shows a project with a link and no description by its name and link, writing nothing in between", () => {
    const [item] = projectsOf(withProfileProjects(cvWith([{ ref: "P2", name: "Blog", description: "Un blog sobre cocina." }]), profile));
    expect(item).toEqual({ ref: "P2", name: "Blog", description: "", url: "https://blog.example.com/" });
  });

  it("does not take a project that is only a name", () => {
    const fixed = withProfileProjects(cvWith([{ ref: "P3", name: "Solo nombre" }]), profile);
    expect(fixed.sections.map((s) => s.kind)).toEqual(["experience"]);
  });

  it("cuts a description past the section's limit, as the base CV does", () => {
    const long = profileSchema.parse({ ...backendProfile, projects: [{ id: "p", name: "Largo", description: "palabra ".repeat(80), url: "" }] });
    const [item] = projectsOf(withProfileProjects(cvWith([{ ref: "P1", name: "Largo" }]), long));
    expect(item!.description.length).toBeLessThanOrEqual(300);
    expect(item!.description.endsWith("…")).toBe(true);
  });

  it("leaves a CV with no projects section as it is", () => {
    const cv = cvDocumentSchema.parse({
      language: "es",
      header: { fullName: "Ana", location: "Junín, Argentina" },
      summary: "Resumen.",
      sections: [{ kind: "education", title: "EDUCACIÓN", items: [{ institution: "UNNOBA", degree: "Analista", location: "", date: "2025" }] }],
      coverage: { requirements: [], omitted: [] },
    });
    expect(withProfileProjects(cv, profile)).toBe(cv);
  });
});

describe("withinProfileBullets", () => {
  const twoTasks = profileSchema.parse({
    ...backendProfile,
    experience: [{ ...backendProfile.experience[0]!, bullets: ["Hice A.", "Hice B.", "hice a."], tags: [] }, { id: "e2", company: "Acme", role: "Dev", bullets: ["Hice C."], tags: [] }],
  });

  const experience = (items: Array<{ company: string; bullets: string[] }>) =>
    cvDocumentSchema.parse({
      language: "es",
      header: { fullName: "Ana", location: "Junín, Argentina" },
      summary: "Resumen.",
      sections: [{ kind: "experience", title: "EXPERIENCIA", items: items.map((i) => ({ role: "Dev", location: "", dateRange: "2024", ...i })) }],
      coverage: { requirements: [], omitted: [] },
    });

  const bulletsOf = (cv: CVDocument) => cv.sections.flatMap((s) => (s.kind === "experience" ? s.items.map((i) => i.bullets) : []));

  it("cuts a job the model padded to a quota down to what the profile gives it", () => {
    const padded = experience([
      { company: "Flash Page", bullets: ["1.", "2.", "3.", "4.", "5.", "6.", "7."] },
      { company: "Acme", bullets: ["1.", "2.", "3."] },
    ]);
    // Two different tasks at Flash Page (the third repeats the first), one at Acme.
    expect(bulletsOf(withinProfileBullets(padded, twoTasks))).toEqual([["1.", "2."], ["1."]]);
  });

  it("keeps the first bullets, which the model writes in order of relevance", () => {
    const [bullets] = bulletsOf(withinProfileBullets(experience([{ company: "Flash Page", bullets: ["Primera.", "Segunda.", "Tercera."] }]), twoTasks));
    expect(bullets).toEqual(["Primera.", "Segunda."]);
  });

  it("leaves a job that is within the count, and a CV that needs no cut, as they are", () => {
    const fine = experience([{ company: "Flash Page", bullets: ["1."] }, { company: "Acme", bullets: ["1."] }]);
    expect(withinProfileBullets(fine, twoTasks)).toBe(fine);
  });

  it("matches the employer as the verifier does, shortened or expanded", () => {
    const padded = experience([{ company: "Flash Page S.A.", bullets: ["1.", "2.", "3.", "4."] }]);
    expect(bulletsOf(withinProfileBullets(padded, twoTasks))).toEqual([["1.", "2."]]);
  });

  it("does not cut a job the profile does not have: that is an error to report, not a count to apply", () => {
    const stranger = experience([{ company: "Google", bullets: ["1.", "2.", "3.", "4."] }]);
    expect(withinProfileBullets(stranger, twoTasks)).toBe(stranger);
  });

  it("does not match an employer the model left blank to every job", () => {
    const blank = experience([{ company: "", bullets: ["1.", "2.", "3.", "4."] }]);
    expect(withinProfileBullets(blank, twoTasks)).toBe(blank);
  });

  it("leaves a role with no tasks as a header, never as invented ones", () => {
    const headerOnly = profileSchema.parse({ ...backendProfile, experience: [{ ...backendProfile.experience[0]!, bullets: [], tags: [] }] });
    expect(bulletsOf(withinProfileBullets(experience([{ company: "Flash Page", bullets: ["1.", "2."] }]), headerOnly))).toEqual([[]]);
  });

  it("gives two roles at one employer their sum, looser than each but never a wrong cut", () => {
    const both = profileSchema.parse({
      ...backendProfile,
      experience: [
        { id: "a", company: "Acme", role: "Junior", bullets: ["A.", "B."], tags: [] },
        { id: "b", company: "Acme", role: "Senior", bullets: ["C.", "D.", "E."], tags: [] },
      ],
    });
    expect(bulletsOf(withinProfileBullets(experience([{ company: "Acme", bullets: ["1.", "2.", "3.", "4.", "5.", "6."] }]), both))).toEqual([["1.", "2.", "3.", "4.", "5."]]);
  });
});

describe("withinProfileBullets — which bullets stay (VAL-12)", () => {
  const dana = profileSchema.parse({
    ...backendProfile,
    experience: [
      { id: "a", company: "Pagaluz SA", role: "Desarrollador Mobile", bullets: ["Armé el pipeline de builds con Fastlane.", "Redujimos el arranque de la app de 6 a 3 segundos."], tags: [] },
      { id: "f", company: "", role: "Desarrollador Freelance", bullets: ["Hice sitios web para comercios.", "Mantuve las tiendas online de dos clientes."], tags: [] },
    ],
  });
  const invented = ["Escribí tests automatizados con Jest para sostener la estabilidad.", "Lideré un equipo de cinco personas.", "Migré la base de datos a la nube."];
  const reworded = ["Automaticé el pipeline de builds con Fastlane para publicar más rápido.", "Reduje el arranque de la app de 6 a 3 segundos."];

  const cvOf = (company: string, role: string, bullets: string[]) =>
    cvDocumentSchema.parse({
      language: "es",
      header: { fullName: "Dana", location: "" },
      summary: "Resumen.",
      sections: [{ kind: "experience", title: "EXPERIENCIA", items: [{ company, role, location: "", dateRange: "2022", bullets }] }],
      coverage: { requirements: [], omitted: [] },
    });
  const keptOf = (cv: CVDocument) => cv.sections.flatMap((s) => (s.kind === "experience" ? s.items.flatMap((i) => i.bullets) : []));

  it("M21b · keeps the tasks the profile has, not the first ones, when the invented ones were put first", () => {
    const cut = withinProfileBullets(cvOf("Pagaluz SA", "Desarrollador Mobile", [...invented, ...reworded]), dana);
    expect(keptOf(cut)).toEqual(reworded);
  });

  it("keeps what stays in the order the model wrote it", () => {
    const cut = withinProfileBullets(cvOf("Pagaluz SA", "Desarrollador Mobile", [reworded[1]!, invented[0]!, reworded[0]!]), dana);
    expect(keptOf(cut)).toEqual([reworded[1], reworded[0]]);
  });

  it("M23 · a freelance with no employer is capped by its title, as the profile's one role without one", () => {
    const freelance = ["Armé sitios web para comercios de mi zona.", "Mantuve las tiendas online de dos clientes."];
    for (const company of ["", "Freelance"]) {
      expect(keptOf(withinProfileBullets(cvOf(company, "Desarrollador Freelance", [...invented, ...freelance]), dana))).toEqual(freelance);
    }
  });

  it("does not take a job with another employer and another title for the freelance", () => {
    const other = cvOf("Google", "Ingeniero", [...invented, ...reworded]);
    expect(withinProfileBullets(other, dana)).toBe(other);
  });
});

describe("withProfileHistory", () => {
  const history = profileSchema.parse({
    ...backendProfile,
    experience: [
      { id: "a", company: "Pagaluz SA", role: "Desarrollador Mobile", city: "Buenos Aires", country: "Argentina", start: "Octubre 2022", end: "Diciembre 2022", bullets: ["Hice A."], tags: [] },
      { id: "b", company: "Nubesur Estudio", role: "Desarrollador React Native", start: "Marzo 2023", end: "", current: true, bullets: ["Hice B."], tags: [] },
      { id: "c", company: "", role: "Desarrollador Freelance", start: "2020", end: "2021", bullets: ["Hice C."], tags: [] },
    ],
    education: [{ id: "u", institution: "Universidad Tecnológica del Sur", degree: "Licenciatura en Sistemas", city: "Bahía Blanca", country: "Argentina", start: "2022", end: "2027", status: "in_progress" }],
    projects: [{ id: "p1", name: "Turnero", description: "Agenda de turnos.", url: "", tags: [] }],
  });

  const job = (company: string, role: string, dateRange: string, bullets = ["x."]) => ({ company, role, location: "", dateRange, bullets });
  const cvOf = (sections: unknown[], language = "es") =>
    cvDocumentSchema.parse({ language, header: { fullName: "Ana", location: "Junín, Argentina" }, summary: "Resumen.", sections, coverage: { requirements: [], omitted: [] } });
  const experience = (items: ReturnType<typeof job>[], language?: string) => cvOf([{ kind: "experience", title: "EXPERIENCIA", items }], language);

  const jobsOf = (cv: CVDocument) => cv.sections.flatMap((s) => (s.kind === "experience" ? s.items : []));
  const studiesOf = (cv: CVDocument) => cv.sections.flatMap((s) => (s.kind === "education" ? s.items : []));
  const run = (cv: CVDocument, relevance: "direct" | "unrelated" = "direct") => withProfileHistory(cv, history, relevance);

  it("prints the dates the profile has, month by month, not the ones the model stretched (M3)", () => {
    const { cv } = run(experience([job("Pagaluz SA", "Desarrollador Mobile", "Octubre 2022 – Junio 2023")]));
    expect(jobsOf(cv)[0]!.dateRange).toBe("Octubre 2022 – Diciembre 2022");
  });

  it("prints a job that is still going as current, in the CV's language", () => {
    expect(jobsOf(run(experience([job("Nubesur Estudio", "Desarrollador React Native", "2023 – 2024")])).cv)[0]!.dateRange).toBe("Marzo 2023 – Actualidad");
    expect(jobsOf(run(experience([job("Nubesur Estudio", "React Native Developer", "2023")], "en")).cv)[0]!.dateRange).toBe("March 2023 – Present");
  });

  it("does not invent a month for a date that has only a year", () => {
    expect(jobsOf(run(experience([job("", "Desarrollador Freelance", "Enero 2020 – Mayo 2021")])).cv)[0]!.dateRange).toBe("2020 – 2021");
  });

  it("prints the profile's employer, place and title: a title that grew goes back (M9)", () => {
    const [item] = jobsOf(run(experience([job("Pagaluz", "Desarrollador Mobile Senior", "2022", ["Uno.", "Dos."])])).cv);
    expect(item).toMatchObject({ company: "Pagaluz SA", role: "Desarrollador Mobile", location: "Buenos Aires, Argentina", bullets: ["Uno.", "Dos."] });
  });

  it("takes the model's title when it is the profile's in the CV's language, and warns when it cannot tell", () => {
    const same = run(experience([job("Pagaluz SA", "Mobile Developer", "2022")], "en"));
    expect(jobsOf(same.cv)[0]!.role).toBe("Mobile Developer");
    expect(same.findings).toEqual([]);

    const grown = run(experience([job("Pagaluz SA", "Senior Mobile Developer", "2022")], "en"));
    expect(jobsOf(grown.cv)[0]!.role).toBe("Desarrollador Mobile");
    expect(grown.findings.map((f) => f.detail)).toEqual([expect.stringContaining("No pudimos traducir tu cargo «Desarrollador Mobile»")]);
  });

  it("takes out a project passed off as a job, and says so (M11)", () => {
    const { cv, findings } = run(experience([job("Pagaluz SA", "Desarrollador Mobile", "2022"), job("Turnero", "Desarrollador", "2024")]));
    expect(jobsOf(cv).map((item) => item.company)).toEqual(["Pagaluz SA"]);
    expect(findings).toEqual([{ severity: "warning", field: "sections[0].items[1]", detail: "«Turnero» es un proyecto, no un puesto: se quitó de la experiencia." }]);
  });

  it("takes out an employer the profile does not have, and the section if it was the only one", () => {
    const { cv, findings } = run(experience([job("Google", "Ingeniero", "2021 – 2024")]));
    expect(cv.sections.some((s) => s.kind === "experience")).toBe(false);
    expect(findings[0]!.detail).toBe("Se quitó «Google» de la experiencia: no está en tu perfil.");
  });

  it("does not take a renamed employer for the freelance that happens to share a word of its title (M15)", () => {
    const { cv, findings } = run(experience([job("Pagaluz Fintech", "Desarrollador Mobile", "2022")]));
    expect(cv.sections.some((s) => s.kind === "experience")).toBe(false);
    expect(findings[0]!.detail).toBe("Se quitó «Pagaluz Fintech» de la experiencia: no está en tu perfil.");
  });

  it("places a freelance with no employer by its title, and keeps what the model wrote for the employer", () => {
    const [item] = jobsOf(run(experience([job("Freelance", "Desarrollador freelance", "2019 – 2023")])).cv);
    expect(item).toMatchObject({ company: "Freelance", role: "Desarrollador Freelance", dateRange: "2020 – 2021" });
  });

  it("adds a job the model wrote twice to the first, once", () => {
    const { cv } = run(experience([job("Pagaluz SA", "Desarrollador Mobile", "2022", ["Uno.", "Dos."]), job("Pagaluz SA", "Desarrollador Mobile", "2022", ["Dos.", "Tres."])]));
    expect(jobsOf(cv)).toHaveLength(1);
    expect(jobsOf(cv)[0]!.bullets).toEqual(["Uno.", "Dos.", "Tres."]);
  });

  it("tells two roles at one employer apart by their title", () => {
    const two = profileSchema.parse({
      ...backendProfile,
      experience: [
        { id: "a", company: "Acme", role: "Analista de Datos", start: "2019", end: "2021", bullets: ["A."], tags: [] },
        { id: "b", company: "Acme", role: "Ingeniero de Software", start: "2021", end: "2024", bullets: ["B."], tags: [] },
      ],
    });
    const { cv } = withProfileHistory(experience([job("Acme", "Software Engineer", "2022"), job("Acme", "Data Analyst", "2020")]), two, "direct");
    expect(jobsOf(cv).map((item) => item.dateRange)).toEqual(["2021 – 2024", "2019 – 2021"]);
  });

  it("shows a study that is still going as going (M18)", () => {
    const cv = cvOf([{ kind: "education", title: "EDUCACIÓN", items: [{ institution: "Universidad Tecnológica del Sur", degree: "Licenciado en Sistemas", location: "", date: "2027", honors: "Promedio 9" }] }]);
    expect(studiesOf(run(cv).cv)[0]).toEqual({
      institution: "Universidad Tecnológica del Sur",
      degree: "Licenciatura en Sistemas",
      location: "Bahía Blanca, Argentina",
      date: "2022 – 2027 (en curso)",
      honors: "Promedio 9",
    });
  });

  it("puts the profile's studies in when the model left them out, instead of asking again", () => {
    const { cv } = run(experience([job("Pagaluz SA", "Desarrollador Mobile", "2022")]));
    expect(cv.sections.map((s) => s.kind)).toEqual(["experience", "education"]);
    expect(studiesOf(cv)[0]).toMatchObject({ degree: "Licenciatura en Sistemas", date: "2022 – 2027 (en curso)" });
    expect(cv.sections[1]!.title).toBe("EDUCACIÓN");
  });

  it("puts them in when every study the model wrote was one the profile does not have", () => {
    const cv = cvOf([{ kind: "education", title: "EDUCACIÓN", items: [{ institution: "MIT", degree: "PhD", location: "", date: "2020", honors: "" }] }]);
    expect(studiesOf(run(cv).cv).map((s) => s.institution)).toEqual(["Universidad Tecnológica del Sur"]);
  });

  it("leaves the studies out outside the candidate's field, as cvGaps does", () => {
    const { cv } = run(experience([job("Pagaluz SA", "Desarrollador Mobile", "2022")]), "unrelated");
    expect(cv.sections.map((s) => s.kind)).toEqual(["experience"]);
  });

  it("writes nothing for studies a profile does not have", () => {
    const bare = profileSchema.parse({ ...backendProfile, education: [] });
    expect(withProfileHistory(experience([job("Flash Page", "Software Engineer", "2024")]), bare, "direct").cv.sections.map((s) => s.kind)).toEqual(["experience"]);
  });

  it("keeps the model's dates in a language it does not write them in", () => {
    const [item] = jobsOf(run(experience([job("Pagaluz SA", "Desarrollador Mobile", "octobre 2022 – décembre 2022")], "fr")).cv);
    expect(item!.dateRange).toBe("octobre 2022 – décembre 2022");
    expect(item!.company).toBe("Pagaluz SA");
  });

  it("composes with the cap, so the ceiling sees the employer as the profile spells it", () => {
    const generated = experience([job("Pagaluz", "Desarrollador Mobile", "2022", ["1.", "2.", "3."])]);
    const analysis = { relevance: "direct" } as Parameters<typeof composeFromProfile>[2];
    expect(jobsOf(composeFromProfile(generated, history, analysis).cv)[0]!.bullets).toEqual(["1."]);
  });
});

describe("withProfileActivities", () => {
  const club = "Presido el Club de Robótica de la facultad desde 2024.";
  const classes = "Doy clases de apoyo a chicos del barrio.";
  const activist = profileSchema.parse({ ...backendProfile, extras: [club, classes, "Juego al fútbol los fines de semana.", "  "] });

  const cvOf = (activities: Array<Record<string, string>>) =>
    cvDocumentSchema.parse({
      language: "es",
      header: { fullName: "Ana", location: "Junín, Argentina" },
      summary: "Resumen.",
      sections: [
        { kind: "experience", title: "EXPERIENCIA", items: [{ company: "Flash Page", role: "Software Engineer", location: "", dateRange: "2024", bullets: ["Uno.", "Dos."] }] },
        { kind: "activities", title: "ACTIVIDADES", items: activities },
      ],
      coverage: { requirements: [], omitted: [] },
    });
  const activitiesOf = (cv: CVDocument) => cv.sections.flatMap((s) => (s.kind === "activities" ? s.items : []));

  it("finds the activity by its label and prints the profile's words, not the model's", () => {
    const fixed = withProfileActivities(cvOf([{ ref: "O1", text: "Lideré un club de robótica con 500 socios." }]), activist);
    expect(activitiesOf(fixed)).toEqual([{ ref: "O1", text: club }]);
  });

  it("reads the label however the model wrote it", () => {
    expect(activitiesOf(withProfileActivities(cvOf([{ ref: " [o2] ", text: "" }]), activist))[0]!.text).toBe(classes);
  });

  it("falls back to the text when there is no label, if it is the profile's line alone", () => {
    expect(activitiesOf(withProfileActivities(cvOf([{ ref: "", text: "  presido el club de robótica de la facultad desde 2024 " }]), activist))).toEqual([{ ref: "O1", text: club }]);
  });

  it("takes out an activity that is not in the profile, however it is labelled", () => {
    const fixed = withProfileActivities(cvOf([{ ref: "O9", text: "Voluntaria en Cruz Roja." }, { ref: "", text: "Capitana del equipo nacional." }, { ref: "O2", text: "" }]), activist);
    expect(activitiesOf(fixed)).toEqual([{ ref: "O2", text: classes }]);
  });

  it("does not take a blank line of the profile for an activity", () => {
    expect(withProfileActivities(cvOf([{ ref: "O4", text: "" }]), activist).sections.map((s) => s.kind)).toEqual(["experience"]);
  });

  it("takes out an activity placed twice", () => {
    expect(activitiesOf(withProfileActivities(cvOf([{ ref: "O1", text: "" }, { ref: "", text: club }]), activist))).toHaveLength(1);
  });

  it("drops the section when nothing in it can be tied to the profile", () => {
    expect(withProfileActivities(cvOf([{ ref: "O7", text: "Inventada." }]), activist).sections.map((s) => s.kind)).toEqual(["experience"]);
    expect(withProfileActivities(cvOf([{ ref: "O1", text: "" }]), profileSchema.parse({ ...backendProfile, extras: [] })).sections.map((s) => s.kind)).toEqual(["experience"]);
  });

  it("cuts a line past the section's limit, as a project's description is", () => {
    const long = `Organizo ${"una jornada de programación para chicos de escuela ".repeat(10)}`.trim();
    const [item] = activitiesOf(withProfileActivities(cvOf([{ ref: "O1", text: "" }]), profileSchema.parse({ ...backendProfile, extras: [long] })));
    expect(item!.text).toHaveLength(300);
    expect(item!.text.endsWith("…")).toBe(true);
  });

  it("leaves a CV with no activities section as it is", () => {
    const bare = cvDocumentSchema.parse({ language: "es", header: { fullName: "Ana", location: "" }, summary: "R.", sections: [{ kind: "bullets", title: "X", bullets: ["Uno.", "Dos."] }], coverage: { requirements: [], omitted: [] } });
    expect(withProfileActivities(bare, activist)).toBe(bare);
  });

  it("is part of the composition: the section goes after the work and the studies for a career already under way", () => {
    const composed = composeFromProfile(cvOf([{ ref: "O1", text: "" }]), activist, { relevance: "direct" } as Parameters<typeof composeFromProfile>[2], new Date(2026, 9, 21));
    expect(composed.cv.sections.map((s) => s.kind)).toEqual(["experience", "education", "activities"]);
    expect(activitiesOf(composed.cv)[0]!.text).toBe(club);
  });
});
