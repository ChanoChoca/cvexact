import { describe, expect, it } from "vitest";
import { LOOSE_HEADING, keptFragments, looseSentencesAsCards, uncoveredSentences, withoutKnownCards } from "@/lib/parse/coverage";
import { verifyExtraction } from "@/lib/parse/verify-extraction";
import { applyParsedDocument } from "@/lib/parse/to-profile";
import { emptyStoredProfile } from "@/lib/schemas/profile-v2";
import type { Extraction } from "@/lib/ai/prompts/extract";

/**
 * A story read by a model comes back as the little of it the model could quote. What it did not carry over is not
 * wrong, it is missing — and a profile that looks complete is where nobody looks for it. These are the cases where
 * the text and what was kept are set side by side.
 */

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

const job = {
  kind: "job" as const,
  company: q("Acme"),
  role: q("analista"),
  city: null,
  country: null,
  start: null,
  end: null,
  facts: [q("armaba los informes de ventas")],
};

const TEAM = "Me encanta trabajar en equipo y aprender cosas nuevas.";
const MANY = "Hice informes, coordiné equipos, atendí clientes, capacité al personal nuevo y organicé eventos.";
const STORY = `Trabajé cinco años en Acme como analista, armaba los informes de ventas. ${TEAM} ${MANY} Sí, claro.`;

/** The reading as it stands before the sentences that nothing came from are put in the tray: "cv" does not do that. */
const reading = (text: string, overrides: Partial<Extraction> = {}) => verifyExtraction(text, extraction(overrides), "cv");

describe("what was said that nothing kept comes from", () => {
  const read = (text = STORY, overrides: Partial<Extraction> = { experience: [job] }) => reading(text, overrides);

  it("is a sentence no value of the reading was taken from", () => {
    const doc = read();
    expect(uncoveredSentences(STORY, doc)).toContain(TEAM);
  });

  it("is not a sentence whose words are mostly in what was kept", () => {
    const doc = read();
    expect(uncoveredSentences(STORY, doc)).not.toContain("Trabajé cinco años en Acme como analista, armaba los informes de ventas.");
  });

  it("is a sentence with many things in it of which the reading kept one, because the rest went nowhere", () => {
    const doc = read();
    expect(uncoveredSentences(STORY, doc)).toContain(MANY);
  });

  it("is not a crumb: «Sí, claro.» says nothing to keep", () => {
    expect(uncoveredSentences(STORY, read())).not.toContain("Sí, claro.");
  });

  it("is everything, when the model carried nothing over", () => {
    const doc = read(STORY, {});
    const loose = uncoveredSentences(STORY, doc);
    expect(loose).toHaveLength(3);
  });

  it("is the sentence of a value the model made up and the check threw out", () => {
    // The fact is not in the text, so it is dropped — and the sentence that actually said something stays loose.
    const text = "Trabajé en Acme como analista. Reduje los costos de la oficina en un veinte por ciento durante el último año.";
    const doc = reading(text, { experience: [{ ...job, facts: [q("Reduje costos un 20%", "redujimos los costos un 20 por ciento")] }] });
    expect(doc.experience[0]!.facts).toHaveLength(0);
    expect(uncoveredSentences(text, doc)).toEqual(["Reduje los costos de la oficina en un veinte por ciento durante el último año."]);
  });

  it("finds a fragment that straddles the end of a sentence", () => {
    const text = "Trabajé en Acme. Armaba los informes de ventas. Coordinaba el equipo comercial de la región norte.";
    const doc = reading(text, { experience: [{ ...job, facts: [q("Armaba los informes de ventas. Coordinaba el equipo comercial")] }] });
    expect(uncoveredSentences(text, doc)).toEqual([]);
  });

  it("counts what the model sent to the tray as placed", () => {
    const text = "Me gusta el ajedrez y la fotografía de paisajes urbanos.";
    const doc = reading(text, { unassigned: [{ text: "Me gusta el ajedrez y la fotografía de paisajes urbanos.", kind: "interests", heading: null }] });
    expect(uncoveredSentences(text, doc)).toEqual([]);
  });

  it("lists every fragment kept, for the comparison", () => {
    const fragments = keptFragments(read());
    expect(fragments).toEqual(expect.arrayContaining(["Acme", "analista", "armaba los informes de ventas"]));
  });
});

