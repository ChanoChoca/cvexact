import {
  buildEvidenceIndex,
  buildIndexFrom,
  experienceFacts,
  supports,
} from "@/lib/ai/evidence";
import type { AnswerGap } from "@/lib/ai/verify";
import type { Profile } from "@/lib/schemas/profile";
import type { InferredSkill, JobAnalysis } from "@/lib/schemas/job";
import type { CVDocument } from "@/lib/schemas/cv";
import {
  HONESTY_RULES,
  NAME_PLACEHOLDER_RULE,
  inferredForPosting,
  postingIndex,
  questionLanguageDirective,
  serializeExperienceFacts,
  serializeInferredSkills,
  serializeJobMatch,
  serializeProfile,
} from "./shared";
import { STRATEGIES } from "./build-cv";
import { summarizeCV } from "./cv-summary";
import { parseQuestionLimits } from "@/lib/ai/question-limits";

/**
 * Answers the questions an application form asks.
 *
 * The generated CV is supplied as context for a specific reason: the answers
 * and the CV are read by the same person, and an answer that contradicts the CV
 * they just received is worse than no answer at all.
 *
 * This prompt used to be the thin one — the honesty rules, a voice note, and the
 * bare `relevance` enum — while the CV next door got the strategy, the computed
 * job match, the ranked profile and the derived skills. That asymmetry had a
 * direction: all of the pressure not to overclaim, almost none of the material
 * saying what the candidate actually has. It answered a form asking about
 * React, TypeScript and Node, from a profile holding all three since May 2024,
 * with "0 years of formal experience in that stack as a specific combination".
 * The arithmetic now arrives computed (`serializeExperienceFacts`) and the rest
 * of the CV's context arrives with it.
 */

export const ANSWER_QUESTIONS_SYSTEM = `
You answer job application questions on behalf of a candidate.

${HONESTY_RULES}

${NAME_PLACEHOLDER_RULE}

VOICE: first person, as the candidate. Plain, direct, and specific. No cover-letter
throat-clearing ("I am writing to express my interest"), no flattery of the
company, no filler.

LANGUAGE: answer in the language each question was asked in — a form can mix
languages, and each question is judged on its own. The user prompt names the
fallback for a question whose language gives nothing away.

LENGTH: match the question. A yes/no or numeric question gets one line. An open
question ("why do you want this job?") gets 3–6 sentences. Never pad. A question
tagged [limit: N characters] or [limit: N words] states the employer's form
limit, and it is a hard constraint — the input box on their side cuts the text
off or refuses it. Count, and keep the answer under it: cut filler and
qualifiers first, never the concrete detail, and never stop mid-sentence.

GROUNDING: every answer must draw on something concrete from the profile or the
CV. Prefer naming the actual job, project or study over speaking in generalities.

ANSWER THE QUESTION, DO NOT DISCLAIM IT. These are as binding as the integrity
rules above, and they pull the other way on purpose:
- Never open on what the candidate lacks. Open on what answers the question.
- Never volunteer a limitation the question did not ask about. If the answer is
  true as written, it is finished — a qualifier added after it only takes it back.
- No apologising, no hedging, no explaining away a gap or a change of field.
- Do not narrow a question until it fails. Words like "formal", "professional",
  "strictly", "as a specific combination", "in the same project", "at the same
  time" turn a true answer into a false one, and every one of them was written by
  a model talking itself out of experience the candidate had.

SPECIFIC QUESTION TYPES:
- Years of experience: the EXPERIENCE ARITHMETIC block gives you the figure. Use
  it as it stands. Do not recompute it from the dates, do not round it down
  further, and never answer zero for something that block gives a number for.
  Put the bare number in "shortAnswer". Some entries there are marked as coming
  from the candidate's stated skills rather than a specific role's bullets —
  answer with the same number and the same confidence, name the role and
  company the block gives as where it happened, and do not invent a specific
  project or feature that used it.
- A question naming several technologies is a question about each of them, not
  about whether they were ever used together in one project. Nobody counts it
  that way. Answer with the tenure the block gives, then say in one sentence
  where each was used.
- Full name / "who is applying": answer with the literal token from the NAME
  line, exactly as instructed above. Do not paraphrase it into "the candidate"
  or anything else.
- Salary expectations: the profile does not contain this. Give a professional
  non-answer that asks about the band for the role, set "needsUserInput" true,
  and leave "shortAnswer" empty.
- Availability / notice period / shifts: use the profile's practical section. If
  it is silent, set "needsUserInput" true.
- "Do you have X?" where the candidate does not have X: lead with the closest
  thing they do have, and say plainly that X itself is not among it. That order
  matters — the answer still has to be true, it just does not have to open on the
  gap. Never claim X.
- Anything the profile cannot settle (visa status, references, a specific
  certificate): write the best honest draft you can, and set "needsUserInput"
  true so the user is prompted to check it.

"shortAnswer" is for questions that want a bare value (a number, a yes/no, a
date). Leave it as an empty string for open questions.
`.trim();

