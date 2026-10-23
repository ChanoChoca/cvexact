import { describe, expect, it } from "vitest";
import { composeFromProfile } from "@/lib/ai/profile-sources";
import { cvGaps, hasGaps, verifyCV } from "@/lib/ai/verify";
import { cvDocumentSchema, type CVDocument } from "@/lib/schemas/cv";
import { profileSchema, type Profile } from "@/lib/schemas/profile";

/**
 * One mistake at a time, in a CV that was right, through what the route does with a generated CV: what it takes from the
 * profile, then the gaps that decide a retry and the findings the person reads. Each row is a mutation of the audit
 * (AUDITORIA_CV.md §5.3); a row that read «no detecta» there reads «ok» here once the change that answers it is in.
 */

const profile = profileSchema.parse({
  fullName: "Bruno Ficticio",
  city: "Rosario",
  country: "Argentina",
  email: "bruno@example.com",
  experience: [
    { id: "a", company: "Pagaluz SA", role: "Desarrollador Mobile", city: "Rosario", country: "Argentina", start: "Octubre 2022", end: "Diciembre 2022", bullets: ["Armé el pipeline de builds."], tags: [] },
    { id: "b", company: "Nubesur Estudio", role: "Desarrollador React Native", start: "Marzo 2023", end: "", current: true, bullets: ["Maqueté pantallas."], tags: [] },
  ],
  education: [{ id: "u", institution: "Universidad Tecnológica del Sur", degree: "Licenciatura en Sistemas", start: "2022", end: "2027", status: "in_progress" }],
  projects: [{ id: "p1", name: "Turnero", description: "Agenda de turnos.", url: "", tags: [] }],
});

const analysis = { relevance: "direct" as const, title: "Desarrollador Mobile", domain: "fintech", keywords: [], requirements: [], responsibilities: [] };

type Item = Record<string, unknown>;
type Section = { items: Item[] } & Item;
type Mutate = (sections: Section[]) => Section[];

function cvAfter(mutate: Mutate = (sections) => sections): CVDocument {
  return cvDocumentSchema.parse({
    language: "es",
    header: { fullName: "Bruno Ficticio", location: "Rosario, Argentina" },
    summary: "Desarrollador mobile con experiencia en React Native.",
    sections: mutate([
      {
        kind: "experience",
        title: "EXPERIENCIA",
        items: [
          { company: "Pagaluz SA", role: "Desarrollador Mobile", location: "Rosario, Argentina", dateRange: "Octubre 2022 – Diciembre 2022", bullets: ["Automaticé los builds de la app con un pipeline propio."] },
          { company: "Nubesur Estudio", role: "Desarrollador React Native", location: "", dateRange: "Marzo 2023 – Actualidad", bullets: ["Armé la interfaz de las pantallas nuevas."] },
        ],
      },
      {
        kind: "education",
        title: "EDUCACIÓN",
        items: [{ institution: "Universidad Tecnológica del Sur", degree: "Licenciatura en Sistemas", location: "", date: "2022 – 2027 (en curso)", honors: "" }],
      },
    ]),
    coverage: { requirements: [], omitted: [] },
  });
}

type Ask = Parameters<typeof composeFromProfile>[2];

/** What the person is shown: the route's composition, then its gaps and findings. */
function outcome(cv: CVDocument, who: Profile = profile, ask: Ask = analysis) {
  const composed = composeFromProfile(cv, who, ask);
  // The CV here is two lines on purpose, so the short-CV notice is always true and never what a row is about.
  const findings = [...composed.findings, ...verifyCV(composed.cv, who, ask)].filter((f) => !f.detail.startsWith("El CV tiene solo"));
  return { cv: composed.cv, findings, retry: hasGaps(cvGaps(composed.cv, who, ask)) };
}

const jobs = (cv: CVDocument) => cv.sections.flatMap((s) => (s.kind === "experience" ? s.items : []));
const studies = (cv: CVDocument) => cv.sections.flatMap((s) => (s.kind === "education" ? s.items : []));
const errors = (found: ReturnType<typeof outcome>) => found.findings.filter((f) => f.severity === "error");