describe("the cards of the tray", () => {
  it("keeps the sentences said one after another together, in one card", () => {
    const doc = verifyExtraction(STORY, extraction({ experience: [job] }), "dump");
    const cards = doc.unassigned.filter((item) => item.heading === LOOSE_HEADING);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.text).toBe(`${TEAM} ${MANY}`);
    expect(cards[0]).toMatchObject({ kind: "other", heading: "De lo que contaste" });
  });

  it("starts a new card when what is said in between was kept", () => {
    const text = `${TEAM} Trabajé cinco años en Acme como analista, armaba los informes de ventas. ${MANY}`;
    const cards = verifyExtraction(text, extraction({ experience: [job] }), "dump").unassigned;
    expect(cards.map((card) => card.text)).toEqual([TEAM, MANY]);
  });

  it("puts a long run into a few cards and the rest into the last, so the tray is not a wall", () => {
    const sentences = Array.from({ length: 12 }, (_, i) => `Cuando llegó el cliente número ${i + 1} organicé personalmente toda la logística del evento completo`);
    // Said between kept ones, so that no two are next to each other.
    const keep = "Trabajé en Acme como analista, armaba los informes de ventas.";
    const text = sentences.map((sentence) => `${sentence}. ${keep}`).join(" ");
    const cards = looseSentencesAsCards(text, reading(text, { experience: [job] }), LOOSE_HEADING);
    expect(cards).toHaveLength(6);
    expect(cards[5]!.text).toContain("número 12");
    expect(cards[5]!.text).toContain("número 6");
  });

  it("does not repeat a sentence the tray already has", () => {
    const text = `${TEAM} Trabajé cinco años en Acme como analista, armaba los informes de ventas.`;
    const doc = verifyExtraction(text, extraction({ experience: [job], unassigned: [{ text: TEAM, kind: "other", heading: null }] }), "dump");
    expect(doc.unassigned.filter((item) => item.text.includes("trabajar en equipo"))).toHaveLength(1);
  });

  it("cuts a story with no full stops where it can, instead of one card for all of it", () => {
    const flow = Array.from({ length: 20 }, (_, i) => `organicé el evento número ${i + 1} con todo el equipo de logística`).join(" y después ");
    const loose = uncoveredSentences(flow, reading(flow));
    expect(loose.length).toBeGreaterThan(1);
    expect(loose.every((piece) => piece.length <= 400)).toBe(true);
  });
});

describe("a story read for a profile", () => {
  it("arrives in the tray, with the heading it came under, and not for a document", () => {
    const asDump = verifyExtraction(STORY, extraction({ experience: [job] }), "dump");
    const asCv = verifyExtraction(STORY, extraction({ experience: [job] }), "cv");
    expect(asDump.unassigned.some((item) => item.heading === LOOSE_HEADING)).toBe(true);
    // A document's lines are headings and bullets, not sentences: which of them went unread is a question about the file.
    expect(asCv.unassigned).toEqual([]);

    const { profile } = applyParsedDocument(
      emptyStoredProfile(),
      asDump,
      { name: "Lo que contaste", fileHash: "", pasted: true, chars: STORY.length },
      { sourceId: "s1", now: "2026-10-03T12:00:00.000Z", newId: (() => { let n = 0; return () => `id-${++n}`; })() },
    );
    expect(profile.unassigned.some((item) => item.heading === LOOSE_HEADING && item.text.includes("trabajar en equipo"))).toBe(true);
  });
});

describe("a story read a second time", () => {
  it("does not put in the tray what the tray already has", () => {
    const read = verifyExtraction(STORY, extraction({ experience: [job] }), "dump");
    expect(read.unassigned).toHaveLength(1);
    // What is already there, spelled a little differently (case, accents, spacing), is the same card.
    const again = withoutKnownCards(read, [{ text: `  ${TEAM.toUpperCase()}   ${MANY.normalize("NFD").replace(/[\u0300-\u036f]/g, "")} ` }]);
    expect(again.unassigned).toEqual([]);
  });

  it("keeps what is new, and leaves everything else of the reading as it was", () => {
    const read = verifyExtraction(STORY, extraction({ experience: [job] }), "dump");
    const again = withoutKnownCards(read, [{ text: "Otra cosa que ya estaba en la bandeja." }]);
    expect(again).toEqual(read);
  });
});
