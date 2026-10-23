import { describe, expect, it } from "vitest";
import { cvGaps, hasGaps, postingBorrowings, summaryDomainClaims, verifyCV } from "@/lib/ai/verify";
import { cvDocumentSchema, type CVDocument } from "@/lib/schemas/cv";
import { profileSchema } from "@/lib/schemas/profile";

/**
 * VAL-14: a line of the CV that says something only the posting said. The words the ad uses and the profile lacks are named, the
 * ad's filler is not, and nothing here is worth a retry.
 */

const profile = profileSchema.parse({
  fullName: "Bruno Ficticio",
  about: "Desarrollador mobile en Rosario, con experiencia en aplicaciones para el sector financiero y el comercio de la región.",
  experience: [
    {
      id: "a",
      company: "Pagaluz SA",
      role: "Desarrollador Mobile",
      start: "Octubre 2022",
      end: "",
      current: true,
      bullets: ["Armé pantallas de la app en entornos productivos, con pruebas del equipo y revisión de los pagos de los clientes."],
      tags: [],
    },
  ],
  skills: ["React Native", "Seguridad"],
});

const ask = {
  keywords: ["React Native"],
  requirements: [{ text: "Experiencia con pagos y notificaciones push", kind: "hard" as const, excluding: false }],
  responsibilities: ["Mejorar la experiencia en celulares de gama baja", "Desarrollar funcionalidades de calidad para el producto", "Mantener la producción estable"],
};

const cv = (summary: string, bullets: string[] = ["Armé pantallas de la app."], language = "es"): CVDocument =>
  cvDocumentSchema.parse({
    language,
    header: { fullName: "Bruno Ficticio", location: "Rosario, Argentina" },
    summary,
    sections: [
      { kind: "experience", title: "EXPERIENCIA", items: [{ company: "Pagaluz SA", role: "Desarrollador Mobile", location: "", dateRange: "Octubre 2022 – Actualidad", bullets }] },
      { kind: "pairs", title: "DATOS", items: [{ label: "Celulares", value: "Disponible" }] },
    ],
    coverage: { requirements: [], omitted: [] },
  });

const borrowed = (doc: CVDocument, who = profile) => postingBorrowings(doc, who, ask);

describe("postingBorrowings", () => {
  it("names the word of the ad that the profile never says, on the line that says it", () => {
    expect(borrowed(cv("Desarrollador mobile.", ["Mejoré la experiencia en celulares de gama baja."]))).toEqual([
      { field: "sections[0].items[0].bullets[0]", words: ["celulares"] },
    ]);
  });

  it("leaves alone what the profile says, in the same form or in another", () => {
    const doc = cv("Desarrollador mobile con pagos, notificaciones y seguridad.", ["Revisé los pagos de los clientes en entornos de producción."]);
    // «pagos» is the profile's; «producción» is its «productivos»; «seguridad» is a skill.
    expect(borrowed(doc).flatMap((line) => line.words)).toEqual(["notificaciones"]);
  });

  it("leaves alone the vocabulary every ad uses", () => {
    expect(borrowed(cv("Desarrollador mobile.", ["Desarrollé funcionalidades de calidad para el producto."]))).toEqual([]);
  });

  it("does not read the title of the ad, a summary may name the role it is for", () => {
    const titled = { ...ask, requirements: [], keywords: [], responsibilities: [] };
    expect(postingBorrowings(cv("Analista de datos."), profile, titled)).toEqual([]);
  });

  it("does not say twice what is already an error: a tool the profile lacks", () => {
    const tooled = { ...ask, keywords: ["Webpack"], responsibilities: [] , requirements: [] };
    expect(postingBorrowings(cv("Desarrollador mobile.", ["Configuré Webpack."]), profile, tooled)).toEqual([]);
  });

  it("does not read a pairs row, which is a label and a fact", () => {
    expect(borrowed(cv("Desarrollador mobile.")).flatMap((line) => line.field)).not.toContain("sections[1].items[0]");
  });

  it("gives up on a CV in another language than the profile, where every word would read as borrowed", () => {
    const english = cv("Mobile developer improving the experience in low-end phones.", ["Improved the experience in celulares."], "en");
    expect(borrowed(english)).toEqual([]);
    // The same line, as a CV in the profile's language, is read.
    expect(borrowed({ ...english, language: "es" })).toHaveLength(1);
  });

  it("has nothing to say with no ad to compare to", () => {
    expect(postingBorrowings(cv("Celulares.", ["Celulares de gama baja."]), profile, {})).toEqual([]);
  });
});

