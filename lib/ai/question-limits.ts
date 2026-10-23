import type { Answers, AnswersWithLimits } from "@/lib/schemas/outputs";

/**
 * The limit an employer's form puts on an answer, stated inside the question
 * text.
 *
 * Form input boxes are capped — "máx. 300 caracteres", "in 150 words or
 * less" — and the cap travels with the question when the user pastes it here.
 * Parsed out in code rather than asked of the model: the parser is
 * deterministic, and the same parse feeds the prompt (the limit arrives as an
 * explicit tag), the measured retry (`answerLimitGaps` in `lib/ai/verify`) and
 * the counter the panel shows next to each answer (`attachQuestionLimits`).
 *
 * A limit is only read where the question states one with the words around it
 * ("máximo de", "hasta", "or less", …). A bare "300 caracteres" with no
 * qualifier could be a description of the answer, not a cap on it, so it is
 * left alone — the parser errs toward not constraining.
 */

export type QuestionLimit = {
  unit: "chars" | "words";
  max: number;
};

export type ParsedQuestion = {
  /** The question without the limit phrase, ready to be answered and echoed. */
  question: string;
  /** Absent when the question states no limit. */
  limit?: QuestionLimit;
};

const UNITS = "car[áa]cteres?|caracteres?|palabras?|characters?|chars?|words?";

// The qualifier before the number: "máx. 300 caracteres", "máximo de 300
// caracteres", "hasta 300 palabras", "no más de 300 caracteres", "límite de
// 300 caracteres", "max 300 characters", "maximum of 300 characters".
const BEFORE = new RegExp(
  `(?:\\(|\\b)(?:un\\s+)?(?:m[áa]x(?:imo|\\.)?(?:\\s+de)?|hasta|no\\s+m[áa]s\\s+de|l[íi]mite\\s+de|max(?:imum)?(?:\\s+of)?)\\s*:?\\s*(\\d{1,5})\\s+(${UNITS})\\b`,
  "i",
);

// The qualifier after: "300 caracteres máximo", "300 palabras como máximo",
// "300 characters max", "150 words or less", "150 palabras o menos".
const AFTER = new RegExp(
  `\\b(\\d{1,5})\\s+(${UNITS})\\s+(?:como\\s+)?(?:m[áa]x(?:imo|\\.)?|max(?:imum)?|o\\s+menos|or\\s+(?:less|fewer))\\b`,
  "i",
);

const isWords = (unit: string) => /^(palabras?|words?)$/i.test(unit);

/**
 * Removes the matched limit phrase and everything that only held it together:
 * the wrapping parentheses, a trailing "o menos"/"or less" the match stopped
 * short of, the "hasta"/"in" in front of it. "¿Por qué querés trabajar acá?
 * (máx. 300 caracteres)" comes back as "¿Por qué querés trabajar acá?".
 */
function stripLimit(raw: string, match: RegExpExecArray): string {
  let start = match.index;
  let end = start + match[0].length;

  const trailing = /^(?:\s+(?:o\s+menos|or\s+(?:less|fewer)))\b/i.exec(raw.slice(end));
  if (trailing) end += trailing[0].length;

  const leading =
    /(?:un\s+)?(?:m[áa]x(?:imo|\.)?(?:\s+de)?|hasta|no\s+m[áa]s\s+de|l[íi]mite\s+de|max(?:imum)?(?:\s+of)?|en|in)\s+$/i.exec(
      raw.slice(0, start),
    );
  if (leading) start -= leading[0].length;

  let cleaned = raw.slice(0, start) + raw.slice(end);
  // When the match opened the parenthesis — "(máx. 300 caracteres" — its
  // closing ")" sits right after the cut, mid-sentence or at the end; drop it
  // too, so nothing but the question text is left behind.
  if (match[0].startsWith("(")) {
    cleaned = raw.slice(0, start) + raw.slice(end).replace(/^\s*\)/, "");
  }
  return cleaned
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,;:.!?])/g, "$1")
    .replace(/^[,;:]\s*/, "")
    .trim();
}

export function parseQuestionLimit(raw: string): ParsedQuestion {
  const match = AFTER.exec(raw) ?? BEFORE.exec(raw);
  if (!match) return { question: raw.trim() };

  const max = Number(match[1]);
  if (!Number.isInteger(max) || max < 1 || max > 100000) return { question: raw.trim() };

  const limit: QuestionLimit = { unit: isWords(match[2]) ? "words" : "chars", max };
  // A line that was only the limit — "Máximo 300 caracteres", or a bare
  // "(máx. 300 caracteres)" whose strip leaves a lone ")" — keeps its text: it
  // likely belongs to the question above it, and an empty or punctuation-only
  // question would break the one-entry-per-question echo.
  const question = stripLimit(raw, match);
  const usable = question.length > 0 && !/^[,;:.!?()\s]*$/.test(question);
  return { question: usable ? question : raw.trim(), limit };
}

/**
 * An explicit limit, typed by the user next to the question rather than
 * pasted inside it, wins over whatever the text parses to — it is a
 * deliberate override, not a guess.
 */
export function parseQuestionLimits(
  questions: readonly string[],
  explicitLimits?: readonly (number | null | undefined)[],
): ParsedQuestion[] {
  return questions.map((raw, index) => {
    const parsed = parseQuestionLimit(raw);
    const explicit = explicitLimits?.[index];
    if (!explicit) return parsed;
    return { question: parsed.question, limit: { unit: "chars", max: explicit } };
  });
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

/**
 * Pairs each generated answer with the limit its question stated, by position.
 *
 * The model's own shape (`answersSchema`) does not carry the limits — they are
 * parsed from the pasted questions, not asked of the model — so the route
 * attaches them here before persisting, and a reopened application can still
 * show the count next to every answer.
 */
export function attachQuestionLimits(
  answers: Answers,
  questions: readonly string[],
  explicitLimits?: readonly (number | null | undefined)[],
): AnswersWithLimits {
  const parsed = parseQuestionLimits(questions, explicitLimits);
  return {
    language: answers.language,
    answers: answers.answers.map((entry, index) => {
      const limit = parsed[index]?.limit;
      if (!limit) return entry;
      return limit.unit === "chars"
        ? { ...entry, maxChars: limit.max }
        : { ...entry, maxWords: limit.max };
    }),
  };
}