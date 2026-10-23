import { describe, expect, it } from "vitest";
import { applyParsedDocument, type SourceInfo } from "@/lib/parse/to-profile";
import { certificationKey, companyKey, companyMatchKey, findMatchingExperience, mergeFacts } from "@/lib/onboarding/merge";
import { resolveConflict } from "@/lib/onboarding/review";
import { editContext } from "@/lib/profile/edit";
import { emptyStoredProfile, type StoredExperience } from "@/lib/schemas/profile-v2";
import type { ParsedDocument, ParsedEducation, ParsedExperience } from "@/lib/parse/types";

/**
 * Two sources describing the same career: the same job read from a CV and from
 * LinkedIn has to become one job with both sets of facts, not two jobs or a
 * silently dropped second reading — and where the two sources genuinely
 * disagree (an end date, an email), the person is asked, not decided for.
 */

const NOW = "2026-09-21T12:00:00.000Z";
let n = 0;
const ctx = (sourceId = "src-1") => ({ sourceId, now: NOW, newId: () => `id-${++n}` });
const info = (fileHash: string): SourceInfo => ({ name: "doc", fileHash, pasted: false, chars: 500 });

const quoted = (value: string) => ({ value, quote: value });

function job(overrides: Partial<ParsedExperience> = {}): ParsedExperience {
  return {
    kind: "job",
    company: quoted("Nubia Retail"),
    role: quoted("Analista de Marketing Digital"),
    start: { value: { year: 2021, month: 3 }, quote: "marzo 2021" },
    end: { value: { current: true }, quote: "actualidad" },
    facts: [],
    confidence: "high",
    doubts: [],
    span: [0, 0],
    ...overrides,
  };
}

function educ(overrides: Partial<ParsedEducation> = {}): ParsedEducation {
  return {
    institution: quoted("Universidad de Valencia"),
    degree: quoted("Licenciatura en Economía"),
    confidence: "high",
    doubts: [],
    span: [0, 0],
    ...overrides,
  };
}

function doc(experience: ParsedExperience[], overrides: Partial<ParsedDocument> = {}): ParsedDocument {
  return {
    kind: "cv",
    contact: { links: [] },
    experience,
    education: [],
    certifications: [],
    languages: [],
    skills: [],
    projects: [],
    unassigned: [],
    omittedPersonalData: 0,
    confidence: "high",
    lineCount: 10,
    ...overrides,
  };
}

describe("companyKey", () => {
  it("strips a legal-entity suffix so the two names compare equal", () => {
    expect(companyKey("Nubia Retail S.L.")).toBe(companyKey("Nubia Retail"));
    expect(companyKey("Acme Inc.")).toBe(companyKey("Acme"));
    expect(companyKey("Data Corp S.A. de C.V.")).toBe(companyKey("Data Corp"));
  });

  it("does not strip a name that only happens to contain those letters", () => {
    expect(companyKey("Sala de Ventas")).not.toBe(companyKey("Sala"));
  });

  it("never strips a company down to nothing", () => {
    expect(companyKey("S.A.")).not.toBe("");
  });
});