describe("the warning", () => {
  const doc = cv("Desarrollador mobile.", ["Mejoré la experiencia en celulares de gama baja.", "Armé pantallas de la app."]);
  const analysis = { relevance: "direct" as const, title: "Desarrollador Mobile", domain: "fintech", ...ask };
  const warning = verifyCV(doc, profile, analysis).filter((f) => f.detail.startsWith("Revisá:"));

  it("is a warning on the line, written with the accents the line has", () => {
    expect(warning).toEqual([
      { severity: "warning", field: "sections[0].items[0].bullets[0]", detail: "Revisá: «celulares» sale del aviso, no de tu perfil. Dejalo solo si lo hiciste." },
    ]);
  });

  it("does not spend the retry", () => {
    expect(hasGaps(cvGaps(doc, profile, analysis))).toBe(false);
  });

  it("says several words in one finding, and keeps «salen» for the plural", () => {
    const several = verifyCV(cv("Desarrollador mobile.", ["Armé notificaciones para celulares."]), profile, analysis).filter((f) => f.detail.startsWith("Revisá:"));
    expect(several).toHaveLength(1);
    expect(several[0]!.detail).toBe("Revisá: «notificaciones», «celulares» salen del aviso, no de tu perfil. Dejalo solo si lo hiciste.");
  });
});

/**
 * The summary may close on the job it is for (PRM-6, P2): «para un rol mobile en una fintech». That stretch names the posting and is not read as
 * borrowed; the rest of the summary is, and a field of the posting written as the candidate's experience is an error of its own. Each word is
 * said once, in the stronger finding.
 */
describe("the job a summary is for, and what it claims", () => {
  const domain = { ...ask, responsibilities: [...ask.responsibilities, "Desarrollar la billetera virtual de una fintech de remesas"] };
  const analysis = { relevance: "direct" as const, title: "Desarrollador Mobile", domain: "fintech", ...domain };
  const found = (summary: string) => verifyCV(cv(summary), profile, analysis).filter((f) => f.field === "summary");
  const review = (summary: string) => found(summary).filter((f) => f.detail.startsWith("Revisá:")).map((f) => f.detail);
  const claims = (summary: string) => found(summary).filter((f) => f.severity === "error").map((f) => f.detail);

  it("does not warn about the stretch that names the job it is for", () => {
    const summary = "Desarrollador mobile con tres años en React Native, para un rol mobile en una fintech de remesas.";
    expect(review(summary)).toEqual([]);
    expect(claims(summary)).toEqual([]);
  });

  it("reads what follows the comma as another claim, in the same sentence", () => {
    const summary = "Desarrollador mobile, para un rol mobile en una fintech, con experiencia en remesas.";
    expect(claims(summary)).toEqual(["El resumen dice que tenés experiencia en «remesas»; tu perfil no lo dice. Sacalo, o cargalo en tu perfil si es así."]);
    expect(review(summary)).toEqual([]);
  });

  it("still marks the same word outside the stretch that names the job", () => {
    expect(review("Desarrollador mobile para un rol en una fintech. Armé apps de remesas para fintech.")).toEqual([
      "Revisá: «remesas», «fintech» salen del aviso, no de tu perfil. Dejalo solo si lo hiciste.",
    ]);
  });

  it("says a field of the ad written as experience once, as an error, and not again as a warning", () => {
    const summary = "Desarrollador mobile con experiencia en fintech.";
    expect(claims(summary)).toEqual(["El resumen dice que tenés experiencia en «fintech»; tu perfil no lo dice. Sacalo, o cargalo en tu perfil si es así."]);
    expect(review(summary)).toEqual([]);
    // An error the person reads before downloading, and not a retry: it costs no call.
    expect(hasGaps(cvGaps(cv(summary), profile, analysis))).toBe(false);
  });

  it("leaves alone a field the profile does state", () => {
    expect(claims("Desarrollador mobile con experiencia en pagos.")).toEqual([]);
    expect(summaryDomainClaims(cv("Desarrollador mobile con experiencia en pagos."), profile, domain)).toEqual([]);
  });

  it("reads the words past the stretch's six as the rest of the summary", () => {
    expect(review("Desarrollador mobile para un rol mobile en una empresa grande de pagos de remesas.")).toEqual([
      "Revisá: «remesas» sale del aviso, no de tu perfil. Dejalo solo si lo hiciste.",
    ]);
  });

  it("ends a claim where another clause begins, and what follows it is still read", () => {
    const summary = "Desarrollador mobile con experiencia en billetera y remesas.";
    expect(claims(summary)).toEqual(["El resumen dice que tenés experiencia en «billetera»; tu perfil no lo dice. Sacalo, o cargalo en tu perfil si es así."]);
    expect(review(summary)).toEqual(["Revisá: «remesas» sale del aviso, no de tu perfil. Dejalo solo si lo hiciste."]);
  });

  it("leaves a job's lines as they were: the stretch is only the summary's", () => {
    const doc = cv("Desarrollador mobile.", ["Armé pantallas para un rol en una fintech de remesas."]);
    expect(postingBorrowings(doc, profile, domain).flatMap((line) => line.words)).toEqual(["fintech", "remesas"]);
  });
});
