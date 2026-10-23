/**
 * The pure, testable half of `/empleos`'s optional semantic reordering — text
 * shaping, cosine similarity and score blending. Everything that actually
 * touches a model lives in `app/(app)/empleos/embedder.worker.ts` instead: a
 * Web Worker, so downloading and running `multilingual-e5-small` never blocks
 * the main thread, and dynamically imported there so `@huggingface/
 * transformers` never enters the bundle for anyone who never turns this on.
 *
 * `lib/jobs/score.ts` — the lexical score every listing already has —
 * deliberately stays untouched by any of this: it runs everywhere `/empleos`
 * does not (`/postular`, `app/api/jobs/alerts/send/route.ts`), on the server,
 * where nothing can be embedded. This module only ever *reorders* what the
 * lexical score already ranked; it never replaces it, and `/empleos` renders
 * and sorts by the lexical score immediately, before anyone has opted into
 * this at all.
 */

import type { Profile } from "@/lib/schemas/profile";

/**
 * multilingual-e5 was trained with asymmetric prefixes for the two sides of a
 * retrieval pair — dropping them measurably hurts its ranking quality, per
 * the model's own card. The profile is the "query" side (what we're looking
 * for), a posting is the "passage" side (what we're looking for it in).
 */
const QUERY_PREFIX = "query: ";
const PASSAGE_PREFIX = "passage: ";

/** How much of a posting's description actually gets embedded. e5-small's
 *  context window is generous, but a long HTML-stripped description is
 *  mostly boilerplate ("beneficios", "sobre la empresa") after the first few
 *  hundred characters — the opening is where the actual role gets named. */
const DESCRIPTION_CHARS = 600;

/**
 * The text embedded for "what this candidate is looking for" — headline,
 * the most recent roles' titles, and named skills, in that order because
 * e5-small (mean-pooled) weighs earlier tokens slightly more once the input
 * runs long enough to matter.
 *
 * Plain prose the candidate already wrote, not `lib/ai/evidence.ts`'s
 * glossary walk: that machinery answers "does the profile support this named
 * technology", a much narrower question than "how similar is this profile's
 * *language* to this posting's". The two approaches are complementary, which
 * is the point of blending both scores instead of picking one.
 */
export function profileText(profile: Profile): string {
  const roles = profile.experience
    .slice(0, 3)
    .map((e) => [e.role, e.company].filter(Boolean).join(" en "))
    .filter(Boolean);
  // The objective first: it is what the person is after, which for someone changing field is not what their three
  // latest roles say — the query would otherwise find the sector they are leaving.
  const parts = [profile.objective, profile.headline, profile.about, ...roles, profile.skills.join(", ")].filter(
    (part) => part.trim().length > 0,
  );
  return QUERY_PREFIX + parts.join(". ");
}

/**
 * The text embedded for one posting. `description` must already be plain
 * text — this module has no DOM to strip HTML with, so the caller (the
 * worker, using the same `stripHtml` `JobsList.tsx` already runs before
 * prefilling `/postular`) does that first.
 */
export function postingText(job: {
  title: string;
  tags: readonly string[];
  description: string;
}): string {
  const body = job.description.slice(0, DESCRIPTION_CHARS);
  return PASSAGE_PREFIX + [job.title, job.tags.join(", "), body].filter(Boolean).join(". ");
}

/** Cosine similarity between two equal-length embedding vectors. `0` for a
 *  zero vector on either side rather than `NaN` — an embedding that failed to
 *  produce a real direction should rank as "no signal", not poison a sort. */
export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * How far apart the similarities in one page have to be before they carry
 * any ranking signal. e5's raw cosine similarities cluster tightly (roughly
 * 0.7–0.95 even between unrelated pairs — the metric is meaningful only in
 * relative, not absolute, terms), so a page where every posting reads
 * equally (dis)similar to the profile is a page with no semantic signal to
 * add, not a page that is all equally excellent matches.
 */
const MIN_SIMILARITY_SPREAD = 0.03;

/** How much weight the semantic signal gets once it is trusted. Kept a
 *  minority: `lib/jobs/score.ts`'s lexical score already reads the posting's
 *  own named requirements, which is more precise than embedding similarity
 *  when it has something to say — semantic reordering exists for the
 *  listings that lexical scoring reads as a flat, uninformative match. */
const SEMANTIC_WEIGHT = 0.35;

/**
 * Blends each listing's existing lexical score (0–100, from
 * `lib/jobs/score.ts`) with its raw cosine similarity to the profile,
 * min-max normalised across this same page first — the raw cosine value is
 * not usable as a 0–1 score on its own (see `MIN_SIMILARITY_SPREAD`), only
 * its rank within what is actually on screen is. Returns the lexical scores
 * unchanged when the page's similarities do not spread enough to say
 * anything real, rather than reorder on noise.
 */
export function blendScores(
  lexicalScores: readonly number[],
  similarities: readonly number[],
): number[] {
  if (lexicalScores.length !== similarities.length || lexicalScores.length === 0) {
    return [...lexicalScores];
  }
  const min = Math.min(...similarities);
  const max = Math.max(...similarities);
  if (max - min < MIN_SIMILARITY_SPREAD) return [...lexicalScores];

  return lexicalScores.map((lexical, i) => {
    const normalized = ((similarities[i] - min) / (max - min)) * 100;
    return lexical * (1 - SEMANTIC_WEIGHT) + normalized * SEMANTIC_WEIGHT;
  });
}
