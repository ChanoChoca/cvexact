import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { cvDocumentSchema, headerFromProfile, type CVDocument } from "@/lib/schemas/cv";
import { jobAnalysisSchema, type JobAnalysis } from "@/lib/schemas/job";
import { answersSchema, type Answers } from "@/lib/schemas/outputs";
import { profileSchema, type Profile } from "@/lib/schemas/profile";
import { aggregate, formatAggregate, formatComparison, scoreCV, type Aggregate } from "./score";
import {
  aggregateAnswers,
  batteryFor,
  formatAnswerAggregate,
  formatAnswerComparison,
  scoreAnswers,
  type AnswerAggregate,
  type AnswerScore,
} from "./answers-score";

/**
 * Regression harness for generation quality, run against a real export.
 *
 * It is a test file so it inherits the runner and the `@/` alias, but it is not
 * part of the suite: with no corpus configured every case skips. Two modes:
 *
 *   CVP_EVAL_CORPUS=path/to/export.json pnpm test tests/eval
 *     Re-scores the CVs already in the export. Cheap, offline, deterministic —
 *     this is the baseline a prompt change is judged against.
 *
 *   CVP_EVAL_REGENERATE=1 CVP_EVAL_LIMIT=10 SERVICE_API_KEY=… pnpm test tests/eval

 *     Re-runs the live pipeline over the same postings and compares. Costs
 *     quota, so it samples `CVP_EVAL_LIMIT` applications (default 10).
 *
 *     To measure the provider the user actually runs on rather than the service
 *     default, set CVP_EVAL_PROVIDER (+ CVP_EVAL_KEY, optionally
 *     CVP_EVAL_MODEL) and the run goes through the same BYOK path the browser
 *     uses. A prompt tuned against Gemini and shipped to someone on Cohere was
 *     never measured where it runs.
 *
 * Add CVP_EVAL_BASELINE=write once before changing a prompt to record where you
 * started; later runs print the delta. Baselines are named after the corpus AND
 * the model, so measuring a prompt change on a second provider means writing a
 * second baseline rather than diffing against the first one's.
 */

const CORPUS_PATH = process.env.CVP_EVAL_CORPUS;

/**
 * One baseline per corpus, per model.
 *
 * A single shared file quietly invited a comparison that means nothing. The
 * committed `baseline.json` was written from 5 applications; diffing it against
 * a 58-application export printed "CVs con tecnología inventada 0.0% → 58.6%",
 * which is not a regression, it is two different corpora — 53 of those CVs came
 * out of prompts that no longer exist. Naming the baseline after the corpus makes
 * the mistake unavailable rather than merely discouraged.
 *
 * Falls back to the legacy path so the committed baseline keeps working for
 * whatever corpus produced it.
 */
function baselinePath(corpus: string): string {
  return fileURLToPath(
    new URL(`./baseline.${corpusName(corpus)}.${modelKey()}.json`, import.meta.url),
  );
}

/** The pre-model-suffix name, kept readable so the fallback below can find it. */
function corpusOnlyBaselinePath(corpus: string): string {
  return fileURLToPath(new URL(`./baseline.${corpusName(corpus)}.json`, import.meta.url));
}

function corpusName(corpus: string): string {
  return basename(corpus).replace(/\.json$/i, "");
}

/**
 * Which model produced the numbers, as a filename fragment.
 *
 * The corpus fixes the input; the model fixes how that input was answered, and
 * the two are equally capable of turning a comparison into nonsense. Diffing a
 * Gemini baseline against a Cohere run prints a regression that is only a change
 * of provider — the same mistake `baselinePath` above already exists to make
 * unavailable, one axis over. The prompt comments in `lib/ai/` are calibrated
 * against one model each; this is what lets the next one be calibrated too.
 *
 * "service" when no BYOK provider is configured, which is what that path is: a
 * model chosen by tier rather than named here.
 */
function modelKey(): string {
  const provider = process.env.CVP_EVAL_PROVIDER;
  if (!provider) return "service";
  const model = process.env.CVP_EVAL_MODEL;
  return slug(model ? `${provider}-${model}` : provider);
}