describe("mergeFacts", () => {
  it("keeps an exact repeat once, in the wording already there", () => {
    const existing = [{ id: "f1", kind: "responsibility" as const, text: "Llevo las campañas de Google Ads", source: { kind: "cv" as const, at: NOW }, status: "confirmed" as const }];
    const { facts, added } = mergeFacts(existing, [quoted("Llevo las campañas de Google Ads")], () => ({ kind: "linkedin_pdf", at: NOW }), () => "new-1");
    expect(facts).toHaveLength(1);
    expect(added).toBe(0);
  });

  it("adds what a model read out of a second document as proposed: a reading, not something the person said", () => {
    const existing = [{ id: "f1", kind: "responsibility" as const, text: "Llevo las campañas de Google Ads", source: { kind: "cv" as const, at: NOW }, status: "confirmed" as const }];
    const { facts, added } = mergeFacts(existing, [quoted("Coordino a la agencia de contenido")], () => ({ kind: "linkedin_pdf", via: "ai", at: NOW }), () => "new-1");
    expect(added).toBe(1);
    expect(facts[1]).toMatchObject({ text: "Coordino a la agencia de contenido", status: "proposed", source: { via: "ai" } });
    // What was already there is as it was.
    expect(facts[0]!.status).toBe("confirmed");
  });

  it("adds what a pattern read out of a second document as confirmed, as it did", () => {
    const existing = [{ id: "f1", kind: "responsibility" as const, text: "Llevo las campañas de Google Ads", source: { kind: "cv" as const, at: NOW }, status: "confirmed" as const }];
    const { facts } = mergeFacts(existing, [quoted("Coordino a la agencia de contenido")], () => ({ kind: "linkedin_pdf", at: NOW }), () => "new-1");
    expect(facts[1]!.status).toBe("confirmed");
  });

  it("adds a genuinely new statement", () => {
    const existing = [{ id: "f1", kind: "responsibility" as const, text: "Llevo las campañas de Google Ads", source: { kind: "cv" as const, at: NOW }, status: "confirmed" as const }];
    const { facts, added } = mergeFacts(existing, [quoted("Coordino a la agencia de contenido")], () => ({ kind: "linkedin_pdf", at: NOW }), () => "new-1");
    expect(facts).toHaveLength(2);
    expect(added).toBe(1);
    expect(facts[1]!.text).toBe("Coordino a la agencia de contenido");
  });
});

function storedJob(company: string, role = "Analista de Marketing Digital"): StoredExperience {
  return {
    id: "e1",
    company: { value: company, status: "confirmed" },
    role: { value: role, status: "confirmed" },
    city: { value: "", status: "confirmed" },
    country: { value: "", status: "confirmed" },
    start: { value: { year: 2021, month: 3 }, status: "confirmed" },
    end: { value: { current: true }, status: "confirmed" },
    facts: [],
  };
}

describe("findMatchingExperience", () => {
  const now = new Date(NOW);

  it("matches a company with a legal suffix against one without", () => {
    const found = findMatchingExperience([storedJob("Nubia Retail")], job({ company: quoted("Nubia Retail S.L.") }), now);
    expect(found?.id).toBe("e1");
  });

  it("does not match a different company", () => {
    expect(findMatchingExperience([storedJob("Grupo Lumen")], job(), now)).toBeUndefined();
  });
});

