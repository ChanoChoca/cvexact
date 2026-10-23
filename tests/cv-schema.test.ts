import { describe, expect, it } from "vitest";
import { cvDocumentSchema, headerFromProfile, projectLinkLabel, SECTION_MINIMUM } from "@/lib/schemas/cv";
import { linkSchema, profileSchema } from "@/lib/schemas/profile";
import { templateCV } from "@/lib/fixtures/template-cv";
import { devProfile } from "./fixtures";

/**
 * `coverage.omitted` is shown beside the CV preview and never printed on the
 * CV itself, so an overlong `item`/`reason` should be truncated rather than
 * fail the whole document — see the "CVDocument failed schema validation"
 * 502 this guards against, caused by the model combining several omitted
 * skills into one comma-separated `item` string past the 200-char cap.
 */
describe("coverageSchema.omitted", () => {
  it("truncates an overlong item instead of rejecting it", () => {
    const longItem = "Clean Code, DRY, SOLID, KISS, YAGNI, ".repeat(10);
    expect(longItem.length).toBeGreaterThan(200);

    const result = cvDocumentSchema.parse({
      ...templateCV,
      coverage: {
        requirements: [],
        omitted: [{ item: longItem, reason: "short reason" }],
      },
    });

    expect(result.coverage.omitted).toHaveLength(1);
    expect(result.coverage.omitted[0].item.length).toBeLessThanOrEqual(200);
    expect(result.coverage.omitted[0].item.endsWith("…")).toBe(true);
  });

  it("truncates an overlong reason instead of rejecting it", () => {
    const longReason = "This skill was omitted because it is not relevant. ".repeat(10);
    expect(longReason.length).toBeGreaterThan(300);

    const result = cvDocumentSchema.parse({
      ...templateCV,
      coverage: {
        requirements: [],
        omitted: [{ item: "Redis", reason: longReason }],
      },
    });

    expect(result.coverage.omitted[0].reason.length).toBeLessThanOrEqual(300);
    expect(result.coverage.omitted[0].reason.endsWith("…")).toBe(true);
  });

  it("leaves item/reason within the cap untouched", () => {
    const result = cvDocumentSchema.parse({
      ...templateCV,
      coverage: {
        requirements: [],
        omitted: [{ item: "Redis", reason: "Not required by the posting." }],
      },
    });

    expect(result.coverage.omitted[0]).toEqual({
      item: "Redis",
      reason: "Not required by the posting.",
    });
  });

  it("accepts a report with `omitted` explicitly null", () => {
    const result = cvDocumentSchema.parse({
      ...templateCV,
      coverage: { requirements: [], omitted: null },
    });

    expect(result.coverage.omitted).toEqual([]);
  });

  /**
   * The real crash this guards against: `[generate] CVDocument failed schema
   * validation: 1 schema violation: #0 "coverage.omitted" code=invalid_type
   * Invalid input: expected array, received undefined` — a model with
   * nothing to report sometimes drops the key entirely instead of sending `[]`.
   */
  it("accepts a report with `omitted` missing entirely", () => {
    const result = cvDocumentSchema.parse({
      ...templateCV,
      coverage: { requirements: [] },
    });

    expect(result.coverage.omitted).toEqual([]);
  });

  it("accepts a document missing the `coverage` key entirely", () => {
    const result = cvDocumentSchema.parse({
      language: "es",
      header: { fullName: "Ana", location: "Córdoba" },
      summary: "Resumen.",
      sections: [{ kind: "bullets", title: "T", bullets: ["a", "b"] }],
    });

    expect(result.coverage).toEqual({ requirements: [], omitted: [] });
  });
});

/**
 * `coverage` is metadata that never reaches the printed CV, so a model that
 * omits part or all of it must not fail the document. It did: a CVDocument
 * came back valid except for `coverage.omitted` being absent, spent a
 * model-assisted repair, came back absent again, and failed the whole
 * generation after 106 seconds and a walk down the provider chain — see the
 * comment on `coverageSchema`. (An explicit `omitted: null` is covered above.)
 */
