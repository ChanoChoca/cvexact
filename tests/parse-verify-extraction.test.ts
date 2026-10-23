import { describe, expect, it } from "vitest";
import { splitCovers, verifyExtraction, verifySplit } from "@/lib/parse/verify-extraction";
import { applyParsedDocument } from "@/lib/parse/to-profile";
import { asOriginalKind, needsAttention } from "@/lib/onboarding/review";
import { provenanceOf } from "@/lib/onboarding/provenance";
import { emptyStoredProfile } from "@/lib/schemas/profile-v2";
import type { Extraction } from "@/lib/ai/prompts/extract";
import type { SplitResult } from "@/lib/ai/prompts/split";

/**
 * What a model claims is never the same thing as what a document says. Every
 * case here is a claim that has to survive being checked against the source
 * text before it becomes part of a profile — the same bar the deterministic
 * parsers meet by construction, held here instead of assumed.
 */

const TEXT = `LUCÍA FERNÁNDEZ
Nubia Retail | Analista de Marketing Digital | marzo 2021 – actualidad
Llevo las campañas de Google Ads y Meta para tres marcas.
Google Analytics, SEO`;

const q = (value: string, quote = value) => ({ value, quote });

function extraction(overrides: Partial<Extraction> = {}): Extraction {
  return {
    contact: { fullName: null, headline: null, email: null, phone: null, city: null, country: null, links: [] },
    experience: [],
    education: [],
    certifications: [],
    languages: [],
    skills: [],
    projects: [],
    unassigned: [],
    ...overrides,
  };
}

describe("quote matching", () => {
  it("finds a quote despite different case, accents and spacing", () => {
    const result = verifyExtraction(
      TEXT,
      extraction({ contact: { ...extraction().contact, fullName: q("Lucía Fernández", "  lucia   FERNANDEZ ") } }),
      "cv",
    );
    expect(result.contact.fullName?.value).toBe("Lucía Fernández");
  });

  it("discards a value whose quote is not in the document at all", () => {
    const result = verifyExtraction(
      TEXT,
      extraction({ contact: { ...extraction().contact, fullName: q("Alguien Inventado") } }),
      "cv",
    );
    expect(result.contact.fullName).toBeUndefined();
  });
});

