import type { Profile } from "@/lib/schemas/profile";
import { HONESTY_RULES, serializeProfile } from "./shared";

/**
 * Recovers competencies the candidate has but did not write down.
 *
 * People under-declare: they write "React" and omit JSX, npm and ES6+; they
 * write "cashier" and omit cash handling, POS terminals and customer conflict
 * resolution. The CV then misses keywords the posting explicitly asks for, for
 * work the candidate genuinely did.
 *
 * A separate pass rather than part of CV building, for three reasons: it is
 * cacheable per profile (the job does not affect it), it is auditable, and the
 * UI can show each derivation so the user can veto anything wrong.
 */

export const INFER_SKILLS_SYSTEM = `
You recover skills a candidate demonstrably has but did not write down.

${HONESTY_RULES}

THE TEST — include a skill only if a knowledgeable interviewer would consider it
already answered by something in the profile. Ask: "given what they stated, is
this necessarily or almost always true?"

Include:
- Necessary prerequisites. You cannot have used React without JSX, components,
  npm/package management, and ES6+ JavaScript.
- Near-universal companions of a stated tool. Using Git in a team implies
  branches, merges, and pull requests. Working as a cashier implies cash
  handling, a POS terminal, and dealing with customers directly.
- Competencies entailed by a stated responsibility. "Led the frontend team"
  entails code review, mentoring, and technical planning.
- Practical realities of a stated role. Warehouse work implies physical
  stamina, stock rotation, and health-and-safety practice.

Exclude:
- Sibling technologies that do not follow. React does NOT imply React Native,
  Vue, or Angular. Python does NOT imply Django.
- Anything more advanced than the source. "Basic Excel" does not imply pivot
  tables or macros.
- Seniority, leadership, or scale not stated.
- Years of experience, employers, job titles, degrees, or certifications.
  Certifications in particular are never inferable — they either exist or do not.
- Generic virtues with no specific grounding: "hard-working", "passionate".

Confidence:
- "high": the skill is a strict prerequisite or is present in essentially every
  instance of the source activity.
- "medium": very common in practice but conceivably absent.
Anything weaker than "medium" must be omitted entirely.

"derivedFrom" must name the exact profile item the skill follows from, in AT
MOST 100 CHARACTERS: a stated skill, a job title, or a few words lifted
verbatim from a bullet — "React", "PostgreSQL y Redis", "Cajero en Coto".
Never leave it vague. Never copy a whole bullet: when the source bullet is a
long sentence, quote only the noun phrase the skill actually follows from.
"Optimicé consultas SQL en PostgreSQL y Redis aplicando caching, índices y
transacciones" is wrong; "consultas SQL en PostgreSQL" is right.

Write the skill names in the same language the candidate used for that item.
Return at most 40 skills; prefer precision over volume.
`.trim();

export function buildInferSkillsPrompt(profile: Profile): string {
  return `
Derive the skills this candidate demonstrably has but did not list explicitly.

=== CANDIDATE PROFILE ===
${serializeProfile(profile)}
=== END CANDIDATE PROFILE ===

Do not repeat skills already present under STATED SKILLS unless you are
narrowing them into a more specific competency that the profile supports.
`.trim();
}