describe("applying a second document over the same profile", () => {
  it("folds a second source's facts into the matched job instead of adding a duplicate", () => {
    const cv = doc([job({ facts: [quoted("Llevo las campañas de Google Ads y Meta"), quoted("Preparo los informes mensuales")] })]);
    const first = applyParsedDocument(emptyStoredProfile(), cv, info("cv-1"), ctx());

    const linkedin = doc(
      [job({ company: quoted("Nubia Retail S.L."), facts: [quoted("Llevo las campañas de Google Ads y Meta."), quoted("Coordino a la agencia que nos hace el contenido")] })],
      { kind: "linkedin_pdf" },
    );
    const second = applyParsedDocument(first.profile, linkedin, info("li-1"), ctx("src-2"));

    expect(second.added.experience).toBe(0);
    expect(second.profile.experience).toHaveLength(1);
    const facts = second.profile.experience[0]!.facts.map((f) => f.text);
    expect(facts).toHaveLength(3);
    expect(facts).toContain("Coordino a la agencia que nos hace el contenido");
  });

  it("raises a conflict when the two sources give different end dates, and leaves the field as it was", () => {
    const cv = doc([job({ start: { value: { year: 2019 }, quote: "2019" }, end: { value: { year: 2021 }, quote: "2021" } })]);
    const first = applyParsedDocument(emptyStoredProfile(), cv, info("cv-1"), ctx());

    const linkedin = doc([job({ start: { value: { year: 2019 }, quote: "2019" }, end: { value: { year: 2022 }, quote: "2022" } })], { kind: "linkedin_pdf" });
    const second = applyParsedDocument(first.profile, linkedin, info("li-1"), ctx("src-2"));

    expect(second.profile.experience).toHaveLength(1);
    const job1 = second.profile.experience[0]!;
    expect(job1.end.value.year).toBe(2021); // untouched until the person picks one
    const conflict = second.profile.conflicts.find((c) => c.field === "end");
    expect(conflict).toMatchObject({
      entity: "experience",
      entityId: job1.id,
      current: { value: { year: 2021 } },
      incoming: { value: { year: 2022 } },
    });
  });

  it("merges automatically when the two dates are equal but one is more precise", () => {
    const cv = doc([job({ start: { value: { year: 2019 }, quote: "2019" } })]);
    const first = applyParsedDocument(emptyStoredProfile(), cv, info("cv-1"), ctx());

    const linkedin = doc([job({ start: { value: { year: 2019, month: 3 }, quote: "marzo de 2019" } })], { kind: "linkedin_pdf" });
    const second = applyParsedDocument(first.profile, linkedin, info("li-1"), ctx("src-2"));

    const job1 = second.profile.experience[0]!;
    expect(job1.start.value).toEqual({ year: 2019, month: 3 });
    expect(second.profile.conflicts.some((c) => c.field === "start")).toBe(false);
  });

  it("never overwrites, or even flags, a field the person has already edited", () => {
    const cv = doc([job()]);
    const first = applyParsedDocument(emptyStoredProfile(), cv, info("cv-1"), ctx());
    const job1 = first.profile.experience[0]!;
    job1.city = { value: "Valencia", status: "edited", original: "" };

    const linkedin = doc([job({ city: quoted("Barcelona") })], { kind: "linkedin_pdf" });
    const second = applyParsedDocument(first.profile, linkedin, info("li-1"), ctx("src-2"));

    const merged = second.profile.experience[0]!;
    expect(merged.city).toEqual({ value: "Valencia", status: "edited", original: "" });
    expect(second.profile.conflicts.some((c) => c.field === "city")).toBe(false);
  });

  it("a reimported CV adds a new bullet to the job that is already there", () => {
    const first = applyParsedDocument(emptyStoredProfile(), doc([job({ facts: [quoted("Llevo las campañas de Google Ads y Meta")] })]), info("cv-1"), ctx());
    const updated = applyParsedDocument(
      first.profile,
      doc([job({ facts: [quoted("Llevo las campañas de Google Ads y Meta"), quoted("Ahora también llevo el presupuesto de medios")] })]),
      info("cv-2"),
      ctx("src-2"),
    );

    expect(updated.added.experience).toBe(0);
    expect(updated.profile.experience).toHaveLength(1);
    const texts = updated.profile.experience[0]!.facts.map((f) => f.text);
    expect(texts).toContain("Ahora también llevo el presupuesto de medios");
    expect(texts).toHaveLength(2);
  });

  it("raises a conflict for a different email instead of overwriting it", () => {
    const start = emptyStoredProfile();
    start.contact.email = { value: "otra@example.com", status: "confirmed" };
    const applied = applyParsedDocument(start, doc([], { contact: { email: quoted("lucia@example.com"), links: [] } }), info("cv-1"), ctx());

    expect(applied.profile.contact.email.value).toBe("otra@example.com");
    const conflict = applied.profile.conflicts.find((c) => c.entity === "contact" && c.field === "email");
    expect(conflict).toMatchObject({ current: { value: "otra@example.com" }, incoming: { value: "lucia@example.com" } });
  });

  it("accepts a 'dump' document — an AI reading of what someone typed freely — the same as any other", () => {
    const applied = applyParsedDocument(emptyStoredProfile(), doc([job()], { kind: "dump" }), info("dump-1"), ctx());
    expect(applied.profile.sources[0]).toMatchObject({ kind: "dump" });
    expect(applied.profile.experience[0]!.company.source?.kind).toBe("dump");
  });
});