describe("experience", () => {
  it("drops a fabricated company along with the entry, when nothing else anchors it", () => {
    const result = verifyExtraction(
      TEXT,
      extraction({
        experience: [
          {
            kind: "job",
            company: q("Empresa Que No Existe"),
            role: null,
            city: null,
            country: null,
            start: null,
            end: null,
            facts: [],
          },
        ],
      }),
      "cv",
    );
    expect(result.experience).toHaveLength(0);
  });

  it("keeps a real company and a real date, and drops a fact that is not in the text", () => {
    const result = verifyExtraction(
      TEXT,
      extraction({
        experience: [
          {
            kind: "job",
            company: q("Nubia Retail"),
            role: q("Analista de Marketing Digital"),
            city: null,
            country: null,
            start: q("marzo 2021"),
            end: q("actualidad"),
            facts: [q("Llevo las campañas de Google Ads y Meta para tres marcas."), q("Lideré un equipo de doce personas")],
          },
        ],
      }),
      "cv",
    );
    const job = result.experience[0]!;
    expect(job.company?.value).toBe("Nubia Retail");
    expect(job.start?.value).toEqual({ year: 2021, month: 3, raw: "marzo 2021" });
    expect(job.end?.value).toMatchObject({ current: true });
    expect(job.facts).toHaveLength(1);
    expect(job.doubts).toEqual([]);
  });

  it("discards a value that does not appear in its own quote, even when the quote is real", () => {
    const result = verifyExtraction(
      TEXT,
      extraction({
        experience: [
          {
            kind: "job",
            company: q("Nubia Retail"),
            role: q("Senior Manager", "Analista de Marketing Digital"),
            city: null,
            country: null,
            start: null,
            end: null,
            facts: [],
          },
        ],
      }),
      "cv",
    );
    const job = result.experience[0]!;
    expect(job.company?.value).toBe("Nubia Retail");
    expect(job.role).toBeUndefined();
    expect(job.doubts).toContain("no_role");
  });

  it("keeps a value found inside a broader quote, tolerating case and accents there too", () => {
    const result = verifyExtraction(
      TEXT,
      extraction({
        experience: [
          {
            kind: "job",
            company: q("nubia RETAIL", "Nubia Retail | Analista de Marketing Digital"),
            role: null,
            city: null,
            country: null,
            start: null,
            end: null,
            facts: [],
          },
        ],
      }),
      "cv",
    );
    expect(result.experience[0]?.company?.value).toBe("nubia RETAIL");
  });

  it("keeps a bare year as a year, never inventing a month", () => {
    const withYear = `${TEXT}\nGrupo Lumen | Asistente | 2019 – 2021`;
    const result = verifyExtraction(
      withYear,
      extraction({
        experience: [
          {
            kind: "job",
            company: q("Grupo Lumen"),
            role: q("Asistente"),
            city: null,
            country: null,
            start: q("2019"),
            end: q("2021"),
            facts: [],
          },
        ],
      }),
      "cv",
    );
    expect(result.experience[0]!.start?.value).toEqual({ year: 2019, raw: "2019" });
    expect(result.experience[0]!.end?.value).toEqual({ year: 2021, raw: "2021" });
  });

  it("flags what is still missing once verification has run", () => {
    const result = verifyExtraction(
      TEXT,
      extraction({
        experience: [
          { kind: "job", company: q("Nubia Retail"), role: null, city: null, country: null, start: null, end: null, facts: [] },
        ],
      }),
      "cv",
    );
    expect(result.experience[0]!.doubts).toContain("no_role");
    expect(result.experience[0]!.doubts).toContain("no_dates");
    expect(result.experience[0]!.confidence).toBe("medium");
  });
});

describe("quote matching does not cross a word boundary", () => {
  it("does not let a value match as a fragment of a longer word inside its own quote", () => {
    const result = verifyExtraction(
      TEXT,
      extraction({
        experience: [
          { kind: "job", company: q("Nubia Retail"), role: q("nalista", "Analista de Marketing Digital"), city: null, country: null, start: null, end: null, facts: [] },
        ],
      }),
      "cv",
    );
    // The quote is genuine and in the document; "nalista" is a real run of characters inside "Analista", but not a word of its own.
    expect(result.experience[0]?.role).toBeUndefined();
  });

  it("does not match a short code inside a longer one that happens to contain it", () => {
    const withCode = `${TEXT}\nRubro: comercio B2B`;
    const result = verifyExtraction(withCode, extraction({ skills: [q("B2")] }), "cv");
    expect(result.skills).toHaveLength(0);
  });
});

describe("a language's level", () => {
  it("keeps a level quoted from the same line as the language's own name", () => {
    const withLevel = `${TEXT}\nIdiomas: Inglés: B2`;
    const result = verifyExtraction(withLevel, extraction({ languages: [{ name: q("Inglés"), level: q("B2") }] }), "cv");
    expect(result.languages[0]).toMatchObject({ name: { value: "Inglés" }, level: { value: "B2" } });
  });

  it("keeps a level whose own quote names the language, even from a different line", () => {
    const withLevel = `${TEXT}\nIdiomas: Inglés\nNivel de inglés: B2`;
    const result = verifyExtraction(withLevel, extraction({ languages: [{ name: q("Inglés"), level: q("B2", "Nivel de inglés: B2") }] }), "cv");
    expect(result.languages[0]?.level?.value).toBe("B2");
  });

  it("drops a level named only somewhere else in the document, like a skill", () => {
    const withSkill = `${TEXT}\nIdiomas: Inglés, Francés\nHabilidades: React Native, Google Analytics`;
    const result = verifyExtraction(withSkill, extraction({ languages: [{ name: q("Francés"), level: q("Native", "React Native") }] }), "cv");
    expect(result.languages[0]?.name.value).toBe("Francés");
    expect(result.languages[0]?.level).toBeUndefined();
  });
});

