import { z } from "zod";
import { fold, readRequirements, type Obligation, type Requirement, type RequirementType } from "./requirements";

/**
 * The bank of job postings that `readRequirements` is measured against: each posting copied by hand, with what it asks, labelled by a person
 * — the literal words, the kind of thing, and whether the posting says it is a must. The reader is a dictionary and some rules, and a
 * dictionary is as good as the postings it has been shown; this is how anyone, including whoever adds a posting it misreads, can tell how
 * good that is. `docs/banco-de-avisos.md` says how a posting is added and what it must not contain.
 *
 * Pure: it takes the postings as an argument. The test reads the files (`tests/fixtures/avisos/*.json`) and holds the reader to `BANK_FLOORS`.
 */

/** The kinds of requirement as a person labelling a posting names them, and as the reader names them. */
export const LABEL_TYPES = {
  herramienta: "tool",
  tarea: "task",
  condicion: "condition",
  credencial: "credential",
  rasgo: "trait",
  otro: "other",
} as const satisfies Record<string, RequirementType>;

export const LABEL_OBLIGATIONS = {
  excluyente: "required",
  deseable: "preferred",
  no_indicado: "unstated",
} as const satisfies Record<string, Obligation>;

const labelSchema = z.object({
  /** The words of the posting, copied: they must be in it. */
  fragmento: z.string().min(1),
  tipo: z.enum(Object.keys(LABEL_TYPES) as [keyof typeof LABEL_TYPES, ...Array<keyof typeof LABEL_TYPES>]),
  obligatoriedad: z.enum(Object.keys(LABEL_OBLIGATIONS) as [keyof typeof LABEL_OBLIGATIONS, ...Array<keyof typeof LABEL_OBLIGATIONS>]),
});

export const bankAdSchema = z
  .object({
    id: z.string().min(1),
    /** Where it comes from: `ejemplo` was written to show the format and to start the bank; `real` was copied by the team from a posting. */
    origen: z.enum(["ejemplo", "real"]),
    segmento: z.enum(["oficios", "primer-empleo", "tecnico", "administrativo", "otro"]),
    texto: z.string().min(1),
    requisitos: z.array(labelSchema),
  })
  .superRefine((ad, ctx) => {
    ad.requisitos.forEach((label, index) => {
      if (!ad.texto.includes(label.fragmento)) {
        ctx.addIssue({ code: "custom", path: ["requisitos", index, "fragmento"], message: "El fragmento no está, tal cual, en el texto del aviso." });
      }
    });
  });

export type BankAd = z.infer<typeof bankAdSchema>;

// --- Matching a reading to a label ---------------------------------------------------------------------------------------

