import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  PRACTICAL_FACTS,
  practicalAsks,
  practicalFactFor,
  statedPractical,
  withoutOffFieldCredentials,
  withProfilePractical,
} from "@/lib/ai/practical";
import { verifyPairs } from "@/lib/ai/verify";
import { cvDocumentSchema, type CVDocument } from "@/lib/schemas/cv";
import { jobAnalysisSchema, type JobAnalysis } from "@/lib/schemas/job";
import { profileSchema, type Profile } from "@/lib/schemas/profile";
import { backendProfile, devProfile } from "./fixtures";

/**
 * The failure these guard is the most expensive one measured over the saved
 * corpus: 4 of 5 CVs from one model declared an availability the profile never
 * stated, every one of them the posting's own hours mirrored back. A pairs row
 * reads as a commitment, so the CV booked the candidate into a schedule they
 * never agreed to.
 */

/** A profile whose availability is nothing like any posting's hours. */
const profile: Profile = profileSchema.parse({
  ...devProfile,
  practical: {
    availability: "Full time, Part time",
    driverLicense: "B1",
    ownVehicle: true,
    willingToRelocate: false,
    workEligibility: "Ciudadanía",
  },
});

/** `pairs` rows only — the other sections play no part in any of this. */
function cvWithPairs(items: { label: string; value: string }[]): CVDocument {
  return cvDocumentSchema.parse({
    language: "es",
    header: { fullName: profile.fullName, location: "Rosario, Argentina" },
    summary: "Profesional responsable y orientado al servicio.",
    sections: [{ kind: "pairs", title: "DISPONIBILIDAD Y REQUISITOS", items }],
    coverage: { requirements: [], omitted: [] },
  });
}

const pairsOf = (cv: CVDocument) =>
  cv.sections.flatMap((s) => (s.kind === "pairs" ? s.items : []));

function analysis(overrides: Partial<z.input<typeof jobAnalysisSchema>> = {}): JobAnalysis {
  return jobAnalysisSchema.parse({
    title: "MOZO/A",
    language: "es",
    domain: "gastronomía",
    relevance: "unrelated",
    relevanceReason: "—",
    requirements: [],
    ...overrides,
  });
}

describe("practicalFactFor", () => {
  it("recognises the labels a CV actually writes", () => {
    expect(practicalFactFor("Disponibilidad")?.field).toBe("availability");
    expect(practicalFactFor("Horario")?.field).toBe("availability");
    expect(practicalFactFor("Licencia de conducir")?.field).toBe("driverLicense");
    expect(practicalFactFor("Eligibilidad laboral")?.field).toBe("workEligibility");
    expect(practicalFactFor("Movilidad propia")?.field).toBe("ownVehicle");
  });

  it("matches without accents or case, because labels come normalised", () => {
    expect(practicalFactFor("VEHÍCULO PROPIO")?.field).toBe("ownVehicle");
  });

  it("leaves alone the rows that belong to the credentials path", () => {
    expect(practicalFactFor("AWS Cloud Practitioner")).toBeUndefined();
    expect(practicalFactFor("Inglés")).toBeUndefined();
  });

  it("does not read a bare «registro» as a driving licence", () => {
    expect(practicalFactFor("Registro de proveedores")).toBeUndefined();
  });
});

describe("statedPractical", () => {
  const fact = (field: string) => PRACTICAL_FACTS.find((f) => f.field === field)!;

  it("returns the profile's own text", () => {
    expect(statedPractical(profile, fact("availability"))).toBe("Full time, Part time");
  });

  it("reads an empty field as nothing stated", () => {
    expect(statedPractical(profile, fact("willingToRelocate"))).toBeNull();
    expect(
      statedPractical(
        profileSchema.parse({ ...profile, practical: { ...profile.practical, availability: "  " } }),
        fact("availability"),
      ),
    ).toBeNull();
  });

  it("reads an unticked flag as nothing stated, not as a denial", () => {
    expect(statedPractical(profile, fact("ownVehicle"))).not.toBeNull();
    expect(statedPractical(profile, fact("willingToRelocate"))).toBeNull();
  });
});