describe("mutations of the history", () => {
  it("baseline: a right CV comes out as it went in, with nothing to say", () => {
    const found = outcome(cvAfter());
    expect(found.findings).toEqual([]);
    expect(found.retry).toBe(false);
    expect(jobs(found.cv).map((j) => j.dateRange)).toEqual(["Octubre 2022 – Diciembre 2022", "Marzo 2023 – Actualidad"]);
  });

  it("M3 · a date stretched by months is the profile's again, and no warning is left", () => {
    const found = outcome(cvAfter((s) => ((s[0]!.items[0]!.dateRange = "Octubre 2022 – Junio 2023"), s)));
    expect(jobs(found.cv)[0]!.dateRange).toBe("Octubre 2022 – Diciembre 2022");
    expect(found.findings).toEqual([]);
  });

  it("M9 · a promoted title is the profile's again, and the retry for a changed title is not spent", () => {
    const found = outcome(cvAfter((s) => ((s[0]!.items[0]!.role = "Desarrollador Mobile Senior"), s)));
    expect(jobs(found.cv)[0]!.role).toBe("Desarrollador Mobile");
    expect(found.retry).toBe(false);
  });

  it("M11 · a project passed off as a job is out of the CV, and there is no error left to confirm", () => {
    const found = outcome(cvAfter((s) => (s[0]!.items.push({ company: "Turnero", role: "Desarrollador", location: "", dateRange: "2024", bullets: ["Hice todo el sistema."] }), s)));
    expect(jobs(found.cv).map((j) => j.company)).toEqual(["Pagaluz SA", "Nubesur Estudio"]);
    expect(found.findings.map((f) => f.detail)).toEqual(["«Turnero» es un proyecto, no un puesto: se quitó de la experiencia."]);
    expect(errors(found)).toEqual([]);
  });

  it("M15 · a renamed employer is taken out and said, not left as an error", () => {
    const found = outcome(cvAfter((s) => ((s[0]!.items[0]!.company = "Pagaluz Fintech"), s)));
    expect(jobs(found.cv).map((j) => j.company)).toEqual(["Nubesur Estudio"]);
    expect(errors(found)).toEqual([]);
  });

  it("M18 · a study that is still going is not shown as finished", () => {
    const found = outcome(cvAfter((s) => ((s[1]!.items[0]!.date = "2027"), s)));
    expect(studies(found.cv)[0]!.date).toBe("2022 – 2027 (en curso)");
  });

  it("a CV with no studies gets them from the profile and does not spend the retry that asked for them", () => {
    const found = outcome(cvAfter((s) => s.slice(0, 1)));
    expect(studies(found.cv)).toHaveLength(1);
    expect(found.retry).toBe(false);
  });
});

/**
 * Dana (§5.5): two real tasks at Pagaluz and a freelance with two more. The model's lines are reworded; the rows put invented ones
 * ahead of them or past the count, and ask which lines the CV is left with.
 */
describe("mutations of the bullets", () => {
  const dana = profileSchema.parse({
    ...profile,
    skills: ["React Native"], // what the baseline summary says
    experience: [
      { id: "a", company: "Pagaluz SA", role: "Desarrollador Mobile", start: "Octubre 2022", end: "Diciembre 2022", bullets: ["Armé el pipeline de builds con Fastlane.", "Reduje el arranque de la app de 6 a 3 segundos."], tags: [] },
      { id: "f", company: "", role: "Desarrollador Freelance", start: "2020", end: "2021", bullets: ["Hice sitios web para comercios.", "Mantuve las tiendas online de dos clientes."], tags: [] },
    ],
  });
  const real = ["Automaticé el pipeline de builds con Fastlane.", "Reduje el arranque de la app de 6 a 3 segundos."];
  const invented = ["Escribí tests automatizados con Jest para sostener la estabilidad.", "Lideré un equipo de cinco personas.", "Migré la base de datos a la nube."];
  const freelance = ["Armé sitios web para comercios de mi zona.", "Mantuve las tiendas online de dos clientes."];

  const withJobs = (...items: Item[]) => cvAfter((s) => ((s[0]!.items = items), s));
  const bulletsOf = (found: ReturnType<typeof outcome>) => jobs(found.cv).map((j) => j.bullets);

  it("M21b · three invented tasks put first leave the two real ones, and the Jest line is not an error that survives", () => {
    const found = outcome(withJobs({ company: "Pagaluz SA", role: "Desarrollador Mobile", location: "", dateRange: "", bullets: [...invented, ...real] }), dana);
    expect(bulletsOf(found)).toEqual([real]);
    expect(errors(found)).toEqual([]);
  });

  it("M23 · a freelance with three tasks too many is cut to the two its profile gives it", () => {
    const found = outcome(withJobs({ company: "", role: "Desarrollador Freelance", location: "", dateRange: "", bullets: [...invented, ...freelance] }), dana);
    expect(bulletsOf(found)).toEqual([freelance]);
  });
});

