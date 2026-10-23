import { describe, expect, it } from "vitest";
import {
  attachQuestionLimits,
  countWords,
  parseQuestionLimit,
  parseQuestionLimits,
} from "@/lib/ai/question-limits";
import { answersSchema } from "@/lib/schemas/outputs";

/**
 * The form limit travels inside the pasted question — "máx. 300 caracteres" —
 * and the parser is the single source every consumer reads: the prompt tags the
 * question with it, the measured retry counts against it, and the panel's
 * counter shows it. A limit read where none was stated silently shortens an
 * answer; a limit missed leaves the paste to fail on the employer's side. Both
 * failures are pinned here.
 */
describe("parseQuestionLimit", () => {
  it("reads a parenthesised limit and drops the empty parentheses", () => {
    const parsed = parseQuestionLimit("¿Por qué querés trabajar acá? (máx. 300 caracteres)");

    expect(parsed.limit).toEqual({ unit: "chars", max: 300 });
    expect(parsed.question).toBe("¿Por qué querés trabajar acá?");
  });

  it("drops the closing parenthesis when the limit sits mid-sentence", () => {
    const parsed = parseQuestionLimit("Contá (máx. 300 caracteres) tu experiencia");

    expect(parsed.limit).toEqual({ unit: "chars", max: 300 });
    expect(parsed.question).toBe("Contá tu experiencia");
  });

  it("reads the qualifier after the number", () => {
    const parsed = parseQuestionLimit("¿Por qué querés trabajar acá? 300 caracteres como máximo");

    expect(parsed.limit).toEqual({ unit: "chars", max: 300 });
    expect(parsed.question).toBe("¿Por qué querés trabajar acá?");
  });

  it("reads the Spanish variants: máximo de, hasta, no más de, límite de", () => {
    for (const [raw, max] of [
      ["Máximo 300 caracteres", 300],
      ["un máximo de 300 caracteres", 300],
      ["hasta 300 caracteres", 300],
      ["no más de 300 caracteres", 300],
      ["límite de 300 caracteres", 300],
    ] as const) {
      expect(parseQuestionLimit(`Contá tu experiencia ${raw}`).limit?.max).toBe(max);
    }
  });

  it("reads the English variants: max, maximum of, or less", () => {
    expect(
      parseQuestionLimit("Describe your experience max 300 characters").limit,
    ).toEqual({ unit: "chars", max: 300 });
    expect(
      parseQuestionLimit("Describe your experience in 300 characters maximum").limit,
    ).toEqual({ unit: "chars", max: 300 });
    expect(
      parseQuestionLimit("Answer in 150 words or less.").limit,
    ).toEqual({ unit: "words", max: 150 });
  });

  it("tells characters from words", () => {
    expect(parseQuestionLimit("¿Cómo fuiste? (hasta 150 palabras)").limit).toEqual({
      unit: "words",
      max: 150,
    });
    expect(parseQuestionLimit("¿Cómo fuiste? (hasta 150 caracteres)").limit).toEqual({
      unit: "chars",
      max: 150,
    });
  });

  it("absorbs the qualifier the first match stops short of", () => {
    // "hasta" before the number, "o menos" after it: neither may survive as
    // boilerplate in the question the model is asked to answer.
    const parsed = parseQuestionLimit("Contá tu experiencia hasta 300 palabras o menos");

    expect(parsed.limit).toEqual({ unit: "words", max: 300 });
    expect(parsed.question).toBe("Contá tu experiencia");
  });

  it("leaves a question without a limit untouched", () => {
    const raw = "¿Cuál es tu disponibilidad horaria?";
    expect(parseQuestionLimit(raw)).toEqual({ question: raw });
  });

  it("does not read a limit where none is stated", () => {
    // "características" contains "caracter"; a year next to nothing is not a
    // cap; a bare count with no qualifier could describe the answer rather
    // than constrain it.
    for (const raw of [
      "¿Qué tecnologías caracterizan tu trabajo?",
      "¿Qué lograste en 2024?",
      "Mencioná 3 palabras que te describan.",
    ]) {
      expect(parseQuestionLimit(raw).limit).toBeUndefined();
    }
  });

  it("keeps the raw text when the line was nothing but the limit", () => {
    // A limit on its own line belongs to the question above it; an empty or
    // punctuation-only question would break the one-entry-per-question echo.
    for (const raw of ["Máximo 300 caracteres", "(máx. 300 caracteres)"]) {
      const parsed = parseQuestionLimit(raw);

      expect(parsed.question).toBe(raw);
      expect(parsed.limit).toEqual({ unit: "chars", max: 300 });
    }
  });
});