describe("education status", () => {
  const withStatus = (line: string) => `${TEXT}\nUniversidad de Valencia\nGrado en ADE ${line}`;

  it("keeps a status whose quote actually says the degree is unfinished", () => {
    const result = verifyExtraction(
      withStatus("(en curso)"),
      extraction({
        education: [{ institution: q("Universidad de Valencia"), degree: q("Grado en ADE"), city: null, country: null, start: null, end: null, honors: null, status: { value: "in_progress" as const, quote: "en curso" } }],
      }),
      "cv",
    );
    expect(result.education[0]?.status).toMatchObject({ value: "in_progress" });
  });

  it("drops a status whose quote exists in the document but says nothing about being unfinished", () => {
    const result = verifyExtraction(
      withStatus("(2013 - 2017)"),
      extraction({
        education: [{ institution: q("Universidad de Valencia"), degree: q("Grado en ADE"), city: null, country: null, start: null, end: null, honors: null, status: { value: "in_progress" as const, quote: "Grado en ADE" } }],
      }),
      "cv",
    );
    expect(result.education[0]?.status).toBeUndefined();
  });
});

describe("a block that never becomes a job still keeps what it said", () => {
  it("sends an unmatched entry's facts to 'Sin asignar' instead of losing them", () => {
    const result = verifyExtraction(
      TEXT,
      extraction({
        experience: [
          {
            kind: "job",
            company: q("Empresa Inventada"),
            role: null,
            city: null,
            country: null,
            start: null,
            end: null,
            facts: [q("Llevo las campañas de Google Ads y Meta para tres marcas."), q("Un hecho que no está en el texto")],
          },
        ],
      }),
      "cv",
    );
    expect(result.experience).toHaveLength(0);
    // Only the fact that was itself found in the document survives, as its own unassigned entry.
    expect(result.unassigned).toEqual([{ text: "Llevo las campañas de Google Ads y Meta para tres marcas.", kind: "other" }]);
  });
});

describe("skills", () => {
  it("discards a skill the document never mentions", () => {
    const result = verifyExtraction(TEXT, extraction({ skills: [q("Google Analytics"), q("Kubernetes")] }), "cv");
    expect(result.skills.map((s) => s.value)).toEqual(["Google Analytics"]);
  });
});

describe("the document as a whole", () => {
  it("carries the kind it was given, medium confidence, and the lines to show as the original", () => {
    const result = verifyExtraction(TEXT, extraction(), "dump");
    expect(result.kind).toBe("dump");
    expect(result.confidence).toBe("medium");
    expect(result.omittedPersonalData).toBe(0);
    expect(result.lines).toEqual(TEXT.split("\n"));
  });
});

describe("verifySplit", () => {
  const answer = "Llevo las campañas de Google Ads y Meta, el SEO de la web y preparo los informes mensuales.";

  it("keeps a piece that is a literal run of the answer", () => {
    const result: SplitResult = { pieces: ["Llevo las campañas de Google Ads y Meta", "el SEO de la web"] };
    expect(verifySplit(answer, result)).toEqual(["Llevo las campañas de Google Ads y Meta", "el SEO de la web"]);
  });

  it("drops a piece that reworded the answer instead of quoting it", () => {
    const result: SplitResult = { pieces: ["Gestiona las campañas publicitarias de la empresa"] };
    expect(verifySplit(answer, result)).toEqual([]);
  });

  it("tolerates case and accent differences the same way quote-matching does", () => {
    const result: SplitResult = { pieces: ["EL SEO DE LA WEB"] };
    expect(verifySplit(answer, result)).toEqual(["EL SEO DE LA WEB"]);
  });
});