describe("one job, titled differently by a CV and by LinkedIn", () => {
  // As the same person's CV and LinkedIn export read it: one company, one span a month apart, two titles 0.05 alike.
  const cv = job({
    company: quoted("Flash Page"),
    role: quoted("Software Engineer"),
    city: quoted("Junín"),
    start: { value: { year: 2024, month: 4 }, quote: "Abril 2024" },
    end: { value: { current: true }, quote: "Actualidad" },
    facts: [
      quoted("Optimicé 300 consultas SQL en PostgreSQL y Redis, reduciendo el tiempo de respuesta en un 40%."),
      quoted("Administré un servidor Linux, gestionando servicios, procesos, logs, Nginx, SSL/TLS y firewall."),
    ],
  });
  const linkedin = job({
    company: quoted("Flash Page"),
    role: quoted("Full Stack Developer"),
    city: quoted("Junin"),
    start: { value: { year: 2024, month: 3 }, quote: "marzo de 2024" },
    end: { value: { current: true }, quote: "Present" },
    facts: [quoted("Desarrollo en backend: Spring Boot, Node.js"), quoted("Desarrollo en frontend: Angular, React")],
  });
  const both = (first: ParsedDocument, second: ParsedDocument) =>
    applyParsedDocument(applyParsedDocument(emptyStoredProfile(), first, info("one"), ctx()).profile, second, info("two"), ctx("src-2")).profile;

  it("is one job, with the lines of both, asking which title and which start to keep", () => {
    const profile = both(doc([cv]), doc([linkedin], { kind: "linkedin_pdf" }));
    expect(profile.experience).toHaveLength(1);
    expect(profile.experience[0]!.facts).toHaveLength(4);
    // "Junín" and "Junin" are one city; the title and the month are a real disagreement.
    expect(profile.conflicts.map((conflict) => conflict.field)).toEqual(["role", "start"]);
    expect(profile.conflicts[0]).toMatchObject({ current: { value: "Software Engineer" }, incoming: { value: "Full Stack Developer" } });
  });

  it("is one job whichever document comes first", () => {
    expect(both(doc([linkedin], { kind: "linkedin_pdf" }), doc([cv])).experience).toHaveLength(1);
  });

  it("is one job when the company is written together, or with how the job was held", () => {
    for (const company of ["FlashPage", "Flash Page (Freelance)", "Flash Page · Autónomo", "Flash Page S.A."]) {
      expect(both(doc([cv]), doc([{ ...linkedin, company: quoted(company) }], { kind: "linkedin_pdf" })).experience, company).toHaveLength(1);
    }
  });

  it("is two jobs when both documents say how it was held, and they disagree", () => {
    const held = (value: "full_time" | "freelance") => ({ employmentType: { value, quote: value } });
    expect(both(doc([{ ...cv, ...held("full_time") }]), doc([{ ...linkedin, ...held("freelance") }], { kind: "linkedin_pdf" })).experience).toHaveLength(2);
  });

  it("is two jobs when a reading was not sure which line was the company", () => {
    expect(both(doc([cv]), doc([{ ...linkedin, doubts: ["company_or_role"] }], { kind: "linkedin_pdf" })).experience).toHaveLength(2);
  });
});

describe("what is never read as one job under two titles", () => {
  const at = (role: string, from: number, to?: number) =>
    job({
      company: quoted("Colegio Norte"),
      role: quoted(role),
      start: { value: { year: from, month: 3 }, quote: `marzo ${from}` },
      end: to ? { value: { year: to, month: 12 }, quote: `diciembre ${to}` } : { value: { current: true }, quote: "actualidad" },
    });
  const both = (first: ParsedExperience[], second: ParsedExperience[]) =>
    applyParsedDocument(applyParsedDocument(emptyStoredProfile(), doc(first), info("one"), ctx()).profile, doc(second, { kind: "linkedin_pdf" }), info("two"), ctx("src-2")).profile;

  it("two jobs held at once at one place, against a third title for one of them: no guessing which", () => {
    const profile = both([at("Docente de matemática", 2020), at("Coordinadora de área", 2020)], [at("Profesora", 2020)]);
    expect(profile.experience).toHaveLength(3);
    expect(profile.conflicts).toHaveLength(0);
  });

  it("one job, against two titles a document gives at once: no guessing which", () => {
    expect(both([at("Profesora", 2020)], [at("Docente de matemática", 2020), at("Coordinadora de área", 2020)]).experience).toHaveLength(3);
  });

  it("a short stint inside a long job at the same place", () => {
    // 22 months in common, out of the longer job's 79: a season volunteering, not the same job.
    expect(both([at("Preceptor", 2020)], [at("Voluntario de la kermés", 2020, 2021)]).experience).toHaveLength(2);
  });
});

