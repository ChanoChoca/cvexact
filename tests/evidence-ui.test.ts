import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BadgeImport } from "@/components/profile/hub/BadgeImport";
import { EducationSection } from "@/components/profile/hub/EducationSection";
import { BackingNote, EvidenceBlock, EvidenceItem, whenLine } from "@/components/profile/hub/EvidenceBlock";
import { ExperienceSection } from "@/components/profile/hub/ExperienceSection";
import { GithubImport } from "@/components/profile/hub/GithubImport";
import { ProjectsSection } from "@/components/profile/hub/ProjectsSection";
import { SkillsSection } from "@/components/profile/hub/SkillsSection";
import { ConfirmDialogProvider } from "@/components/ui/ConfirmDialog";
import { ToastProvider } from "@/components/ui/toast";
import { VerificationLine } from "@/components/profile/hub/VerificationLine";
import { addEntry, blankForm } from "@/lib/onboarding/entries";
import { addCertification } from "@/lib/profile/entities";
import { addEvidence, type EvidenceTarget } from "@/lib/profile/evidence";
import type { Evidence, StoredProfile } from "@/lib/schemas/profile-v2";
import { STAMP, newId, profileWith, withStudy } from "./helpers/profiles";

/**
 * What the profile draws of the evidence (e5, O13, O14, O19, O20 and I4): nothing at all with the switches off — not an empty heading, not a button
 * — and, with them on, the block on each card, the way in to a badge and to GitHub, and the count. The interactions are the browser walkthroughs'.
 */

const ctx = { now: STAMP, newId };

afterEach(() => {
  vi.unstubAllEnvs();
});

const on = (...ids: string[]) => vi.stubEnv("NEXT_PUBLIC_CVP_EXPERIMENTS", ids.join(","));
const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);

function everything() {
  const profile = profileWith({ company: "Nubia Retail", role: "Analista", from: { year: 2022 }, to: "current", facts: [{ text: "Armo los informes" }] });
  const study = withStudy(profile, { degree: "Licenciatura en Administración", institution: "UBA", from: { year: 2014 }, to: { year: 2019 } });
  const cert = addCertification(profile, { name: "Matrícula de gasista", issuer: "Camuzzi" }, ctx)!;
  const projectId = addEntry(profile, { ...blankForm("project"), what: "Mi tienda", where: "Una tienda online" }, { newId, now: STAMP })!;
  const targets = {
    job: { kind: "experience", id: profile.experience[0]!.id },
    study: { kind: "education", id: study.id },
    cert: { kind: "certification", id: cert.id },
    project: { kind: "project", id: projectId },
  } satisfies Record<string, EvidenceTarget>;
  return { profile, targets };
}

const SWITCHES = ["evidence_links", "official_registries", "github_projects", "open_badges"];

/** The four sections that carry the block, drawn as the hub draws them. */
function sections(profile: StoredProfile): string {
  const onRemoved = () => {};
  return [
    html(createElement(ExperienceSection, { profile, onRemoved, addRequests: 0 })),
    html(createElement(EducationSection, { profile, onRemoved })),
    html(createElement(SkillsSection, { profile, onRemoved, now: new Date(STAMP) })),
    // A project card has «Mejorar con IA» under its description, which confirms and notifies: it stands where the app puts the two.
    html(createElement(ConfirmDialogProvider, null, createElement(ToastProvider, null, createElement(ProjectsSection, { profile, onRemoved })))),
  ].join("\n");
}

const TRACES = [
  "data-evidence-block",
  "data-evidence-add",
  "data-evidence=",
  "data-backing-note",
  "data-badge-import",
  "data-github-import",
  "data-github-entry",
  "data-verification-counts",
  "Respaldo",
  "Importar una insignia",
  "Traer mis proyectos de GitHub",
  "traerlos de ahí",
  "una foto",
];

