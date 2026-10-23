import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { analyzeJob, buildCV, CV_MAX_OUTPUT_TOKENS, inferSkills } from "@/lib/ai/pipeline";
import type { GenerationTelemetry } from "@/lib/ai/pipeline";
import { resolveModel } from "@/lib/ai/provider";
import { isProviderId } from "@/lib/ai/provider-catalog";
import { verifyCV } from "@/lib/ai/verify";
import { headerFromProfile } from "@/lib/schemas/cv";
import { profileSchema, type Profile } from "@/lib/schemas/profile";

/**
 * Runs the real pipeline over ONE posting and prints why the result came out
 * the way it did.
 *
 *   CVP_EVAL_POSTING=path/to/posting.txt \
 *   CVP_EVAL_CORPUS=public/viejo/cvexact-2026-08-11.json \
 *   SERVICE_API_KEY=… pnpm test tests/eval/posting

 *
 * `CVP_EVAL_PROVIDER` and `CVP_EVAL_KEY` (optionally `CVP_EVAL_MODEL`) run it
 * against any other BYOK provider instead. Worth having: the provider shapes
 * the result as much as the prompt does — Cohere caps output at half the budget
 * this CV asks for, so a truncation this probe reports there may not reproduce
 * anywhere else.
 *
 * `corpus.test.ts` measures aggregates across many saved CVs, which is the
 * right tool for judging a prompt change. It is the wrong tool for a single CV
 * that came back mutilated: the aggregate says 10.4 bullets per CV and nothing
 * about the one that had two. This prints the token usage, the finish reason,
 * which repair path ran, and the structure of what came back — the things that
 * distinguish "the model was concise" from "the answer was cut off and the
 * retry deleted the work history".
 *
 * Skips with no posting configured, so it costs nothing in a normal run.
 */

const POSTING_PATH = process.env.CVP_EVAL_POSTING;
const CORPUS_PATH = process.env.CVP_EVAL_CORPUS;
const OUT_PATH = process.env.CVP_EVAL_OUT;

function loadProfile(path: string): Profile {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  const root = raw as { profile?: unknown };
  return profileSchema.parse(root.profile ?? raw);
}

describe.skipIf(!POSTING_PATH || !CORPUS_PATH)("single posting", () => {
  it(
    "generates a CV and reports what shaped it",
    async () => {
      const jobText = readFileSync(POSTING_PATH!, "utf8");
      const profile = loadProfile(CORPUS_PATH!);

      const provider = process.env.CVP_EVAL_PROVIDER ?? "google";
      if (!isProviderId(provider)) throw new Error(`CVP_EVAL_PROVIDER=${provider} is not a provider.`);

      const chain = await resolveModel({
        tier: "byok",
        action: "cv",
        byok: [
          {
            provider,
            apiKey: process.env.CVP_EVAL_KEY ?? process.env.SERVICE_API_KEY ?? "",
            model: process.env.CVP_EVAL_MODEL ?? process.env.SERVICE_MODEL,

          },
        ],
      });

      const [analysis, inferred] = await Promise.all([
        analyzeJob(chain, jobText, profile),
        inferSkills(chain, profile),
      ]);

      const out: string[] = [
        ``,
        `── ${analysis.title}${analysis.company ? ` · ${analysis.company}` : ""} ──`,
        `  proveedor ${chain.used.describe}`,
        `  relevancia ${analysis.relevance} · idioma ${analysis.language}`,
        `  requisitos ${analysis.requirements.length} · responsabilidades ${analysis.responsibilities.length} · keywords ${analysis.keywords.length}`,
        `  skills inferidas ${inferred.length}`,
      ];

      const telemetry: GenerationTelemetry = {};
      const generated = await buildCV(chain,
        { profile, analysis, inferredSkills: inferred, outputLanguage: analysis.language },
        telemetry,
      );

      // The route pins the header, so the probe has to as well or it measures a
      // CV nobody would ever be shown.
      const cv = {
        ...generated,
        header: headerFromProfile(profile),
      };

      const covChars = JSON.stringify(cv.coverage).length;
      const cvChars = JSON.stringify({ ...cv, coverage: undefined }).length;

      out.push(
        ``,
        `  finishReason        ${telemetry.finishReason ?? "?"}`,
        `  reparación          ${telemetry.repaired ?? "ninguna"}`,
        `  tokens entrada      ${telemetry.inputTokens ?? "?"}`,
        `  tokens salida       ${telemetry.outputTokens ?? "?"} (tope ${CV_MAX_OUTPUT_TOKENS})`,
        `  tokens razonamiento ${telemetry.reasoningTokens ?? "?"}`,
        `  reparto de salida   CV ${cvChars} chars · coverage ${covChars} chars ` +
          `(${Math.round((100 * covChars) / (cvChars + covChars))}% en un panel que no se imprime)`,
        ``,
        `  contacto  email=${cv.header.email || "(vacío)"} tel=${cv.header.phone || "(vacío)"} links=${cv.header.links.length}`,
      );

      let bullets = 0;
      for (const section of cv.sections) {
        if (section.kind === "experience") {
          const n = section.items.reduce((total, i) => total + i.bullets.length, 0);
          bullets += n;
          out.push(`  ${section.kind.padEnd(10)} "${section.title}" — ${section.items.length} items, ${n} bullets`);
        } else if (section.kind === "bullets") {
          bullets += section.bullets.length;
          out.push(`  ${section.kind.padEnd(10)} "${section.title}" — ${section.bullets.length} bullets`);
        } else {
          out.push(`  ${section.kind.padEnd(10)} "${section.title}" — ${section.items.length} items`);
        }
      }
      out.push(`  total bullets ${bullets} (presupuesto de un perfil de un rol con material de sobra: 12–16; con poco, el tope es lo que el perfil da)`);

      const findings = verifyCV(cv, profile, analysis);
      out.push(``, `  findings (${findings.length}):`);
      for (const f of findings) out.push(`    [${f.severity}] ${f.field}: ${f.detail}`);

      console.log(out.join("\n"));

      if (OUT_PATH) {
        writeFileSync(OUT_PATH, JSON.stringify(cv, null, 2));
        console.log(`\n  CV guardado en ${OUT_PATH}`);
      }

      // The failure this exists to catch: a CV with no work history at all.
      expect(cv.sections.some((s) => s.kind === "experience" && s.items.length > 0)).toBe(true);
    },
    120_000,
  );
});