describe("coverageSchema defaults", () => {
  it("accepts a report without `omitted`", () => {
    const result = cvDocumentSchema.parse({
      ...templateCV,
      coverage: { requirements: [] },
    });

    expect(result.coverage.omitted).toEqual([]);
  });

  it("accepts a report without `requirements`", () => {
    const result = cvDocumentSchema.parse({
      ...templateCV,
      coverage: { omitted: [{ item: "Redis", reason: "Not required." }] },
    });

    expect(result.coverage.requirements).toEqual([]);
    expect(result.coverage.omitted).toHaveLength(1);
  });

  it("accepts a document with no coverage block at all", () => {
    const withoutCoverage: Record<string, unknown> = { ...templateCV };
    delete withoutCoverage.coverage;

    expect(cvDocumentSchema.parse(withoutCoverage).coverage).toEqual({
      requirements: [],
      omitted: [],
    });
  });

  it("still rejects a report of the wrong shape", () => {
    // Defaults cover absence, not nonsense: a string where the report belongs
    // is a model that misunderstood the schema, and the repair pass deserves
    // its turn at that one.
    expect(() => cvDocumentSchema.parse({ ...templateCV, coverage: "no coverage" })).toThrow();
  });
});

/**
 * The whole header is overwritten from the profile by
 * `app/api/generate/cv/route.ts`, so a length violation there rejects a whole
 * document over a value that was about to be discarded. That is not theoretical:
 * a generation ran off into a repetition loop inside `phone`
 * ("+5491100000000 Lopez Lopez Lopez…"), and the 40-char cap turned it into
 * a 502 for a field the route never reads.
 */
describe("cvDocumentSchema.header", () => {
  const base = {
    language: "es",
    summary: "Resumen.",
    sections: [{ kind: "bullets" as const, title: "T", bullets: ["a", "b"] }],
    coverage: { requirements: [], omitted: [] },
  };

  it("truncates a phone that ran away instead of rejecting the document", () => {
    const runaway = "+5491100000000 " + "Lopez ".repeat(500);

    const result = cvDocumentSchema.parse({
      ...base,
      header: { fullName: "Ana López Pérez", location: "Junín", phone: runaway },
    });

    expect(result.header.phone).toHaveLength(40);
    expect(result.header.phone.endsWith("…")).toBe(true);
  });

  it("truncates the other copied contact fields too", () => {
    const result = cvDocumentSchema.parse({
      ...base,
      header: {
        fullName: "N".repeat(400),
        location: "L".repeat(400),
        email: "e".repeat(400),
        links: [{ label: "l".repeat(200), url: "u".repeat(600) }],
      },
    });

    expect(result.header.fullName).toHaveLength(120);
    expect(result.header.location).toHaveLength(120);
    expect(result.header.email).toHaveLength(160);
    expect(result.header.links[0].label).toHaveLength(60);
    expect(result.header.links[0].url).toHaveLength(300);
  });

  it("adds https:// to a link url that has no scheme", () => {
    const result = cvDocumentSchema.parse({
      ...base,
      header: {
        fullName: "N",
        location: "L",
        links: [{ label: "linkedin.com/in/x", url: "linkedin.com/in/x" }],
      },
    });

    expect(result.header.links[0].url).toBe("https://linkedin.com/in/x");
  });

  it("leaves a link url that already has a scheme untouched", () => {
    const result = cvDocumentSchema.parse({
      ...base,
      header: {
        fullName: "N",
        location: "L",
        links: [{ label: "l", url: "http://e.com" }],
      },
    });

    expect(result.header.links[0].url).toBe("http://e.com");
  });

  it("caps links rather than rejecting a document that has too many", () => {
    const result = cvDocumentSchema.parse({
      ...base,
      header: {
        fullName: "N",
        location: "L",
        links: Array.from({ length: 9 }, (_, i) => ({ label: `l${i}`, url: `https://e.com/${i}` })),
      },
    });

    expect(result.header.links).toHaveLength(5);
  });
});