const tokensOf = (value: string): string[] =>
  fold(value)
    .replace(/[^a-z0-9#+]+/g, " ")
    .trim()
    .split(" ")
    .filter((token) => token.length > 1);

/**
 * Whether two quotes are the same stretch of the posting: one holds the other, or they share three quarters of the shorter one's words. A
 * reading that quotes «Debe manejar secador y plancha» and a label that says «manejar secador y plancha» are the same requirement.
 */
export function sameStretch(a: string, b: string): boolean {
  const left = tokensOf(a);
  const right = tokensOf(b);
  if (left.length === 0 || right.length === 0) return false;
  const joinedLeft = left.join(" ");
  const joinedRight = right.join(" ");
  if (joinedLeft.includes(joinedRight) || joinedRight.includes(joinedLeft)) return true;
  const rightSet = new Set(right);
  const shared = new Set(left.filter((token) => rightSet.has(token))).size;
  return shared >= 2 && shared / Math.min(new Set(left).size, rightSet.size) >= 0.75;
}

// --- The report ---------------------------------------------------------------------------------------------------------------

export type Score = {
  /** How many requirements of this kind the reader read. */
  predicted: number;
  /** Of those, how many are a label's. */
  correct: number;
  /** How many a person labelled. */
  labelled: number;
  /** Of those, how many the reader read. */
  covered: number;
};

export type Stretch = { ad: string; type: RequirementType; fragment: string; obligation: Obligation };

export type BankReport = {
  ads: number;
  byType: Record<RequirementType, Score>;
  /** Over the labels the reader found: whether it also read how much the posting says. */
  obligation: { compared: number; right: number };
  /** Labelled and not read. */
  misses: Stretch[];
  /** Read and not labelled. */
  extras: Stretch[];
  /** Read, and labelled, but read as more or less of a must than the label says. */
  wrongObligation: Array<{ ad: string; fragment: string; read: Obligation; labelled: Obligation }>;
};

const TYPES: readonly RequirementType[] = ["tool", "task", "condition", "credential", "trait", "other"];

/** `null` when there is nothing to divide: a kind that was never read, or never labelled. */
export const precision = (score: Score): number | null => (score.predicted === 0 ? null : score.correct / score.predicted);
export const coverage = (score: Score): number | null => (score.labelled === 0 ? null : score.covered / score.labelled);

export function evaluateBank(ads: readonly BankAd[], read: (text: string) => Requirement[] = readRequirements): BankReport {
  const byType = Object.fromEntries(TYPES.map((type) => [type, { predicted: 0, correct: 0, labelled: 0, covered: 0 }])) as Record<RequirementType, Score>;
  const report: BankReport = { ads: ads.length, byType, obligation: { compared: 0, right: 0 }, misses: [], extras: [], wrongObligation: [] };

  for (const ad of ads) {
    const labels = ad.requisitos.map((label) => ({
      fragment: label.fragmento,
      type: LABEL_TYPES[label.tipo],
      obligation: LABEL_OBLIGATIONS[label.obligatoriedad],
    }));
    const readings = read(ad.texto);

    for (const reading of readings) {
      byType[reading.type].predicted += 1;
      if (labels.some((label) => label.type === reading.type && sameStretch(label.fragment, reading.fragment))) byType[reading.type].correct += 1;
      else report.extras.push({ ad: ad.id, type: reading.type, fragment: reading.fragment, obligation: reading.obligation });
    }

    for (const label of labels) {
      byType[label.type].labelled += 1;
      const found = readings.filter((reading) => reading.type === label.type && sameStretch(label.fragment, reading.fragment));
      if (found.length === 0) {
        report.misses.push({ ad: ad.id, type: label.type, fragment: label.fragment, obligation: label.obligation });
        continue;
      }
      byType[label.type].covered += 1;
      report.obligation.compared += 1;
      if (found.some((reading) => reading.obligation === label.obligation)) report.obligation.right += 1;
      else report.wrongObligation.push({ ad: ad.id, fragment: label.fragment, read: found[0]!.obligation, labelled: label.obligation });
    }
  }
  return report;
}

/**
 * The floors the reader is held to: what it must keep reading right however the dictionary changes. Each is set a little under what was measured
 * when it was set, so that a change that makes the reader worse fails the test and one that makes it better does not need to touch it; a floor
 * goes up when the reader improves and is not lowered without saying, in the commit, which posting made it fall and why that is worth it.
 */
export type Floors = {
  /** Of what the reader reads as a thing to ask about, how much is right: a wrong question is worse than a missing one. */
  precision: Partial<Record<RequirementType, number>>;
  coverage: Partial<Record<RequirementType, number>>;
  obligation: number;
};

/** The shape of a report as plain lines, for a person to read: the same table `docs/banco-de-avisos.md` shows. */
export function describeReport(report: BankReport): string {
  const percent = (value: number | null) => (value === null ? "   –" : `${String(Math.round(value * 100)).padStart(3)}%`);
  const lines = [`Avisos: ${report.ads}`, "tipo         leídos  bien  precisión   marcados  leídos  cobertura"];
  for (const type of TYPES) {
    const score = report.byType[type];
    lines.push(
      `${type.padEnd(12)} ${String(score.predicted).padStart(6)}  ${String(score.correct).padStart(4)}  ${percent(precision(score))}       ${String(score.labelled).padStart(8)}  ${String(score.covered).padStart(6)}  ${percent(coverage(score))}`,
    );
  }
  const { compared, right } = report.obligation;
  lines.push(`Obligatoriedad bien leída: ${right} de ${compared}${compared ? ` (${Math.round((right / compared) * 100)}%)` : ""}`);
  return lines.join("\n");
}
