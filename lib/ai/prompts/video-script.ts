import type { Profile } from "@/lib/schemas/profile";
import type { JobAnalysis } from "@/lib/schemas/job";
import type { CVDocument } from "@/lib/schemas/cv";
import { HONESTY_RULES, languageDirective, serializeProfile } from "./shared";
import { summarizeCV } from "./cv-summary";

/**
 * The script for the presentation video some postings ask for: a couple of
 * minutes of the candidate talking to a camera about topics the employer names.
 *
 * Unlike every other artifact here, this one is never read by the employer —
 * it is read by the candidate, off a screen, while recording. That changes what
 * good output is: it has to sound like speech rather than like a document, and
 * it has to fit the duration the posting demands, because going over is what
 * gets a submission rejected.
 */

/** Words per minute of unhurried, recorded-to-camera speech. */
export const SPEAKING_RATE = 140;

/** The word budget a block of `seconds` can hold at that pace. */
export function wordBudget(seconds: number): number {
  return Math.round((seconds / 60) * SPEAKING_RATE);
}

/**
 * Above this, a fully written script stops being usable.
 *
 * Three minutes is already ~420 words; ten is 1400. Nobody memorises that, and
 * a candidate reading it off a screen is visibly reading — the exact
 * impression the video is supposed to avoid. So a long video keeps its opening
 * and its closing written out, because those are what people fumble and what
 * the employer remembers, and turns the middle into something spoken around.
 */
export const VERBATIM_CEILING_SECONDS = 180;

/** How the blocks are written, given how long the whole thing runs. */
function registerDirective(durationSeconds: number): string {
  if (durationSeconds <= VERBATIM_CEILING_SECONDS) {
    return `
REGISTER: every block is "mode": "verbatim" — the exact words to say. At this
length the candidate can rehearse the whole thing, and a short video is won or
lost on the wording.
`.trim();
  }

  return `
REGISTER: this video is too long to memorise, so it is written in two registers.

- The FIRST block and the LAST block are "mode": "verbatim" — the exact words.
  These are the opening and the closing: the two places a candidate fumbles and
  the two the employer actually remembers.
- Every block in between is "mode": "outline". There, "script" is not what to
  say — it is what to cover and in what order, addressed to the candidate in
  the second person ("start with the problem, not the solution"). Keep it to
  40–70 words no matter how many seconds the block runs: the seconds are filled
  by the candidate speaking around it, not by reading your text aloud. Do not
  write out sentences for them to recite.
- In an outline block, "keyPoints" carry the content: 4–8 of them, each naming
  a concrete thing to say — a number, an employer, a project, an outcome. This
  is what the candidate glances at while the camera runs, so it is the part
  that must be specific.
`.trim();
}

/**
 * What survives if the response has to be shortened. Sibling of
 * `CV_REPAIR_FLOOR` — see the note on `repairSchemaViolation` in the pipeline.
 */
export const VIDEO_REPAIR_FLOOR = `
What must survive the shortening, in this order of sacrifice:
1. Cut "tips" first — they are close to the same advice every time and the
   least specific thing in the response.
2. Then shorten "keyPoints", and the "script" of the outline blocks.
3. Then shorten the verbatim blocks' wording.
NEVER drop a block: the blocks' "seconds" must still add up to "totalSeconds",
and a script missing its opening or its closing is one the candidate cannot
record.
`.trim();

export const VIDEO_SCRIPT_SYSTEM = `
You write the script for a candidate's self-presentation video.

${HONESTY_RULES}

The candidate reads this off a screen while recording themselves, so it is
spoken language, not written language.

VOICE AND REGISTER:
- First person, as the candidate, in their own register.
- Short sentences. One idea each. No subordinate clauses stacked on each other.
- Say numbers the way they are spoken.
- No markdown, no bullet characters, no headings inside "script".
- No stage directions inside "script" — no "smile", no "(pause)". Those belong
  in "tips" if they matter at all.
- Do not open with a greeting the employer will hear twenty times ("Hi, my name
  is X and I am very excited about this opportunity"). Open with something true
  and specific about this candidate.

LENGTH IS A HARD CONSTRAINT:
- Speech runs at about ${SPEAKING_RATE} words per minute. A verbatim block of N
  seconds therefore holds about N/60 × ${SPEAKING_RATE} words. Count as you write.
- "seconds" per block must add up to "totalSeconds", and "totalSeconds" must be
  the duration requested below.
- Aim for about 90% of each verbatim block's budget. A video that runs over is
  worse than one that runs short, and nobody speaks at an exactly even pace.

BLOCKS:
- When the employer names the topics, write one block per topic, in the order
  they asked, and use their own wording as "topic".
- When they do not, use: who I am → the experience that matters for this role,
  with one concrete thing from the CV → why this role and this employer → close
  with availability and a thank you.
- The longer the video, the finer the topics. Do not answer more minutes with
  the same three blocks stretched — split the middle into the actual things
  worth saying, one block each, and give each one only the seconds it needs.
- Every block must land on something specific from the profile or the CV. A
  block that could be about any candidate is a failed block.
- "keyPoints" are fragments, not sentences: what to remember if they lose their
  place mid-take.

TIPS: 3–5 short, concrete, actionable things about recording — framing, light,
looking at the lens instead of at their own image, recording two takes, not
reading word for word. Nothing about content, nothing generic about confidence.
`.trim();

export function buildVideoScriptPrompt(input: {
  profile: Profile;
  analysis: JobAnalysis;
  cv?: CVDocument;
  /** The topics or questions the employer wants covered. Optional. */
  topics: string;
  durationSeconds: number;
  outputLanguage: string;
}): string {
  const { profile, analysis, cv, topics, durationSeconds, outputLanguage } = input;
  const asked = topics.trim();

  return `
${languageDirective(outputLanguage)}

Write the script for this candidate's presentation video.

Total length: ${durationSeconds} seconds (about ${wordBudget(durationSeconds)} words of speech).
Set "totalSeconds" to ${durationSeconds}.

${registerDirective(durationSeconds)}

${
  asked
    ? `=== WHAT THE EMPLOYER ASKS THE VIDEO TO COVER ===\n${asked}\n=== END WHAT THE EMPLOYER ASKS ===\n\nThe topics above set the video's language: the employer is its audience, so\nwhen they are written in a language other than "${outputLanguage}", write the\nscript in the topics' language instead. When they match it, keep "${outputLanguage}".`
    : "The employer did not specify topics — use the default structure."
}

=== THE JOB ===
Title: ${analysis.title}
Company: ${analysis.company || "(not stated)"}
Location: ${analysis.location || "(not stated)"} · ${analysis.workMode}
Field: ${analysis.domain}
Seniority: ${analysis.seniority}
How close this is to the candidate's background: ${analysis.relevance} — ${analysis.relevanceReason}

Requirements:
${analysis.requirements.map((r) => `- [${r.kind}] ${r.text}`).join("\n") || "(none extracted)"}

Responsibilities:
${analysis.responsibilities.map((r) => `- ${r}`).join("\n") || "(none extracted)"}
=== END THE JOB ===

=== THE CV THEY WILL RECEIVE ===
Nothing you write may contradict this.
${cv ? summarizeCV(cv) : "(not generated yet — rely on the profile)"}
=== END CV ===

=== FULL PROFILE (may contain things the CV left out) ===
${serializeProfile(profile)}
=== END FULL PROFILE ===

Set "jobTitle" and "company" from the job above.

"labels" holds the headings the printed sheet puts above your text, and the
paragraph that introduces it. They are read by the candidate, so write them in
the output language too, not in English and not as schema keys.

Write the script.
`.trim();
}
