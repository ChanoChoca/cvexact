import type { Profile } from "@/lib/schemas/profile";
import type { JobAnalysis } from "@/lib/schemas/job";
import type { CVDocument } from "@/lib/schemas/cv";
import { HONESTY_RULES, languageDirective, serializeProfile } from "./shared";
import { summarizeCV } from "./cv-summary";

/**
 * Likely interview questions with answers drawn from the candidate's own
 * material, printed to PDF so it can sit open on a second screen during a video
 * interview.
 */

export const INTERVIEW_PREP_SYSTEM = `
You prepare a candidate for a specific job interview.

${HONESTY_RULES}

The result is printed and read during the interview, on a second screen. Write
for that: answers must be skimmable under pressure, not essays.

ANSWERS:
- First person, as the candidate, in their own register.
- Built from what is actually in their profile and CV. Name the real employer,
  the real project, the real study.
- 3–6 sentences. Long enough to be a real answer, short enough to scan.
- Where a story fits, structure it as situation → what they did → outcome,
  without labelling those parts.
- "keyPoints" are the 2–4 things they must not forget to say. Fragments, not
  sentences — these are the glanceable version.
- "followUps" are the questions an interviewer would naturally ask next.

COVER THESE CATEGORIES, adapted to the role (skip any that do not apply, and
name the categories in the output language):
- Opening: tell me about yourself; walk me through your CV.
- Motivation: why this role, why this company, why now.
- Role-specific: the actual competencies this posting asks for. For a technical
  role that means technical questions; for a shop or warehouse role it means
  shifts, physical work, customer conflict, stock accuracy, punctuality.
- Behavioural: teamwork, conflict, mistakes, pressure, feedback.
- The awkward ones. Do not skip these — they are why the candidate is nervous:
  gaps in employment, changing field, being over- or under-qualified, being
  fired, short tenures, missing a listed requirement. Give an answer that is
  honest, brief, and does not grovel. Never coach them to lie or to conceal.
- Logistics: availability, start date, salary expectations, notice period.

A short or tightly timed interview ("15 minutes", "quick call") does NOT mean
fewer questions to prepare. This sheet is consulted off-screen before and
around the call — it is never read aloud in full — so it must still cover
every category above regardless of how long the interview itself will be.
Only the length of each individual answer stays to its 3–6 sentence scale;
the number of questions and categories does not shrink to match a short call.

WHEN THE CANDIDATE IS APPLYING OUTSIDE THEIR FIELD, the single most likely
question is some form of "why do you want this job, with your background?" and
"won't you leave as soon as something better comes up?". Prepare both properly.
The answer must be grounded and matter-of-fact — not apologetic, and not
pretending the background does not exist.

"questionsToAsk" are questions the candidate should ask the interviewer:
specific to this role and company, and useful to them — not flattery.
`.trim();

/**
 * What survives if the response has to be shortened. Sibling of
 * `VIDEO_REPAIR_FLOOR` — see the note on `repairSchemaViolation` in the
 * pipeline.
 */
export const INTERVIEW_REPAIR_FLOOR = `
What must survive the shortening, in this order of sacrifice:
1. Cut "followUps" first, then trim "keyPoints" to the essentials.
2. Then shorten the individual answers.
NEVER drop a whole section/category, and never reduce a section to fewer
questions than it already has: every category present in the first attempt
must still be present, with the same number of questions, just told more
concisely.
`.trim();

export function buildInterviewPrepPrompt(input: {
  profile: Profile;
  analysis: JobAnalysis;
  cv?: CVDocument;
  /** Interview format, interviewer, anything the user knows. Optional. */
  context: string;
  outputLanguage: string;
}): string {
  const { profile, analysis, cv, context, outputLanguage } = input;

  return `
${languageDirective(outputLanguage)}

Prepare this candidate for their interview.

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

=== WHAT THE INTERVIEWER HAS ALREADY SEEN (the CV sent) ===
${cv ? summarizeCV(cv) : "(not generated yet — rely on the profile)"}
=== END CV ===

=== FULL PROFILE (may contain things the CV left out) ===
${serializeProfile(profile)}
=== END FULL PROFILE ===

${
  context.trim()
    ? `=== WHAT THE CANDIDATE KNOWS ABOUT THE INTERVIEW ===\n${context.trim()}\n=== END ===\n\nWhen that description is written in a language other than "${outputLanguage}",\nwrite the questions and answers in the description's language — it is the\nlanguage the interview itself will be conducted in. Otherwise keep\n"${outputLanguage}".`
    : "The candidate gave no extra detail about the interview format."
}

Set "jobTitle" and "company" from the job above.

"labels" holds the headings the printed sheet puts above your text, and the
paragraph that introduces it. They are read by the candidate, so write them in
the output language too, not in English and not as schema keys.

Produce the preparation.
`.trim();
}