describe("practicalAsks", () => {
  // Outside the candidate's field every fact the profile states is required
  // regardless of what the posting asks — see the `outside the candidate's
  // field` block below — so these exercise the asks-based filter on a posting
  // that is at least adjacent to the candidate's own background.
  const adjacent = (overrides: Partial<z.input<typeof jobAnalysisSchema>> = {}) =>
    analysis({ relevance: "adjacent", ...overrides });

  it("catches a posting that states hours without using the word", () => {
    const asked = practicalAsks(
      profile,
      adjacent({
        requirements: [
          { text: "Disponibilidad de jueves a domingo de 19:30hs al cierre", kind: "hard" },
        ],
      }),
    );
    expect(asked.map((f) => f.field)).toEqual(["availability"]);
  });

  it("catches the weekend and shift vocabulary an ad uses instead", () => {
    expect(
      practicalAsks(profile, adjacent({ keywords: ["turno noche", "fines de semana"] })).map(
        (f) => f.field,
      ),
    ).toEqual(["availability"]);
  });

  it("asks for the vehicle only when the posting names it", () => {
    expect(
      practicalAsks(profile, adjacent({ requirements: [{ text: "Movilidad propia", kind: "hard" }] }))
        .map((f) => f.field),
    ).toEqual(["ownVehicle"]);
    expect(practicalAsks(profile, adjacent()).map((f) => f.field)).toEqual([]);
  });

  it("stays quiet when the posting asks and the profile does not answer", () => {
    // The profile leaves `willingToRelocate` unticked, so there is nothing to
    // require verbatim and the row must not be demanded at all.
    expect(
      practicalAsks(
        profile,
        adjacent({ requirements: [{ text: "Requiere reubicación a Córdoba", kind: "hard" }] }),
      ),
    ).toEqual([]);
  });

  /**
   * The masthead case. A posting opening "Contrato por tiempo indeterminado /
   * Jornada completa / Presencial y remoto" put none of those in
   * `requirements` — they sit above the "Requisitos:" heading, and the
   * extractor reads the posting literally rather than promoting its masthead.
   * The candidate's availability never reached the REQUIRED PAIRS block.
   */
  it("reads the raw posting, not only what the analysis extracted", () => {
    const jobText = [
      "Contrato por tiempo indeterminado",
      "Jornada completa",
      "Presencial y remoto",
      "",
      "Requisitos:",
      "HTML5 Semántico, CSS3 y Responsive Design.",
    ].join("\n");

    const extracted = adjacent({ requirements: [{ text: "HTML5 Semántico", kind: "hard" }] });

    expect(practicalAsks(profile, extracted).map((f) => f.field)).toEqual([]);
    expect(practicalAsks(profile, extracted, jobText).map((f) => f.field)).toEqual(["availability"]);
  });

  it("does not invent an ask from a posting that never mentions one", () => {
    expect(
      practicalAsks(profile, adjacent(), "Buscamos alguien con ganas de aprender.").map((f) => f.field),
    ).toEqual([]);
  });

  /**
   * Outside the candidate's field, `fact.asks` is not consulted at all: every
   * fact the profile states is required whether or not the posting's own
   * words happen to match. A four-line posting ("Buscamos técnico instalador
   * de cámaras... enviar cv") asks about nothing `PRACTICAL_FACTS[].asks` can
   * match, and a candidate with a car is still a better lead for a field job
   * than one without — the profile is the only place that fact lives, and
   * `STRATEGIES.unrelated` already treats it as frequently decisive.
   */
  describe("outside the candidate's field", () => {
    it("requires every practical fact the profile states, regardless of what the posting asks", () => {
      const shortPosting = analysis({
        relevance: "unrelated",
        title: "Técnico instalador de cámaras de seguridad",
        domain: "seguridad electrónica",
        requirements: [],
      });

      expect(practicalAsks(profile, shortPosting).map((f) => f.field).sort()).toEqual(
        ["availability", "driverLicense", "ownVehicle", "workEligibility"].sort(),
      );
    });

    it("still leaves out a fact the profile does not answer", () => {
      const shortPosting = analysis({ relevance: "unrelated", requirements: [] });
      expect(
        practicalAsks(profile, shortPosting).map((f) => f.field),
      ).not.toContain("willingToRelocate");
    });
  });
});