/**
 * `sections[].items`/`bullets` have hard minimums nothing else absorbs. A
 * generation once closed out with well-formed JSON (`finishReason: "stop"`)
 * but four sections whose arrays were empty — a 502 after two full
 * round-trips, even though the prompt already says to omit an empty section
 * rather than emit one. `dropEmptySections` enforces that instruction
 * deterministically instead of rejecting the whole document.
 */
describe("cvDocumentSchema.sections", () => {
  const base = {
    language: "es",
    header: { fullName: "Ana", location: "Córdoba" },
    summary: "Resumen.",
    coverage: { requirements: [], omitted: [] },
  };

  const goodExperience = {
    kind: "experience" as const,
    title: "EXPERIENCIA",
    items: [
      {
        company: "Acme",
        role: "Dev",
        location: "Rosario, Argentina",
        dateRange: "2020 – Actualidad",
        bullets: ["Hizo cosas."],
      },
    ],
  };

  const goodBullets = {
    kind: "bullets" as const,
    title: "SKILLS",
    bullets: ["a", "b"],
  };

  it("drops a section whose items array is empty, keeping a good sibling", () => {
    const result = cvDocumentSchema.parse({
      ...base,
      sections: [goodExperience, { kind: "education", title: "EDUCACIÓN", items: [] }],
    });

    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].kind).toBe("experience");
  });

  it("drops a bullets section with fewer than 2 bullets", () => {
    const result = cvDocumentSchema.parse({
      ...base,
      sections: [goodExperience, { kind: "bullets", title: "SKILLS", bullets: ["only one"] }],
    });

    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].kind).toBe("experience");
  });

  it("keeps only the good sections, in order, out of a mix", () => {
    const result = cvDocumentSchema.parse({
      ...base,
      sections: [
        goodExperience,
        { kind: "pairs", title: "PAIRS", items: [] },
        goodBullets,
      ],
    });

    expect(result.sections.map((s) => s.kind)).toEqual(["experience", "bullets"]);
  });

  it("still rejects a document where every section ends up empty", () => {
    expect(() =>
      cvDocumentSchema.parse({
        ...base,
        sections: [
          { kind: "experience", title: "EXPERIENCIA", items: [] },
          { kind: "bullets", title: "SKILLS", bullets: ["only one"] },
        ],
      }),
    ).toThrow();
  });

  it("leaves a section with an unrecognized kind for the discriminated union to reject", () => {
    expect(() =>
      cvDocumentSchema.parse({
        ...base,
        sections: [goodExperience, { kind: "hobbies", title: "HOBBIES", items: ["chess"] }],
      }),
    ).toThrow();
  });

  /**
   * The prompt asks for one pairs section and a run produced two —
   * CERTIFICACIONES over a single line and IDIOMAS over two, spending two of
   * the six slots and two headings on a page that has to fit one sheet.
   */
  it("folds a second pairs section into the first, joining the titles", () => {
    const result = cvDocumentSchema.parse({
      ...base,
      sections: [
        goodExperience,
        { kind: "pairs", title: "CERTIFICACIONES", items: [{ label: "AWS", value: "2024" }] },
        { kind: "pairs", title: "IDIOMAS", items: [{ label: "Inglés", value: "Avanzado" }] },
      ],
    });

    expect(result.sections).toHaveLength(2);
    const pairs = result.sections[1];
    if (pairs.kind !== "pairs") throw new Error("expected a pairs section");
    expect(pairs.title).toBe("CERTIFICACIONES · IDIOMAS");
    expect(pairs.items.map((i) => i.label)).toEqual(["AWS", "Inglés"]);
  });

  /**
   * The reordering `STRATEGIES.unrelated` licenses is worth keeping; opening the
   * page with a table of availability is not. `public/plantilla-cv.html` has no
   * equivalent of that block anywhere, let alone leading the document.
   */
  it("moves the pairs section to the end, whatever order the model chose", () => {
    const result = cvDocumentSchema.parse({
      ...base,
      sections: [
        { kind: "pairs", title: "DISPONIBILIDAD", items: [{ label: "Disponibilidad", value: "Full time" }] },
        goodBullets,
        goodExperience,
      ],
    });

    expect(result.sections.map((s) => s.kind)).toEqual(["bullets", "experience", "pairs"]);
  });

  it("leaves a document without a pairs section untouched", () => {
    const result = cvDocumentSchema.parse({ ...base, sections: [goodExperience, goodBullets] });

    expect(result.sections.map((s) => s.kind)).toEqual(["experience", "bullets"]);
  });

  it("leaves the pairs section alone when it is already last", () => {
    const result = cvDocumentSchema.parse({
      ...base,
      sections: [
        goodExperience,
        { kind: "pairs", title: "IDIOMAS", items: [{ label: "Inglés", value: "Avanzado" }] },
      ],
    });

    expect(result.sections.map((s) => s.kind)).toEqual(["experience", "pairs"]);
  });

  it("merges two pairs sections wherever they were written", () => {
    const result = cvDocumentSchema.parse({
      ...base,
      sections: [
        { kind: "pairs", title: "IDIOMAS", items: [{ label: "Inglés", value: "Avanzado" }] },
        goodExperience,
        { kind: "pairs", title: "CERTIFICACIONES", items: [{ label: "AWS", value: "2024" }] },
      ],
    });

    // One pairs section out of two, and — see `pairsLast` — at the end rather
    // than at the head of the document, which is where the first one was.
    expect(result.sections.map((s) => s.kind)).toEqual(["experience", "pairs"]);
  });

  it("falls back to the first title when the joined one would exceed the cap", () => {
    const long = (n: number) => `${"CERTIFICACIONES".repeat(2)}${n}`;
    const result = cvDocumentSchema.parse({
      ...base,
      sections: [
        goodExperience,
        { kind: "pairs", title: long(1), items: [{ label: "AWS", value: "2024" }] },
        { kind: "pairs", title: long(2), items: [{ label: "Inglés", value: "Avanzado" }] },
        { kind: "pairs", title: long(3), items: [{ label: "B1", value: "Sí" }] },
      ],
    });

    const pairs = result.sections[1];
    if (pairs.kind !== "pairs") throw new Error("expected a pairs section");
    expect(pairs.title).toBe(long(1).toLocaleUpperCase());
    expect(pairs.items).toHaveLength(3);
  });

  it("imposes the template's heading whatever the model wrote", () => {
    const result = cvDocumentSchema.parse({
      ...base,
      sections: [
        { ...goodExperience, title: "Professional Experience" },
        { kind: "education", title: "Formación Académica", items: [
          { institution: "UNNOBA", degree: "Analista", location: "Junín", date: "2025" },
        ] },
      ],
    });

    expect(result.sections.map((s) => s.title)).toEqual([
      "EXPERIENCIA PROFESIONAL",
      "EDUCACIÓN",
    ]);
  });

  it("uses the template's headings for the CV's own language, not the profile's", () => {
    const result = cvDocumentSchema.parse({
      ...base,
      language: "en",
      sections: [{ ...goodExperience, title: "Trayectoria" }, goodBullets],
    });

    expect(result.sections.map((s) => s.title)).toEqual([
      "WORK EXPERIENCE",
      "ADDITIONAL SKILLS",
    ]);
  });

  // The table covers the two languages the product generates in. A CV in a
  // third must keep its own headings rather than be retitled into one of them.
  it("leaves a heading alone in a language the template does not cover", () => {
    const result = cvDocumentSchema.parse({
      ...base,
      language: "fr",
      sections: [{ ...goodExperience, title: "Expériences professionnelles" }, goodBullets],
    });

    expect(result.sections[0].title).toBe("EXPÉRIENCES PROFESSIONNELLES");
  });

  // Three consecutive runs on one posting titled this section three different
  // ways, which is invisible in any single CV and glaring across a folder. The
  // list is no longer a lookup of known variants, so a name nobody anticipated
  // ("HABILIDADES CLAVE") is covered by the same rule.
  it.each([
    "Habilidades complementarias",
    "Habilidades técnicas",
    "Otras habilidades",
    "Competencias",
    "Habilidades clave",
  ])("maps the skills heading %s onto the template's", (title) => {
    const result = cvDocumentSchema.parse({
      ...base,
      sections: [goodExperience, { ...goodBullets, title }],
    });

    expect(result.sections[1].title).toBe("SKILLS ADICIONALES");
  });

  it("leaves a pairs heading alone, since it names whatever the posting asked for", () => {
    const result = cvDocumentSchema.parse({
      ...base,
      sections: [
        goodExperience,
        { kind: "pairs", title: "Disponibilidad y certificaciones", items: [
          { label: "Disponibilidad", value: "Mañanas" },
        ] },
      ],
    });

    expect(result.sections[1].title).toBe("DISPONIBILIDAD Y CERTIFICACIONES");
  });
});