describe("splitCovers", () => {
  // Lucía's answer from the spec's own example (§8): four pieces that between
  // them say everything she did, leaving only "y" and "También" to the joins.
  const answer =
    "Llevo las campañas de Google Ads y Meta, el SEO de la web y preparo los informes mensuales para dirección. " +
    "También coordino a la agencia que nos hace el contenido.";
  const pieces = [
    "Llevo las campañas de Google Ads y Meta",
    "el SEO de la web",
    "preparo los informes mensuales para dirección",
    "coordino a la agencia que nos hace el contenido",
  ];

  it("covers the answer when only connectors are left to the joins between pieces", () => {
    expect(splitCovers(answer, pieces)).toBe(true);
  });

  it("does not cover the answer when a whole clause is missing from every piece", () => {
    expect(splitCovers(answer, pieces.slice(0, 3))).toBe(false);
  });

  it("does not cover the answer when a piece reworded a clause instead of quoting it", () => {
    const reworded = [...pieces.slice(0, 3), "Gestiona el contenido con una agencia externa"];
    expect(splitCovers(answer, reworded)).toBe(false);
  });

  it("is vacuously true for an answer that is nothing but connectors", () => {
    expect(splitCovers("y también", [])).toBe(true);
  });
});

describe("what someone wrote themselves", () => {
  // "Contámelo a mi manera": the words are theirs, and so is what comes out whole of them.
  const SAID =
    "Trabajo en Kiosco del Centro como cajero desde marzo 2021 hasta la actualidad, atiendo la caja. " +
    "Antes fui repositor en Supermercado Sur. Estudié la Licenciatura en Administración en la Universidad Nacional de Córdoba.";

  const whole = {
    kind: "job" as const,
    company: q("Kiosco del Centro"),
    role: q("cajero"),
    city: null,
    country: null,
    start: q("marzo 2021"),
    end: q("actualidad"),
    facts: [q("atiendo la caja")],
  };
  const noDates = { ...whole, company: q("Supermercado Sur"), role: q("repositor"), start: null, end: null, facts: [] };
  const study = { institution: q("Universidad Nacional de Córdoba"), degree: q("Licenciatura en Administración"), city: null, country: null, start: null, end: null, status: null, honors: null };

  it("comes in whole as theirs when it names, places and dates what it is about", () => {
    const [job] = verifyExtraction(SAID, extraction({ experience: [whole] }), "dump").experience;
    expect(job).toMatchObject({ confidence: "high", doubts: [] });
  });

  it("is still asked about when something is missing", () => {
    const [job] = verifyExtraction(SAID, extraction({ experience: [noDates] }), "dump").experience;
    expect(job).toMatchObject({ confidence: "medium", doubts: ["no_dates"] });
    const [noEnd] = verifyExtraction(SAID, extraction({ experience: [{ ...whole, end: null }] }), "dump").experience;
    expect(noEnd).toMatchObject({ confidence: "medium", doubts: ["no_end"] });
    const [noRole] = verifyExtraction(SAID, extraction({ experience: [{ ...whole, role: null }] }), "dump").experience;
    expect(noRole!.confidence).toBe("medium");
  });

  it("is still asked about when the words say the company and the role may be the wrong way round", () => {
    const [job] = verifyExtraction(SAID, extraction({ experience: [{ ...whole, company: q("cajero"), role: q("Kiosco del Centro") }] }), "dump").experience;
    expect(job!.confidence).toBe("medium");
    expect(job!.doubts).toContain("company_or_role");
    expect(job!.candidates).toEqual(["Kiosco del Centro", "cajero"]);
  });

  it("is not doubted just because nothing in the words says which is which", () => {
    const [job] = verifyExtraction(SAID, extraction({ experience: [{ ...whole, company: q("Kiosco del Centro"), role: q("cajero") }] }), "dump").experience;
    expect(job!.doubts).not.toContain("company_or_role");
  });

  it("holds a study as theirs when it says what and where, with no dates asked of it", () => {
    const [entry] = verifyExtraction(SAID, extraction({ education: [study] }), "dump").education;
    expect(entry).toMatchObject({ confidence: "high", doubts: [] });
    const [half] = verifyExtraction(SAID, extraction({ education: [{ ...study, institution: null }] }), "dump").education;
    expect(half).toMatchObject({ confidence: "medium", doubts: ["no_institution"] });
  });

  it("gives a document nobody wrote in their own words no such credit: everything stays a model's reading", () => {
    const result = verifyExtraction(SAID, extraction({ experience: [whole], education: [study] }), "cv");
    expect(result.experience[0]!.confidence).toBe("medium");
    expect(result.education[0]!.confidence).toBe("medium");
  });

  it("enters the profile confirmed, as what they said, with only the incomplete left to look at", () => {
    const parsed = verifyExtraction(SAID, extraction({ experience: [whole, noDates], education: [study] }), "dump");
    const { profile } = applyParsedDocument(
      emptyStoredProfile(),
      parsed,
      { name: "Lo que contaste", fileHash: "", pasted: true, chars: SAID.length },
      { sourceId: "s1", now: "2026-09-21T12:00:00.000Z", newId: (() => { let n = 0; return () => `id-${++n}`; })() },
    );
    const [complete, incomplete] = profile.experience;
    expect(complete!.company.status).toBe("confirmed");
    // Theirs — and said to have been read by a model, which is how it got to be structured.
    expect(provenanceOf(complete!.company.status, complete!.company.source)).toMatchObject({ label: "Lo dijiste vos · leído con IA", tone: "said" });
    expect(needsAttention(complete!)).toBe(false);
    expect(needsAttention(incomplete!)).toBe(true);
    expect(needsAttention(profile.education[0]!)).toBe(false);
  });
});