/**
 * Ana (§5.5): a mobile developer with a few students at a club and no number beyond that. The rows say a quantity nobody gave, in
 * words, or a trait nobody can check, in a list of skills.
 */
describe("mutations of the scale and the traits", () => {
  const withBullet = (bullet: string) => cvAfter((s) => ((s[0]!.items[1]!.bullets = [bullet]), s));
  const withSkills = (...bullets: string[]) => cvAfter((s) => [...s, { kind: "bullets", title: "SKILLS ADICIONALES", bullets, items: [] } as unknown as Section]);

  it("M12 · «cientos de estudiantes», with no digit, is an invented figure like any other: an error, and the retry", () => {
    const found = outcome(withBullet("Armé la interfaz de las pantallas que usan cientos de estudiantes."));
    expect(errors(found).map((f) => f.detail)).toEqual(["El CV dice «cientos», una cifra que no figura en tu perfil. Si es real, cargala; si no, sacala."]);
    expect(found.retry).toBe(true);
  });

  it("M12 · the same words are fine where the profile says them, and «10 millones» is the digits' to answer for", () => {
    const said = profileSchema.parse({ ...profile, experience: profile.experience.map((job, i) => (i === 1 ? { ...job, bullets: ["Maqueté pantallas usadas por cientos de estudiantes."] } : job)) });
    expect(errors(outcome(withBullet("Armé la interfaz de las pantallas que usan cientos de estudiantes."), said))).toEqual([]);
    expect(errors(outcome(withBullet("Armé la interfaz de pantallas que usan 10 millones de personas."))).map((f) => f.detail)).toEqual(["El CV dice «10», una cifra que no figura en tu perfil. Si es real, cargala; si no, sacala."]);
  });

  it("M12 · «múltiples» and «numerosos» are a warning, not an error, and no retry", () => {
    const found = outcome(withBullet("Armé la interfaz de múltiples pantallas para numerosos clientes."));
    expect(found.findings.map((f) => f.severity)).toEqual(["warning", "warning"]);
    expect(found.retry).toBe(false);
  });

  it("M13 · «Trabajo en equipo, comunicación efectiva y proactividad» as skills are three warnings and a retry", () => {
    const found = outcome(withSkills("Trabajo en equipo", "Comunicación efectiva", "Proactividad"));
    expect(found.findings.filter((f) => f.detail.includes(" de vos:")).map((f) => f.detail.match(/«([^»]+)»/)![1])).toEqual(["trabajo en equipo", "proactivo/a", "buena comunicación"]);
    expect(found.retry).toBe(true);
  });

  it("M13 · a trait in the summary is the same, and a job's line about teamwork is a thing that was done", () => {
    expect(outcome({ ...cvAfter(), summary: "Desarrollador mobile apasionado por la tecnología." }).retry).toBe(true);
    expect(outcome(withBullet("Documenté el trabajo en equipo entre diseño y desarrollo de la app.")).retry).toBe(false);
  });
});

describe("mutations of the tools", () => {
  // §5.5: «Control de versiones con Git y gestión de paquetes con npm/yarn», on a CV whose profile says none of the three.
  it("a tool the glossary used to not know, and the profile does not state, is an error that names it", () => {
    const found = outcome(cvAfter((s) => ((s[0]!.items[1]!.bullets = ["Control de versiones con Git y gestión de paquetes con npm y yarn."]), s)));
    const named = errors(found).map((f) => f.detail).join(" ");
    for (const tool of ["Git", "npm", "yarn"]) expect(named).toContain(tool);
  });
});

