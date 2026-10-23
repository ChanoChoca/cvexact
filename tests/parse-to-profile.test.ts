import { describe, expect, it } from "vitest";
import { emptyStoredProfile, storedProfileSchema } from "@/lib/schemas/profile-v2";
import { toPlainProfile } from "@/lib/profile/project";
import { linesFromText } from "@/lib/parse/lines";
import { parseCv } from "@/lib/parse/cv-heuristic";
import { applyParsedDocument, importOutcome, replaceSource, type ApplyResult, type SourceInfo } from "@/lib/parse/to-profile";
import type { ParsedDocument, ParsedExperience } from "@/lib/parse/types";
import { AMBIGUOUS, SPANISH_BULLETS } from "./fixtures/cv-samples";

const NOW = "2026-09-21T12:00:00.000Z";
let counter = 0;
const ctx = (sourceId = "src-1") => ({ sourceId, now: NOW, newId: () => `id-${++counter}` });
const info = (fileHash = "hash-1"): SourceInfo => ({ name: "cv.pdf", fileHash, pasted: false, chars: 1200 });

const parse = (text: string, kind: "cv" | "linkedin_pdf" = "cv") => parseCv(linesFromText(text), kind);

describe("applying a parsed CV", () => {
  const applied = applyParsedDocument(emptyStoredProfile(), parse(SPANISH_BULLETS), info(), ctx());
  const profile = applied.profile;

  it("adds what was read, and counts it", () => {
    expect(applied.duplicate).toBe(false);
    // Five from the skills section, and Google Ads from "Llevo las campañas de Google Ads y Meta"
    // ("Meta" is also an ordinary word: left for the question to ask about).
    expect(applied.added).toMatchObject({ experience: 2, education: 1, facts: 5, skills: 6, languages: 2, certifications: 2 });
    expect(profile.experience).toHaveLength(2);
  });

  it("records the document it came from, and what reading it found", () => {
    expect(profile.sources).toEqual([
      {
        id: "src-1",
        kind: "cv",
        name: "cv.pdf",
        fileHash: "hash-1",
        pasted: false,
        chars: 1200,
        importedAt: NOW,
        // Counted at that moment, from what the reading added: the review says it back.
        read: {
          experience: profile.experience.length,
          education: profile.education.length,
          facts: profile.experience.reduce((total, job) => total + job.facts.length, 0),
          skills: profile.skills.length,
          languages: profile.languages.length,
          certifications: profile.certifications.length,
          projects: profile.projects.length,
          unassigned: profile.unassigned.length,
          conflicts: 0,
        },
      },
    ]);
  });

  it("keeps, for every value, the fragment it was read from, and says which document", () => {
    const job = profile.experience[0]!;
    expect(job.company.source).toEqual({ kind: "cv", docId: "src-1", quote: "Nubia Retail", at: NOW });
    expect(job.start.source?.quote).toBe("marzo 2021");
    expect(job.facts[0]!.source).toMatchObject({ kind: "cv", docId: "src-1", quote: job.facts[0]!.text });
  });

  it("confirms what was read with confidence and leaves contact details to be confirmed", () => {
    expect(profile.experience[0]!.company.status).toBe("confirmed");
    expect(profile.experience[0]!.facts.every((f) => f.status === "confirmed")).toBe(true);
    expect(profile.contact.fullName).toMatchObject({ value: "LUCÍA FERNÁNDEZ", status: "proposed" });
    expect(profile.contact.email).toMatchObject({ value: "lucia.fernandez@example.com", status: "proposed" });
    expect(profile.legacy.headline.value).toBe("Analista de Marketing Digital");
  });

  it("notes how sure the reading was, for the review", () => {
    expect(profile.experience[0]!.review).toEqual({ confidence: "high", doubts: [], span: expect.any(Array) });
  });

  it("fills «Sobre vos» with the document's own summary, instead of leaving it unexplained in the tray", () => {
    expect(profile.legacy.about).toMatchObject({
      value: "Analista con seis años de experiencia en campañas de pago y SEO.",
      status: "proposed",
      source: { kind: "cv", docId: "src-1" },
    });
    expect(profile.unassigned.some((item) => item.kind === "summary")).toBe(false);
  });

  it("raises a conflict, rather than overwriting it quietly, when a second document's summary disagrees", () => {
    const second = applyParsedDocument(
      profile,
      parse("PERFIL\nOtra vida, otra historia.\n\nEXPERIENCIA LABORAL\n\nGrupo Lumen | Asistente | enero 2019 – marzo 2020\nHice cosas."),
      info("hash-2"),
      ctx("src-2"),
    );
    // Unchanged until the person resolves it — the same rule `contact.email`
    // and `legacy.headline` already follow.
    expect(second.profile.legacy.about.value).toBe("Analista con seis años de experiencia en campañas de pago y SEO.");
    expect(second.profile.conflicts).toContainEqual(
      expect.objectContaining({
        entity: "legacy",
        field: "about",
        current: expect.objectContaining({ value: "Analista con seis años de experiencia en campañas de pago y SEO." }),
        incoming: expect.objectContaining({ value: "Otra vida, otra historia." }),
      }),
    );
  });

  it("leaves a second summary in the same document's own tray, rather than merging it too", () => {
    const withTwo = applyParsedDocument(
      emptyStoredProfile(),
      parse("PERFIL\nAnalista con seis años de experiencia.\n\nOBJETIVO PROFESIONAL\nLiderar un equipo de datos.\n\nEXPERIENCIA LABORAL\n\nNubia Retail | Analista | marzo 2021 – actualidad\nHice cosas."),
      info("hash-3"),
      ctx("src-3"),
    );
    expect(withTwo.profile.legacy.about.value).toBe("Analista con seis años de experiencia.");
    expect(withTwo.profile.unassigned).toContainEqual(
      expect.objectContaining({ kind: "summary", sourceId: "src-3", text: "Liderar un equipo de datos." }),
    );
  });

  it("fills a practical fact read from the document, and sends a conflicting one to the tray instead of overwriting it", () => {
    const withPractical = applyParsedDocument(
      emptyStoredProfile(),
      parse(
        "EXPERIENCIA LABORAL\n\nNubia Retail | Analista | marzo 2021 – actualidad\nHice cosas.\n\nCERTIFICACIONES E IDIOMAS\nDisponibilidad: Full time, Part time\n",
      ),
      info("hash-4"),
      ctx("src-4"),
    );
    expect(withPractical.profile.legacy.practical).toMatchObject({
      value: { availability: "Full time, Part time" },
      status: "proposed",
      source: { kind: "cv", docId: "src-4" },
    });

    const again = applyParsedDocument(
      withPractical.profile,
      parse(
        "EXPERIENCIA LABORAL\n\nOtra Empresa | Otro puesto | enero 2019 – marzo 2020\nHice otras cosas.\n\nCERTIFICACIONES E IDIOMAS\nDisponibilidad: Solo fines de semana\n",
      ),
      info("hash-5"),
      ctx("src-5"),
    );
    // A fact that already has a different value keeps it — `legacy.practical`
    // is one field for all five facts, so there is no per-fact status to
    // raise a formal conflict on, unlike `contact.email` or `legacy.about`.
    expect(again.profile.legacy.practical.value.availability).toBe("Full time, Part time");
    expect(again.profile.unassigned).toContainEqual(expect.objectContaining({ kind: "other", text: "Disponibilidad: Solo fines de semana" }));
  });

  it("projects to the plain profile the generators read, in the author's words", () => {
    const plain = toPlainProfile(profile);
    expect(plain.experience[0]).toMatchObject({
      company: "Nubia Retail",
      role: "Analista de Marketing Digital",
      start: "marzo 2021",
      bullets: [
        "Llevo las campañas de Google Ads y Meta para tres marcas.",
        "Preparo los informes mensuales para dirección.",
        "Coordino a la agencia que nos hace el contenido.",
      ],
    });
    expect(plain.skills).toContain("Google Analytics");
    expect(plain.languages.map((l) => [l.name, l.level])).toEqual([
      ["Español", "Nativo"],
      ["Inglés", "B2"],
    ]);
  });

  it("gives each thing an id, all different", () => {
    const ids = [
      ...profile.experience.map((e) => e.id),
      ...profile.experience.flatMap((e) => e.facts.map((f) => f.id)),
      ...profile.skills.map((s) => s.id),
      ...profile.languages.map((l) => l.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every quote is found in the document it names", () => {
    const flat = SPANISH_BULLETS.replace(/\s+/g, " ");
    const sources: string[] = [];
    for (const job of profile.experience) {
      for (const field of [job.company, job.role, job.start, job.end]) if (field.source?.quote) sources.push(field.source.quote);
      for (const fact of job.facts) sources.push(fact.source.quote ?? "");
    }
    for (const skill of profile.skills) sources.push(skill.name.source?.quote ?? "");
    expect(sources.length).toBeGreaterThan(15);
    for (const quote of sources) expect(flat, quote).toContain(quote.replace(/\s+/g, " "));
  });
});

describe("what it will not do", () => {
  it("does not read the same file twice", () => {
    const once = applyParsedDocument(emptyStoredProfile(), parse(SPANISH_BULLETS), info("same"), ctx());
    const again = applyParsedDocument(once.profile, parse(SPANISH_BULLETS), info("same"), ctx("src-2"));
    expect(again.duplicate).toBe(true);
    expect(again.profile).toBe(once.profile);
  });

  it("does not add a job it already has, from a different file", () => {
    const once = applyParsedDocument(emptyStoredProfile(), parse(SPANISH_BULLETS), info("a"), ctx());
    const again = applyParsedDocument(once.profile, parse(SPANISH_BULLETS), info("b"), ctx("src-2"));
    expect(again.duplicate).toBe(false);
    expect(again.added.experience).toBe(0);
    expect(again.added.skills).toBe(0);
    expect(again.profile.experience).toHaveLength(2);
    expect(again.profile.sources).toHaveLength(2);
  });

  it("does not overwrite contact details the profile already has", () => {
    const start = emptyStoredProfile();
    start.contact.fullName = { value: "Lucía F.", status: "edited", original: "LUCÍA FERNÁNDEZ" };
    start.contact.email = { value: "otra@example.com", status: "confirmed" };
    const { profile } = applyParsedDocument(start, parse(SPANISH_BULLETS), info(), ctx());
    expect(profile.contact.fullName.value).toBe("Lucía F.");
    expect(profile.contact.fullName.status).toBe("edited");
    expect(profile.contact.email.value).toBe("otra@example.com");
    // …but fills what was empty.
    expect(profile.contact.phone.value).toBe("+34 611 22 33 44");
  });

  it("does not touch the profile it was given", () => {
    const start = emptyStoredProfile();
    const copy = structuredClone(start);
    applyParsedDocument(start, parse(SPANISH_BULLETS), info(), ctx());
    expect(start).toEqual(copy);
  });

  it("proposes, rather than confirms, a block it was not sure of, and keeps both candidates", () => {
    const { profile } = applyParsedDocument(emptyStoredProfile(), parse(AMBIGUOUS), info(), ctx());
    const job = profile.experience[0]!;
    expect(job.company.status).toBe("proposed");
    expect(job.role.status).toBe("proposed");
    expect(job.review).toMatchObject({ confidence: "low", doubts: ["company_or_role"], candidates: ["Estrella Norte", "Mercado Sur"] });
  });

  it("does not repeat the same document's own bullet, but does add one that is new to it", () => {
    const first = applyParsedDocument(emptyStoredProfile(), parse(SPANISH_BULLETS), info("a"), ctx());
    const again = applyParsedDocument(first.profile, parse(SPANISH_BULLETS), info("b"), ctx("src-2"));
    // A byte-for-byte reimport adds nothing anywhere — the case `importOutcome` calls "unchanged" below.
    expect(again.added).toMatchObject({ experience: 0, education: 0, facts: 0, skills: 0, languages: 0, certifications: 0, conflicts: 0 });
  });
});

describe("the tools a job's own lines name", () => {
  const q = <T>(value: T, quote = String(value)) => ({ value, quote });
  const documentWith = (overrides: Partial<ParsedDocument>): ParsedDocument => ({
    kind: "cv",
    contact: { links: [] },
    experience: [],
    education: [],
    certifications: [],
    languages: [],
    skills: [],
    projects: [],
    unassigned: [],
    omittedPersonalData: 0,
    confidence: "high",
    lineCount: 0,
    ...overrides,
  });
  const job = (company: string, facts: string[]): ParsedExperience => ({
    kind: "job",
    company: q(company),
    role: q("Analista"),
    start: q({ year: 2015, month: 1 }, "enero 2015"),
    end: q({ year: 2017, month: 6 }, "junio 2017"),
    facts: facts.map((fact) => q(fact)),
    confidence: "high",
    doubts: [],
    span: [0, 0],
  });

  it("adds each one the skills do not list, as a proposal quoting its line and linked to its job", () => {
    const { profile } = applyParsedDocument(emptyStoredProfile(), parse(SPANISH_BULLETS), info(), ctx());
    const nubia = profile.experience.find((entry) => entry.company.value === "Nubia Retail")!;
    const ads = profile.skills.find((skill) => skill.name.value === "Google Ads")!;
    expect(ads.name).toMatchObject({ status: "proposed", source: { kind: "cv", docId: "src-1", quote: expect.stringContaining("Google Ads y Meta") } });
    expect(ads.experienceIds).toEqual([nubia.id]);
    // "Meta" is also a word ("meta cumplida"): the question asks about it instead.
    expect(profile.skills.some((skill) => skill.name.value === "Meta")).toBe(false);
  });

  it("leaves out one already turned down, and one the skills list under another spelling — linking that one instead", () => {
    const declined = emptyStoredProfile();
    declined.pending.push({ questionId: "loose_tool:item:google ads", ruleId: "loose_tool", entityId: "google ads", state: "na", count: 1, at: NOW });
    expect(applyParsedDocument(declined, parse(SPANISH_BULLETS), info(), ctx()).profile.skills.some((skill) => skill.name.value === "Google Ads")).toBe(false);

    const listed = emptyStoredProfile();
    listed.skills.push({ id: "s0", name: { value: "GoogleAds", status: "confirmed" }, experienceIds: [] });
    const { profile } = applyParsedDocument(listed, parse(SPANISH_BULLETS), info(), ctx());
    const ads = profile.skills.filter((skill) => skill.name.value.toLowerCase().replace(/\s/g, "") === "googleads");
    expect(ads.map((skill) => skill.id)).toEqual(["s0"]);
    expect(ads[0]!.experienceIds).toEqual([profile.experience.find((entry) => entry.company.value === "Nubia Retail")!.id]);
  });

  it("takes a proposal as the person's own once a document lists it among its skills", () => {
    const first = applyParsedDocument(emptyStoredProfile(), parse(SPANISH_BULLETS), info("a"), ctx());
    const second = applyParsedDocument(first.profile, documentWith({ skills: [q("Google Ads")] }), info("b"), ctx("src-2"));
    expect(second.profile.skills.filter((skill) => skill.name.value === "Google Ads")).toEqual([
      expect.objectContaining({ name: expect.objectContaining({ status: "confirmed", source: expect.objectContaining({ docId: "src-2" }) }) }),
    ]);
  });

  it("links a skill the document lists to the job whose lines name it", () => {
    const { profile } = applyParsedDocument(emptyStoredProfile(), documentWith({ experience: [job("Delta", ["Armaba los informes en Excel"])], skills: [q("Excel")] }), info(), ctx());
    expect(profile.skills).toEqual([expect.objectContaining({ name: expect.objectContaining({ value: "Excel", status: "confirmed" }), experienceIds: [profile.experience[0]!.id] })]);
  });

  it("does not put back a link the person took away, when a later document leaves that job alone", () => {
    const first = applyParsedDocument(emptyStoredProfile(), parse(SPANISH_BULLETS), info("a"), ctx());
    const draft = structuredClone(first.profile);
    const ads = draft.skills.find((skill) => skill.name.value === "Google Ads")!;
    ads.experienceIds = []; // "Sacar de este puesto", in the profile
    const later = applyParsedDocument(draft, documentWith({ experience: [job("Delta", ["Atendía el mostrador"])] }), info("b"), ctx("src-2"));
    expect(later.profile.skills.find((skill) => skill.id === ads.id)!.experienceIds).toEqual([]);
  });

  it("goes, with the reading that proposed it, when that reading is replaced", () => {
    const first = applyParsedDocument(emptyStoredProfile(), parse(SPANISH_BULLETS), info(), ctx());
    const draft = structuredClone(first.profile);
    const nubia = draft.experience.find((entry) => entry.company.value === "Nubia Retail")!;
    draft.skills.find((skill) => skill.name.value === "SEO")!.experienceIds = [nubia.id];
    const cleared = replaceSource(draft, "src-1");
    expect(cleared.skills.map((skill) => skill.name.value)).not.toContain("Google Ads");
    // What the document listed as skills stays, and no longer points at a job that is gone.
    expect(cleared.skills.find((skill) => skill.name.value === "SEO")!.experienceIds).toEqual([]);
  });
});

describe("one page, listed by two documents", () => {
  const withLinks = (kind: ParsedDocument["kind"], urls: string[], unassigned: ParsedDocument["unassigned"] = []): ParsedDocument => ({
    kind,
    contact: { links: urls.map((url) => ({ value: { label: url, url }, quote: url })) },
    experience: [],
    education: [],
    certifications: [],
    languages: [],
    skills: [],
    projects: [],
    unassigned,
    omittedPersonalData: 0,
    confidence: "high",
    lineCount: 0,
  });
  const cv = withLinks("cv", ["linkedin.com/in/perfil-ejemplo-1a2b3c4d5e", "github.com/perfil-ejemplo", "flashpage.com.ar"]);
  const linkedin = withLinks("linkedin_pdf", ["www.linkedin.com/in/perfil-ejemplo-1a2b3c4d5e"], [{ text: "https://flashpage.com.ar", kind: "link", heading: "Flash Page" }]);

  it("is listed once, whichever wording each used", () => {
    const first = applyParsedDocument(emptyStoredProfile(), cv, info("cv"), ctx());
    const second = applyParsedDocument(first.profile, linkedin, info("li"), ctx("src-2"));
    expect(second.profile.contact.links.value.map((link) => link.url)).toEqual([
      "https://linkedin.com/in/perfil-ejemplo-1a2b3c4d5e",
      "https://github.com/perfil-ejemplo",
      "https://flashpage.com.ar",
    ]);
  });

  it("is not left to place again when the links already hold it, whichever document came first", () => {
    const cvFirst = applyParsedDocument(applyParsedDocument(emptyStoredProfile(), cv, info("cv"), ctx()).profile, linkedin, info("li"), ctx("src-2"));
    expect(cvFirst.profile.unassigned).toEqual([]);
    const linkedinFirst = applyParsedDocument(emptyStoredProfile(), linkedin, info("li"), ctx());
    expect(linkedinFirst.profile.unassigned.map((item) => item.text)).toEqual(["https://flashpage.com.ar"]);
    const then = applyParsedDocument(linkedinFirst.profile, cv, info("cv"), ctx("src-2"));
    expect(then.profile.unassigned).toEqual([]);
    expect(then.profile.contact.links.value).toHaveLength(3);
  });
});

describe("importOutcome", () => {
  const stubJob: ParsedExperience = { kind: "job", facts: [], confidence: "high", doubts: [], span: [0, 0] };
  const emptyDoc = (overrides: Partial<ParsedDocument> = {}): ParsedDocument => ({
    kind: "cv",
    contact: { links: [] },
    experience: [],
    education: [],
    certifications: [],
    languages: [],
    skills: [],
    projects: [],
    unassigned: [],
    omittedPersonalData: 0,
    confidence: "high",
    lineCount: 0,
    ...overrides,
  });
  const ZERO_ADDED = { experience: 0, education: 0, facts: 0, skills: 0, languages: 0, certifications: 0, projects: 0, unassigned: 0, conflicts: 0 };
  const resultWith = (added: Partial<typeof ZERO_ADDED>): ApplyResult => ({
    profile: emptyStoredProfile(),
    duplicate: false,
    added: { ...ZERO_ADDED, ...added },
    omittedPersonalData: 0,
    confidence: "high",
  });

  it("is 'empty' for a document with no career content, even one that left a stray paragraph in 'Sin asignar'", () => {
    expect(importOutcome(emptyDoc(), resultWith({})).kind).toBe("empty");
    expect(importOutcome(emptyDoc({ unassigned: [{ text: "algo", kind: "other" }] }), resultWith({ unassigned: 1 })).kind).toBe("empty");
  });

  it("is 'added' for a document with content that changed something — a new fact, a conflict, or something unfiled", () => {
    expect(importOutcome(emptyDoc({ experience: [stubJob] }), resultWith({ facts: 1 })).kind).toBe("added");
    expect(importOutcome(emptyDoc({ experience: [stubJob] }), resultWith({ conflicts: 1 })).kind).toBe("added");
    expect(importOutcome(emptyDoc({ experience: [stubJob] }), resultWith({ unassigned: 1 })).kind).toBe("added");
  });

  it("is 'unchanged' — a success, not 'nothing found' — for a document with content that changed nothing", () => {
    expect(importOutcome(emptyDoc({ experience: [stubJob] }), resultWith({})).kind).toBe("unchanged");
  });
});

describe("how a document was read", () => {
  it("is said on nothing a pattern read", () => {
    const { profile } = applyParsedDocument(emptyStoredProfile(), parse(SPANISH_BULLETS), info(), ctx());
    expect(profile.sources[0]!.via).toBeUndefined();
    expect(profile.experience[0]!.company.source?.via).toBeUndefined();
    expect(profile.experience[0]!.facts[0]!.source.via).toBeUndefined();
  });

  it("is said on the document's record, and on every value a model read from it", () => {
    const parsed = { ...parse(SPANISH_BULLETS), via: "ai" as const };
    const { profile } = applyParsedDocument(emptyStoredProfile(), parsed, info("hash-ai"), ctx("src-ai"));
    expect(profile.sources[0]).toMatchObject({ id: "src-ai", via: "ai" });
    const job = profile.experience[0]!;
    expect(job.company.source).toMatchObject({ docId: "src-ai", via: "ai" });
    expect(job.start.source?.via).toBe("ai");
    expect(job.facts.every((fact) => fact.source.via === "ai")).toBe(true);
    expect(profile.skills[0]!.name.source?.via).toBe("ai");
  });

  it("is said of what a model added to a job a pattern had read, and not of what was already there", () => {
    const first = applyParsedDocument(emptyStoredProfile(), parse(SPANISH_BULLETS), info("h1"), ctx("src-1")).profile;
    const second = applyParsedDocument(first, { ...parse(SPANISH_BULLETS), via: "ai" as const }, info("h2"), ctx("src-2")).profile;
    expect(second.sources.map((entry) => entry.via)).toEqual([undefined, "ai"]);
    expect(second.experience[0]!.company.source?.via).toBeUndefined();
  });

  it("is a marker that survives being saved and read back, and a profile from before it still reads", () => {
    const parsed = { ...parse(SPANISH_BULLETS), via: "ai" as const };
    const { profile } = applyParsedDocument(emptyStoredProfile(), parsed, info("hash-ai"), ctx("src-ai"));
    expect(storedProfileSchema.parse(JSON.parse(JSON.stringify(profile)))).toEqual(profile);
    const old = JSON.parse(JSON.stringify(profile));
    delete old.sources[0].via;
    expect(storedProfileSchema.parse(old).sources[0]!.via).toBeUndefined();
    old.sources[0].via = "algo-que-no-existe";
    expect(storedProfileSchema.parse(old).sources[0]!.via).toBeUndefined();
  });
});