describe("the lists two documents both name, in two wordings", () => {
  const both = (first: Partial<ParsedDocument>, second: Partial<ParsedDocument>) =>
    applyParsedDocument(applyParsedDocument(emptyStoredProfile(), doc([], first), info("one"), ctx()).profile, doc([], { kind: "linkedin_pdf", ...second }), info("two"), ctx("src-2")).profile;

  it("one project spaced two ways, keeping the first description and taking the link only the second had", () => {
    const profile = both(
      { projects: [{ name: quoted("CVExact"), description: quoted("Genera CVs adaptados a cada oferta") }] },
      { projects: [{ name: quoted("CV Exact"), description: quoted("SaaS de CVs"), url: quoted("https://cvexact.com") }] },
    );
    expect(profile.projects).toHaveLength(1);
    expect(profile.projects[0]).toMatchObject({ description: { value: "Genera CVs adaptados a cada oferta" }, url: { value: "https://cvexact.com", status: "proposed" } });
  });

  it("one certification with and without 'Certified', taking the issuer only the second named", () => {
    const profile = both(
      { certifications: [{ name: quoted("AWS Cloud Practitioner") }] },
      { certifications: [{ name: quoted("AWS Certified Cloud Practitioner"), issuer: quoted("Amazon Web Services") }] },
    );
    expect(profile.certifications).toHaveLength(1);
    expect(profile.certifications[0]).toMatchObject({ name: { value: "AWS Cloud Practitioner" }, issuer: { value: "Amazon Web Services", status: "proposed" } });
    expect(certificationKey("Certificado")).toBe("certificado");
  });

  it("one language named in Spanish and in English, its level taken from the one that gave it", () => {
    const profile = both({ languages: [{ name: quoted("Inglés") }] }, { languages: [{ name: quoted("English"), level: quoted("Full Professional") }] });
    expect(profile.languages).toHaveLength(1);
    expect(profile.languages[0]).toMatchObject({ name: { value: "Inglés" }, level: { value: { raw: "Full Professional" }, status: "proposed" } });
  });
});

describe("companyMatchKey", () => {
  it("drops a legal suffix and how the job was held, at either end, and the spaces", () => {
    expect(companyMatchKey("Flash Page S.A. (Freelance)")).toBe("flashpage");
    expect(companyMatchKey("Freelance - Flash Page")).toBe("flashpage");
    expect(companyMatchKey("Nubia Retail S.L.")).toBe(companyMatchKey("Nubia Retail"));
  });

  it("keeps whatever is part of the name itself", () => {
    expect(companyMatchKey("Freelance")).toBe("freelance");
    expect(companyMatchKey("Full Stack Labs")).toBe("fullstacklabs");
  });
});

describe("a promotion — two roles at one company — is never merged into one", () => {
  const promotion = [
    job({
      role: quoted("Analista"),
      start: { value: { year: 2019, month: 1 }, quote: "enero 2019" },
      end: { value: { year: 2021, month: 3 }, quote: "marzo 2021" },
    }),
    job({
      role: quoted("Analista Sr."),
      start: { value: { year: 2021, month: 3 }, quote: "marzo 2021" },
      end: { value: { current: true }, quote: "actualidad" },
    }),
  ];

  it("keeps both roles from the very same document as two jobs, sharing their transition month", () => {
    const applied = applyParsedDocument(emptyStoredProfile(), doc(promotion), info("cv-1"), ctx());
    expect(applied.profile.experience).toHaveLength(2);
    expect(applied.profile.experience.map((j) => j.role.value)).toEqual(["Analista", "Analista Sr."]);
    expect(applied.profile.conflicts).toHaveLength(0);
  });

  it("matches each title to itself when the same promotion is read a second time, from LinkedIn", () => {
    const first = applyParsedDocument(emptyStoredProfile(), doc(promotion), info("cv-1"), ctx());
    const second = applyParsedDocument(first.profile, doc(promotion, { kind: "linkedin_pdf" }), info("li-1"), ctx("src-2"));

    expect(second.added.experience).toBe(0);
    expect(second.profile.experience).toHaveLength(2);
    expect(second.profile.experience.map((j) => j.role.value)).toEqual(["Analista", "Analista Sr."]);
    expect(second.profile.conflicts).toHaveLength(0);
  });
});