/** Model ids carry "/" and ":" — `google/gemini-2.5-flash`, `qwen/q:free`. */
function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

/**
 * The answers get their own baseline file rather than a section of the CV's.
 *
 * They are scored over a different denominator — answers, not applications —
 * and over a different subset of the corpus, since most saved applications
 * never ran the answers tab. Merging them into one file would invite the
 * comparison `baselinePath` above already exists to make unavailable.
 */
function answersBaselinePath(corpus: string): string {
  return fileURLToPath(
    new URL(`./baseline-answers.${corpusName(corpus)}.${modelKey()}.json`, import.meta.url),
  );
}

function readAnswersBaseline(corpus: string): AnswerAggregate | null {
  return readFirst<AnswerAggregate>([
    answersBaselinePath(corpus),
    fileURLToPath(new URL(`./baseline-answers.${corpusName(corpus)}.json`, import.meta.url)),
  ]);
}

const LEGACY_BASELINE_PATH = fileURLToPath(new URL("./baseline.json", import.meta.url));

/**
 * Restricts the run to one relevance bucket.
 *
 * 46 of the 58 saved applications are `direct`, so every metric that only means
 * something outside the candidate's field — jargon, the code links in the
 * header, where the pairs section sits — is invisible in the overall average.
 */
const RELEVANCE_FILTER = process.env.CVP_EVAL_RELEVANCE;

type Case = {
  label: string;
  jobText: string;
  analysis: JobAnalysis;
  cv: CVDocument;
  /** Present only where the user ran the answers tab on this application. */
  answers?: Answers;
};

function loadCorpus(path: string): { profile: Profile; cases: Case[] } {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof raw !== "object" || raw === null) throw new Error(`${path} is not an export.`);

  const root = raw as { profile?: unknown; applications?: unknown };
  const profile = profileSchema.parse(root.profile ?? {});
  const applications = Array.isArray(root.applications) ? root.applications : [];

  const cases: Case[] = [];
  for (const entry of applications) {
    const app = entry as Record<string, unknown>;
    // Applications saved before the CV step, or from an older schema, carry no
    // usable signal — skip them rather than fail the whole run.
    const analysis = jobAnalysisSchema.safeParse(app.analysis);
    const cv = cvDocumentSchema.safeParse(app.cv);
    if (!analysis.success || !cv.success || typeof app.jobText !== "string") continue;
    const answers = answersSchema.safeParse(app.answers);
    cases.push({
      label: typeof app.label === "string" && app.label ? app.label : analysis.data.title,
      jobText: app.jobText,
      analysis: analysis.data,
      cv: cv.data,
      answers: answers.success ? answers.data : undefined,
    });
  }

  return { profile, cases };
}

function readBaseline(corpus: string): Aggregate | null {
  return readFirst<Aggregate>([
    baselinePath(corpus),
    corpusOnlyBaselinePath(corpus),
    LEGACY_BASELINE_PATH,
  ]);
}

/**
 * The first of these that parses, announcing which one it was.
 *
 * The fallbacks reach baselines written before the model was part of the name,
 * so a comparison can silently be against a different model after all. Saying
 * which file the numbers came from is what keeps that visible instead of
 * merely possible.
 */
function readFirst<T>(paths: string[]): T | null {
  for (const [index, path] of paths.entries()) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as T;
      if (index > 0) console.log(`\nComparando contra ${basename(path)} — no es de este modelo.`);
      return parsed;
    } catch {
      continue;
    }
  }
  return null;
}

