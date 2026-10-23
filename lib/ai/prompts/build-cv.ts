import {
  approximateFigures,
  buildEvidenceIndex,
  collectFigures,
  keywordMatches,
  matchKeywords,
  statedHardTerms,
  supports,
  unsupportedPhrases,
  type EvidenceIndex,
} from "@/lib/ai/evidence";
import { practicalAsks, statedPractical, type PracticalFact } from "@/lib/ai/practical";
import type { CVGaps } from "@/lib/ai/verify";
import type { Sheets } from "@/lib/cv/sheets";
import { OMITTED_LIMIT } from "@/lib/schemas/cv";
import { meaningfulExperience, type Profile } from "@/lib/schemas/profile";
import type { InferredSkill, JobAnalysis, Relevance } from "@/lib/schemas/job";
import {
  COVERAGE_REPORT_RULE,
  HONESTY_RULES,
  languageDirective,
  matchedCredentials,
  postingIndex,
  profileMaterial,
  serializeInferredSkills,
  serializeJobMatch,
  serializeProfile,
  undecidedSkills,
  type MatchedCredential,
} from "./shared";

/**
 * Builds the tailored CV. The single most important prompt in the product.
 *
 * The model chooses content only — what to keep, what to cut, how to phrase it,
 * and what order the sections go in. Layout belongs to components/cv/CVDocument.tsx,
 * which is why the template can be guaranteed to hold no matter what comes back.
 */

/**
 * How many phrases the lexical deny-list may name.
 *
 * It is built from the posting's own requirements, so on a wordy ad it can run
 * to twenty-odd entries — long enough to read as a wall rather than a rule, and
 * long enough to crowd out everything after it. The ones that matter are the
 * hard requirements, which come first.
 */
const UNCLAIMABLE_LIMIT = 12;

/**
 * How many of the candidate's own technologies the jargon ban may name.
 *
 * A real profile carries over a hundred tags. The list is a rule, not an
 * inventory, and past a couple of dozen entries it stops reading as one — so it
 * names enough to make the category unmistakable and stops. Comfortably larger
 * than `UNCLAIMABLE_LIMIT` because these are single words rather than sentences.
 */
const JARGON_BAN_LIMIT = 24;

/**
 * What the last attempt actually measured, fed back in.
 *
 * `components/cv/CVPreview.tsx` renders the CV and measures it against A4, so
 * the one-page constraint is checked rather than trusted. Until now that
 * measurement only reached the user: "Volver a generar" resent a byte-identical
 * prompt, so the second attempt landed the same place as the first and the
 * advice was unfollowable. The budget above is an estimate written before
 * anything was rendered; this is the ground truth, and it wins.
 */
export type PreviousFit = "over";

/** Overflow only ever cuts: a page short of full is the person's to fill, and the blank space is not a problem the model is sent back to solve. */
function fitCorrection(fit: PreviousFit | undefined, total: string, sheets: Sheets = 1): string {
  if (!fit) return "";

  return `
MEASURED — your previous attempt at this exact CV was rendered and overflowed
onto a ${sheets === 2 ? "third" : "second"} page. The budget above was an estimate; this is what the page
actually did. Cut to the lower end of ${total}: drop the bullets carrying the
fewest of this posting's terms, and tighten the wording of the ones that stay.
Do not drop a whole section.`;
}

/**
 * Rough capacity of one A4 page in this template, after the header and summary.
 * Given to the model as a budget so the result does not overflow onto page two.
 *
 * The budget scales with how many roles there are to spend it on. A page is a
 * page whether the candidate has had one job or six, and a single-role profile
 * given the six-role budget produces a CV that stops halfway down the sheet —
 * which reads as a thin candidate rather than a concise one. Told plainly that
 * the one role has to carry the page, the model reaches deeper into the
 * profile instead of stopping at the obvious five bullets.
 *
 * It also scales with `relevance`; see `HONESTY_OVER_FULLNESS` below.
 */

/**
 * What a posting outside the candidate's field can honestly fill.
 *
 * The budget below exists because a CV that stops two thirds down the page
 * reads as a thin candidate, and everything in it pushes toward filling the
 * sheet. On a `direct` posting that pressure lands on material the profile
 * has plenty of. On an `unrelated` one there is no such material, and the page
 * gets filled the only way left: a CV for a groundskeeping job came back
 * claiming a willingness to work in varying weather, experience maintaining
 * machinery and stock-keeping, none of it in the profile — invented not because
 * the honesty rules were unclear but because the quota had to be met.
 *
 * So the quota moves instead. Half a page of true statements is a worse-looking
 * CV and a better application than a full page that collapses in the first
 * question.
 */
const HONESTY_OVER_FULLNESS = `- These numbers are a ceiling, not a quota. This posting is outside the
  candidate's field, so the honest material runs out sooner than the page does.
  When it runs out, STOP. Do not invent a line to reach the count: a trait
  ("responsible", "attentive to detail"), a tolerance ("willing to work
  outdoors, in any weather"), a familiarity ("experience with tools and
  machinery"), or a readiness to learn are all facts about the candidate, and
  a fact the profile does not state is a fact you may not write. Three quarters
  of a page that is entirely true beats a full one that is not.`;

/**
 * The line count below which the profile cannot fill a page with what it has. It is the low end of the range
 * the budget used to state outright ("12–16" for one role, "10–16" for more): under it, that range was a quota.
 */
function materialFloor(roles: number): number {
  return roles <= 1 ? 12 : 10;
}