describe("parseQuestionLimits — explicit limits", () => {
  it("uses the explicit limit typed next to the question, ignoring any parsed one", () => {
    const parsed = parseQuestionLimits(
      ["¿Por qué querés trabajar acá? (máx. 300 caracteres)"],
      [150],
    );

    expect(parsed[0]!.limit).toEqual({ unit: "chars", max: 150 });
    // The boilerplate is still stripped from the question text even though
    // the explicit value, not the parsed one, wins.
    expect(parsed[0]!.question).toBe("¿Por qué querés trabajar acá?");
  });

  it("applies the explicit limit when the text states none", () => {
    const parsed = parseQuestionLimits(["¿Cuál es tu disponibilidad horaria?"], [200]);

    expect(parsed[0]!.limit).toEqual({ unit: "chars", max: 200 });
  });

  it("falls back to the parsed limit when no explicit value is given", () => {
    const parsed = parseQuestionLimits(
      ["¿Por qué querés trabajar acá? (máx. 300 caracteres)", "¿Cuándo podés empezar?"],
      [undefined, null],
    );

    expect(parsed[0]!.limit).toEqual({ unit: "chars", max: 300 });
    expect(parsed[1]!.limit).toBeUndefined();
  });
});

describe("countWords", () => {
  it("counts runs of whitespace as one separator", () => {
    expect(countWords("uno dos\ttres\n cuatro")).toBe(4);
  });

  it("counts nothing on empty or blank text", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
  });
});

describe("attachQuestionLimits", () => {
  it("pairs each answer with the limit its question stated, by position", () => {
    const answers = answersSchema.parse({
      language: "es",
      answers: [
        { question: "¿Por qué?", answer: "Porque.", shortAnswer: "" },
        { question: "¿Cuándo?", answer: "Ya.", shortAnswer: "" },
      ],
    });

    const withLimits = attachQuestionLimits(answers, [
      "¿Por qué? (máx. 300 caracteres)",
      "¿Cuándo?",
    ]);

    expect(withLimits.answers[0].maxChars).toBe(300);
    expect(withLimits.answers[0].maxWords).toBeUndefined();
    expect(withLimits.answers[1].maxChars).toBeUndefined();
    expect(withLimits.answers[1].maxWords).toBeUndefined();
  });

  it("keeps the language and the answers themselves intact", () => {
    const answers = answersSchema.parse({
      language: "es",
      answers: [{ question: "¿Por qué?", answer: "Porque.", shortAnswer: "sí" }],
    });

    const withLimits = attachQuestionLimits(answers, ["¿Por qué? (hasta 5 palabras)"]);

    expect(withLimits.language).toBe("es");
    expect(withLimits.answers[0]).toMatchObject({
      question: "¿Por qué?",
      answer: "Porque.",
      shortAnswer: "sí",
    });
    expect(withLimits.answers[0].maxWords).toBe(5);
  });

  it("attaches the explicit limit typed next to the question over the parsed one", () => {
    const answers = answersSchema.parse({
      language: "es",
      answers: [{ question: "¿Por qué?", answer: "Porque.", shortAnswer: "" }],
    });

    const withLimits = attachQuestionLimits(
      answers,
      ["¿Por qué? (máx. 300 caracteres)"],
      [120],
    );

    expect(withLimits.answers[0].maxChars).toBe(120);
  });
});