/**
 * The coverage report is never printed, yet across 69 applications it averaged
 * 15.8 omitted entries and hit the old 30-entry ceiling — on a provider capping
 * output at 8192 tokens that is what pushes the CV itself into the truncation
 * repair, which comes back missing a section.
 */
describe("cvDocumentSchema — the omitted report is bounded, not rejected", () => {
  const base = {
    language: "es",
    header: { fullName: "Ana", location: "Córdoba" },
    summary: "Desarrolladora.",
    sections: [
      {
        kind: "experience",
        title: "EXPERIENCIA",
        items: [{ company: "Acme", role: "Dev", location: "", dateRange: "2020", bullets: ["Hice cosas."] }],
      },
    ],
  };

  it("keeps the first ten entries and drops the rest", () => {
    const result = cvDocumentSchema.parse({
      ...base,
      coverage: {
        requirements: [],
        omitted: Array.from({ length: 25 }, (_, i) => ({ item: `cosa ${i}`, reason: "no aplica" })),
      },
    });

    expect(result.coverage.omitted).toHaveLength(10);
    expect(result.coverage.omitted[0].item).toBe("cosa 0");
  });

  // The applications already in a browser carry more than ten, and `answers`,
  // `email`, `interview` and the PDF export all re-parse a stored CV through
  // this schema. Rejecting would make an existing application unexportable.
  it("does not reject a stored CV that has more", () => {
    const parsed = cvDocumentSchema.safeParse({
      ...base,
      coverage: {
        requirements: [],
        omitted: Array.from({ length: 22 }, () => ({ item: "cosa", reason: "no aplica" })),
      },
    });

    expect(parsed.success).toBe(true);
  });
});