describe("with everything off", () => {
  it("draws no trace of any of it, with evidence in the profile or without", () => {
    const { profile, targets } = everything();
    for (const target of Object.values(targets)) addEvidence(profile, target, { type: "link", url: "https://ejemplo.com/a", phrase: "Se ve" }, ctx);
    const drawn = sections(profile);
    for (const trace of TRACES) expect(drawn, trace).not.toContain(trace);
    expect(drawn).not.toContain("https://ejemplo.com/a");
    expect(html(createElement(VerificationLine, { profile }))).toBe("");
    for (const target of Object.values(targets)) expect(html(createElement(EvidenceBlock, { profile, target }))).toBe("");
    expect(html(createElement(BadgeImport, { profile }))).toBe("");
    expect(html(createElement(GithubImport, { profile }))).toBe("");
  });
});

describe("with the switches on", () => {
  it("draws the block on each of the four cards, with the way to add one and nothing that says something is missing", () => {
    on("evidence_links");
    const { profile, targets } = everything();
    for (const target of Object.values(targets)) {
      const drawn = html(createElement(EvidenceBlock, { profile, target }));
      expect(drawn, target.kind).toContain(`data-evidence-block="${target.id}"`);
      expect(drawn, target.kind).toContain("+ Agregar un respaldo");
      // The explanation is not under the card: it is once for the section (`BackingNote`), so that the card has its entries and one button — and no heading with nothing under it.
      expect(drawn, target.kind).not.toContain("Opcional.");
      expect(drawn, target.kind).not.toContain("Respaldo,");
      // What is said, and not the markup: nothing that tells the person something is missing or counts what is not there.
      expect(drawn.replace(/<[^>]+>/g, " "), target.kind).not.toMatch(/falta|sin respaldo|pendiente|%/i);
    }
    const drawn = sections(profile);
    expect((drawn.match(/data-evidence-block=/g) ?? []).length).toBe(4);
    // And what it is for, said once for each of the four sections.
    expect((drawn.match(/data-backing-note/g) ?? []).length).toBe(4);
  });

  it("says what the respaldo is once for the section, in words that fit what the section holds, and nothing where nothing can be added", () => {
    on("evidence_links");
    expect(html(createElement(BackingNote, { kind: "experience" })).replace(/<[^>]+>/g, "")).toBe("Respaldo, si querés: un enlace donde se vea cada puesto, con tus palabras. Lo que no respaldás queda como lo contaste. ");
    on("evidence_links", "official_registries");
    expect(html(createElement(BackingNote, { kind: "education" })).replace(/<[^>]+>/g, "")).toContain("un enlace o un registro oficial donde se vea cada estudio");
    // A register shows a degree and a licence, and not a job or a project.
    expect(html(createElement(BackingNote, { kind: "project" })).replace(/<[^>]+>/g, "")).toContain("un enlace donde se vea cada proyecto");
    on("official_registries");
    expect(html(createElement(BackingNote, { kind: "experience" }))).toBe("");
    on();
    for (const kind of ["experience", "education", "certification", "project"] as const) expect(html(createElement(BackingNote, { kind })), kind).toBe("");
  });

  it("says, on the certifications, what the photo of a credential is for — and only there", () => {
    on("credential_photo");
    expect(html(createElement(BackingNote, { kind: "certification" })).replace(/<[^>]+>/g, "")).toContain("Para lo que vence, podés leer la fecha de una foto de la credencial.");
    for (const kind of ["experience", "education", "project"] as const) expect(html(createElement(BackingNote, { kind })), kind).toBe("");
    on("credential_photo", "evidence_links");
    expect(html(createElement(BackingNote, { kind: "certification" })).replace(/<[^>]+>/g, "")).toMatch(/Respaldo, si querés: un enlace .* Para lo que vence, podés leer la fecha de una foto de la credencial\./);
  });

  describe("the one button of a certification", () => {
    const photo = { kind: "expiry" as const, onUse: () => {} };
    const button = (drawn: string) => /data-evidence-add[^>]*>([^<]*)</.exec(drawn)?.[1];

    it("adds a respaldo or reads a photo: one button, and it says both", () => {
      on("evidence_links", "credential_photo");
      const { profile, targets } = everything();
      const drawn = html(createElement(EvidenceBlock, { profile, target: targets.cert, photo }));
      expect(button(drawn)).toBe("+ Agregar un respaldo o una foto");
      expect((drawn.match(/data-evidence-add/g) ?? []).length).toBe(1);
      expect(drawn).not.toContain("data-credential-photo-entry");
    });

    it("says only what it can do: a respaldo, or the photo, according to what is switched on", () => {
      const { profile, targets } = everything();
      on("evidence_links");
      expect(button(html(createElement(EvidenceBlock, { profile, target: targets.cert, photo })))).toBe("+ Agregar un respaldo");
      on("credential_photo");
      expect(button(html(createElement(EvidenceBlock, { profile, target: targets.cert, photo })))).toBe("Leer de una foto");
      on("official_registries", "credential_photo");
      expect(button(html(createElement(EvidenceBlock, { profile, target: targets.cert, photo })))).toBe("+ Agregar un respaldo o una foto");
    });

    it("has no photo where there is nothing to read — a job, a study — or where the card does not offer it, and draws nothing when only the photo is on", () => {
      const { profile, targets } = everything();
      on("credential_photo");
      expect(html(createElement(EvidenceBlock, { profile, target: targets.job }))).toBe("");
      expect(html(createElement(EvidenceBlock, { profile, target: targets.cert }))).toBe("");
      on("evidence_links");
      expect(button(html(createElement(EvidenceBlock, { profile, target: targets.cert })))).toBe("+ Agregar un respaldo");
    });
  });

  it("draws what is beside a thing: the page as a link that opens elsewhere without saying where it came from, and the person's words", () => {
    on("evidence_links");
    const { profile, targets } = everything();
    addEvidence(profile, targets.project, { type: "link", url: "https://github.com/perfil-ejemplo/tienda", phrase: "Mi código" }, ctx);
    const drawn = html(createElement(EvidenceBlock, { profile, target: targets.project }));
    expect(drawn).toContain('href="https://github.com/perfil-ejemplo/tienda"');
    expect(drawn).toContain('target="_blank"');
    expect(drawn).toContain('rel="noopener noreferrer nofollow"');
    expect(drawn).toContain(">github.com/perfil-ejemplo/tienda<");
    expect(drawn).toContain("Mi código");
    expect(drawn).toContain("Enlace");
    expect(drawn).toContain("Poner en los enlaces de mi CV");
  });

  it("says a page that is already among the CV's links, and offers nothing more for it", () => {
    on("evidence_links");
    const { profile, targets } = everything();
    addEvidence(profile, targets.project, { type: "link", url: "https://github.com/perfil-ejemplo/tienda", phrase: "Mi código" }, ctx);
    profile.contact.links = { value: [{ label: "github.com/perfil-ejemplo/tienda", url: "https://github.com/perfil-ejemplo/tienda" }], status: "confirmed" };
    const drawn = html(createElement(EvidenceBlock, { profile, target: targets.project }));
    expect(drawn).toContain("Está en los enlaces de tu CV");
    expect(drawn).not.toContain("Poner en los enlaces de mi CV");
  });

  it("draws nothing for what a register cannot show when only the registers are on: a job or a project", () => {
    on("official_registries");
    const { profile, targets } = everything();
    expect(html(createElement(EvidenceBlock, { profile, target: targets.job }))).toBe("");
    expect(html(createElement(EvidenceBlock, { profile, target: targets.project }))).toBe("");
    expect(html(createElement(EvidenceBlock, { profile, target: targets.study }))).toContain("data-evidence-block");
    expect(html(createElement(EvidenceBlock, { profile, target: targets.cert }))).toContain("data-evidence-block");
  });

  it("shows what a badge or a repository left beside a thing, with no way to add more, and nothing where there is nothing", () => {
    const { profile, targets } = everything();
    on("open_badges");
    expect(html(createElement(EvidenceBlock, { profile, target: targets.cert }))).toBe("");
    addEvidence(profile, targets.cert, { type: "signed", via: "badge", check: { alg: "ES256", keyFrom: "jwk", at: STAMP } }, ctx);
    const drawn = html(createElement(EvidenceBlock, { profile, target: targets.cert }));
    expect(drawn).toContain('data-evidence-type="signed"');
    expect(drawn).toContain("Insignia importada de un archivo");
    expect(drawn).not.toContain("data-evidence-add");
    // The same for a repository that GitHub brought, on its project.
    on("github_projects");
    expect(html(createElement(EvidenceBlock, { profile, target: targets.project }))).toBe("");
    addEvidence(profile, targets.project, { type: "link", via: "github", url: "https://github.com/perfil-ejemplo/tienda", phrase: "Mi código" }, ctx);
    const project = html(createElement(EvidenceBlock, { profile, target: targets.project }));
    expect(project).toContain("Traído de GitHub");
    expect(project).not.toContain("data-evidence-add");
    // And not for a switch that has nothing to do with it.
    on("template_counts");
    expect(html(createElement(EvidenceBlock, { profile, target: targets.project }))).toBe("");
  });

  it("draws the way into a badge and into GitHub, each only with its own switch", () => {
    const { profile } = everything();
    on("open_badges");
    expect(html(createElement(BadgeImport, { profile }))).toContain("+ Importar una insignia");
    expect(html(createElement(GithubImport, { profile }))).toBe("");
    on("github_projects");
    expect(html(createElement(GithubImport, { profile }))).toContain("Traer mis proyectos de GitHub");
    expect(html(createElement(BadgeImport, { profile }))).toBe("");
    on(...SWITCHES);
    const drawn = sections(profile);
    expect(drawn).toContain("data-badge-import");
    expect(drawn).toContain("data-github-import");
  });

  it("counts what has something beside it, with any of the four on, and says nothing until something has", () => {
    const { profile, targets } = everything();
    for (const id of SWITCHES) {
      on(id);
      expect(html(createElement(VerificationLine, { profile })), id).toBe("");
    }
    addEvidence(profile, targets.job, { type: "link", url: "https://ejemplo.com/a", phrase: "Se ve" }, ctx);
    addEvidence(profile, targets.study, { type: "registry", registry: "graduados", phrase: "Figura" }, ctx);
    for (const id of SWITCHES) {
      on(id);
      expect(html(createElement(VerificationLine, { profile })), id).toContain("Con respaldo: 1 con un enlace y 1 en un registro oficial.");
    }
    on("template_counts");
    expect(html(createElement(VerificationLine, { profile }))).toBe("");
  });
});

