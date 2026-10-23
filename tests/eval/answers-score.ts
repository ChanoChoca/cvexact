import { auditAnswers, type AnswerProblemKind } from "@/lib/ai/verify";
import type { CVDocument } from "@/lib/schemas/cv";
import type { Answers } from "@/lib/schemas/outputs";
import type { Profile } from "@/lib/schemas/profile";

/**
 * Metrics for one generated set of form answers, and the aggregate over a
 * corpus of them. The sibling of `./score.ts`, which does the same for CVs.
 *
 * The two measure opposite failures. A CV overclaims — `scoreCV`'s headline
 * number is invented technology. Answers underclaim: told six ways not to
 * overstate and almost nothing about what the candidate has, the model reads a
 * form question as an invitation to disclaim, and the answer that started this
 * was "0 años de experiencia ... como combinación específica" from a profile
 * holding all three technologies for over two years.
 *
 * Every number below is computed by `auditAnswers`, the same function the route
 * runs and the panel renders. A second implementation here would drift, and the
 * eval would end up grading a definition the product does not use.
 */

export type AnswerScore = {
  label: string;
  answers: number;
  words: number;
  /** Answers claiming less than the profile's own dates support. The bug. */
  understated: number;
  /** Technologies claimed that the profile never states. */
  fabricated: number;
  /** Opened on the gap with something better available to lead with. */
  negativeOpeners: number;
  /** Qualifiers that take a true answer back. */
  selfDefeating: number;
  /** Denials of something the CV asserts, to the same reader. */
  cvContradictions: number;
  /** Answers the model itself flagged as a draft the user must check. */
  needsUserInput: number;
  /** Answers with a bare value filled in — what a numeric question wants. */
  withShortAnswer: number;
};

export function scoreAnswers(input: {
  label: string;
  profile: Profile;
  answers: Answers;
  cv?: CVDocument;
  keywords?: readonly string[];
  now?: Date;
}): AnswerScore {
  const { label, profile, answers, cv, keywords, now } = input;

  const problems = auditAnswers({ answers, profile, cv, keywords, now });
  const count = (kind: AnswerProblemKind) => problems.filter((p) => p.kind === kind).length;

  return {
    label,
    answers: answers.answers.length,
    words: answers.answers.reduce(
      (n, a) => n + a.answer.split(/\s+/).filter(Boolean).length,
      0,
    ),
    understated: count("understated"),
    fabricated: count("fabricated"),
    negativeOpeners: count("negative-opener"),
    selfDefeating: count("self-defeating"),
    cvContradictions: count("cv-contradiction"),
    needsUserInput: answers.answers.filter((a) => a.needsUserInput).length,
    withShortAnswer: answers.answers.filter((a) => a.shortAnswer.trim().length > 0).length,
  };
}

export type AnswerAggregate = {
  applications: number;
  answers: number;
  wordsPerAnswer: number;
  /** All five are per answer, and all five should be 0. */
  understatedPerAnswer: number;
  fabricatedPerAnswer: number;
  negativeOpenersPerAnswer: number;
  selfDefeatingPerAnswer: number;
  cvContradictionsPerAnswer: number;
  /** Share of answer sets containing at least one understated figure. */
  setsWithUnderstatement: number;
  needsUserInput: number;
  withShortAnswer: number;
};

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

export function aggregateAnswers(scores: AnswerScore[]): AnswerAggregate {
  const n = scores.length;
  const sum = (pick: (s: AnswerScore) => number) =>
    scores.reduce((total, s) => total + pick(s), 0);
  const answers = sum((s) => s.answers);

  return {
    applications: n,
    answers,
    wordsPerAnswer: ratio(sum((s) => s.words), answers),
    understatedPerAnswer: ratio(sum((s) => s.understated), answers),
    fabricatedPerAnswer: ratio(sum((s) => s.fabricated), answers),
    negativeOpenersPerAnswer: ratio(sum((s) => s.negativeOpeners), answers),
    selfDefeatingPerAnswer: ratio(sum((s) => s.selfDefeating), answers),
    cvContradictionsPerAnswer: ratio(sum((s) => s.cvContradictions), answers),
    setsWithUnderstatement: ratio(scores.filter((s) => s.understated > 0).length, n),
    needsUserInput: ratio(sum((s) => s.needsUserInput), answers),
    withShortAnswer: ratio(sum((s) => s.withShortAnswer), answers),
  };
}

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