/**
 * The system prompt has forbidden markdown since it was written, and a CV came
 * back with its summary wrapped in asterisks anyway — printed verbatim, because
 * the renderer's whole job is to not interpret the model's text.
 */
describe("cvDocumentSchema — formatting the model was told not to emit", () => {
  const base = {
    language: "es",
    header: { fullName: "Ana", location: "Córdoba" },
    coverage: { requirements: [], omitted: [] },
    sections: [
      {
        kind: "experience",
        title: "EXPERIENCIA",
        items: [
          {
            company: "Acme",
            role: "Dev",
            location: "Rosario, Argentina",
            dateRange: "2020 – Actualidad",
            bullets: ["- Migró la API a **Python**, con `pytest` de por medio."],
          },
        ],
      },
    ],
  };

  it("unwraps a summary the model wrapped in asterisks", () => {
    const result = cvDocumentSchema.parse({ ...base, summary: "*Ingeniera de Software.*" });
    expect(result.summary).toBe("Ingeniera de Software.");
  });

  it("strips list markers, emphasis and backticks from a bullet", () => {
    const result = cvDocumentSchema.parse({ ...base, summary: "Resumen." });
    const section = result.sections[0];
    if (section.kind !== "experience") throw new Error("expected an experience section");
    expect(section.items[0].bullets[0]).toBe("Migró la API a Python, con pytest de por medio.");
  });

  it("leaves an asterisk that is not emphasis alone", () => {
    const result = cvDocumentSchema.parse({ ...base, summary: "Trabajó en C* y en A*B." });
    expect(result.summary).toBe("Trabajó en C* y en A*B.");
  });

  it("measures length after stripping, not before", () => {
    const body = "a".repeat(700);
    expect(cvDocumentSchema.parse({ ...base, summary: `**${body}**` }).summary).toBe(body);
    expect(() => cvDocumentSchema.parse({ ...base, summary: `${body}a` })).toThrow();
  });
});