/**
 * Carla (§5.5): senior, with a job where she was «responsable», one where she «participé» and one where she «colaboré». What
 * the model wrote for her was right; the rows change one line of it. Her lines are reworded, so that copying a line from the
 * profile is not what the baseline is about.
 */
describe("mutations of who did the work", () => {
  const carla = profileSchema.parse({
    fullName: "Carla Ficticia",
    city: "Rosario",
    country: "Argentina",
    email: "carla@example.com",
    experience: [
      { id: "a", company: "Pagaluz SA", role: "Desarrolladora Mobile", start: "Enero 2020", end: "", current: true, bullets: ["Responsable del equipo mobile de 6 personas.", "Responsable de la migración del checkout a React Native."], tags: [] },
      { id: "b", company: "Nubesur Estudio", role: "Desarrolladora Mobile", start: "Marzo 2018", end: "Diciembre 2019", bullets: ["Participé en la definición del roadmap."], tags: [] },
      { id: "c", company: "Tiendix", role: "Desarrolladora Mobile", start: "Marzo 2017", end: "Febrero 2018", bullets: ["Colaboré en la mejora del checkout, que redujo el abandono aprox. 12 %."], tags: [] },
    ],
  });

  function carlaCv(mutate: Mutate = (sections) => sections): CVDocument {
    return cvDocumentSchema.parse({
      language: "es",
      header: { fullName: "Carla Ficticia", location: "Rosario, Argentina" },
      summary: "Desarrolladora mobile con experiencia en React Native.",
      sections: mutate([
        {
          kind: "experience",
          title: "EXPERIENCIA",
          items: [
            { company: "Pagaluz SA", role: "Desarrolladora Mobile", location: "", dateRange: "Enero 2020 – Actualidad", bullets: ["Lideré al equipo mobile de 6 personas.", "Dirigí la migración del checkout a React Native."] },
            { company: "Nubesur Estudio", role: "Desarrolladora Mobile", location: "", dateRange: "Marzo 2018 – Diciembre 2019", bullets: ["Participé en la definición del roadmap de producto."] },
            { company: "Tiendix", role: "Desarrolladora Mobile", location: "", dateRange: "Marzo 2017 – Febrero 2018", bullets: ["Colaboré en el checkout, que redujo el abandono aprox. 12 %."] },
          ],
        },
      ]),
      coverage: { requirements: [], omitted: [] },
    });
  }

  it("baseline: «Lideré» where the profile says «Responsable», and «Participé» and «Colaboré» kept, say nothing", () => {
    const found = outcome(carlaCv(), carla);
    expect(found.findings).toEqual([]);
    expect(found.retry).toBe(false);
  });

  it("M4 · «Participé en la definición» turned into «Lideré» is an error on that job, and it is what the retry is for", () => {
    const found = outcome(carlaCv((s) => ((s[0]!.items[1]!.bullets = ["Lideré la definición del roadmap de producto."]), s)), carla);
    expect(errors(found).map((f) => f.field)).toEqual(["sections[0].items[1]"]);
    expect(errors(found)[0]!.detail).toContain("Lideré la definición del roadmap de producto.");
    expect(found.retry).toBe(true);
  });

  it("M5 (who did it) · «Colaboré… redujo» as «Reduje» is a warning that the job lost its «colaboré», and no retry", () => {
    const found = outcome(carlaCv((s) => ((s[0]!.items[2]!.bullets = ["Reduje aprox. un 12 % el abandono del checkout."]), s)), carla);
    expect(found.findings.filter((f) => f.field === "sections[0].items[2]").map((f) => f.severity)).toEqual(["warning"]);
    expect(found.retry).toBe(false);
  });

  it("M5 (aprox.) · the estimate stated flat is an error on that line, and it is what the retry is for", () => {
    const found = outcome(carlaCv((s) => ((s[0]!.items[2]!.bullets = ["Colaboré en el checkout, que redujo el abandono un 12 %."]), s)), carla);
    expect(errors(found).map((f) => f.field)).toEqual(["sections[0].items[2].bullets[0]"]);
    expect(errors(found)[0]!.detail).toContain("sin «aprox.»");
    expect(found.retry).toBe(true);
  });

  it("M5 (aprox.) · «~», «alrededor de» and «aproximadamente» say it as well as «aprox.» does", () => {
    for (const said of ["que redujo el abandono ~12 %.", "que redujo el abandono alrededor de un 12 %.", "que redujo el abandono un 12 % aproximadamente.", "que redujo aproximadamente un 12 % el abandono."]) {
      const found = outcome(carlaCv((s) => ((s[0]!.items[2]!.bullets = [`Colaboré en el checkout, ${said}`]), s)), carla);
      expect(errors(found)).toEqual([]);
    }
  });

  it("an authority verb in the summary is an error unless something in the profile backs it", () => {
    const withSummary = (text: string) => ({ ...carlaCv(), summary: text });
    const bare = profileSchema.parse({ ...carla, experience: carla.experience.slice(1) });
    expect(errors(outcome(withSummary("Desarrolladora mobile; lideré equipos."), bare)).map((f) => f.field)).toContain("summary");
    expect(errors(outcome(withSummary("Desarrolladora mobile; lideré equipos."), carla)).map((f) => f.field)).not.toContain("summary");
  });
});