function bulletBudget(
  profile: Profile,
  relevance: Relevance,
  previousFit?: PreviousFit,
  allowed: Sheets = 1,
): string {
  const experience = meaningfulExperience(profile);
  const roles = experience.length;
  const unrelated = relevance === "unrelated";
  // A second sheet is for a long career told in its own field: outside it the page is short on purpose, whatever was allowed.
  const sheets: Sheets = unrelated ? 1 : allowed;
  const material = profileMaterial(profile, { unrelated });
  const own = material.roleBullets[0] ?? 0;
  // A page the profile cannot fill. With no role at all there is nothing to push toward, so that is thin by definition;
  // outside the field `HONESTY_OVER_FULLNESS` already says the same thing and has its own numbers.
  const thin = roles === 0 || (!unrelated && material.total < materialFloor(roles));
  const holds = (n: number) => `${n} bullet${n === 1 ? "" : "s"}`;
  const caps = experience.map((job, i) => `${job.company || job.role || `role ${i + 1}`}: ${material.roleBullets[i]}`).join(", ");

  // What the skills section may hold. It carries only tools that no bullet names, and a section needs two lines. The
  // activities the profile lists have a section of their own, which is said here when there are enough of them to need one.
  const skillsOnlyIfThere =
    material.skillLines >= 2
      ? `- A skills section of up to ${material.skillLines} lines, only with tools a role lists that no bullet had room for.
  It is not mandatory: leave it out rather than restate a bullet.`
      : `- No section of tools: the profile has too few left over to fill two lines.${
          material.extras >= 2 ? ' The activities and volunteering it lists go in an "activities" section.' : ""
        }`;

  // Naming the number to avoid ("do not stop at five") anchors on it: across 53
  // generated CVs the single role came back with exactly five bullets 36 times.
  // State the target as a quantity to reach and a count to check, and say what
  // material is still unspent, rather than as a mistake to avoid.
  const perRole =
    roles === 0
      ? `- There is no work history in this profile. Do not emit an experience section,
  and never present a project, a course or an activity as a job. Build the page
  from the studies, the projects and the activities the profile lists, in that
  order of relevance to this posting. The projects go in the "projects" section and
  the activities in the "activities" section.`
      : roles === 1
        ? unrelated
          ? `- The single role carries the page, and almost none of it was written for
  this kind of work. Write ${Math.min(4, own)} bullets${own >= 5 ? ", or 5 where the reframing is genuine" : ""} —
  every one of them a real task from the profile, seen from this employer's
  side. A sixth that only exists to fill the page is the failure this whole
  section is about.
- Then a skills section of 3–4 lines, if and only if the profile has 3–4 things
  left to say that the bullets did not. It is not mandatory here. Studies,
  languages, licence, vehicle and stated availability are the material this
  reader cares about most, and they belong in their own short section.`
          : thin
            ? `- The profile gives the single role ${holds(own)}. Write the ones that serve this
  posting, reworded for it.
${skillsOnlyIfThere}`
            : `- The single role carries the page. ${
                own >= 7
                  ? `Write 7 bullets${own >= 8 ? ", or 8 if the material supports it" : ""}. Fewer than 7 leaves the page half empty, which reads as a thin
  candidate rather than a concise one.
- The profile's one role has ${own} bullets and ${experience[0]?.tags.length ?? 0} listed tools to draw
  from — there is more material than you need. If you have written 5 bullets
  and stopped, you have not run out; go back to the profile and keep going.`
                  : `Write all ${holds(own)} the profile gives it, reworded for this posting.
- The profile's one role has ${own} bullets and ${experience[0]?.tags.length ?? 0} listed tools. The rest of the page
  is the profile's other material, each in its own section.`
              }
${skillsOnlyIfThere}`
        : thin
          ? `- The most recent or most relevant role gets the most bullets and the older ones fewer, each within the count
  below.`
          : roles <= 3
            ? `- Most recent or most relevant role: ${unrelated ? "4–5" : sheets === 2 ? "6–8" : "5–7"} bullets, when the profile gives it that many.
- Older or less relevant roles: ${unrelated ? "1–3" : sheets === 2 ? "3–5" : "2–4"} bullets. The further back, the fewer.`
            : sheets === 2
              ? `- Most recent or most relevant role: 4–7 bullets, when the profile gives it that many.
- Older or less relevant roles: 2–4 bullets. The further back, the fewer.`
              : `- Most recent or most relevant role: 3–5 bullets, when the profile gives it that many.
- Older or less relevant roles: 1–3 bullets. The further back, the fewer.`;

  const total = unrelated ? "7–11" : sheets === 2 ? (roles <= 1 ? "14–22" : "18–28") : roles <= 1 ? "12–16" : "10–16";
  const ceiling = sheets === 2 ? 28 : 16;

  return `
${
  sheets === 2
    ? `LENGTH — the CV may take TWO A4 pages in a fixed template: the candidate has ten years of work or more and asked for a
second sheet. Fill the first one before the second, and let the second hold only what the first had no room for; a second
sheet that is stretched to look full is worse than a short one. Budget:`
    : `LENGTH — the CV must fit on ONE A4 page in a fixed template${unrelated || thin ? "" : ", and should very\nnearly fill it"}. Budget:`
}
- Summary: 2 lines (about 30–45 words), only from the profile: what the
  candidate is (the role their dates support, and the years those dates add up
  to when that helps) and the specialty this posting asks about. It may close on
  the kind of job it is for ("para un rol mobile en una fintech"), and leaves
  that out when the first part already says it. The posting's field describes
  the job, never the candidate's past: "con experiencia en fintech",
  "especialista en pagos" or "orientado a productos financieros" only where the
  profile says so. Never the employer's name, never an ambition ("Busco…",
  "Seeking…", "My goal is…"). It is written for THIS posting: the profile's
  ABOUT paragraph is raw material and never the answer, and a summary that
  repeats it was not written.
  It never takes the posting's seniority label: do not open "Senior …", "Lead
  …", "Semi Senior …" unless the candidate's own dates carry it. The posting's
  title says what the employer wants; the dates below say what the candidate is,
  and a claim they do not support is flagged before the CV reaches anyone.
${
  thin
    ? `- The profile holds ${material.total} lines of material for this CV (bullets, projects,
  activities, study highlights, tool lines). That is a ceiling, not a quota: use
  the ones that serve this posting and stop when they run out. A short page that
  is true beats a full one that is not.`
    : `- Total bullets across all sections: ${total}. Never more than ${ceiling}.`
}
${perRole}
${
  roles > 0
    ? `- Never more than the profile gives that role (${caps}). Fewer is fine; a bullet
  past that count is one the profile does not support.
`
    : ""
}- Each bullet: one sentence, roughly 15–30 words. Two lines maximum.
- Drop a role entirely rather than list it with a bullet that adds nothing. A
  role can appear as a header with no bullets when it only needs to show
  continuity of employment.
- A role that ended more than 7 years ago gets its header and at most one
  bullet, unless its bullets answer this posting's requirements. Never drop it
  when it is the evidence for one.
${
  unrelated
    ? HONESTY_OVER_FULLNESS
    : thin
      ? ""
      : `- Before you answer, count the bullets you have written across every section.
  If the total is under ${total.split("–")[0]}, you are under budget: add what the profile still
  has unspent until you reach it — a project (in the "projects" section), an
  activity (in the "activities" section), a study highlight (on that study's line), a tool a role lists that no
  bullet had room for (in the skills section). Each goes in its own section: none becomes a bullet under a job, and
  no role gets more than the profile gives it. This is the most common way this
  task is done badly.`
}
${fitCorrection(previousFit, thin ? String(Math.min(ceiling, material.total)) : total, sheets)}
`.trim();
}

/**
 * The numbers already in the profile, named one by one.
 *
 * The system prompt has said "keep numbers the candidate gave" since it was
 * written, and across 69 real applications 85% of those numbers still did not
 * reach the CV — the bullet survived and arrived with its figure deleted. The
 * instruction fails because it asks the model to notice something while it is
 * busy re-angling a sentence; a list it can check against does not.
 *
 * This adds no facts. Every figure here is in the profile block directly above,
 * which is the point: it is the same material, extracted so that dropping one
 * is a visible omission rather than an invisible one.
 */
function serializeFigures(profile: Profile, relevance: Relevance): string {
  // Not outside the candidate's field. There the strategy's own first
  // instruction is to strip the jargon, and these figures are the jargon: "40%
  // de reducción en tiempo de respuesta" and "8 servicios AWS/GCP" belong to
  // work this reader does not care about, and a block insisting they survive is
  // this prompt arguing with itself. Every number the profile has is a software
  // number, so the whole block goes.
  if (relevance === "unrelated") return "";

  const byRole = meaningfulExperience(profile)
    .map((role) => ({ role, figures: collectFigures(role.bullets) }))
    .filter((entry) => entry.figures.length > 0);

  if (byRole.length === 0) return "";

  // The figures the candidate gave as an estimate keep that in the rewrite; named so that it is a thing to check, not to remember.
  const estimated = approximateFigures(meaningfulExperience(profile).flatMap((role) => role.bullets));
  const lines = byRole.map(
    ({ role, figures }) =>
      `- ${role.company || "(company not given)"}: ${figures.map((figure) => (estimated.has(figure) ? `${figure} (aprox.)` : figure)).join(", ")}`,
  );
  const estimates =
    estimated.size > 0
      ? `