describe("withProfilePractical", () => {
  it("overwrites the posting's hours with the candidate's own", () => {
    const fixed = withProfilePractical(
      cvWithPairs([{ label: "Disponibilidad", value: "Jueves a domingo, 19:30hs al cierre" }]),
      profile,
    );
    expect(pairsOf(fixed)).toEqual([{ label: "Disponibilidad", value: "Full time, Part time" }]);
  });

  it("leaves the label and the section title to the model, in its own language", () => {
    const fixed = withProfilePractical(
      cvWithPairs([{ label: "Availability", value: "Thursday to Sunday, evenings" }]),
      profile,
    );
    expect(pairsOf(fixed)[0]!.label).toBe("Availability");
    expect(fixed.sections[0]!.title).toBe("DISPONIBILIDAD Y REQUISITOS");
  });

  it("keeps an elaboration that still contains the profile's value", () => {
    // "B1 (vehículo propio)" against a profile stating "B1" is the model adding
    // a true detail, not inventing one — but the value is still imposed, so what
    // survives is the profile's.
    const fixed = withProfilePractical(
      cvWithPairs([{ label: "Licencia de conducir", value: "B1 (vehículo propio)" }]),
      profile,
    );
    expect(pairsOf(fixed)[0]!.value).toBe("B1");
  });

  it("drops a row the profile cannot answer at all", () => {
    const fixed = withProfilePractical(
      cvWithPairs([
        { label: "Disponibilidad", value: "Jueves a domingo" },
        { label: "Relocación", value: "Disponible para mudarse" },
      ]),
      profile,
    );
    expect(pairsOf(fixed)).toEqual([{ label: "Disponibilidad", value: "Full time, Part time" }]);
  });

  it("keeps a true flag's wording, since there is no text to copy", () => {
    const fixed = withProfilePractical(
      cvWithPairs([{ label: "Movilidad propia", value: "Sí, vehículo propio" }]),
      profile,
    );
    expect(pairsOf(fixed)).toEqual([{ label: "Movilidad propia", value: "Sí, vehículo propio" }]);
  });

  it("never touches a certification or a language row", () => {
    const rows = [
      { label: "AWS Cloud Practitioner", value: "AWS, 2024" },
      { label: "Inglés", value: "Avanzado" },
    ];
    expect(pairsOf(withProfilePractical(cvWithPairs(rows), profile))).toEqual(rows);
  });

  it("never adds a row the model did not write", () => {
    const fixed = withProfilePractical(cvWithPairs([{ label: "Inglés", value: "Avanzado" }]), profile);
    expect(pairsOf(fixed)).toHaveLength(1);
  });

  it("returns the same document when there is nothing to impose", () => {
    const cv = cvWithPairs([{ label: "Inglés", value: "Avanzado" }]);
    expect(withProfilePractical(cv, profile)).toBe(cv);
  });

  it("truncates to the cap a pairs value has, so the result still parses", () => {
    const long = profileSchema.parse({
      ...profile,
      practical: { ...profile.practical, availability: "x".repeat(200) },
    });
    const fixed = withProfilePractical(
      cvWithPairs([{ label: "Disponibilidad", value: "Jueves a domingo" }]),
      long,
    );
    expect(pairsOf(fixed)[0]!.value).toHaveLength(160);
    expect(() => cvDocumentSchema.parse(fixed)).not.toThrow();
  });

  it("leaves verifyPairs with nothing to report, which is the point", () => {
    const mirrored = cvWithPairs([
      { label: "Disponibilidad", value: "Jueves a domingo, 19:30hs al cierre" },
      { label: "Relocación", value: "Disponible para mudarse" },
    ]);
    expect(verifyPairs(mirrored, profile)).not.toEqual([]);
    expect(verifyPairs(withProfilePractical(mirrored, profile), profile)).toEqual([]);
  });
});

/**
 * The deterministic half of `STRATEGIES.unrelated`'s "STRIP THE JARGON", for
 * the one place a stray technical credential is safe to delete outright rather
 * than merely warn about. A CV for a camera-installer vacancy opened its final
 * section with "AWS Cloud Practitioner" — true, and exactly the signal that
 * reads as overqualification to the person hiring.
 */
describe("withoutOffFieldCredentials", () => {
  it("drops a technical credential the posting never asked about", () => {
    const withCert = cvWithPairs([
      { label: "AWS Cloud Practitioner", value: "AWS, 2024" },
      { label: "Inglés", value: "Avanzado" },
      { label: "Licencia de conducir", value: "B1" },
    ]);

    const stripped = withoutOffFieldCredentials(withCert, backendProfile, analysis());

    expect(pairsOf(stripped).map((i) => i.label)).toEqual(["Inglés", "Licencia de conducir"]);
  });

  it("leaves the pairs section alone inside the candidate's own field", () => {
    const withCert = cvWithPairs([{ label: "AWS Cloud Practitioner", value: "AWS, 2024" }]);
    expect(
      withoutOffFieldCredentials(withCert, backendProfile, analysis({ relevance: "direct" })),
    ).toBe(withCert);
  });

  it("keeps a credential the posting actually asks about", () => {
    const withCert = cvWithPairs([{ label: "AWS Cloud Practitioner", value: "AWS, 2024" }]);
    const kept = withoutOffFieldCredentials(
      withCert,
      backendProfile,
      analysis({ requirements: [{ text: "Certificación AWS valorada", kind: "soft" }] }),
    );
    expect(pairsOf(kept).map((i) => i.label)).toContain("AWS Cloud Practitioner");
  });

  it("never touches a row recognised as a practical fact, even one naming a hard term", () => {
    // "B1" reads as a technology to the acronym pass, and it is exactly the row
    // this candidate needs on the page, not one to strip.
    const withLicense = cvWithPairs([{ label: "Licencia de conducir", value: "B1" }]);
    expect(withoutOffFieldCredentials(withLicense, backendProfile, analysis())).toBe(withLicense);
  });

  it("returns the same document when there is nothing to drop", () => {
    const plain = cvWithPairs([{ label: "Disponibilidad", value: "Full time" }]);
    expect(withoutOffFieldCredentials(plain, backendProfile, analysis())).toBe(plain);
  });
});