describe("a degree and a later one at the same university stay apart", () => {
  it("keeps a bachelor's and a master's from the same document as two entries", () => {
    const both = doc([], {
      education: [
        educ({ degree: quoted("Licenciatura en Economía"), start: { value: { year: 2013 }, quote: "2013" }, end: { value: { year: 2017 }, quote: "2017" } }),
        educ({ degree: quoted("Maestría en Economía"), start: { value: { year: 2018 }, quote: "2018" }, end: { value: { year: 2020 }, quote: "2020" } }),
      ],
    });
    const applied = applyParsedDocument(emptyStoredProfile(), both, info("cv-1"), ctx());
    expect(applied.profile.education).toHaveLength(2);
    expect(applied.profile.education.map((e) => e.degree.value)).toEqual(["Licenciatura en Economía", "Maestría en Economía"]);
    expect(applied.profile.conflicts).toHaveLength(0);
  });

  it("still merges the very same degree read a second time, once dated, since their spans overlap", () => {
    const dated = educ({ start: { value: { year: 2013 }, quote: "2013" }, end: { value: { year: 2017 }, quote: "2017" } });
    const first = applyParsedDocument(emptyStoredProfile(), doc([], { education: [dated] }), info("cv-1"), ctx());
    const second = applyParsedDocument(
      first.profile,
      doc([], { education: [educ({ ...dated, honors: quoted("Cum laude") })], kind: "linkedin_pdf" }),
      info("li-1"),
      ctx("src-2"),
    );
    expect(second.added.education).toBe(0);
    expect(second.profile.education).toHaveLength(1);
    expect(second.profile.education[0]!.honors.value).toBe("Cum laude");
  });

  it("merges an undated degree only when the title matches exactly", () => {
    const first = applyParsedDocument(emptyStoredProfile(), doc([], { education: [educ()] }), info("cv-1"), ctx());
    const second = applyParsedDocument(
      first.profile,
      doc([], { education: [educ({ honors: quoted("Cum laude") })], kind: "linkedin_pdf" }),
      info("li-1"),
      ctx("src-2"),
    );
    expect(second.added.education).toBe(0);
    expect(second.profile.education).toHaveLength(1);
    expect(second.profile.education[0]!.honors.value).toBe("Cum laude");
  });
});

describe("an institution named once by its acronym and once in full", () => {
  it("merges rather than duplicating, undated, when the degree matches exactly", () => {
    const cv = educ({ institution: quoted("Universidad Nacional del Noroeste de la Provincia de Buenos Aires"), degree: quoted("Analista de Sistemas") });
    const first = applyParsedDocument(emptyStoredProfile(), doc([], { education: [cv] }), info("cv-1"), ctx());

    const linkedin = educ({
      institution: quoted("UNNOBA"),
      degree: quoted("Analista de Sistemas"),
      start: { value: { year: 2020, month: 3 }, quote: "marzo de 2020" },
      end: { value: { year: 2024, month: 11 }, quote: "noviembre de 2024" },
    });
    const second = applyParsedDocument(first.profile, doc([], { education: [linkedin], kind: "linkedin_pdf" }), info("li-1"), ctx("src-2"));

    expect(second.added.education).toBe(0);
    expect(second.profile.education).toHaveLength(1);
    // The dates LinkedIn had and the CV did not are still worth keeping.
    expect(second.profile.education[0]!.start.value).toMatchObject({ year: 2020, month: 3 });
  });

  it("does not merge two institutions whose initials merely happen to coincide with an unrelated word", () => {
    const cv = educ({ institution: quoted("Universidad de Buenos Aires"), degree: quoted("Analista de Sistemas") });
    const first = applyParsedDocument(emptyStoredProfile(), doc([], { education: [cv] }), info("cv-1"), ctx());

    // "UNNOBA" does not spell out of "Universidad de Buenos Aires"'s own initials.
    const linkedin = educ({ institution: quoted("UNNOBA"), degree: quoted("Analista de Sistemas") });
    const second = applyParsedDocument(first.profile, doc([], { education: [linkedin], kind: "linkedin_pdf" }), info("li-1"), ctx("src-2"));

    expect(second.added.education).toBe(1);
    expect(second.profile.education).toHaveLength(2);
  });
});