describe.skipIf(!CORPUS_PATH)("corpus eval", () => {
  // Lazy: `describe.skipIf` still runs the suite body at collection time, and
  // reading a file that was never configured would fail the whole run.
  let corpus: ReturnType<typeof loadCorpus> | null = null;
  const load = () => (corpus ??= loadCorpus(CORPUS_PATH!));

  it("scores the CVs already in the export", () => {
    const { profile, cases: all } = load();
    const cases = RELEVANCE_FILTER
      ? all.filter((c) => c.analysis.relevance === RELEVANCE_FILTER)
      : all;
    expect(cases.length).toBeGreaterThan(0);

    const score = (list: Case[]) =>
      list.map((c) => scoreCV({ label: c.label, profile, analysis: c.analysis, cv: c.cv }));

    const scores = score(cases);
    const agg = aggregate(scores);
    console.log(formatAggregate(`CVs guardados${RELEVANCE_FILTER ? ` (${RELEVANCE_FILTER})` : ""}`, agg, scores));

    // Per bucket as well as overall, unless the run is already one bucket. The
    // `unrelated` cases are the hard ones and there are two of them; averaged
    // in with 46 `direct` CVs they say nothing.
    if (!RELEVANCE_FILTER) {
      for (const relevance of ["direct", "adjacent", "unrelated"] as const) {
        const bucket = score(cases.filter((c) => c.analysis.relevance === relevance));
        if (bucket.length > 0) {
          console.log(formatAggregate(`— ${relevance} (n=${bucket.length})`, aggregate(bucket), bucket));
        }
      }
    }

    if (process.env.CVP_EVAL_BASELINE === "write") {
      const path = baselinePath(CORPUS_PATH!);
      writeFileSync(path, `${JSON.stringify(agg, null, 2)}\n`);
      console.log(`\nLínea de base escrita en ${path}`);
      return;
    }

    const baseline = readBaseline(CORPUS_PATH!);
    if (baseline) console.log(formatComparison(baseline, agg));
  });

  /**
   * The answers already in the export, where there are any.
   *
   * Optional by nature: the answers tab is one the user may never open, so a
   * corpus with none of them skips rather than failing. The regenerate case
   * below is the one that produces comparable numbers across a whole corpus.
   */
  it("scores the answers already in the export", () => {
    const { profile, cases } = load();
    const withAnswers = cases.filter((c) => c.answers !== undefined);

    if (withAnswers.length === 0) {
      console.log("\nSin respuestas guardadas en el corpus; se salta el eval de Q&A.");
      return;
    }

    const scores = withAnswers.map((c) =>
      scoreAnswers({
        label: c.label,
        profile,
        answers: c.answers!,
        cv: c.cv,
        keywords: c.analysis.keywords,
      }),
    );
    const agg = aggregateAnswers(scores);
    console.log(formatAnswerAggregate("Respuestas guardadas", agg, scores));

    if (process.env.CVP_EVAL_BASELINE === "write") {
      const path = answersBaselinePath(CORPUS_PATH!);
      writeFileSync(path, `${JSON.stringify(agg, null, 2)}\n`);
      console.log(`\nLínea de base de respuestas escrita en ${path}`);
      return;
    }

    const baseline = readAnswersBaseline(CORPUS_PATH!);
    if (baseline) console.log(formatAnswerComparison(baseline, agg));
  });

  /**
   * The answers regenerated over a fixed battery of questions.
   *
   * One call per posting, against the CV the export already holds — the CV step
   * is not re-run, so this measures the answer prompt alone and costs a single
   * generation per application.
   */
  it.skipIf(!process.env.CVP_EVAL_REGENERATE)(
    "re-runs the answer generator over a fixed question battery",
    { timeout: 60 * 60_000 },
    async () => {
      const { answerQuestions } = await import("@/lib/ai/pipeline");
      const { isProviderId, resolveModel } = await import("@/lib/ai/provider");

      const { profile, cases } = load();
      const sample = cases.slice(0, Number(process.env.CVP_EVAL_LIMIT ?? 10));

      const configured = process.env.CVP_EVAL_PROVIDER;
      if (configured !== undefined && !isProviderId(configured)) {
        throw new Error(`CVP_EVAL_PROVIDER="${configured}" is not a known provider.`);
      }
      const chain = await resolveModel(
        configured
          ? {
              tier: "byok",
              action: "cv",
              byok: [
                {
                  provider: configured,
                  apiKey: process.env.CVP_EVAL_KEY ?? "",
                  model: process.env.CVP_EVAL_MODEL,
                },
              ],
            }
          : { tier: "free", action: "cv" },
      );
      console.log(`\nModelo: ${chain.used.describe}`);

      const scores: AnswerScore[] = [];
      for (const [i, entry] of sample.entries()) {
        const questions = batteryFor(entry.analysis.keywords);
        try {
          const answers = await answerQuestions(chain, {
            questions,
            profile,
            analysis: entry.analysis,
            cv: entry.cv,
            outputLanguage: entry.analysis.language,
          });
          scores.push(
            scoreAnswers({
              label: entry.label,
              profile,
              answers,
              cv: entry.cv,
              keywords: entry.analysis.keywords,
            }),
          );
        } catch (error) {
          console.warn(`  [${i + 1}/${sample.length}] ${entry.label}: ${String(error)}`);
        }
      }

      expect(scores.length).toBeGreaterThan(0);

      const after = aggregateAnswers(scores);
      console.log(formatAnswerAggregate("Respuestas regeneradas", after, scores));

      const baseline = readAnswersBaseline(CORPUS_PATH!);
      if (baseline) console.log(formatAnswerComparison(baseline, after));
    },
  );

  it.skipIf(!process.env.CVP_EVAL_REGENERATE)(
    "re-runs the pipeline and compares against the saved CVs",
    // A full 53-posting corpus is two live calls each on top of one shared skill
    // inference, and the slower free tiers sit around 35s per application.
    { timeout: 90 * 60_000 },
    async () => {
      // Imported lazily so the offline mode never pulls in the provider stack.
      const { analyzeJob, buildCV, inferSkills } = await import("@/lib/ai/pipeline");
      const { isProviderId, resolveModel } = await import("@/lib/ai/provider");

      const { profile, cases } = load();
      const limit = Number(process.env.CVP_EVAL_LIMIT ?? 10);
      const sample = cases.slice(0, limit);

      const configured = process.env.CVP_EVAL_PROVIDER;
      if (configured !== undefined && !isProviderId(configured)) {
        throw new Error(`CVP_EVAL_PROVIDER="${configured}" is not a known provider.`);
      }
      const chain = await resolveModel(
        configured
          ? {
              tier: "byok",
              action: "cv",
              byok: [
                {
                  provider: configured,
                  apiKey: process.env.CVP_EVAL_KEY ?? "",
                  model: process.env.CVP_EVAL_MODEL,
                },
              ],
            }
          : { tier: "free", action: "cv" },
      );
      console.log(`\nModelo: ${chain.used.describe}`);

      // One inference per corpus, not per application: it depends only on the
      // profile, and the route caches it the same way.
      const inferred = await inferSkills(chain, profile);

      const regenerated = [];
      for (const [i, entry] of sample.entries()) {
        try {
          const analysis = await analyzeJob(chain, entry.jobText, profile);
          const generated = await buildCV(chain, {
            profile,
            analysis,
            inferredSkills: inferred,
            outputLanguage: analysis.language,
          });
          // What ships is the route's output, not the model's: it overwrites the
          // whole header from the profile, and the prompt tells the model not to
          // spend effort there. Scoring the raw generation instead would report
          // every regenerated CV as having no contact email.
          const cv = { ...generated, header: headerFromProfile(profile) };
          regenerated.push(scoreCV({ label: entry.label, profile, analysis, cv }));
        } catch (error) {
          console.warn(`  [${i + 1}/${sample.length}] ${entry.label}: ${String(error)}`);
        }
      }

      expect(regenerated.length).toBeGreaterThan(0);

      const before = aggregate(
        sample
          .slice(0, regenerated.length)
          .map((c) => scoreCV({ label: c.label, profile, analysis: c.analysis, cv: c.cv })),
      );
      const after = aggregate(regenerated);

      console.log(formatAggregate("Regenerados", after, regenerated));
      console.log(formatComparison(before, after));
    },
  );
});