/**
 * Bruno (§5.5), who wrote «RN», «Node» and «Postgres» in his skills, for a posting that says React Native, Node.js and PostgreSQL. The
 * CV follows the posting, as it is told to; what is asked is whether the profile answers for the long name.
 */
describe("mutations of the abbreviations", () => {
  const bruno = (skills: string[]) =>
    profileSchema.parse({ ...profile, experience: profile.experience.map((job) => ({ ...job, role: "Desarrollador Mobile" })), skills });
  const saying = (text: string): CVDocument => ({ ...cvAfter(), summary: text });
  const named = (found: ReturnType<typeof outcome>) => errors(found).map((f) => f.detail).join(" ");

  it("M7 · PostgreSQL where the profile says Postgres is the same tool, and no error is left", () => {
    const cv = saying("Desarrollador mobile con consultas sobre PostgreSQL.");
    expect(named(outcome(cv, bruno([])))).toContain("PostgreSQL");
    expect(errors(outcome(cv, bruno(["Postgres"])))).toEqual([]);
  });

  it("M8 · Node.js where the profile says Node is the same tool, and no error is left", () => {
    const cv = saying("Desarrollador mobile con servicios en Node.js.");
    expect(named(outcome(cv, bruno([])))).toContain("Node.js");
    expect(errors(outcome(cv, bruno(["Node"])))).toEqual([]);
  });

  it("M6 · «RN» is not read as React Native by the table: the error stays until the person says it is, and then it is gone", () => {
    const cv = saying("Desarrollador mobile con experiencia en React Native.");
    expect(named(outcome(cv, bruno(["RN"])))).toContain("React Native");
    // What «Sí» to «¿“RN” es React Native?» leaves in the profile: the skill under its whole name.
    expect(errors(outcome(cv, bruno(["React Native"])))).toEqual([]);
  });
});

/**
 * Bruno's ad (§5.5) asks to improve the app on low-end phones and to prioritise new screens; his profile says neither. The model
 * wrote both in his mouth. The rows are the lines it wrote, and the ones it could write without taking anything from the ad.
 */