/**
 * The contact block is copied, not generated. A CV came back with the email and
 * both links missing — accepted by the schema (all three carry defaults) and
 * ignored by the verifier (it compared values, and there was none to compare).
 * Building it from the profile removes the failure rather than detecting it.
 */
/**
 * `labels` carries the words the renderers print around the model's text, so a
 * CV in another language does not come out with "Honores:" in it. It was added
 * after CVs were already sitting in users' browsers, so the defaults are the
 * compatibility guarantee, not a convenience.
 */
describe("cvDocumentSchema.labels", () => {
  const base = {
    language: "es",
    header: { fullName: "Ana", location: "Córdoba" },
    summary: "Resumen.",
    sections: [{ kind: "bullets" as const, title: "T", bullets: ["a", "b"] }],
    coverage: { requirements: [], omitted: [] },
  };

  it("defaults a document that has no labels at all", () => {
    expect(cvDocumentSchema.parse(base).labels.honors).toBe("Honores");
  });

  it("defaults the fields a partial labels object leaves out", () => {
    expect(cvDocumentSchema.parse({ ...base, labels: {} }).labels.honors).toBe("Honores");
  });

  it("keeps a label the model wrote in the CV's language", () => {
    const parsed = cvDocumentSchema.parse({
      ...base,
      language: "en",
      labels: { honors: "Honors" },
    });

    expect(parsed.labels.honors).toBe("Honors");
  });
});

/**
 * The "Enlaces" form placeholder shows `https://linkedin.com/...` but never
 * enforces it, so a bare domain typed by the user (e.g. `linkedin.com/in/x`)
 * was saved as-is and rendered as `<a href="linkedin.com/in/x">` — a relative
 * path the browser resolved against whatever page printed the CV, producing
 * links like `localhost:3000/cv/<id>/linkedin.com/in/x`.
 */
describe("linkSchema.url", () => {
  it("adds https:// to a url with no scheme", () => {
    expect(linkSchema.parse({ label: "l", url: "linkedin.com/in/x" }).url).toBe(
      "https://linkedin.com/in/x",
    );
  });

  it("leaves a url that already has a scheme untouched", () => {
    expect(linkSchema.parse({ label: "l", url: "http://e.com" }).url).toBe("http://e.com");
  });
});

