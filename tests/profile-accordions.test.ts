import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfilePanel } from "@/components/onboarding/ProfilePanel";
import { ContactSection } from "@/components/profile/hub/ContactSection";
import { EducationSection } from "@/components/profile/hub/EducationSection";
import { ExperienceSection } from "@/components/profile/hub/ExperienceSection";
import { OtherSection } from "@/components/profile/hub/OtherSection";
import { ProjectsSection } from "@/components/profile/hub/ProjectsSection";
import { SkillsSection } from "@/components/profile/hub/SkillsSection";
import { goTo } from "@/components/profile/jumpTo";
import { ProfileLayout } from "@/components/profile/ProfileLayout";
import { CollapsibleCard } from "@/components/ui";
import { confirmEducation, confirmExperience } from "@/lib/onboarding/review";
import { certificationSchema, type StoredProfile } from "@/lib/schemas/profile-v2";
import { NOW, profileWith, withStudy } from "./helpers/profiles";

/**
 * Stage 1 of the profile's new first load: the sections fold, the view of the profile stands beside them or behind them, and a link to a
 * section that is shut opens it. What moves under a finger —the sheet— is in the browser's own tests; what is decided here is what the page says.
 */

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element).replace(/<!-- -->/g, "");
const noop = () => {};

const stored = (): StoredProfile => {
  const profile = profileWith({ company: "Nubia Retail", role: "Analista", from: { year: 2021, month: 3 }, to: "current", facts: [{ text: "Armo los pedidos" }, { kind: "tool", text: "Excel" }] });
  profile.contact.fullName = { value: "Lucía Pérez", status: "confirmed" };
  profile.contact.email = { value: "lucia@example.com", status: "confirmed" };
  profile.contact.phone = { value: "351 555-1234", status: "confirmed" };
  profile.contact.city = { value: "Córdoba", status: "confirmed" };
  profile.contact.country = { value: "Argentina", status: "confirmed" };
  profile.certifications.push(certificationSchema.parse({ id: "c1", name: { value: "Matrícula de gasista", status: "confirmed" }, issuer: { value: "ENARGAS", status: "confirmed" } }));
  return profile;
};

describe("the sections of the profile", () => {
  const sections = (profile: StoredProfile, defaultOpen?: boolean) => {
    const open = defaultOpen === undefined ? {} : { defaultOpen };
    return {
      contacto: html(createElement(ContactSection, { profile, ...open })),
      experiencia: html(createElement(ExperienceSection, { profile, onRemoved: noop, ...open })),
      estudios: html(createElement(EducationSection, { profile, onRemoved: noop, ...open })),
      habilidades: html(createElement(SkillsSection, { profile, onRemoved: noop, now: NOW, ...open })),
      proyectos: html(createElement(ProjectsSection, { profile, onRemoved: noop, ...open })),
      "otros-datos": html(createElement(OtherSection, { profile, onRemoved: noop, now: NOW, ...open })),
    };
  };
  const TITLES = { contacto: "Datos personales", experiencia: "Experiencia laboral", estudios: "Formación", habilidades: "Habilidades, idiomas y certificaciones", proyectos: "Proyectos · opcional", "otros-datos": "Sobre vos y otros datos" };

  it("are six folds, each the target of a link with its own id, and its title is what the fold shows", () => {
    for (const [id, markup] of Object.entries(sections(stored()))) {
      expect(markup, id).toMatch(new RegExp(`^<details id="${id}"`));
      expect(markup, id).toMatch(new RegExp(`<summary[^>]*>.*${TITLES[id as keyof typeof TITLES]}.*</summary>`));
      // No heading of their own left: the fold is the heading.
      expect(markup, id).not.toContain("<section");
    }
  });

  it("start shut, and open when the profile says so", () => {
    for (const [id, markup] of Object.entries(sections(stored()))) expect(markup.slice(0, markup.indexOf(">")), id).not.toContain(" open");
    for (const [id, markup] of Object.entries(sections(stored(), true))) expect(markup.slice(0, markup.indexOf(">")), id).toMatch(/ open=""/);
  });

  it("offer to add a language with a button, and the form waits for it — as certifications do", () => {
    const { habilidades } = sections(stored());
    expect(habilidades).toContain("+ Agregar idioma");
    expect(habilidades).not.toContain('aria-label="Idioma"');
    expect(habilidades).toContain("+ Agregar certificación");
  });

  it("say nothing of when they were last looked at", () => {
    for (const [id, markup] of Object.entries(sections(stored()))) expect(markup, id).not.toContain("Última revisión");
  });

  it("ask for the licence's class and no longer for the day it lapses", () => {
    const { "otros-datos": other } = sections(stored());
    expect(other).toContain("Licencia de conducir");
    expect(other).not.toContain("Vence (opcional)");
    expect(other).not.toContain("data-license-expiry");
  });

  it("have no gap under the title while shut, and the one they had when open", () => {
    const markup = html(createElement(CollapsibleCard, { id: "x", title: "Algo" } as Parameters<typeof CollapsibleCard>[0], "adentro"));
    expect(markup).toContain('<details id="x"');
    expect(markup).toMatch(/<summary[^>]* mb-0 group-open:mb-3 /);
  });
});