export function formatAnswerAggregate(
  title: string,
  agg: AnswerAggregate,
  scores: AnswerScore[],
): string {
  const worst = [...scores]
    .sort((a, b) => b.understated - a.understated)
    .slice(0, 8)
    .filter((s) => s.understated > 0);

  const lines = [
    ``,
    `── ${title} — ${agg.applications} postulaciones, ${agg.answers} respuestas ──`,
    `  Respuestas por debajo de las fechas ${agg.understatedPerAnswer.toFixed(3)}`,
    `  Sets con alguna subestimación       ${percent(agg.setsWithUnderstatement)}`,
    `  Tecnología inventada por respuesta  ${agg.fabricatedPerAnswer.toFixed(3)}`,
    `  Aperturas por la carencia           ${agg.negativeOpenersPerAnswer.toFixed(3)}`,
    `  Reparos que se sabotean             ${agg.selfDefeatingPerAnswer.toFixed(3)}`,
    `  Contradicciones con el CV           ${agg.cvContradictionsPerAnswer.toFixed(3)}`,
    `  Palabras por respuesta              ${agg.wordsPerAnswer.toFixed(1)}`,
    `  Respuestas con valor corto          ${percent(agg.withShortAnswer)}`,
    `  Respuestas marcadas como borrador   ${percent(agg.needsUserInput)}`,
  ];

  if (worst.length) {
    lines.push(`  Peores casos:`);
    for (const score of worst) {
      lines.push(`    ${score.label.slice(0, 40).padEnd(40)} ${score.understated}`);
    }
  }

  return lines.join("\n");
}

export function formatAnswerComparison(
  before: AnswerAggregate,
  after: AnswerAggregate,
): string {
  // Tolerates a baseline recorded before a metric existed, exactly as
  // `formatComparison` in ./score.ts does: that is the normal state on the run
  // that is meant to establish the new number.
  const row = (
    name: string,
    a: number | undefined,
    b: number,
    format: (v: number) => string,
  ) => {
    const current = format(b).padStart(8);
    if (a === undefined) return `  ${name.padEnd(35)}${"—".padStart(8)} → ${current}   (nueva)`;
    const delta = b - a;
    return `  ${name.padEnd(35)}${format(a).padStart(8)} → ${current}   ${delta > 0 ? "+" : ""}${format(delta)}`;
  };
  const fixed = (digits: number) => (v: number) => v.toFixed(digits);

  return [
    ``,
    `── respuestas: línea de base → actual ──`,
    row("Por debajo de las fechas", before.understatedPerAnswer, after.understatedPerAnswer, fixed(3)),
    row("Sets con alguna subestimación", before.setsWithUnderstatement, after.setsWithUnderstatement, percent),
    row("Tecnología inventada", before.fabricatedPerAnswer, after.fabricatedPerAnswer, fixed(3)),
    row("Aperturas por la carencia", before.negativeOpenersPerAnswer, after.negativeOpenersPerAnswer, fixed(3)),
    row("Reparos que se sabotean", before.selfDefeatingPerAnswer, after.selfDefeatingPerAnswer, fixed(3)),
    row("Contradicciones con el CV", before.cvContradictionsPerAnswer, after.cvContradictionsPerAnswer, fixed(3)),
    row("Palabras por respuesta", before.wordsPerAnswer, after.wordsPerAnswer, fixed(1)),
    row("Respuestas con valor corto", before.withShortAnswer, after.withShortAnswer, percent),
    row("Marcadas como borrador", before.needsUserInput, after.needsUserInput, percent),
  ].join("\n");
}

/**
 * The questions every posting in the corpus is asked, so the regenerate mode
 * has something comparable to measure.
 *
 * Scoring only the `answers` already in an export would measure almost nothing:
 * the tab is optional and most saved applications never ran it. These four are
 * the ones a real form asks, and the first is the one this whole harness exists
 * for — `{tech}` is filled with the posting's own leading keyword, so each
 * application asks about the technology it actually cares about.
 */
export const QUESTION_BATTERY = [
  "¿Cuántos años de experiencia tenés con {tech}?",
  "¿Cuál es tu disponibilidad horaria?",
  "¿Cuál es tu expectativa salarial?",
  "¿Por qué te interesa este puesto?",
];

export function batteryFor(keywords: readonly string[]): string[] {
  const tech = keywords[0] ?? "el stack del puesto";
  return QUESTION_BATTERY.map((q) => q.replace("{tech}", tech));
}