describe("headerFromProfile", () => {
  it("copies every contact field the profile has", () => {
    const header = headerFromProfile(devProfile);
    expect(header.fullName).toBe(devProfile.fullName);
    expect(header.email).toBe(devProfile.email);
    expect(header.phone).toBe(devProfile.phone);
    expect(header.links).toEqual(devProfile.links);
    expect(header.location).toBe("Rosario, Argentina");
  });

  it("joins only the parts of the location that exist", () => {
    const noCity = profileSchema.parse({ ...devProfile, city: "" });
    expect(headerFromProfile(noCity).location).toBe("Argentina");
  });

  it("keeps the header inside the schema's five-link cap", () => {
    const many = profileSchema.parse({
      ...devProfile,
      links: Array.from({ length: 8 }, (_, i) => ({ label: `l${i}`, url: `https://e.com/${i}` })),
    });
    expect(headerFromProfile(many).links).toHaveLength(5);
  });

  it("prints one page listed twice, written two ways, once — and keeps the place for a fifth real one", () => {
    const twice = profileSchema.parse({
      ...devProfile,
      links: [
        { label: "linkedin.com/in/perfil-ejemplo", url: "https://linkedin.com/in/perfil-ejemplo" },
        { label: "www.linkedin.com/in/perfil-ejemplo", url: "https://www.linkedin.com/in/perfil-ejemplo" },
        ...Array.from({ length: 5 }, (_, i) => ({ label: `l${i}`, url: `https://e.com/${i}` })),
      ],
    });
    const links = headerFromProfile(twice).links.map((link) => link.url);
    expect(links).toEqual(["https://linkedin.com/in/perfil-ejemplo", "https://e.com/0", "https://e.com/1", "https://e.com/2", "https://e.com/3"]);
  });

  /**
   * `STRATEGIES.unrelated` strips the jargon because naming a stack reads as
   * overqualification. A `github.com/...` under the phone number says the same
   * thing, in the one place on the page every reader looks.
   */
  it("drops the code links when the job is outside the candidate's field", () => {
    const mixed = profileSchema.parse({
      ...devProfile,
      links: [
        { label: "linkedin.com/in/perfil-ejemplo", url: "https://linkedin.com/in/perfil-ejemplo" },
        { label: "github.com/perfil-ejemplo", url: "https://github.com/perfil-ejemplo" },
        { label: "perfil-ejemplo.dev", url: "https://perfil-ejemplo.dev" },
      ],
    });

    expect(
      headerFromProfile(mixed, { relevance: "unrelated" }).links.map((l) => l.label),
    ).toEqual(["linkedin.com/in/perfil-ejemplo", "perfil-ejemplo.dev"]);
  });

  it("keeps them for every other relevance", () => {
    for (const relevance of ["direct", "adjacent"] as const) {
      expect(headerFromProfile(devProfile, { relevance }).links).toEqual(devProfile.links);
    }
    expect(headerFromProfile(devProfile).links).toEqual(devProfile.links);
  });

  /**
   * `verifyCompleteness` reports a CV that arrived without the profile's links,
   * and it is right to. A profile whose every link is a code host must not be
   * stripped bare to satisfy a preference.
   */
  it("keeps them anyway when filtering would leave none", () => {
    const onlyCode = profileSchema.parse({
      ...devProfile,
      links: [{ label: "github.com/perfil-ejemplo", url: "https://github.com/perfil-ejemplo" }],
    });

    expect(headerFromProfile(onlyCode, { relevance: "unrelated" }).links).toEqual(onlyCode.links);
  });
});