describe("mutations of the ad's wording", () => {
  const posting: Ask = { ...analysis, responsibilities: ["Mejorar el rendimiento de la app en celulares de gama baja", "Priorizar las nuevas pantallas y funcionalidades del producto"] };
  const withBullet = (bullet: string) => cvAfter((s) => ((s[0]!.items[1]!.bullets = [bullet]), s));
  const toReview = (found: ReturnType<typeof outcome>) => found.findings.filter((f) => f.detail.startsWith("Revisá:"));

  it("«celulares de gama baja» in a job's line is a warning on that line, and the retry is not spent", () => {
    const found = outcome(withBullet("Armé la interfaz de las pantallas pensando en celulares de gama baja."), profile, posting);
    expect(toReview(found)).toEqual([{ severity: "warning", field: "sections[0].items[1].bullets[0]", detail: "Revisá: «celulares» sale del aviso, no de tu perfil. Dejalo solo si lo hiciste." }]);
    expect(errors(found)).toEqual([]);
    expect(found.retry).toBe(false);
  });

  it("the same detail in the summary is a warning on the summary", () => {
    const found = outcome({ ...cvAfter(), summary: "Desarrollador mobile que cuida el rendimiento de la app en celulares de gama baja." }, profile, posting);
    expect(toReview(found).filter((f) => f.field === "summary").map((f) => f.detail)).toEqual(["Revisá: «rendimiento», «celulares» salen del aviso, no de tu perfil. Dejalo solo si lo hiciste."]);
  });

  it("«nuevas pantallas» is a warning on «nuevas»: the screens are his, the word is the ad's", () => {
    const found = outcome(withBullet("Armé las nuevas pantallas de la app."), profile, posting);
    expect(toReview(found).map((f) => f.detail)).toEqual(["Revisá: «nuevas» sale del aviso, no de tu perfil. Dejalo solo si lo hiciste."]);
  });

  it("the ad's field written as the candidate's experience in the summary is an error, and naming the job it is for is not", () => {
    const fintech: Ask = { ...posting, responsibilities: [...posting.responsibilities, "Desarrollar la billetera de una fintech de pagos"] };
    const claimed = outcome({ ...cvAfter(), summary: "Desarrollador mobile con experiencia en fintech." }, profile, fintech);
    const onSummary = (found: ReturnType<typeof outcome>) => toReview(found).filter((f) => f.field === "summary");
    expect(errors(claimed).map((f) => [f.field, f.detail])).toEqual([["summary", "El resumen dice que tenés experiencia en «fintech»; tu perfil no lo dice. Sacalo, o cargalo en tu perfil si es así."]]);
    expect(onSummary(claimed)).toEqual([]);

    const target = outcome({ ...cvAfter(), summary: "Desarrollador mobile con experiencia en React Native, para un rol mobile en una fintech." }, profile, fintech);
    expect(errors(target)).toEqual([]);
    expect(onSummary(target)).toEqual([]);
  });

  it("the ad's filler («producto», «funcionalidades») is not a detail, and there is nothing to say", () => {
    expect(toReview(outcome(withBullet("Armé pantallas y funcionalidades del producto."), profile, posting))).toEqual([]);
  });

  it("the same words are fine where the profile says them", () => {
    const said = profileSchema.parse({ ...profile, experience: profile.experience.map((job, i) => (i === 1 ? { ...job, bullets: ["Maqueté pantallas pensadas para celulares de gama baja."] } : job)) });
    expect(toReview(outcome(withBullet("Armé la interfaz de las pantallas pensando en celulares de gama baja."), said, posting))).toEqual([]);
  });
});

/**
 * Ana (§5.5): a student with a teaching assistantship, a project, and a club she runs. The run put her work first, her project
 * next and her degree last, and the club under «SKILLS ADICIONALES». The rows are what the model wrote and what the CV is left with.
 */