A figure marked (aprox.) is one the profile gives as an estimate. It keeps that
mark in the rewrite ("aprox.", "approx." or "~"). Dropping it turns an estimate
the candidate gave into a fact they did not.
`
      : "";

  return `
=== FIGURES THE CANDIDATE STATED ===
Every number below is already in a bullet above. The candidate typed each one
and you may not produce another, so a figure lost here cannot be recovered
anywhere else — and numbers are the single strongest thing on a CV, which is
why the template you are imitating is built out of them.

Cutting a bullet is allowed. Keeping the bullet and cutting its number is not:
"Optimicé consultas SQL en PostgreSQL y Redis" is a worse line than "Optimicé
<N> consultas SQL, reduciendo <X> ms el tiempo de respuesta" (the profile's own
figures in place of <N> and <X>), and rewriting the second into the first is the
most common way this task is done badly.

There is one way out and it is the whole bullet, never the number alone. A figure
that argues against the candidate — a quantity of one, a duration that sounds
like the problem rather than the fix — makes the line worse than not writing it:
"Administré 1 servidor Linux" says the candidate has administered one server.
Drop that bullet, and its figure goes with it. What you may not do is keep the
sentence and quietly delete the number, which leaves the claim standing with the
only evidence for it removed.

For every bullet you keep that carries one of these, the number appears in your
rewrite:
${lines.join("\n")}
${estimates}=== END FIGURES ===
`;
}

/**
 * What the previous attempt got wrong, fed back in.
 *
 * The same closed loop as `fitCorrection` above: the CV is checked in code
 * after generation, and rather than only telling the user, what was measured
 * goes back to the model.
 *
 * Two kinds live here now. The first are omissions — a figure, the education
 * section — material the model was handed and did not use, which is the kind a
 * second attempt fixes when it is told which one. The second are the checks that
 * had been measured and reported to the user for as long and never cost the
 * model anything: bullets shipped verbatim, a skills section written as a word
 * list, a summary opening on what the candidate wants. Those were the largest
 * gap between what this product knows about a CV and what it does about it.
 */
function gapCorrection(gaps: CVGaps | undefined): string {
  if (!gaps) return "";

  const parts: string[] = [];

  if (gaps.droppedFigures.length > 0) {
    parts.push(
      `- Your previous attempt at this exact CV contained no numbers at all. These
  were available and every one was dropped: ${gaps.droppedFigures.join(", ")}.
  Find the bullets they belong to in the profile above, keep those bullets, and
  keep their figures in the rewrite.`,
    );
  }

  if (gaps.missingEducation) {
    parts.push(
      `- Your previous attempt omitted the education section, which the profile
  above fills. Emit it. A CV with no studies on it reads as a candidate who has
  none.`,
    );
  }

  for (const { claimed, stated } of gaps.retitledRoles) {
    parts.push(
      `- Your previous attempt gave the candidate the job title "${claimed}". Their
  profile says "${stated}". Re-angling the bullets at this posting is the task;
  re-titling the post is inventing an employment history, and it is checkable the
  moment a reference is taken. Use their real title, translated into the output
  language if the language differs, and nothing else.`,
    );
  }

  if (gaps.copiedBullets.length > 0) {
    parts.push(
      `- Your previous attempt did not rewrite. ${gaps.copiedBullets.length} of its
  bullets came back word for word as the profile states them, including this one:
  "${gaps.copiedBullets[0]}". Selecting the right lines is half the task and it
  is the half that feels like all of it. Every bullet you keep opens on the part
  of that work THIS posting asks about, in this posting's words, with the clauses
  it never mentions cut — and it keeps every figure it arrived with. If a bullet
  cannot be re-angled at this posting, that is a reason to drop it, not a reason
  to pass it through unchanged.`,
    );
  }

  for (const title of gaps.keywordDumpSections) {
    parts.push(
      `- Your previous attempt wrote "${title}" as a list of bare words. A reader
  learns nothing from a word on its own; they learn from where it was used. Group
  them into statements that say what was built with what — one line covering
  several related tools is worth more than several lines naming one each — and
  drop the ones you cannot say anything about.`,
    );
  }

  for (const summary of gaps.summaryRuleViolations) {
    parts.push(
      `- Your previous attempt's summary says what the candidate is looking for:
  "${summary}". A CV states what they bring. Open on the experience and the
  strengths this posting asks about; the reader already knows which job the
  application is for, and a candidate who describes an ambition instead of a
  history reads as someone who has not done the work yet.`,
    );
  }

  for (const requirement of gaps.contradictedRequirements) {
    parts.push(
      `- Your previous attempt marked "${requirement}" as NOT covered in the
  coverage report, and then claimed it in the summary anyway. Both halves were in
  the same response and only one of them can ship. Decide which is true from the
  profile alone: if the candidate has it, evidence it in the CV and mark it
  covered; if they do not, the summary must not say so.`,
    );
  }

  for (const { field, where, line } of gaps.overclaimedWork) {
    parts.push(
      `- Your previous attempt wrote "${line}" ${field === "summary" ? "in the summary" : `for the role at ${where || "that employer"}`}.
  That says the candidate led, managed or was responsible for the work, and the
  profile does not say that of ${field === "summary" ? "any of it" : "that role"}. Say the line again at the level the profile
  states — "participé", "colaboré" and "apoyé" stay at that level — more
  specific, not stronger, and keep every figure it has.`,
    );
  }

  if (gaps.inventedFigures.length > 0) {
    parts.push(
      `- Your previous attempt wrote numbers the profile above does not state: ${gaps.inventedFigures.slice(0, 8).join(", ")}${gaps.inventedFigures.length > 8 ? " and more" : ""}.
  The profile is the only place a figure may come from, and a number nobody
  typed is the one thing on a CV that is checked against the candidate's own
  word at the interview. Say those lines again without the number — if the
  line only worked because of it, drop the line — and keep every figure the
  profile does state.`,
    );
  }

  if (gaps.droppedApproximations.length > 0) {
    parts.push(
      `- Your previous attempt stated as exact ${gaps.droppedApproximations.slice(0, 6).map(({ raw }) => raw).join(", ")}${gaps.droppedApproximations.length > 6 ? " and more" : ""},
  and the profile gives ${gaps.droppedApproximations.length === 1 ? "it" : "them"} as an estimate. Say the line again with "aprox.", "approx." or
  "~" in front of the number, in the output language: the candidate estimated it,
  and a CV that states it flat claims a precision they never did.`,
    );
  }

  if (gaps.selfAssessedTraits.length > 0) {
    parts.push(
      `- Your previous attempt said of the candidate ${gaps.selfAssessedTraits.map((trait) => `"${trait}"`).join(", ")}. A trait someone says of themselves
  is not evidence and a reader skips it. Cut it; where the posting asks for the
  trait, answer it with a fact the profile states, or leave it uncovered in the
  coverage report.`,
    );
  }

  if (gaps.jargonTerms.length > 0) {
    parts.push(
      `- Your previous attempt still named ${gaps.jargonTerms.slice(0, 8).join(", ")}${gaps.jargonTerms.length > 8 ? " and more" : ""}.
  Every one of those is true of the candidate and every one of them is jargon
  this reader does not use — this posting is outside their field, and a term
  from their old one reads as overqualification, not a qualification. Say what
  they DID in the reader's own terms instead: "resolví problemas de equipos
  bajo presión", never "configuré servidores Linux y certificados SSL/TLS". If
  a bullet cannot be said that way, cut it rather than keep the term.`,
    );
  }

  if (parts.length === 0) return "";

  return `