describe("what is marked «Para revisar»", () => {
  /** A job and a study read with doubts. */
  const marked = (): StoredProfile => {
    const profile = stored();
    profile.experience[0]!.company = { value: "Nubia Retail", status: "proposed" };
    const study = withStudy(profile, { degree: "Licenciatura en Economía", institution: "UBA" });
    study.institution = { ...study.institution, status: "proposed" };
    return profile;
  };
  const folds = (profile: StoredProfile, extra: { focus?: { experienceId: string; factId: string } } = {}) => ({
    experiencia: html(createElement(ExperienceSection, { profile, onRemoved: noop, ...extra })),
    estudios: html(createElement(EducationSection, { profile, onRemoved: noop })),
  });
  /** What each summary says, the title of the fold first and then the card of each job or study. */
  const summaries = (markup: string) => [...markup.matchAll(/<summary[^>]*>(.*?)<\/summary>/g)].map((match) => match[1]!);

  it("is said on the title of the fold, where it is read shut or open — and not at all when nothing is marked", () => {
    for (const [id, markup] of Object.entries(folds(marked()))) expect(summaries(markup)[0], id).toContain("Para revisar");
    for (const [id, markup] of Object.entries(folds(stored()))) expect(summaries(markup)[0], id).not.toContain("Para revisar");
  });

  it("stays on the card that has it, and the card starts shut: being marked does not open anything by itself", () => {
    for (const [id, markup] of Object.entries(folds(marked()))) {
      expect(summaries(markup)[1], id).toContain("Para revisar");
      for (const tag of markup.match(/<details[^>]*>/g)!) expect(tag, id).not.toContain(" open");
    }
  });

  it("is settled on the card itself with «Está bien»: a doubtful reading has the button, and confirming it clears the mark", () => {
    const profile = marked();
    for (const [id, markup] of Object.entries(folds(profile))) expect(markup, id).toContain("Está bien");
    for (const [id, markup] of Object.entries(folds(stored()))) expect(markup, id).not.toContain("Está bien");
    confirmExperience(profile, profile.experience[0]!.id);
    confirmEducation(profile, profile.education[0]!.id);
    for (const [id, markup] of Object.entries(folds(profile))) expect(markup, id).not.toContain("Para revisar");
  });

  it("opens the job that was asked for, marked or not", () => {
    const profile = marked();
    const { experiencia } = folds(profile, { focus: { experienceId: profile.experience[0]!.id, factId: "f-1" } });
    expect(experiencia.match(/<details[^>]*>/g)![1]).toContain(' open=""');
  });
});

describe("the view of the profile", () => {
  it("opens with who they are and how to reach them, then what the profile holds, certifications among it", () => {
    const markup = html(createElement(ProfilePanel, { profile: stored(), highlight: [] }));
    expect(markup).toContain("data-panel-contact");
    expect(markup).toContain("Lucía Pérez");
    expect(markup).toContain("lucia@example.com · 351 555-1234 · Córdoba, Argentina");
    expect(markup).toContain("Certificaciones");
    expect(markup).toContain("Matrícula de gasista · ENARGAS");
    expect(markup.indexOf("Lucía Pérez")).toBeLessThan(markup.indexOf("Nubia Retail"));
    expect(markup.indexOf("Nubia Retail")).toBeLessThan(markup.indexOf("Certificaciones"));
  });

  it("says nothing of contact or certifications that are not there", () => {
    const markup = html(createElement(ProfilePanel, { profile: profileWith({ company: "Nubia Retail", role: "Analista", facts: [{ text: "Armo los pedidos" }] }), highlight: [] }));
    expect(markup).not.toContain("data-panel-contact");
    expect(markup).not.toContain("Certificaciones");
  });

  it("is plain text unless someone asked to follow a line: then each thing a job says is a button that names it, and the tools stay out", () => {
    const profile = stored();
    expect(html(createElement(ProfilePanel, { profile, highlight: [] }))).not.toContain("<button");
    const markup = html(createElement(ProfilePanel, { profile, highlight: [], onFactClick: noop }));
    expect(markup).toContain('aria-label="Abrir en tu perfil: Armo los pedidos"');
    expect(markup.match(/<button/g)).toHaveLength(1);
    // A finger gets a row of its own height.
    expect(markup).toContain("pointer-coarse:min-h-11");
  });
});