describe("cvDocumentSchema — the projects section", () => {
  const base = {
    language: "es",
    header: { fullName: "Ana", location: "Rosario" },
    summary: "Resumen.",
    coverage: { requirements: [], omitted: [] },
  };
  const projects = (items: unknown[], title = "Proyectos") => ({ kind: "projects", title, items });

  it("parses a section of projects, with the link normalised and the reference kept", () => {
    const result = cvDocumentSchema.parse({
      ...base,
      sections: [projects([{ ref: "P1", name: "Sistema de turnos", description: "Agenda para una clínica.", url: "github.com/perfil-ejemplo/turnos" }])],
    });
    expect(result.sections[0]).toEqual({
      kind: "projects",
      title: "PROYECTOS",
      items: [{ ref: "P1", name: "Sistema de turnos", description: "Agenda para una clínica.", url: "https://github.com/perfil-ejemplo/turnos" }],
    });
  });

  it("defaults what a provider with a relaxed schema leaves out: the reference, the description and the link", () => {
    const result = cvDocumentSchema.parse({ ...base, sections: [projects([{ name: "Sistema de turnos" }])] });
    expect(result.sections[0]).toMatchObject({ items: [{ ref: "", name: "Sistema de turnos", description: "", url: "" }] });
  });

  it("holds a project to the lengths the page has room for", () => {
    const section = (item: object) => cvDocumentSchema.safeParse({ ...base, sections: [projects([item])] }).success;
    expect(section({ name: "x".repeat(121) })).toBe(false);
    expect(section({ name: "x", description: "y".repeat(301) })).toBe(false);
    expect(section({ name: "x", description: "y".repeat(300) })).toBe(true);
  });

  it("holds the section to four projects, and drops one with none", () => {
    const four = Array.from({ length: 4 }, (_, i) => ({ name: `P${i}` }));
    expect(cvDocumentSchema.safeParse({ ...base, sections: [projects(four)] }).success).toBe(true);
    expect(cvDocumentSchema.safeParse({ ...base, sections: [projects([...four, { name: "P5" }])] }).success).toBe(false);

    const result = cvDocumentSchema.parse({ ...base, sections: [templateCV.sections.find((s) => s.kind === "experience"), projects([])] });
    expect(result.sections.map((s) => s.kind)).toEqual(["experience"]);
    expect(SECTION_MINIMUM.projects).toEqual({ field: "items", min: 1 });
  });

  it("strips the formatting the model was told not to emit from a description", () => {
    const result = cvDocumentSchema.parse({ ...base, sections: [projects([{ name: "**Turnos**", description: "- Agenda *online*." }])] });
    expect(result.sections[0]).toMatchObject({ items: [{ name: "Turnos", description: "Agenda online." }] });
  });

  it("imposes the template's heading, per language", () => {
    const heading = (language: string) => cvDocumentSchema.parse({ ...base, language, sections: [projects([{ name: "x" }], "Mis cosas")] }).sections[0]?.title;
    expect(heading("es")).toBe("PROYECTOS");
    expect(heading("en")).toBe("PROJECTS");
    expect(heading("fr")).toBe("MIS COSAS");
  });

  it("still parses a CV stored before the section existed", () => {
    expect(cvDocumentSchema.safeParse(templateCV).success).toBe(true);
  });

  it("shows the link the way the page prints it: no scheme, no slash, one line wide", () => {
    expect(projectLinkLabel("https://github.com/perfil-ejemplo/turnos/")).toBe("github.com/perfil-ejemplo/turnos");
    const long = projectLinkLabel(`https://example.com/${"a".repeat(80)}`);
    expect(long).toHaveLength(48);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("cvDocumentSchema — the activities section", () => {
  const base = {
    language: "es",
    header: { fullName: "Ana", location: "Rosario" },
    summary: "Resumen.",
    coverage: { requirements: [], omitted: [] },
  };
  const activities = (items: unknown[], title = "Cosas que hago") => ({ kind: "activities", title, items });

  it("parses a section of activities, with the reference kept and the text a provider may leave out defaulted", () => {
    const result = cvDocumentSchema.parse({ ...base, sections: [activities([{ ref: "O1", text: "Presido el Club de Robótica." }, { ref: "O2" }, {}])] });
    expect(result.sections[0]).toEqual({
      kind: "activities",
      title: "ACTIVIDADES",
      items: [{ ref: "O1", text: "Presido el Club de Robótica." }, { ref: "O2", text: "" }, { ref: "", text: "" }],
    });
  });

  it("imposes the template's heading, per language: it is not «SKILLS ADICIONALES» (M22)", () => {
    const heading = (language: string) => cvDocumentSchema.parse({ ...base, language, sections: [activities([{ ref: "O1" }])] }).sections[0]?.title;
    expect(heading("es")).toBe("ACTIVIDADES");
    expect(heading("en")).toBe("ACTIVITIES");
    expect(heading("fr")).toBe("COSAS QUE HAGO");
  });

  it("holds the section to four activities and a line to the length the page has room for, and drops one with none", () => {
    const four = Array.from({ length: 4 }, (_, i) => ({ ref: `O${i + 1}` }));
    expect(cvDocumentSchema.safeParse({ ...base, sections: [activities(four)] }).success).toBe(true);
    expect(cvDocumentSchema.safeParse({ ...base, sections: [activities([...four, { ref: "O5" }])] }).success).toBe(false);
    expect(cvDocumentSchema.safeParse({ ...base, sections: [activities([{ text: "y".repeat(301) }])] }).success).toBe(false);

    const result = cvDocumentSchema.parse({ ...base, sections: [templateCV.sections.find((s) => s.kind === "experience"), activities([])] });
    expect(result.sections.map((s) => s.kind)).toEqual(["experience"]);
    expect(SECTION_MINIMUM.activities).toEqual({ field: "items", min: 1 });
  });

  it("keeps pairs last with an activities section in the document", () => {
    const pairs = { kind: "pairs", title: "IDIOMAS", items: [{ label: "Inglés", value: "B2" }] };
    const result = cvDocumentSchema.parse({ ...base, sections: [pairs, activities([{ ref: "O1" }])] });
    expect(result.sections.map((s) => s.kind)).toEqual(["activities", "pairs"]);
  });
});