describe("mutations of the order and the activities", () => {
  const club = "Presido el Club de Robótica de la facultad desde 2024.";
  // Declared, so that the row does not depend on the day it runs: the derived stage is career-stage.test.ts's.
  const ana = profileSchema.parse({
    fullName: "Ana Ejemplo",
    city: "Bahía Blanca",
    country: "Argentina",
    email: "ana@example.com",
    situation: "student",
    skills: ["React Native"],
    experience: [{ id: "t", company: "Universidad Tecnológica del Sur", role: "Ayudante de cátedra", employmentType: "teaching", start: "Marzo 2025", end: "", current: true, bullets: ["Doy clases prácticas de Algoritmos."], tags: [] }],
    education: [{ id: "u", institution: "Universidad Tecnológica del Sur", degree: "Licenciatura en Sistemas", start: "2022", end: "2027", status: "in_progress" }],
    projects: [{ id: "p1", name: "Turnero", description: "Agenda de turnos hecha en React Native.", url: "https://turnero.app", tags: [] }],
    extras: [club],
  });
  const anaCv = (activities: Item[] = [{ ref: "O1", text: "" }]): CVDocument =>
    cvDocumentSchema.parse({
      language: "es",
      header: { fullName: "Ana Ejemplo", location: "Bahía Blanca, Argentina" },
      summary: "Estudiante de Sistemas con experiencia en React Native.",
      sections: [
        { kind: "experience", title: "EXPERIENCIA", items: [{ company: "Universidad Tecnológica del Sur", role: "Ayudante de cátedra", location: "", dateRange: "Marzo 2025 – Actualidad", bullets: ["Dicto clases prácticas de Algoritmos."] }] },
        { kind: "projects", title: "PROYECTOS", items: [{ ref: "P1", name: "Turnero", description: "", url: "" }] },
        { kind: "education", title: "EDUCACIÓN", items: [{ institution: "Universidad Tecnológica del Sur", degree: "Licenciatura en Sistemas", location: "", date: "2022 – 2027 (en curso)", honors: "" }] },
        { kind: "activities", title: "Cosas que hago", items: activities },
      ],
      coverage: { requirements: [], omitted: [] },
    });
  const kinds = (cv: CVDocument) => cv.sections.map((section) => section.kind);

  it("the order of Ana · her studies first, then her project, her work and the club: not the order the model wrote", () => {
    const found = outcome(anaCv(), ana);
    expect(kinds(found.cv)).toEqual(["education", "projects", "experience", "activities"]);
    expect(errors(found)).toEqual([]);
    // The club's line is the profile's, word for word: that is not a bullet copied, and spends no retry.
    expect(found.retry).toBe(false);
  });

  it("M11 for Ana · a project passed off as a job is said where the person will find the section, after the reorder", () => {
    const cv = anaCv();
    const work = cv.sections.find((s) => s.kind === "experience")!;
    work.items.push({ company: "Turnero", role: "Desarrolladora", location: "", dateRange: "2025", bullets: ["Hice todo el sistema."] } as never);
    const found = outcome(cv, ana);
    expect(kinds(found.cv)).toEqual(["education", "projects", "experience", "activities"]);
    expect(found.findings.map((f) => [f.field, f.detail])).toEqual([["sections[2].items[1]", "«Turnero» es un proyecto, no un puesto: se quitó de la experiencia."]]);
  });

  it("the same CV for someone with a career keeps the work first", () => {
    const found = outcome(anaCv(), profileSchema.parse({ ...ana, situation: "experienced" }));
    expect(kinds(found.cv)).toEqual(["experience", "education", "projects", "activities"]);
  });

  it("a posting outside her field leaves the order the model chose", () => {
    const found = outcome(anaCv(), ana, { ...analysis, relevance: "unrelated" });
    expect(kinds(found.cv)).toEqual(["experience", "projects", "education", "activities"]);
  });

  it("M22 · the club prints under «ACTIVIDADES», not «SKILLS ADICIONALES», and in Ana's words", () => {
    const found = outcome(anaCv(), ana);
    const section = found.cv.sections.find((s) => s.kind === "activities")!;
    expect(section.title).toBe("ACTIVIDADES");
    expect(section.items).toEqual([{ ref: "O1", text: club }]);
    expect(found.cv.sections.map((s) => s.title)).not.toContain("SKILLS ADICIONALES");
  });

  it("M22 · what the model writes about the club is not what is printed: «Lideré» and a number stay out", () => {
    const found = outcome(anaCv([{ ref: "O1", text: "Lideré el club de robótica, con 500 socios." }]), ana);
    expect(found.cv.sections.flatMap((s) => (s.kind === "activities" ? s.items.map((i) => i.text) : []))).toEqual([club]);
    expect(errors(found)).toEqual([]);
  });

  it("a club that is not in her profile is out of the CV", () => {
    const found = outcome(anaCv([{ ref: "O2", text: "Capitana del equipo de hockey." }]), ana);
    expect(kinds(found.cv)).not.toContain("activities");
  });
});