describe("when the two sources name the role or the degree differently", () => {
  it("raises a conflict for a role spelled differently, even in another language", () => {
    const cv = doc([job({ role: quoted("Analista de Marketing Digital") })]);
    const first = applyParsedDocument(emptyStoredProfile(), cv, info("cv-1"), ctx());

    const linkedin = doc([job({ role: quoted("Digital Marketing Analyst") })], { kind: "linkedin_pdf" });
    const second = applyParsedDocument(first.profile, linkedin, info("li-1"), ctx("src-2"));

    expect(second.profile.experience).toHaveLength(1);
    expect(second.profile.experience[0]!.role.value).toBe("Analista de Marketing Digital"); // untouched until chosen
    const conflict = second.profile.conflicts.find((c) => c.field === "role");
    expect(conflict).toMatchObject({
      entity: "experience",
      current: { value: "Analista de Marketing Digital" },
      incoming: { value: "Digital Marketing Analyst" },
    });
  });

  it("raises no conflict when the two role spellings are the same once normalised", () => {
    const cv = doc([job({ role: quoted("Analista de Marketing Digital") })]);
    const first = applyParsedDocument(emptyStoredProfile(), cv, info("cv-1"), ctx());

    const linkedin = doc([job({ role: quoted("analista  de marketing digital") })], { kind: "linkedin_pdf" });
    const second = applyParsedDocument(first.profile, linkedin, info("li-1"), ctx("src-2"));

    expect(second.profile.conflicts.some((c) => c.field === "role")).toBe(false);
  });

  it("raises a conflict for a differently spelled degree, once a shared span says it is the same one", () => {
    const span = { start: { value: { year: 2013 }, quote: "2013" }, end: { value: { year: 2017 }, quote: "2017" } };
    const first = applyParsedDocument(emptyStoredProfile(), doc([], { education: [educ(span)] }), info("cv-1"), ctx());
    const second = applyParsedDocument(
      first.profile,
      doc([], { education: [educ({ ...span, degree: quoted("Grado en Economía") })], kind: "linkedin_pdf" }),
      info("li-1"),
      ctx("src-2"),
    );
    expect(second.profile.education).toHaveLength(1); // matched, not a second entry
    const conflict = second.profile.conflicts.find((c) => c.field === "degree");
    expect(conflict).toMatchObject({ entity: "education", current: { value: "Licenciatura en Economía" }, incoming: { value: "Grado en Economía" } });
  });
});

describe("a language's level, read from a second source", () => {
  function langDoc(name: string, level?: string): ParsedDocument {
    return doc([], { languages: [{ name: quoted(name), ...(level ? { level: quoted(level) } : {}) }] });
  }

  it("fills in a level the first source never gave", () => {
    const first = applyParsedDocument(emptyStoredProfile(), langDoc("Inglés"), info("cv-1"), ctx());
    expect(first.profile.languages[0]!.level.value).toEqual({});

    const second = applyParsedDocument(first.profile, langDoc("Inglés", "B2"), info("li-1"), ctx("src-2"));
    expect(second.added.languages).toBe(0);
    expect(second.profile.languages).toHaveLength(1);
    expect(second.profile.languages[0]!.level).toMatchObject({ value: { cefr: "B2", raw: "B2" }, status: "proposed" });
  });

  it("raises a conflict when the two sources give a different level", () => {
    const first = applyParsedDocument(emptyStoredProfile(), langDoc("Inglés", "B2"), info("cv-1"), ctx());
    const second = applyParsedDocument(first.profile, langDoc("Inglés", "C1"), info("li-1"), ctx("src-2"));

    expect(second.profile.languages).toHaveLength(1);
    expect(second.profile.languages[0]!.level.value).toEqual({ cefr: "B2", raw: "B2" }); // untouched until chosen
    const conflict = second.profile.conflicts.find((c) => c.entity === "language");
    expect(conflict).toMatchObject({ field: "level", current: { value: { cefr: "B2", raw: "B2" } }, incoming: { value: { cefr: "C1", raw: "C1" } } });
  });

  it("raises no conflict when the two sources agree", () => {
    const first = applyParsedDocument(emptyStoredProfile(), langDoc("Inglés", "B2"), info("cv-1"), ctx());
    const second = applyParsedDocument(first.profile, langDoc("Inglés", "B2"), info("li-1"), ctx("src-2"));
    expect(second.profile.conflicts).toHaveLength(0);
  });
});