=== MEASURED — FIX THIS ===
This is a second attempt. The first was generated and checked against the
profile. Nothing else about it needs changing:
${parts.join("\n")}
=== END MEASURED ===
`;
}

export const STRATEGIES: Record<Relevance, string> = {
  direct: `
STRATEGY — DIRECT MATCH. The job is in the candidate's own field.

A direct match is where this task is most often done badly, because selecting
the right bullets and copying them across looks like the job is done. It is
not: the candidate wrote those bullets for nobody in particular, and a reader
of THIS posting needs them pointed at THIS posting.

- REWRITE, do not transcribe. This is the instruction most often skipped,
  because picking the right bullets feels like the work is done. It is not.
  For every bullet you keep, the first two of these change, and the third may:
    (a) it opens on the part of that work THIS posting asks about, using the
        posting's own word for it — not on whatever the profile opened with;
    (b) the clauses this posting never mentions are cut, not carried along;
    (c) the opening verb may change, but never to one that claims more of the
        work than the profile does. "Participé", "colaboré", "apoyé", "ayudé" /
        "participated", "collaborated", "supported", "helped" stay at that level:
        make them specific instead of stronger ("Implementé el módulo de pagos
        de la migración" only if the profile names that module). "Lideré",
        "dirigí", "gestioné" / "led", "managed", "owned" only where the profile
        says the candidate led, managed or was responsible for that work. The
        summary follows the same rule.
  A bullet that arrives with the profile's opening verb and the profile's
  clause order was transcribed. Copying is checked for after generation and
  reported to the candidate, so it does not go unnoticed.
- WHAT REWRITING MAY NOT CHANGE. It changes the emphasis, the order and the
  words. It never changes what the work was or which tool it was done with.
  If the profile's bullet says PostgreSQL, the rewritten bullet says
  PostgreSQL — this posting asking for MySQL does not turn the candidate's
  Postgres work into MySQL work, and a tool listed among their tools is not
  licence to attach it to a task they did with a different one. Where their
  tools and the posting's differ, that is a line for the coverage report, not
  something to paper over by swapping a name. This failure passes every
  automatic check, because both names are somewhere in the profile, and it is
  the one that ends an interview.
- KEEP THE SUBSTANCE. Re-angling must not cost the specifics: the named tools,
  the scale, the numbers. "Deployed with containers" is a worse bullet than
  "deployed with Docker and Kubernetes on AWS", and trading the second for the
  first to echo the posting's vocabulary is a loss, not a tailoring.
- The profile's bullets arrive already ordered by how much of this posting they
  answer, with the count shown. Keep that order. The first bullet of the most
  relevant role is the one line a reader is guaranteed to read, and it must
  answer the posting's first responsibility.
- Bullets marked [0 matches] answer nothing this posting asked for. Reach for
  them only after the scoring ones are spent, and cut them before you go over
  budget.
- Lead with depth. Keep the technical substance, tools and scale.
- Mirror the posting's vocabulary where the candidate's experience genuinely
  matches it. If they wrote "JS" and the posting says "JavaScript", use the
  posting's term. This is translation, not invention.
- Keep concrete numbers the candidate stated; they are the strongest signal.
- Cut work unrelated to this role even when the candidate is proud of it.
- Across the CV, let more than one kind of strength show when the profile has
  them: technical depth, business impact, leadership or teaching. Never
  manufacture one the profile lacks.
- Section order is applied after you answer, from the candidate's stage: for a
  student or someone with under two years of work, education first (with the
  expected graduation date), then projects, experience and activities;
  otherwise experience first. For that early-career reader, teaching, student
  organisations (with the role held), research and hackathons are real
  evidence: include the ones the profile states. For a long career, leave them
  out unless the posting asks for what they show.
`.trim(),

  adjacent: `
STRATEGY — ADJACENT ROLE. A different job that leans on much of the same
background.

- Keep the experience, change the emphasis. Re-angle each bullet toward what
  this role actually needs. For a support role, a developer's debugging work
  becomes diagnosing and resolving user-facing problems.
- Lead each bullet with the outcome that matters to THIS role, not the one that
  mattered in the original job.
- Reduce jargon to what a hiring manager in the target field would recognise.
- Surface what the candidate stated that bridges the two fields, when the
  posting asks for it.
- WHEN NOTHING MATCHES LITERALLY, SELECTING MATTERS MORE, NOT LESS. On an
  adjacent role the profile's bullets will often share none of the posting's
  named tools, so nothing stands out and the profile's own order is the only
  thing left. That order is when the candidate typed each line, which is not a
  ranking and must not be used as one. Read every bullet and pick the ones whose
  WORK transfers, however different the vocabulary: for a role about laying out
  and explaining screens, a bullet about landing pages and portfolio sites
  transfers and a bullet about query optimisation and Linux servers does not,
  even when the second one is the one with the numbers in it. A bullet tagged
  [transferable] in the profile is one the candidate has already said carries
  over to the kind of job they are after: start from those, and weigh the rest
  against them.
- Section order is applied after you answer, from the candidate's stage: for a
  student or someone with under two years of work, education first (with the
  expected graduation date), then projects, experience and activities;
  otherwise experience first. For that early-career reader, teaching, student
  organisations (with the role held), research and hackathons are real
  evidence: include the ones the profile states. For a long career, leave them
  out unless the posting asks for what they show.
- Re-angling the work history is not a reason to drop the studies: across 69 real
  applications this is the only strategy that lost the education section, on
  nearly half the postings it ran on, while the other two never did — and a
  posting that opens "education and/or hands-on experience" is one where the
  omission is read as an absence.
- The summary must explicitly connect the background to this role so the reader
  is not left to make the leap.
`.trim(),

  unrelated: `
STRATEGY — DIFFERENT FIELD. The candidate is applying outside their field
(for example a programmer applying to be a shelf stocker, cashier, waiter,
driver or warehouse operative).

This is the case that normally produces a nearly empty CV, and it is the case
you must handle best. A hiring manager here cares about reliability, attitude
and fit — not about the candidate's former industry.

- REFRAME, do not discard. Every job contains evidence a retail or hospitality
  manager values. Translate it into their terms:
    punctuality and attendance; responsibility for valuable equipment or money;
    working to a deadline under pressure; direct customer or client contact;
    accuracy and attention to detail; teamwork and shift handovers; following
    procedures; training or helping newer colleagues; keeping records or stock
    accurate; physical presence and stamina where the profile shows it.
  A bullet tagged [transferable] in the profile is one the candidate already
  picked as carrying over: it is the first place to look.
- STRIP THE JARGON. Never list frameworks, languages or tools. They mean
  nothing here and read as overqualification, which costs interviews. Say "I
  managed my own projects and deadlines", not "I shipped a React application".
- DO NOT SIGNAL THAT THE JOB IS BENEATH THEM. No "seeking a change of pace", no
  mention of a career break, no apology, no explanation of why they are
  applying. Present them as a capable candidate who wants this job.
- PROMOTE THE NON-PROFESSIONAL EVIDENCE. Studies (including unfinished ones),
  personal projects, volunteering, sport, community work, languages, driving
  licence, own vehicle, and stated availability all matter here and often more
  than the work history does. Volunteering, sport and community work go in the
  "activities" section.
- REORDER THE SECTIONS. When the work history offers little for this role, put
  education or the skills section BEFORE experience. The reader must hit the
  relevant material first. The "pairs" section is the exception: it goes LAST,
  after the skills, whatever else you reorder. It is a compact table of facts,
  and a page that opens with one reads as a form rather than a CV — the template
  this renders into has no such block at the top. It is moved there after you
  answer regardless, so placing it anywhere else only costs you the chance to
  order the rest.
- USE THE PRACTICAL SECTION. Availability, shift flexibility, licence, vehicle,
  and work eligibility are frequently the deciding factors. If the profile
  states them, give them their own bullets. If the posting asks for one the
  profile does not state, record it as uncovered.
- The summary must read as someone who wants THIS job: what they offer (the
  reliability or customer contact the profile shows), not what they used to be.
  "Reliability" is earned by a job held for three years, not asserted.
- REFRAMING IS NOT INVENTING, AND THIS IS WHERE THE LINE MOVES. Everything
  above tells you to translate the candidate's work into this employer's
  terms; none of it licenses a fact they never gave you. Three that were
  invented on real runs of this exact strategy, none of them in the profile
  they came from:
    "disposición para trabajar en diferentes condiciones climáticas";
    "experiencia en gestión de inventarios y registros";
    "con experiencia en atención al cliente" — in a summary whose own coverage
    report, in the same response, marked customer contact as NOT covered.
  A physical tolerance, a customer-facing history, stock-keeping, shift work,
  a licence, stamina: each is a fact. Write it only if the profile says it.
- THE AVAILABILITY IS THE CANDIDATE'S, NOT THE POSTING'S. Copy it from the
  PRACTICAL line of the profile, word for word. The posting's hours are what
  the employer wants; writing them in as the candidate's availability commits
  them to a schedule they never agreed to. Where the two do not match, the
  profile wins and the difference is a line in the coverage report. Same for
  the licence, the vehicle and the work eligibility.
`.trim(),
};

export const BUILD_CV_SYSTEM = `
You write a CV tailored to one specific job posting.

${HONESTY_RULES}
${COVERAGE_REPORT_RULE}

WHAT YOU CONTROL: which experience appears, which bullets survive, how each is
phrased, which sections exist, and what order they appear in.

WHAT YOU DO NOT CONTROL: layout, fonts, spacing. A fixed template renders your
output. Do not emit HTML, markdown, bullet characters, or formatting of any
kind. Plain sentences only — no leading "-", "•" or "*".

RULES FOR CONTENT:
- Each bullet is action + what + result or scope, all of it from the profile.
  Open on a specific past-tense verb, in the output language. Never open on
  "Responsable de", "Encargado/a de", "A cargo de", "Trabajé en", "Participé en" /
  "Responsible for", "Worked on", "Involved in" when the profile line says what
  was done: say that instead.
- Every role you keep with bullets carries at least one line of result or scope
  taken from the profile (a [result] line, a figure, people, users, markets).
  When the profile gives none for that role, say what was built and for whom,
  in the profile's words. Never estimate a number to make the line land.
- Rewording may tighten a line and point it at this posting. It may not add a
  detail the profile does not state: not a purpose ("to prioritise new
  screens"), not a setting ("on low-end phones"), not a practice ("giving
  written feedback"), not a user group. The posting's responsibilities describe
  the job, not the candidate: never attach their specifics to the candidate's
  past work. When a bullet only meets the posting by adding one of those, keep
  the profile's version of it.
- No self-assessed traits and no filler, in the summary or in any section:
  never "trabajo en equipo", "proactivo/a", "buena comunicación", "orientado/a a
  resultados", "apasionado/a", "dinámico/a", "team player", "detail-oriented",
  "results-driven", "passionate", "synergy". A soft requirement of the posting
  is answered by a fact the profile states (a team the candidate led, classes
  they taught, a club they ran) or it is recorded as uncovered.
- NUMBERS SURVIVE THE REWRITE. Never manufacture one, and never drop one. A
  figure in the profile is there because the candidate typed it when asked; you
  cannot produce another, so a number you delete is gone from this CV for good.
  Deciding a bullet is not worth keeping is your call and takes its number with
  it. Keeping the bullet and dropping the number is not a decision, it is a
  loss: re-angling "Optimicé <N> consultas SQL, reduciendo <X> ms el tiempo de
  respuesta" into "Optimicé consultas SQL y estrategias de caching" throws away
  the only part a reader was going to believe. Every bullet you keep arrives
  with every figure it had.
- Section titles: the work-history, education, projects, activities and skills headings are
  fixed by the template and are replaced with its wording after you answer, so
  write anything sensible there and spend no effort on it. The one title that is
  yours is the "pairs" section's, because it names whatever that section holds:
  uppercase, in the output language ("CERTIFICACIONES E IDIOMAS",
  "DISPONIBILIDAD").
- An education entry may carry highlights — subjects or papers, a thesis, a
  grade — that the candidate said stand out of it; for someone with little
  work behind them, they are most of what a study has to say. Put the ones that
  serve THIS posting, in the candidate's own words and numbers and separated by
  " · ", in that item's "honors" line, and make "labels.honors" the word that
  heads such a line ("Destacados", "Highlights") unless it holds real honours.
  Never write one the profile does not state.
- "dateRange" and "date" are display strings; write the months out in the output
  language. Use "–" between endpoints. Use the output language's word for a
  current role ("Actualidad", "Present").
- "location" is "City, Country". Empty string if the profile does not say.
- Omit a section entirely rather than emit one with nothing meaningful in it.
- Never output a section whose only content is a restatement of the summary.
- Personal projects go in a "projects" section, never under work experience and
  never as a job. Pick the ones this posting can use, at most 4, those marked
  "link on file" first, and place the section right after education. For each,
  copy its [Pn] reference into "ref" and its name into "name", and leave
  "description" and "url" as empty strings: both are the candidate's own and are
  put in after you answer. A project that is not in the profile's PROJECTS block
  does not exist.
- Volunteering, community work, a club and the like go in an "activities"
  section, at most 4, never under work experience and never as a job. For each,
  copy its [On] reference from the profile's OTHER block into "ref" and leave
  "text" as an empty string: the candidate's own words are put in after you
  answer. Pick the ones this posting can use; one that is not in the OTHER block
  does not exist.

THE SKILLS SECTION carries what the work history had no room for. It is the
section most often wasted, because filling it by restating the bullets above it
looks like filling it:
- A skills line may not be built around a technology already named in an
  experience bullet. "Knowledge of containerization with Docker and Kubernetes"
  under a bullet that already deployed with Docker and Kubernetes costs a line
  of a one-page CV and tells the reader nothing new. Before writing each line,
  check the bullets you have already written; if its subject is there, write a
  different line.
- What belongs here instead: tools a role lists that no bullet had room for,
  practices and methodologies, the breadth of a stack the bullets could only
  show one corner of.
- A stated skill marked "(not used in any role or project)" is not listed in the
  CV. Add it to coverage.omitted with the reason that the profile does not show
  where it was used.
- When the stated skills carry a level, "(strong)" and "(regular use)", group the
  skills lines by it: one or two lines of "label: items", the strong ones first.
  A skill marked "(basic: not listed in the CV)" is not listed: say so in
  coverage.omitted, and where the posting asks for it, record the requirement as
  uncovered. The candidate chose these marks; never promote or demote a skill.
- Never open a line by conceding. No "Familiar with", "Knowledge of", "Basic",
  "Exposure to", "Conocimiento de", "Nociones de", "Familiarizado con". A
  recruiter reads those as "does not have it". If it is worth a line, state it
  affirmatively; if it cannot be stated affirmatively, it is not worth a line
  and the requirement belongs in the coverage report as uncovered.

A "pairs" section is for short labelled facts — a certification and its issuer,
a language and its level, availability, a driving licence. Use one whenever the
posting asks for something the profile answers in that shape. A required
language the candidate speaks, or a certification the posting names, belongs
here and is worth more than another skills bullet: it is a hard requirement,
answered, in the form the reader is scanning for. When the user message carries
a REQUIRED PAIRS SECTION block, emitting that section is mandatory.

THE COVERAGE REPORT is not printed on the CV; it is shown to the user beside the
preview. It is the only thing they read to decide whether they are a fit, so it
must be honest and complete:
- One entry per hard AND soft requirement from the analysis, and NOTHING ELSE.
  Not a strength the CV happens to show, not a quality you think the employer
  would value, not a phrase from elsewhere in the ad. The count of entries is
  the count of requirements. Adding rows the posting never asked for reads to
  the user as coverage — a groundskeeping ad with three requirements came back
  reporting ten, eight of them marked covered, and told a candidate who met one
  of three that they were a 76% match. It is checked after generation and the
  real ratio is shown to them regardless, so the padding buys nothing.
- "covered": true only when the CV genuinely evidences it.
- "evidence": quote or closely paraphrase the CV line that covers it. When
  uncovered, say plainly what is missing.
- "inferred": true when the evidence rests on a derived skill rather than
  something the candidate stated outright.
- "omitted": profile material you deliberately left out, with the reason. This
  is how the user checks you did not drop something they cared about. This key
  is REQUIRED even when nothing was left out — send an empty array ([]) in
  that case. Never omit the key itself.

LIMITS — the schema enforces these bounds and rejects anything outside them.
The minimums matter as much as the caps: a section with nothing in it renders
as a heading over blank space.
- "sections": at most 6, and none of them empty.
- An "experience" section: 1 to 10 items, each with at most 8 bullets.
- An "education" section: 1 to 8 items.
- A "bullets" section: 2 to 12 bullets. A single labelled fact — one
  certification, one language — is a "pairs" section, not a one-line bullets
  section.
- A "pairs" section: 1 to 8 items.
- A "projects" section: 1 to 4 items.
- An "activities" section: 1 to 4 items.
- "coverage.requirements": at most 30 entries. "coverage.omitted": at most
  ${OMITTED_LIMIT} entries — keep the ${OMITTED_LIMIT} the candidate is most likely to miss and
  leave the rest out. Each "item" is a short label (a few words, ≤200
  characters) naming exactly ONE specific thing — never a comma-separated list,
  never a full sentence, and never a single entry summarising "many things were
  omitted." If several related things are omitted, give each its own entry
  rather than combining them into one string; if you run out of entries, drop
  the least consequential ones instead of merging them together. Same rule for
  "reason" (≤300 characters per entry).
`.trim();

/**
 * What a shortened retry must still contain.
 *
 * The truncation repair asks for a smaller object, and the largest thing in a
 * CVDocument by a wide margin is the coverage report — which is never printed.
 * Left to choose freely a model shortens by deleting a section instead, and the
 * result is a CV with no work history: schema-valid, and useless. This names
 * the ballast so the cargo survives.
 */
export const CV_REPAIR_FLOOR = `
What must survive the shortening, in this order of sacrifice:
1. Empty "coverage.omitted" first (send [], never drop the key), then
   "coverage.requirements" — that report is never printed on the CV and is the
   largest part of the response.
2. Then shorten the wording of individual bullets.
NEVER drop the work experience section if the CV has one, nor the education
section or the summary. A CV that had work history and lost it is worthless no
matter how well it fits. Do not add a work experience section the CV did not
have: a profile without jobs gets none.
`.trim();

/**
 * Turns the matched credentials into an instruction rather than a suggestion.
 *
 * The system prompt has described the "pairs" section since it was added, in
 * permissive terms ("use one whenever the posting asks…"). Across 53 generated
 * CVs it was used zero times, and the candidate's AWS certification and English
 * level — both named outright by several of those postings — never appeared.
 * A section that is optional in a prompt this long is a section that does not
 * exist, so when the overlap is non-empty this states the exact rows to emit.
 */
function serializeRequiredPairs(
  credentials: MatchedCredential[],
  /**
   * The practical facts this posting asks about. Split from the credentials
   * above because the two carry different instructions: a certification's label
   * is a proper noun and ships verbatim, while "Disponibilidad" is a common noun
   * that has to follow the output language.
   */
  practical: PracticalFact[],
  profile?: Profile,
): string {
  if (!credentials.length && !practical.length) return "";

  const blocks: string[] = [];

  if (credentials.length) {
    blocks.push(
      `The posting asks for each of these and the candidate holds it. Emit them as
items of that section, verbatim — label and value exactly as written here,
because each label is a proper noun:
${credentials.map((c) => `- label: "${c.label}", value: "${c.value}"`).join("\n")}`,
    );
  }

  if (practical.length && profile) {
    const rows = practical.flatMap((fact) => {
      const stated = statedPractical(profile, fact);
      if (stated === null) return [];
      return [
        fact.kind === "flag"
          ? `- ${fact.field}: the fact is TRUE of this candidate. Write the label and a
  short affirmative value, both in the output language.`
          : `- ${fact.field}: value EXACTLY "${stated}". Write the label in the output
  language; do not touch the value.`,
      ];
    });

    blocks.push(
      `The posting also asks about these practical facts, and the profile answers
them. The value below is the candidate's own and is the only thing that may go
in that row. The posting's hours are what the EMPLOYER wants; writing them here
commits the candidate to a schedule they never agreed to, and it is the single
most common way this task is done badly — measured over real runs, 4 CVs out of
5 answered "Disponibilidad" with the posting's own words. Where the two do not
match, the profile wins and the difference is a line in the coverage report:
${rows.join("\n")}`,
    );
  }

  return `
=== REQUIRED PAIRS SECTION ===
Emit ONE section with "kind": "pairs". This is not optional and it is not a
substitute for the skills section — it is the form a recruiter scans for a hard
requirement, and it costs almost no vertical space.

${blocks.join("\n\n")}

Give the section a title in the output language that fits what it holds
("CERTIFICACIONES E IDIOMAS", "DISPONIBILIDAD Y REQUISITOS").
=== END REQUIRED PAIRS ===
`;
}

/**
 * The candidate's own technology, listed so an out-of-field CV can be told to
 * leave it out.
 *
 * The deterministic half of "STRIP THE JARGON", which as an instruction alone
 * lost: a CV written for a groundskeeping vacancy came back naming Linux
 * servers, firewalls, DNS, SSL/TLS, RustDesk and TeamViewer. Every one of those
 * is true, which is why no honesty rule and no evidence check could catch it —
 * the failure is that the CV is still addressed to a software reader.
 *
 * Built from the profile rather than from the posting, because the posting says
 * nothing about databases and the profile is where the temptation lives. Empty
 * outside `unrelated`, where naming the stack is the entire point.
 *
 * A term the posting itself asks for is exempted, even here. A field technician
 * posting that names "redes" or "cableado estructurado" is a case where the
 * candidate's networking background is not overqualification, it is the job —
 * banning it would strip material this exact reader wants. `verifyJargon` and
 * `cvGaps` (see verify.ts) apply the same exemption, so the ban, the warning
 * and the retry all agree on what counts.
 */
function serializeJargonBan(
  profile: Profile,
  relevance: Relevance,
  posting: EvidenceIndex,
): string[] {
  if (relevance !== "unrelated") return [];

  const evidence = buildEvidenceIndex(profile);
  const found = new Set<string>();

  const sources = [
    profile.headline,
    profile.about,
    ...profile.skills,
    ...profile.extras,
    ...profile.experience.flatMap((job) => [...job.bullets, ...job.tags]),
    ...profile.projects.flatMap((p) => [p.description, ...p.tags]),
  ];
  for (const text of sources) {
    for (const term of statedHardTerms(text, evidence)) {
      if (!supports(posting, term)) found.add(term);
    }
  }

  return [...found].slice(0, JARGON_BAN_LIMIT);
}

export function buildCVPrompt(input: {
  profile: Profile;
  analysis: JobAnalysis;
  inferredSkills: InferredSkill[];
  outputLanguage: string;
  /**
   * The posting as pasted. Only `practicalAsks` reads it — everything else here
   * works from the analysis — because the facts it looks for (a shift, a
   * schedule, a licence) are routinely stated above the requirements list and
   * never make it into one. See its docstring.
   */
  jobText?: string;
  /** How the previous attempt actually measured against the page, if there was one. */
  previousFit?: PreviousFit;
  /** How many sheets the person allowed: one, unless they asked for two. */
  sheets?: Sheets;
  /** What the previous attempt dropped, when this call is the retry for it. */
  gaps?: CVGaps;
}): string {
  const { profile, analysis, inferredSkills, outputLanguage, jobText, previousFit, sheets, gaps } = input;

  const requirements = analysis.requirements
    .map((r) => `- [${r.kind}] ${r.text}`)
    .join("\n");

  const evidence = buildEvidenceIndex(profile);
  const keywords = matchKeywords(evidence, analysis.keywords);
  const credentials = matchedCredentials(profile, analysis);
  const practical = practicalAsks(profile, analysis, jobText);

  // The deny-list the glossary cannot produce. Requirements and keywords only —
  // never the responsibilities, which are duties rather than claims and would
  // bury the list under a dozen sentences nobody was going to write anyway.
  const unclaimable =
    analysis.relevance === "direct"
      ? []
      : unsupportedPhrases(evidence, [
          ...analysis.requirements.map((r) => r.text),
          ...keywords.neutral,
        ]).slice(0, UNCLAIMABLE_LIMIT);
  const posting = postingIndex(analysis);
  const jargon = serializeJargonBan(profile, analysis.relevance, posting);

  /**
   * The relevance of one bullet to this posting, counted rather than judged —
   * the same move `serializeVocabulary` makes for keywords, for the same
   * reason. Asked to pick the bullets that matter, a model keeps the profile's
   * order; given the order, it uses it.
   *
   * It measures one thing and stops there, and the limit is worth writing down
   * because the obvious extension does not work. `analysis.keywords` are the
   * technologies the posting names, so a backend profile against a maquetación
   * ad scores nearly every bullet zero, and one incidental hit ("Git", named by
   * both) leaves eleven bullets tied behind it in the order they were typed. A
   * tiebreak counting ordinary shared vocabulary against the whole posting was
   * built for exactly that and measured on the run that motivated it: it ranked
   * "Optimicé 300 consultas SQL en PostgreSQL y Redis" above "landing pages de
   * conversión y sitios de portafolio" for a maquetación role, because the first
   * one happens to contain "diseño" and "manejo". An order assembled out of
   * coincidences is worse than no order, because the prompt presents it as
   * meaning something. Selection with no keyword to go on is left to the model,
   * told plainly in `STRATEGIES.adjacent` that the profile's order is not a
   * ranking.
   */
  const rankBullet = (text: string) => keywordMatches(analysis.keywords, text);

  /**
   * Whether one profile entry — a tool tag, a stated skill — names something
   * this posting asks about.
   *
   * The whole-string check alone was not enough, because profiles do not store
   * bare tool names. "CSS (Tailwind)" is one entry and matches no posting
   * verbatim, so a candidate whose profile said exactly that was not credited
   * with CSS by an ad whose title was CSS maquetación. Reading the named
   * technologies out of the entry first asks the question that was meant:
   * not "is this entry the posting's wording?" but "does this entry name
   * something the posting wants?".
   */
  const namesSomethingAskedFor = (entry: string) =>
    supports(posting, entry) || statedHardTerms(entry, posting).length > 0;

  return `
=== CANDIDATE PROFILE (the only source of facts) ===
A "*" after a tool marks one this posting names. Unmarked tools are still the
candidate's and are still usable — a posting asking for asynchronous systems is
answered by the message broker in their stack even though it never names it.
${serializeProfile(profile, {
  highlight: namesSomethingAskedFor,
  rankBullet,
  omitTechInventory: analysis.relevance === "unrelated",
  projectRefs: true,
})}
=== END CANDIDATE PROFILE ===
${serializeFigures(profile, analysis.relevance)}${gapCorrection(gaps)}

=== SKILLS ALREADY DERIVED FROM THIS PROFILE ===
These were inferred from the profile and the candidate has not confirmed them.
Use them only to choose and order what the profile states. Never write one as
a skill, tool or task of the candidate; where the posting asks for one, record
the requirement in the coverage report with "inferred": true.
${serializeInferredSkills(undecidedSkills(inferredSkills, analysis, profile))}
=== END DERIVED SKILLS ===

${bulletBudget(profile, analysis.relevance, previousFit, sheets)}

${languageDirective(outputLanguage)}

${STRATEGIES[analysis.relevance]}

=== TARGET JOB ===
Title: ${analysis.title}
Company: ${analysis.company || "(not stated)"}
Location: ${analysis.location || "(not stated)"} · ${analysis.workMode}
Field: ${analysis.domain}
Seniority: ${analysis.seniority}
Relevance to this candidate: ${analysis.relevance} — ${analysis.relevanceReason}

Requirements:
${requirements || "(none extracted)"}

Responsibilities:
${analysis.responsibilities.map((r) => `- ${r}`).join("\n") || "(none extracted)"}
${
  analysis.priorities.length > 0
    ? `
Business priorities:
${analysis.priorities.map((p) => `- ${p}`).join("\n")}
When a kept bullet's own facts touch one of these, frame it toward that priority. Never add a result to make the connection.
`
    : ""
}=== END TARGET JOB ===

${serializeVocabulary(keywords, unclaimable, jargon)}

=== WHERE THIS PROFILE MEETS THIS POSTING ===
${serializeJobMatch(profile, evidence, analysis)}
=== END OVERLAP ===
${serializeRequiredPairs(credentials, practical, profile)}
Every "header" field is discarded and replaced with the profile's own values
after generation — nothing you write there reaches the CV. Leave them as empty
strings (an empty array for "links") and spend no effort on them.

"labels" holds the words the renderer prints around your text — they are shown
to the reader, so write them in the output language too, not in English and not
as schema keys.

Produce the tailored CV.
`.trim();
}

/**
 * The posting's ATS keywords, already checked against the profile.
 *
 * The single undifferentiated list this replaces asked the model to decide, per
 * term, whether the candidate "genuinely matches" it — a judgement it lost
 * consistently in the direction of the posting, writing Clean Architecture, DDD
 * and CQRS into CVs whose profiles named none of them. Two flat lists take the
 * judgement away. The third bucket is left out on purpose: ordinary phrasing
 * like "backend development" is not a claim to police, and listing it either
 * way would make the model timid about its own vocabulary.
 */
function serializeVocabulary(
  keywords: ReturnType<typeof matchKeywords>,
  /**
   * The same deny-list computed lexically, for the postings the glossary cannot
   * see. Empty on `direct`, where the glossary already covers it and listing
   * ordinary phrasing would only make the model timid about its own vocabulary.
   */
  unclaimable: string[],
  /**
   * The candidate's own technology, to be kept off an out-of-field CV. Empty
   * everywhere except `unrelated` — see `serializeJargonBan`.
   */
  jargon: string[],
): string {
  const blocks: string[] = [];

  if (keywords.supported.length) {
    blocks.push(
      `IN THE PROFILE — the posting asks for these and the candidate has them.
Use the posting's spelling, verbatim, wherever the experience genuinely carries
it. These are the terms an ATS will look for and the reason this CV gets read:
${keywords.supported.join(", ")}`,
    );
  }

  if (keywords.fabricable.length) {
    blocks.push(
      `NOT IN THE PROFILE — the posting asks for these and the candidate has NOT
stated them anywhere. They must not appear in the CV: not in the summary, not
in a skills line, not as part of a longer phrase, not implied. Naming a
technology the candidate has never touched is how a CV wins an interview and
then loses it in the first ten minutes. Record each as uncovered in the
coverage report instead:
${keywords.fabricable.join(", ")}`,
    );
  }

  if (unclaimable.length) {
    blocks.push(
      `NOTHING IN THE PROFILE ANSWERS THESE — the posting asks for each of them
and the profile is silent on all of them. Outside a technical field a
fabrication is not a product name, it is an ordinary sentence, so the rule has
to be stated in those terms: none of these may appear in the CV as something
the candidate has done, has experience in, is able to do, or is willing to do.
Not in the summary, not in a skills line, not softened into an adjacent
phrasing that means the same thing to a reader. "Disposición para trabajar en
diferentes condiciones climáticas", written from a profile that never mentions
outdoor work, invents a fact exactly as much as naming a database the
candidate has never opened.

This is a list of things not to write. It is NOT a list of coverage entries:
the coverage report still has exactly one row per requirement in the analysis
and no rows for anything else. Where one of these is a requirement, that
requirement's row says uncovered.
${unclaimable.map((phrase) => `- ${phrase}`).join("\n")}`,
    );
  }

  if (jargon.length) {
    blocks.push(
      `IN THE PROFILE AND STILL NOT ALLOWED — every term here is genuinely the
candidate's, which is what makes this different from the two lists above. This
job is outside their field, and to the person reading it these words carry no
information and mark the applicant as someone who will leave. Do not name any
of them: not in the summary, not in a bullet, not in a skills line, not in a
pairs value, not "systems like X". Say what they DID in the reader's own terms
— "resolví problemas de equipos bajo presión", never "configuré servidores
Linux y certificados SSL/TLS".
${jargon.map((term) => `- ${term}`).join("\n")}`,
    );
  }

  return blocks.length
    ? `=== POSTING VOCABULARY ===\n${blocks.join("\n\n")}\n=== END VOCABULARY ===`
    : "";
}