type LayoutProps = Parameters<typeof ProfileLayout>[0];

const layout = (view?: boolean) => html(createElement(ProfileLayout, (view ? { view: createElement("p", null, "la vista") } : {}) as LayoutProps, createElement("p", null, "lo demás")));

describe("the layout of the profile", () => {

  it("is only the column when there is no view: a profile with nothing in it has nothing to show beside it", () => {
    const markup = layout(false);
    expect(markup).toContain("lo demás");
    expect(markup).not.toContain("data-bottom-sheet");
    expect(markup).not.toContain("la vista");
  });

  it("is the view as the page and the rest in a sheet that starts peeking, where the screen is not wide (and so before the screen is known)", () => {
    const markup = layout(true);
    expect(markup.indexOf("la vista")).toBeLessThan(markup.indexOf("data-bottom-sheet"));
    // The room of the peek under the view, so that when the page opens nothing of it is under the sheet.
    expect(markup).toContain("padding-bottom:7.5rem");
    expect(markup).toMatch(/<section[^>]*aria-label="Editar tu perfil"[^>]*data-stop="peek"/);
    expect(markup).toContain("height:7.5rem");
    expect(markup).not.toContain("data-panel=");
  });
});

describe("the sheet", () => {
  const sheet = () => layout(true);

  it("stands on the bar of tabs and on the floor where there is none", () => {
    expect(sheet()).toMatch(/<section[^>]*class="fixed [^"]*bottom-\[var\(--tab-h\)\][^"]* chrome:bottom-0/);
  });

  it("is moved by a button with its state, that a finger can drag without the page going along", () => {
    const markup = sheet();
    expect(markup).toMatch(/<button[^>]*type="button"[^>]*aria-expanded="false"[^>]*aria-controls="([^"]+)"/);
    const controls = /<button[^>]*aria-controls="([^"]+)"/.exec(markup)![1]!;
    expect(markup).toContain(`id="${controls}"`);
    expect(markup).toMatch(/<button[^>]* touch-none /);
    expect(markup).toContain("pointer-coarse:min-h-11");
  });

  it("scrolls inside itself and does not pass the scroll on to the page, and is for looking at while it peeks", () => {
    const markup = sheet();
    expect(markup).toMatch(/id="[^"]+" class="[^"]*overflow-y-auto overscroll-contain[^"]*pointer-events-none/);
  });

  it("does not ease its height for someone who asked for less motion", () => {
    expect(sheet()).toContain("transition-[height] duration-200 ease-out motion-reduce:transition-none");
  });
});

describe("a link to a section that is shut", () => {
  afterEach(() => vi.unstubAllGlobals());

  type Fold = { open: boolean; parentElement: { closest: (selector: string) => Fold | null } | null; closest: (selector: string) => Fold | null };
  const fold = (parent: Fold | null): Fold => {
    const self: Fold = { open: false, parentElement: parent ? { closest: () => parent } : null, closest: () => self };
    return self;
  };

  const stub = (target: unknown) => {
    vi.stubGlobal("document", { getElementById: (id: string) => (id === "dentro" ? target : null) });
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
  };

  it("opens it, and the one it is in, before it takes the page there", () => {
    const outer = fold(null);
    const inner = fold(outer);
    const scrolled = vi.fn();
    stub({ closest: () => inner, scrollIntoView: scrolled, querySelector: () => null });
    expect(goTo("dentro")).toBe(true);
    expect(inner.open).toBe(true);
    expect(outer.open).toBe(true);
    expect(scrolled).toHaveBeenCalledOnce();
  });

  it("opens the section that is itself the target", () => {
    const section = fold(null);
    stub({ ...section, closest: () => section, scrollIntoView: noop, querySelector: () => null });
    expect(goTo("dentro")).toBe(true);
    expect(section.open).toBe(true);
  });

  it("says no, and opens nothing, for what is not on the page", () => {
    const section = fold(null);
    stub({ closest: () => section, scrollIntoView: noop, querySelector: () => null });
    expect(goTo("otro")).toBe(false);
    expect(section.open).toBe(false);
  });

  it("goes where it is told when nothing is shut", () => {
    const scrolled = vi.fn();
    stub({ closest: () => null, scrollIntoView: scrolled, querySelector: () => null });
    expect(goTo("dentro")).toBe(true);
    expect(scrolled).toHaveBeenCalledOnce();
  });
});