describe("resolveConflict", () => {
  it("keeping the current value clears the conflict without touching the field", () => {
    const profile = emptyStoredProfile();
    profile.contact.email = { value: "otra@example.com", status: "confirmed" };
    profile.conflicts.push({
      id: "c1",
      entity: "contact",
      entityId: "contact",
      field: "email",
      current: { value: "otra@example.com" },
      incoming: { value: "lucia@example.com", source: { kind: "cv", at: NOW } },
      at: NOW,
    });

    expect(resolveConflict(profile, "c1", "current", editContext({ now: NOW, newId: () => "e1" }))).toBe(true);
    expect(profile.conflicts).toHaveLength(0);
    expect(profile.contact.email.value).toBe("otra@example.com");
  });

  it("taking the incoming value confirms the field under that source, not as an edit", () => {
    const profile = emptyStoredProfile();
    profile.contact.email = { value: "otra@example.com", status: "confirmed" };
    profile.conflicts.push({
      id: "c1",
      entity: "contact",
      entityId: "contact",
      field: "email",
      current: { value: "otra@example.com" },
      incoming: { value: "lucia@example.com", source: { kind: "cv", at: NOW } },
      at: NOW,
    });

    expect(resolveConflict(profile, "c1", "incoming", editContext({ now: NOW, newId: () => "e1" }))).toBe(true);
    expect(profile.conflicts).toHaveLength(0);
    // Picking a version is the person saying it is so: the source stays the document's, and the day they said it is kept (e5, O2).
    expect(profile.contact.email).toEqual({ value: "lucia@example.com", status: "confirmed", source: { kind: "cv", at: NOW }, confirmedAt: NOW });
  });

  it("keeping the current value confirms it under its own source, even if it was still only proposed", () => {
    const profile = emptyStoredProfile();
    profile.contact.email = { value: "otra@example.com", status: "proposed", source: { kind: "cv", at: NOW } };
    profile.conflicts.push({
      id: "c1",
      entity: "contact",
      entityId: "contact",
      field: "email",
      current: { value: "otra@example.com", source: { kind: "cv", at: NOW } },
      incoming: { value: "lucia@example.com", source: { kind: "linkedin_pdf", at: NOW } },
      at: NOW,
    });

    expect(resolveConflict(profile, "c1", "current", editContext({ now: NOW, newId: () => "e1" }))).toBe(true);
    expect(profile.conflicts).toHaveLength(0);
    expect(profile.contact.email).toEqual({ value: "otra@example.com", status: "confirmed", source: { kind: "cv", at: NOW }, confirmedAt: NOW });
  });

  it("a custom value is applied the same way, for the date case the spec asks for", () => {
    const profile = emptyStoredProfile();
    profile.experience.push({
      id: "e1",
      company: { value: "Nubia Retail", status: "confirmed" },
      role: { value: "Analista", status: "confirmed" },
      city: { value: "", status: "confirmed" },
      country: { value: "", status: "confirmed" },
      start: { value: { year: 2019 }, status: "confirmed" },
      end: { value: { year: 2021 }, status: "confirmed" },
      facts: [],
    });
    profile.conflicts.push({
      id: "c1",
      entity: "experience",
      entityId: "e1",
      field: "end",
      current: { value: { year: 2021 } },
      incoming: { value: { year: 2022 }, source: { kind: "linkedin_pdf", at: NOW } },
      at: NOW,
    });

    resolveConflict(profile, "c1", { value: { year: 2021, month: 6 } }, editContext({ now: NOW, newId: () => "e2" }));
    expect(profile.experience[0]!.end.value).toEqual({ year: 2021, month: 6 });
    expect(profile.experience[0]!.end.status).toBe("edited");
  });
});