describe("a piece of evidence", () => {
  const entry = (extra: Partial<Evidence> = {}): Evidence => ({ id: "e1", type: "link", url: "https://ejemplo.com/obras", phrase: "Fotos de obras", at: "2026-10-07T12:00:00.000Z", ...extra });
  const draw = (evidence: Evidence, inCv = false) => html(createElement(EvidenceItem, { entry: evidence, inCv, onCv: () => {}, onRemove: () => {} }));

  it("says the day in the words that go with what it is", () => {
    expect(whenLine(entry())).toBe("Agregado el 7 de octubre de 2026");
    expect(whenLine(entry({ type: "registry", registry: "graduados" }))).toBe("Visto el 7 de octubre de 2026");
    expect(whenLine(entry({ type: "signed" }))).toBe("Firma comprobada el 7 de octubre de 2026");
    expect(whenLine(entry({ at: "" }))).toBe("");
  });

  it("names the register it was seen in, and the badge or GitHub when they brought it", () => {
    expect(draw(entry({ type: "registry", registry: "graduados", url: "" }))).toContain("Registro Público de Graduados Universitarios");
    expect(draw(entry({ via: "badge" }))).toContain("Insignia importada de un archivo");
    expect(draw(entry({ via: "github" }))).toContain("Traído de GitHub");
  });

  it("says what a signature does and does not mean, next to every signed one", () => {
    const drawn = draw(entry({ type: "signed", url: "", phrase: "", check: { alg: "ES256", keyFrom: "jwk", at: "2026-10-07T12:00:00.000Z" } }));
    expect(drawn).toContain("No dice de quién es esa clave.");
    expect(drawn).toContain("Firma");
    expect(drawn).not.toContain("<a ");
  });

  it("has no link when it has no address, and no button to put one in the CV", () => {
    const drawn = draw(entry({ type: "registry", registry: "refeps", url: "" }));
    expect(drawn).not.toContain("<a ");
    expect(drawn).not.toContain("enlaces de mi CV");
  });
});