describe("a document read again with a model", () => {
  const job = {
    kind: "job" as const,
    company: q("Nubia Retail"),
    role: q("Analista de Marketing Digital"),
    city: null,
    country: null,
    start: q("marzo 2021"),
    end: q("actualidad"),
    facts: [],
  };
  const apply = (kind: "cv" | "linkedin_pdf" | "linkedin_csv" | "dump" | undefined) =>
    applyParsedDocument(
      emptyStoredProfile(),
      asOriginalKind(verifyExtraction(TEXT, extraction({ experience: [job] }), "cv"), kind),
      { name: "Profile.pdf", fileHash: "", pasted: false, chars: TEXT.length },
      { sourceId: "s2", now: "2026-10-03T12:00:00.000Z", newId: (() => { let n = 0; return () => `id-${++n}`; })() },
    ).profile;

  it("keeps being a LinkedIn profile: its source and what it says are «De LinkedIn», read with a model", () => {
    const profile = apply("linkedin_pdf");
    expect(profile.sources[0]).toMatchObject({ kind: "linkedin_pdf", via: "ai" });
    const company = profile.experience[0]!.company;
    expect(company.source).toMatchObject({ kind: "linkedin_pdf", via: "ai" });
    expect(provenanceOf(company.status, company.source)).toMatchObject({ label: "De LinkedIn · leído con IA", tone: "linkedin" });
  });

  it("keeps being a CV when it was a CV, and is left alone when there is nothing to go back to", () => {
    for (const kind of ["cv", undefined] as const) {
      const profile = apply(kind);
      expect(profile.sources[0]).toMatchObject({ kind: "cv", via: "ai" });
      expect(provenanceOf(profile.experience[0]!.company.status, profile.experience[0]!.company.source)).toMatchObject({ label: "De tu CV · leído con IA" });
    }
  });

  it("does not turn a story into a document: it was asked for as the CV it is read as", () => {
    expect(apply("dump").sources[0]!.kind).toBe("cv");
  });

  it("changes the label and nothing else: what was extracted is the same", () => {
    const reading = verifyExtraction(TEXT, extraction({ experience: [job] }), "cv");
    const same = asOriginalKind(reading, "linkedin_pdf");
    expect({ ...same, kind: "cv" }).toEqual(reading);
  });
});