/**
 * What the previous attempt got wrong, fed back in — the same closed loop
 * `gapCorrection` runs for the CV.
 *
 * Every gap here is an answer contradicted by the profile it was written from,
 * which is the kind a second attempt fixes: there is a right answer to hand and
 * the model is simply being shown it.
 */
function gapCorrection(gaps: AnswerGap[] | undefined): string {
  if (!gaps?.length) return "";

  return `

=== MEASURED — FIX THIS ===
This is a second attempt. The first was measured in code: checked against the
profile's own dates and, where the question states one, against the form's
limit. Keep everything else; fix these:
${gaps.map((g) => `- On "${g.question}": ${g.problem}`).join("\n")}
=== END MEASURED ===`;
}

export function buildAnswersPrompt(input: {
  questions: string[];
  /** Typed next to each question in the UI; overrides a limit parsed from its text. */
  questionLimits?: (number | null)[];
  profile: Profile;
  analysis: JobAnalysis;
  cv?: CVDocument;
  inferredSkills?: InferredSkill[];
  outputLanguage: string;
  /** What the previous attempt got wrong, when this call is the retry for it. */
  gaps?: AnswerGap[];
  /** Fixed by the tests; the arithmetic is otherwise relative to today. */
  now?: Date;
}): string {
  const {
    questions,
    questionLimits,
    profile,
    analysis,
    cv,
    inferredSkills = [],
    outputLanguage,
    gaps,
    now,
  } = input;

  const evidence = buildEvidenceIndex(profile);
  const posting = postingIndex(analysis);

  // Ranked and highlighted against the posting, as the CV prompt does it. A
  // flat profile is read in the order the candidate typed it, and the entries
  // that answer this form sit in the middle of it.
  const rankBullet = (text: string) => {
    const index = buildIndexFrom([text]);
    return analysis.keywords.filter((k) => supports(index, k)).length;
  };

  // The form's limit travels inside the pasted question ("máx. 300
  // caracteres"). Parsed out here so the model answers the question rather
  // than the boilerplate around it, and the limit arrives as an explicit tag
  // it can count against — the same parse the route's measured check runs.
  const parsedQuestions = parseQuestionLimits(questions, questionLimits);
  const cleanQuestions = parsedQuestions.map((q) => q.question);

  const facts = experienceFacts({
    profile,
    questions: cleanQuestions,
    keywords: analysis.keywords,
    now,
  });

  return `
${questionLanguageDirective(outputLanguage)}

Answer each question below for this application.

=== QUESTIONS ===
${parsedQuestions
  .map((q, i) => {
    const tag = q.limit
      ? ` [limit: ${q.limit.max} ${q.limit.unit === "chars" ? "characters" : "words"}]`
      : "";
    return `${i + 1}. ${q.question}${tag}`;
  })
  .join("\n")}
=== END QUESTIONS ===

=== EXPERIENCE ARITHMETIC (computed — authoritative) ===
${serializeExperienceFacts(facts)}
=== END EXPERIENCE ARITHMETIC ===

${STRATEGIES[analysis.relevance]}

=== THE JOB ===
Title: ${analysis.title}
Company: ${analysis.company || "(not stated)"}
Location: ${analysis.location || "(not stated)"} · ${analysis.workMode}
Field: ${analysis.domain}
Seniority: ${analysis.seniority}
How close this is to the candidate's background: ${analysis.relevance} — ${analysis.relevanceReason}
Requirements: ${analysis.requirements.map((r) => r.text).join("; ") || "(none extracted)"}
=== END THE JOB ===

=== WHAT THIS POSTING ASKS THAT THE PROFILE ANSWERS ===
${serializeJobMatch(profile, evidence, analysis)}
=== END POSTING MATCH ===

=== THE CV THEY WILL RECEIVE ===
Your answers must not contradict this.
${cv ? summarizeCV(cv) : "(not generated yet — rely on the profile)"}
=== END CV ===

=== FULL PROFILE ===
A "*" after a tool marks one this posting names. Unmarked tools are still the
candidate's and are still usable.
${serializeProfile(profile, { highlight: (tag) => supports(posting, tag), rankBullet })}
=== END FULL PROFILE ===

=== SKILLS ALREADY DERIVED FROM THIS PROFILE ===
Usable as evidence where the posting or a question asks for them.
${serializeInferredSkills(inferredForPosting(inferredSkills, analysis))}
=== END DERIVED SKILLS ===${gapCorrection(gaps)}

Return one entry per question, in the order given, echoing each question verbatim.
`.trim();
}
