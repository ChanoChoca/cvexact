import {
  buildEvidenceIndex,
  buildIndexFrom,
  collectFigures,
  contentWords,
  documentLanguage,
  approximateFigures,
  evidenceTextsFrom,
  experienceFacts,
  figureMentions,
  findUnsupportedTerms,
  hardTermsIn,
  matchesKnown,
  matchKeywords,
  normalize,
  saidApproximately,
  scaleMentions,
  statedFigures,
  statedHardTerms,
  statedYearsOfExperience,
  supports,
  supportShare,
  textOverlap,
  VERBATIM_OVERLAP,
  type ExperienceFacts,
} from "@/lib/ai/evidence";
import { practicalFactFor, statedPractical } from "@/lib/ai/practical";
import { profileMaterial } from "@/lib/ai/prompts/shared";
import { mentionsSkill } from "@/lib/onboarding/tools";
import { AUTHORITY, SUPPORTIVE, termsIn } from "@/lib/cv/condense-guard";
import type { Coverage, CVDocument } from "@/lib/schemas/cv";
import type { Answer, Answers } from "@/lib/schemas/outputs";
import { countWords, parseQuestionLimits, type QuestionLimit } from "@/lib/ai/question-limits";
import type { JobAnalysis, Relevance, Requirement } from "@/lib/schemas/job";
import { meaningfulExperience, type Experience, type Profile } from "@/lib/schemas/profile";
import { normalizeText } from "@/lib/text/normalize";

/**
 * Email and phone equality only, below — trim and casefold, nothing else.
 * `normalize()` from evidence.ts is tuned for technology names (it folds
 * accents and turns `.`/`@` into spaces), which is the wrong tool for
 * contact data: it would call "john.doe@x.com" a match for "johndoe x com".
 */
function normalizeContact(value: string): string {
  return normalizeText(value, { stripDiacritics: false, punctuation: "keep" });
}

/**
 * Structural check that the generated CV did not invent an employer, an
 * institution, a year, a technology, or a level of seniority.
 *
 * The honesty rules in the prompts are instructions; this is enforcement. A CV
 * naming a company the candidate never worked at fails at the interview and
 * costs them the role, so it is worth catching in code rather than trusting the
 * model. Findings are surfaced to the user rather than thrown — a false
 * positive must not block a legitimate CV.
 */

export type Finding = {
  severity: "error" | "warning";
  field: string;
  detail: string;
  /**
   * Which kind it is, for the ones the panel does something with besides saying them: an invented figure comes with
   * what to do about it (`InventedFigure`), and is recomputed where the CV and the profile are, not read back from here.
   * A CV that is short because the profile has little to put on it (`thin_cv`) comes with the question of what else there is to list.
   */
  kind?: "invented_figure" | "thin_cv";
};

/** Years mentioned anywhere in a display string, e.g. "Agosto 2017 – Sept 2022". */
function years(value: string): string[] {
  return [...value.matchAll(/\b(19|20)\d{2}\b/g)].map((m) => m[0]);
}

/**
 * The CV's prose, field by field: what the candidate asserts about themselves,
 * as opposed to the structural strings the template needs.
 *
 * Section titles are excluded deliberately. The template requires them in
 * uppercase ("EXPERIENCIA PROFESIONAL"), which the acronym check below would
 * read as a wall of technology claims.
 */
export type Prose = {
  field: string;
  text: string;
  /**
   * Which kind of line this is. `pairs` reads differently from every other
   * entry — a label and a short fact rather than a sentence — so the checks
   * that weigh a sentence's wording have to be able to leave it out.
   */
  kind: "summary" | "experience" | "bullets" | "pairs" | "projects" | "activities";
};

export function cvProse(cv: CVDocument): Prose[] {
  const prose: Prose[] = [{ field: "summary", text: cv.summary, kind: "summary" }];

  for (const [s, section] of cv.sections.entries()) {
    if (section.kind === "experience") {
      for (const [i, item] of section.items.entries()) {
        for (const [b, bullet] of item.bullets.entries()) {
          prose.push({
            field: `sections[${s}].items[${i}].bullets[${b}]`,
            text: bullet,
            kind: "experience",
          });
        }
      }
    }
    if (section.kind === "bullets") {
      for (const [b, bullet] of section.bullets.entries()) {
        prose.push({ field: `sections[${s}].bullets[${b}]`, text: bullet, kind: "bullets" });
      }
    }
    if (section.kind === "pairs") {
      for (const [i, item] of section.items.entries()) {
        prose.push({
          field: `sections[${s}].items[${i}]`,
          text: `${item.label} ${item.value}`,
          kind: "pairs",
        });
      }
    }
    // Only the description: the name and the link are the profile's, not the model's text.
    // A project with none is still a printed line, so it still counts for the thin-CV floor.
    if (section.kind === "projects") {
      for (const [i, item] of section.items.entries()) {
        prose.push({
          field: `sections[${s}].items[${i}].description`,
          text: item.description,
          kind: "projects",
        });
      }
    }
    // The profile's own line, put in after the model answered; it is still a printed line for the thin-CV floor.
    if (section.kind === "activities") {
      for (const [i, item] of section.items.entries()) {
        prose.push({ field: `sections[${s}].items[${i}].text`, text: item.text, kind: "activities" });
      }
    }
  }

  return prose;
}

/**
 * Phrases that assert a long career without naming a number. Treated as a claim
 * to roughly this many years, which is the point at which a recruiter reading
 * "amplia trayectoria" would stop being surprised by the dates below it.
 */
const VAGUE_SENIORITY =
  /\b(amplia (trayectoria|experiencia)|extensa experiencia|vasta experiencia|solida trayectoria|senior|seasoned|extensive experience|highly experienced)\b/;
const VAGUE_SENIORITY_IMPLIES_YEARS = 5;

/** "8 años de experiencia", "5+ years". */
const EXPLICIT_YEARS = /\b(\d{1,2})\s*\+?\s*(?:anos|years)\b/;

/**
 * Below this the page is visibly empty and the CV reads as a thin candidate.
 * The prompt's budget is 12–16 for a profile with the material for it, so this is a floor, not a target.
 * A profile without that material is told its count is a ceiling (`bulletBudget`), and a short page is then the
 * honest outcome: the warning says so instead of sending the person to regenerate what the profile cannot fill.
 *
 * Outside the candidate's field the budget is 7–11 and a short page is the
 * intended outcome, so the floor drops with it. Telling the user to regenerate
 * a CV that stopped where the honest material stopped is the same mistake
 * `verifyFigures` was making: reporting the one decision that went right.
 */
const THIN_CV_BULLETS = 8;
const THIN_CV_BULLETS_UNRELATED = 5;

/**
 * Catches what the model left out, which nothing else does.
 *
 * Every other check here compares something the CV asserts against the profile,
 * so a CV that asserts *nothing* passes them all. That is not hypothetical: one
 * came back with a summary, two skill bullets, and no work history, no
 * education and no contact details — schema-valid, and unusable. Absence is a
 * failure mode of its own and needs its own checks.
 */
function verifyCompleteness(
  cv: CVDocument,
  profile: Profile,
  analysis?: { relevance: Relevance },
): Finding[] {
  const findings: Finding[] = [];

  const experience = cv.sections.filter((s) => s.kind === "experience");
  const hasExperience = experience.some((s) => s.items.length > 0);
  const hasEducation = cv.sections.some((s) => s.kind === "education" && s.items.length > 0);

  // Blank entries do not count — see `meaningfulExperience`. Telling the user
  // the CV dropped a job they never actually described sends them looking for
  // something that was never there.
  const stated = meaningfulExperience(profile);
  if (stated.length > 0 && !hasExperience) {
    findings.push({
      severity: "error",
      field: "sections",
      detail:
        "El CV no incluye ninguna experiencia laboral, pero tu perfil tiene " +
        `${stated.length === 1 ? "un puesto" : `${stated.length} puestos`}. ` +
        "Volvé a generar.",
    });
  }

  // For a job in a different field the strategy may legitimately push education
  // above experience, or lean on it instead — but not delete it.
  if (profile.education.length > 0 && !hasEducation && analysis?.relevance !== "unrelated") {
    findings.push({
      severity: "warning",
      field: "sections",
      detail: "El CV no incluye tu formación académica, que sí figura en tu perfil.",
    });
  }

  const bullets = cvProse(cv).filter((p) => p.kind !== "summary").length;
  const unrelated = analysis?.relevance === "unrelated";
  const floor = unrelated ? THIN_CV_BULLETS_UNRELATED : THIN_CV_BULLETS;
  if (bullets < floor) {
    // `cvProse` prints a certification or a language as a row each, so they are material too. The model may fold the
    // languages into one row, which makes this count generous: "poco material" is said only when even it falls short.
    const material =
      profileMaterial(profile, { unrelated }).total +
      profile.certifications.filter((cert) => cert.name.trim()).length +
      profile.languages.filter((language) => language.name.trim()).length;

    findings.push({
      severity: "warning",
      field: "sections",
      ...(material < floor ? { kind: "thin_cv" as const } : {}),
      detail:
        `El CV tiene solo ${bullets} ${bullets === 1 ? "línea" : "líneas"} de contenido y va a ocupar media página. ` +
        (material < floor
          ? "Tu perfil tiene poco material para este aviso. " +
            "Sumá proyectos, ayudantías, voluntariados o actividades para un CV más completo."
          : "Volvé a generar para aprovecharla."),
    });
  }

  // Undeliverable without these, and there is no reason a CV should lack them
  // when the profile has them.
  if (profile.email && !cv.header.email) {
    findings.push({
      severity: "error",
      field: "header.email",
      detail: "El CV salió sin tu email; un reclutador no tiene cómo responderte.",
    });
  }
  if (profile.phone && !cv.header.phone) {
    findings.push({
      severity: "warning",
      field: "header.phone",
      detail: "El CV salió sin tu teléfono, que sí figura en tu perfil.",
    });
  }
  if (profile.links.length > 0 && cv.header.links.length === 0) {
    findings.push({
      severity: "warning",
      field: "header.links",
      detail: "El CV salió sin tus links (LinkedIn, GitHub), que sí figuran en tu perfil.",
    });
  }

  return findings;
}

/**
 * The numbers this CV had available to it, and the ones it kept.
 *
 * Scoped to the roles the CV included — dropping a whole job takes its figures
 * with it and the strategy prompts explicitly license that — but deliberately
 * not narrowed further, to the individual bullet a figure came from. Matching a
 * rewritten bullet back to its source is not possible here: measured over the
 * corpus, profile bullets whose figure demonstrably survived scored word
 * overlaps from 0.00 to 0.74 against the CV line that carried it, because
 * re-angling a bullet for a posting is supposed to change almost every word.
 * Any threshold low enough to catch those matches everything.
 *
 * So this asks the question the user actually has — "I typed numbers and my CV
 * has none of them" — rather than the narrower one about which bullet lost
 * which figure. Companies are matched with `matchesKnown` because the model
 * legitimately shortens and expands names.
 *
 * Exported because `tests/eval/score.ts` reports the same ratio this warns
 * about, and a metric drifting from the check it measures is worse than no
 * metric — the same reason `isHedgedSkillLine` is exported below.
 */
export function figuresAtStake(
  cv: CVDocument,
  profile: Profile,
): { stated: string[]; kept: string[]; lost: string[] } {
  // Only roles the CV wrote bullets for. A role reduced to a header is the
  // documented way to show continuity of employment without spending lines on
  // it, and a job the CV says nothing about cannot have lost a number.
  const written = cv.sections.flatMap((s) =>
    s.kind === "experience" ? s.items.filter((i) => i.bullets.length > 0) : [],
  );
  const companies = written.map((i) => i.company);
  // `matchesKnown` reads an empty candidate as "nothing asserted" and returns
  // true, so a blank profile entry would match every company in the CV.
  const used = meaningfulExperience(profile).filter((role) =>
    matchesKnown(role.company, companies),
  );

  const stated = collectFigures(used.flatMap((role) => role.bullets));
  const inCV = new Set(collectFigures(cvProse(cv).map((p) => p.text)));

  return {
    stated,
    kept: stated.filter((f) => inCV.has(f)),
    lost: stated.filter((f) => !inCV.has(f)),
  };
}

/**
 * The role each experience item claims, against the one the profile records.
 *
 * `verifyCV` below checks the employer, the institution, the dates, the email
 * and the phone. It never checked the job title, and the title is the field the
 * model rewrites hardest: the same profile role, `Software Engineer @ Flash
 * Page`, shipped as "Soporte Técnico y Mantenimiento de Infraestructura" on one
 * posting and "Soporte Técnico y Operaciones" on the next. Re-angling the
 * bullets is the job; re-titling the post is inventing an employment history,
 * and it is checkable the moment a reference is taken.
 *
 * A warning rather than an error because the output language follows the
 * posting: `Software Engineer` legitimately becomes `Ingeniero de Software`,
 * and only a title sharing no word at all with the profile's is reported.
 */
export type RetitledRole = {
  field: string;
  company: string;
  claimed: string;
  /** Every title the profile records at this employer. */
  stated: string[];
};

/**
 * The roles whose title the CV rewrote past recognition.
 *
 * Exported alongside the findings it produces so `cvGaps` can feed the retry the
 * profile's own title, rather than re-deriving the comparison or parsing it back
 * out of a Spanish sentence.
 */
export function retitledRoles(cv: CVDocument, profile: Profile): RetitledRole[] {
  const found: RetitledRole[] = [];

  for (const [s, section] of cv.sections.entries()) {
    if (section.kind !== "experience") continue;

    for (const [i, item] of section.items.entries()) {
      const claimed = item.role.trim();
      if (!claimed) continue;

      // The profile roles at this employer. Matching by company first keeps a
      // two-role profile from excusing a title borrowed from the other job.
      const stated = profile.experience
        .filter((role) => matchesKnown(item.company, [role.company]) && role.role.trim())
        .map((role) => role.role);
      if (stated.length === 0) continue;

      const recognised = stated.some(
        (role) => matchesKnown(claimed, [role]) || textOverlap(claimed, role) > 0,
      );
      if (recognised) continue;

      found.push({ field: `sections[${s}].items[${i}].role`, company: item.company, claimed, stated });
    }
  }

  return found;
}

export function verifyRoleTitles(cv: CVDocument, profile: Profile): Finding[] {
  return retitledRoles(cv, profile).map((role) => ({
    severity: "warning",
    field: role.field,
    detail:
      `El CV te pone como «${role.claimed}» en ${role.company || "ese puesto"}; tu perfil dice ` +
      `«${role.stated.join("», «")}». Si el cargo real es otro, corregilo en el perfil.`,
  }));
}

/**
 * Who did the work: a CV may say «lideré» of a job only where the profile says someone led it, and a «participé» the profile
 * wrote should not quietly become a flat «hice». Read per job and not per line, because a rewritten line cannot be paired
 * with its original (see `verbatimBullets`), and for the summary against the whole profile.
 *
 * The words are the condense guard's (`AUTHORITY`, `SUPPORTIVE`), in both languages at once: the profile and the CV are not
 * always in the same one. Backing is read loosely on purpose, since a false positive here costs a paid retry that cannot
 * fix it: any authority word in the job's title or tasks backs any other («Responsable del equipo» backs «Lideré al equipo»),
 * and so does a title that is the authority itself («Líder técnica»).
 */
// Read inside the functions, not here: `condense-guard` imports this module, so at load time its lexicons may not exist yet.
const anyOf = (lexicon: Record<string, readonly string[]>) => Object.values(lexicon).flat();
const AUTHORITY_TITLE = /\b(?:lider\w*|jef[ae]|gerent\w+|director\w*|coordin\w+|encargad\w+|supervis\w+|dirij\w+|gestion\w+|lead\w*|manag\w+|head|owner|chief)\b/;

/** Past this share of words, a CV line is still about the profile task (`textOverlap`; a verbatim copy is `VERBATIM_OVERLAP`). */
const SAME_TASK_OVERLAP = 0.3;

const backsAuthority = (said: string) => termsIn(said, anyOf(AUTHORITY)).length > 0 || AUTHORITY_TITLE.test(normalize(said));

/** The profile's jobs a CV job can be: its employer's, or a freelance (no employer) with a similar title. */
function profileJobsOf(item: { company: string; role: string }, profile: Profile): Experience[] {
  const named = item.company.trim() ? profile.experience.filter((job) => job.company.trim() && matchesKnown(item.company, [job.company])) : [];
  return named.length > 0 ? named : profile.experience.filter((job) => !job.company.trim() && textOverlap(item.role, job.role) > 0);
}

export type OverclaimedWork = {
  field: string;
  /** The employer (or the title, for a job without one); empty for the summary. */
  where: string;
  /** The first line that says the candidate led or owned the work. */
  line: string;
};

export function authorship(cv: CVDocument, profile: Profile): { overclaimed: OverclaimedWork[]; lost: { field: string; where: string }[] } {
  const overclaimed: OverclaimedWork[] = [];
  const lost: { field: string; where: string }[] = [];

  const claim = (field: string, where: string, lines: string[], said: string) => {
    const line = lines.find((text) => termsIn(text, anyOf(AUTHORITY)).length > 0);
    if (line && !backsAuthority(said)) overclaimed.push({ field, where, line });
  };

  claim("summary", "", [cv.summary], evidenceTextsFrom(profile).join("\n"));

  for (const [s, section] of cv.sections.entries()) {
    if (section.kind !== "experience") continue;
    for (const [i, item] of section.items.entries()) {
      const jobs = profileJobsOf(item, profile);
      if (jobs.length === 0) continue;

      const field = `sections[${s}].items[${i}]`;
      const where = item.company.trim() || item.role.trim();
      const said = jobs.flatMap((job) => [job.role, ...job.bullets]).join("\n");
      claim(field, where, item.bullets, said);

      // Only when the CV still has a line about that task: a task the model left out claims nothing. Over the 127 saved CVs
      // of one account, 68 had a «participé» dropped along with its line, and the one rewritten into «Coordiné» scored 0.5.
      const supportive = jobs.flatMap((job) => job.bullets).filter((task) => termsIn(task, anyOf(SUPPORTIVE)).length > 0);
      const kept = item.bullets.some((bullet) => supportive.some((task) => textOverlap(task, bullet) >= SAME_TASK_OVERLAP));
      if (kept && termsIn(item.bullets.join("\n"), anyOf(SUPPORTIVE)).length === 0) lost.push({ field, where });
    }
  }

  return { overclaimed, lost };
}

export function verifyAuthorship(cv: CVDocument, profile: Profile): Finding[] {
  const { overclaimed, lost } = authorship(cv, profile);
  return [
    ...overclaimed.map(({ field, where, line }): Finding => ({
      severity: "error",
      field,
      detail:
        `El CV dice que lideraste o te hiciste cargo («${line}»), y tu perfil no lo dice${where ? ` de ${where}` : ""}. ` +
        `Dejalo en lo que hiciste, o agregalo al perfil si fue así.`,
    })),
    ...lost.map(({ field, where }): Finding => ({
      severity: "warning",
      field,
      detail:
        `Tu perfil dice que participaste o colaboraste en ${where || "ese puesto"}, y el CV ya no lo dice en ese puesto. ` +
        `Revisá que ninguna línea suene a más de lo que fue.`,
    })),
  ];
}

/**
 * The short labelled facts, against the profile fields they come from.
 *
 * A "pairs" row is read as a commitment rather than a description — a recruiter
 * scanning for "can you work Saturdays" stops there — and it is the one place
 * the model was reliably answering with the posting instead of the profile. The
 * measurements and the table itself live in `lib/ai/practical.ts`, next to
 * `withProfilePractical`, which now imposes the profile's value on these rows
 * before this ever runs.
 *
 * Kept anyway, for the two paths that overwrite does not cover: a CV the user has
 * edited by hand, where a bad row can be typed back in, and the CVs already saved
 * in a browser, which the eval harness scores as they are.
 */
export function verifyPairs(cv: CVDocument, profile: Profile): Finding[] {
  const findings: Finding[] = [];

  for (const [s, section] of cv.sections.entries()) {
    if (section.kind !== "pairs") continue;

    for (const [i, item] of section.items.entries()) {
      const fact = practicalFactFor(item.label);
      if (!fact) continue;

      const value = item.value.trim();
      if (!value) continue;

      const stated = statedPractical(profile, fact);
      const where = `sections[${s}].items[${i}]`;

      if (stated === null) {
        findings.push({
          severity: "error",
          field: where,
          detail:
            `El CV declara «${item.label}: ${value}», pero tu perfil no dice nada sobre ${fact.what}. ` +
            `Eso es un compromiso que no diste: sacalo o cargalo en el perfil.`,
        });
        continue;
      }

      // A boolean has no text to compare against — `statedPractical` returning a
      // value already means the fact holds, and the wording is the model's.
      if (fact.kind === "flag") continue;

      if (supports(buildIndexFrom([value]), stated)) continue;

      findings.push({
        severity: "error",
        field: where,
        detail:
          `El CV promete «${value}» y tu perfil dice «${stated}». Ese dato salió del aviso, ` +
          `no de vos: te compromete a algo que no ofreciste.`,
      });
    }
  }

  return findings;
}

/**
 * Two texts describe the same requirement. Low, because the model paraphrases
 * the analysis rather than quoting it, and the entries this needs to separate —
 * a real requirement reworded against one the model made up whole — are far
 * apart either way.
 */
const COVERAGE_MATCH_OVERLAP = 0.4;

/**
 * Above this share of a requirement's content words appearing in the summary,
 * the summary is claiming it. Set high: the summary and the requirement are
 * about the same job, so some vocabulary is shared no matter what.
 */
const SUMMARY_CLAIMS_SHARE = 0.6;

/**
 * The coverage report, against the posting it claims to report on.
 *
 * It is the one part of the response nothing checked, and the only part the
 * user reads to decide whether they are a fit. Left unaudited it grades its own
 * homework: a groundskeeping posting with three requirements came back with a
 * ten-row report, eight of them marked covered, the seven extra rows invented
 * by the model out of things the CV happened to say ("Atención al detalle",
 * "Trabajo físico y al aire libre"). Real coverage was one of three; the panel
 * showed 76%.
 */
type PostingAsk = Pick<JobAnalysis, "requirements" | "responsibilities">;

const coverageMatches = (entry: string, against: readonly string[]) =>
  against.some((text) => textOverlap(entry, text) >= COVERAGE_MATCH_OVERLAP);

/**
 * Coverage entries reporting on something the posting never mentioned.
 *
 * Exported because `tests/eval/score.ts` counts exactly these, and a metric
 * drifting from the check it measures is worse than no metric — the same reason
 * `figuresAtStake` and `isHedgedSkillLine` are exported.
 *
 * Responsibilities count as things the posting asked for, even though the
 * prompt asks for one entry per requirement: a duty listed in the ad is
 * something the reader will look for, and a model reporting on it is being more
 * complete rather than making something up. They are not in the denominator,
 * which is what the user is told they are a fit against.
 */
export function inventedCoverage(cv: Pick<CVDocument, "coverage">, analysis: PostingAsk) {
  const inPosting = [
    ...analysis.requirements.map((r) => r.text),
    ...analysis.responsibilities,
  ];
  return cv.coverage.requirements.filter(
    (entry) => !coverageMatches(entry.requirement, inPosting),
  );
}

export type CoverageRow = {
  /** The posting's own wording, which is what the user is a fit *against*. */
  requirement: string;
  kind: Requirement["kind"];
  excluding: boolean;
  /** The model's entry for it, or `null` when the report skipped it entirely. */
  entry: Coverage["requirements"][number] | null;
  covered: boolean;
};

export type CoverageAudit = {
  /** One row per requirement in the posting, in the posting's order. */
  rows: CoverageRow[];
  /** Entries the model reported on that the posting never asked for. */
  extra: Coverage["requirements"];
  genuinelyCovered: number;
  /** The denominator the user came for: how many things the posting requires. */
  total: number;
  /**
   * The same two numbers over `kind === "hard"` rows only.
   *
   * A CV evidences a tool, a certification or a date range. It does not
   * evidence "atención al detalle" or "pensamiento visual y didáctico", so a
   * ratio that counts those in its denominator reports a shortfall no candidate
   * could ever close: an HTML posting with 5 hard requirements and 7 soft traits
   * showed 3/12 to someone who met 3 of 5 of the checkable half.
   *
   * Added alongside `genuinelyCovered`/`total` rather than replacing them —
   * `tests/eval/score.ts` reads those, and a metric that quietly changes
   * denominator is worse than no metric.
   */
  hardCovered: number;
  hardTotal: number;
};

/**
 * The coverage report re-derived from the posting instead of from itself.
 *
 * Left to its own arithmetic the report grades its own homework, and the panel
 * printed the grade. Two measured cases from
 * `public/cvexact-2026-08-17.json`: a groundskeeping ad with three
 * requirements came back with ten rows, eight marked covered, shown as 76%; a
 * waiting job with two came back with eight rows, six marked covered, shown as
 * 6/8 — while the real answer was one of two, and the one it missed was the
 * excluding one.
 *
 * The spine is `analysis.requirements`, not the model's rows, which is the part
 * that could not be fixed by counting differently: a requirement the report
 * simply omitted used to vanish from the panel, and silence read as coverage.
 *
 * Exported so `CoveragePanel` and `tests/eval/score.ts` show the number this
 * function computes rather than each deriving their own — the same reason
 * `figuresAtStake` and `isHedgedSkillLine` are exported.
 */
export function coverageAudit(
  /** Only the report is read, so the panel can pass a stored coverage block. */
  cv: Pick<CVDocument, "coverage">,
  analysis: PostingAsk,
): CoverageAudit {
  const reported = cv.coverage.requirements;

  const rows = analysis.requirements.map((requirement) => {
    const entry =
      reported.find((candidate) => coverageMatches(candidate.requirement, [requirement.text])) ??
      null;
    return {
      requirement: requirement.text,
      kind: requirement.kind,
      excluding: requirement.excluding,
      entry,
      // An unreported requirement is uncovered. The model not mentioning it is
      // not evidence that it is met.
      covered: entry?.covered ?? false,
    };
  });

  const hard = rows.filter((row) => row.kind === "hard");

  return {
    rows,
    extra: inventedCoverage(cv, analysis),
    genuinelyCovered: rows.filter((row) => row.covered).length,
    total: rows.length,
    hardCovered: hard.filter((row) => row.covered).length,
    hardTotal: hard.length,
  };
}

/**
 * Requirements the report concedes and the summary claims anyway.
 *
 * Both halves came back in one response for a waiting job: the coverage said
 * customer contact was not covered, the summary opened "con experiencia en
 * atención al cliente". Whichever half is wrong, they cannot both ship — which
 * is also why this is the one coverage failure worth spending a retry on, so
 * `cvGaps` reads it too.
 */
export function summaryContradictions(cv: Pick<CVDocument, "summary" | "coverage">): string[] {
  const summaryIndex = buildIndexFrom([cv.summary]);

  return cv.coverage.requirements
    .filter((entry) => {
      if (entry.covered) return false;
      const share = supportShare(summaryIndex, entry.requirement);
      return share !== null && share >= SUMMARY_CLAIMS_SHARE;
    })
    .map((entry) => entry.requirement);
}

function verifyCoverage(cv: CVDocument, analysis: PostingAsk): Finding[] {
  const findings: Finding[] = [];

  if (analysis.requirements.length === 0) return findings;

  const audit = coverageAudit(cv, analysis);
  const reported = cv.coverage.requirements;

  /**
   * An empty report is survivable now — the schema defaults it so a model that
   * omits the block does not fail the whole document (see `coverageSchema`) —
   * and this is what keeps that from being silent. The panel beside the preview
   * counts the posting's requirements against these entries: with none, every
   * row reads "El informe no dijo nada sobre este punto" and the badge shows
   * 0 of N, which reads as "you cover nothing" rather than "the model did not
   * report". A warning, not an error: the CV itself may be fine.
   */
  if (reported.length === 0) {
    findings.push({
      severity: "warning",
      field: "coverage",
      detail:
        "El informe de cobertura llegó vacío: el modelo no dijo qué requisito cubre cada línea. " +
        `El panel de requisitos no puede evaluarlo y va a mostrar 0 de ${analysis.requirements.length}. ` +
        "El CV puede estar bien igual; volvé a generar si querés el detalle por requisito.",
    });
  }

  if (audit.extra.length > 0) {
    findings.push({
      severity: "warning",
      field: "coverage",
      detail:
        `El informe de cobertura lista ${reported.length} puntos, pero el aviso pide ${audit.total} ` +
        `${audit.total === 1 ? "requisito" : "requisitos"}. ` +
        `${audit.extra.length === 1 ? "Uno no figura" : `${audit.extra.length} no figuran`} en el aviso ` +
        `(${audit.extra.slice(0, 3).map((e) => `«${e.requirement}»`).join(", ")}${audit.extra.length > 3 ? "…" : ""}). ` +
        `Sobre lo que el aviso realmente pide, cubrís ${audit.genuinelyCovered} de ${audit.total}.`,
    });
  }

  for (const requirement of summaryContradictions(cv)) {
    findings.push({
      severity: "error",
      field: "summary",
      detail:
        `El resumen afirma «${requirement.toLocaleLowerCase()}», pero el propio informe de ` +
        `cobertura lo marca como no cubierto. El CV se contradice a sí mismo.`,
    });
  }

  return findings;
}

/**
 * Above this share of the available figures being dropped, the CV lost the
 * candidate's strongest content. Below it, the model cut bullets, which is its
 * job.
 */
const FIGURE_LOSS_SHARE = 0.5;

/**
 * Whether the numbers the candidate typed reached the page.
 *
 * Nothing else here can see this. Every fabrication check asks whether the CV
 * claimed too much; a CV that quietly deletes "1000 usuarios concurrentes" from
 * a bullet it otherwise kept passes all of them, and is strictly worse than the
 * bullet it replaced. `HONESTY_RULES` makes the profile the only place a figure
 * can come from, so a figure lost here cannot be recovered anywhere downstream.
 *
 * Across 69 real applications only 23% of CVs carried a number while the
 * profile carried several, and the metrics assistant kept reappearing to ask
 * for numbers the user had already given — because this check did not exist.
 */
function verifyFigures(
  cv: CVDocument,
  profile: Profile,
  analysis?: { relevance: Relevance },
): Finding[] {
  // Not outside the candidate's field. There every figure the profile holds
  // belongs to work the reader does not care about — "40% de reducción en
  // tiempo de respuesta", "8 servicios AWS/GCP" — and `STRATEGIES.unrelated`
  // orders them stripped. Unguarded, this fired on both such CVs in the corpus
  // and was the ONLY thing the panel said about either: an error telling the
  // user to regenerate a CV whose one correct decision it had just found.
  if (analysis?.relevance === "unrelated") return [];

  const { stated, kept, lost } = figuresAtStake(cv, profile);
  if (stated.length === 0) return [];

  if (kept.length === 0) {
    return [
      {
        severity: "error",
        field: "sections",
        detail:
          `El CV borró ${stated.length === 1 ? "el número" : `los ${stated.length} números`} que cargaste en tu perfil ` +
          `(${stated.join(", ")}). Son lo que más mira quien lee un CV. Volvé a generar.`,
      },
    ];
  }

  if (lost.length / stated.length >= FIGURE_LOSS_SHARE) {
    return [
      {
        severity: "warning",
        field: "sections",
        detail:
          `El CV se quedó con ${kept.length} de ${stated.length} números de tu perfil; ` +
          `perdió ${lost.join(", ")}.`,
      },
    ];
  }

  return [];
}

/**
 * A number the CV states that the profile does not — and the posting does not either.
 *
 * The other half of `figuresAtStake`: that one asks whether the numbers a person typed reached the page; this asks whether
 * the page has numbers nobody typed. Until it existed that rule was only a sentence in the prompt (`HONESTY_RULES`: «si un
 * número no está en el perfil, no lo produzcas»), and a model that invents «40 %» to make a line land is the one failure
 * that costs the candidate the interview rather than the job.
 *
 * Generous on purpose, because a figure wrongly called invented tells a person their CV lies when it does not. Not counted:
 * a year (the dates are the profile's), a length of time (derived from them, and the seniority check reads the claims), the
 * number one (a singular, not a quantity), a date or a time of day, a figure the posting itself states («5 años de
 * experiencia», «Java 17»), and any figure the profile states in another way — in words (`cinco`), as a count of thousands
 * (`10 mil`), in shorthand (`10k`), or with or without its percent sign (`statedFigures`).
 */
export type InventedFigure = {
  /** As the CV writes it: «40 %». */
  raw: string;
  /** As `extractFigures` says it: «40%». */
  figure: string;
  /** Where in the CV, as `Finding.field` says it: `sections[1].items[0].bullets[2]`. */
  field: string;
  /** The line it is in, whole. */
  line: string;
};

const A_YEAR = /^(?:19|20)\d{2}$/;
/** «3 años», «8 meses», «5+ years»: how long, which the dates say. */
const A_DURATION = /^\s*\+?\s*(?:a[ñn]os?|years?|yrs?|meses|mes|months?)(?![\p{L}\d])/iu;
/** «12/03/2021», «03/2021», «12.03.21»: a date says several numbers and none of them is a quantity. */
const A_DATE = /\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{1,2}\/\d{4}/g;

export function inventedFigures(
  cv: CVDocument,
  profile: Profile,
  analysis?: Partial<Pick<JobAnalysis, "title" | "domain" | "keywords" | "requirements" | "responsibilities">>,
): InventedFigure[] {
  const stated = statedFigures(licensingTexts(profile, analysis));

  const found: InventedFigure[] = [];
  const seen = new Set<string>();
  for (const { field, text } of cvProse(cv)) {
    const clean = text.replace(A_DATE, (date) => " ".repeat(date.length));
    // A quantity said in words is one too: «cientos de estudiantes» has no digit for the loop to see.
    for (const mention of [...figureMentions(clean), ...scaleMentions(clean)]) {
      const { figure } = mention;
      if (A_YEAR.test(figure) || figure === "1" || stated.has(figure)) continue;
      if (A_DURATION.test(clean.slice(mention.end))) continue;
      if (seen.has(`${field}|${figure}`)) continue;
      seen.add(`${field}|${figure}`);
      found.push({ raw: mention.raw, figure, field, line: text });
    }
  }
  return found;
}

/**
 * Everything a figure of the CV may come from: the profile, its contact details —a phone number repeated in a line is no
 * invention— and the posting, which states its own («5 años de experiencia», «Java 17»).
 */
function licensingTexts(
  profile: Profile,
  analysis?: Partial<Pick<JobAnalysis, "title" | "domain" | "keywords" | "requirements" | "responsibilities">>,
): string[] {
  const posting = [
    analysis?.title,
    analysis?.domain,
    ...(analysis?.keywords ?? []),
    ...(analysis?.requirements ?? []).map((requirement) => requirement.text),
    ...(analysis?.responsibilities ?? []),
  ].filter((text): text is string => Boolean(text));
  return [...evidenceTextsFrom(profile), profile.email, profile.phone, ...posting];
}

/** A quantity that is no number at all, and that nobody gave: «múltiples proyectos», «numerosos clientes». */
const VAGUE_QUANTITY = /(?<![\p{L}\d])(m[uú]ltiples|numerosos|numerosas)(?![\p{L}\d])/giu;

/** One warning for each of those the CV says and neither the profile nor the posting does. Not an error: «varios» says as little, and nobody is told they lied. */
function verifyVagueQuantities(
  cv: CVDocument,
  profile: Profile,
  analysis?: Partial<Pick<JobAnalysis, "title" | "domain" | "keywords" | "requirements" | "responsibilities">>,
): Finding[] {
  const said = new Set(licensingTexts(profile, analysis).flatMap((text) => [...text.matchAll(VAGUE_QUANTITY)].map((match) => normalize(match[1]!))));
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const { field, text } of cvProse(cv)) {
    for (const match of text.matchAll(VAGUE_QUANTITY)) {
      const word = normalize(match[1]!);
      if (said.has(word) || seen.has(`${field}|${word}`)) continue;
      seen.add(`${field}|${word}`);
      findings.push({
        severity: "warning",
        field,
        detail: `El CV dice «${match[1]}», una cantidad que no figura en tu perfil. Poné la cifra real o sacalo.`,
      });
    }
  }
  return findings;
}

/**
 * A figure the profile gives only as an estimate («aprox. 12 %») that the CV states as a fact. The number survived, which is what
 * `figuresAtStake` asks, and the word that made it honest did not: the candidate said «más o menos» and the page says «exactamente».
 */
export type DroppedApproximation = InventedFigure;

export function droppedApproximations(cv: CVDocument, profile: Profile): DroppedApproximation[] {
  const estimated = approximateFigures(evidenceTextsFrom(profile));
  if (estimated.size === 0) return [];

  const found: DroppedApproximation[] = [];
  const seen = new Set<string>();
  for (const { field, text } of cvProse(cv)) {
    const clean = text.replace(A_DATE, (date) => " ".repeat(date.length));
    for (const mention of figureMentions(clean)) {
      const { figure } = mention;
      if (A_YEAR.test(figure) || figure === "1" || !estimated.has(figure)) continue;
      if (A_DURATION.test(clean.slice(mention.end)) || saidApproximately(clean, mention, true)) continue;
      if (seen.has(`${field}|${figure}`)) continue;
      seen.add(`${field}|${figure}`);
      found.push({ raw: mention.raw, figure, field, line: text });
    }
  }
  return found;
}

function verifyApproximations(cv: CVDocument, profile: Profile): Finding[] {
  return droppedApproximations(cv, profile).map(({ raw, field }) => ({
    severity: "error" as const,
    field,
    detail: `El CV dice «${raw}» sin «aprox.»: en tu perfil es una estimación. Agregale «aprox.» o sacala.`,
  }));
}

/** One error for each number the CV made up: said in the words of the figure, with the two things that can be done about it. */
export function inventedFindings(found: readonly InventedFigure[]): Finding[] {
  return found.map(({ raw, field }) => ({
    severity: "error" as const,
    field,
    kind: "invented_figure" as const,
    detail: `El CV dice «${raw}», una cifra que no figura en tu perfil. Si es real, cargala; si no, sacala.`,
  }));
}

/**
 * What a regeneration could plausibly fix, as opposed to what merely needs
 * saying.
 *
 * `verifyCV` reports; this decides. The two failures here are the ones where
 * the model dropped something it was given rather than added something it was
 * not, which is exactly the kind a second attempt with pointed feedback lands —
 * unlike a fabricated technology, where retrying tends to produce a different
 * fabrication.
 */
export type CVGaps = {
  droppedFigures: string[];
  missingEducation: boolean;
  /**
   * Requirements the coverage report concedes while the summary claims them.
   * A retry fixes this because the model is not missing a fact — it wrote both
   * halves itself and only one of them can ship.
   */
  contradictedRequirements: string[];
  /** Roles whose title the CV rewrote into something the profile never says. */
  retitledRoles: { claimed: string; stated: string }[];
  /**
   * The profile's own bullets, shipped unchanged, when most of the CV is them.
   *
   * The only failure here the rest of this file was blind to, and the one the
   * user sees first: they pasted a posting and got their profile back. It was
   * measured and reported from the day `verifyTailoring` was written and never
   * cost the model anything, which is why a real run came back 7 of 7 copied.
   *
   * Populated only past `VERBATIM_SHARE`, the same bar the warning uses — a
   * retry over one faithfully-kept line would be arguing with an editorial
   * decision that was probably right.
   *
   * Said, not counted: it is not in `gapCount`, so it never decides a retry or which attempt is kept. A retry that happens for
   * another reason still carries it to the model.
   */
  copiedBullets: string[];
  /** Titles of skills sections written as a word list instead of statements. */
  keywordDumpSections: string[];
  /** The summary saying what the candidate wants rather than what they bring. */
  summaryRuleViolations: string[];
  /**
   * True technology terms the CV names outside the candidate's field, past
   * `JARGON_WORTH_RETRYING`. Unlike `contradictedRequirements` and
   * `retitledRoles`, this is not a self-contradiction the model can spot on its
   * own — it is the same failure `verifyJargon` has warned about since it was
   * written, promoted from a warning to a retry because the warning alone never
   * cost the model anything: a CV for a camera-installer vacancy kept naming
   * RBAC, Zero Trust and SSR/SSG/ISR through every warned-about generation.
   * There is a right answer to hand (say what they did in the reader's terms,
   * as `STRATEGIES.unrelated` already asks), which is what makes it worth a
   * second call in a way a fabricated technology is not.
   */
  jargonTerms: string[];
  /**
   * Numbers the CV states that the profile does not (`inventedFigures`), once each. Like the retitled role, a
   * self-contradiction the model can see once it is shown it: the profile is the only place a figure may come from, and
   * the right answer — say the line without the number — is one it can reach from what it was given.
   */
  inventedFigures: string[];
  /**
   * Jobs (and the summary) that say the candidate led or owned work the profile does not say that of. A self-contradiction
   * the model can see once shown the line: the profile states how much of the work was theirs, and the right answer is the
   * same line at that level.
   */
  overclaimedWork: OverclaimedWork[];
  /**
   * Figures the profile gives as an estimate that the CV states flat (`droppedApproximations`). Like an invented figure, a
   * self-contradiction the model can see once shown the line: the profile says «aprox.», and the right answer is the same line with it.
   */
  droppedApproximations: DroppedApproximation[];
  /** What the summary or a skills list says of the candidate that nobody can check (`selfAssessedTraits`): there is a right answer to hand, which is to cut it. */
  selfAssessedTraits: string[];
};

export function cvGaps(
  cv: CVDocument,
  profile: Profile,
  analysis?: { relevance: Relevance } &
    Partial<Pick<JobAnalysis, "title" | "domain" | "keywords" | "requirements" | "responsibilities">>,
): CVGaps {
  const { stated, kept, lost } = figuresAtStake(cv, profile);

  return {
    // Only the total loss, not the partial one: cutting some bullets is the
    // model doing its job, and retrying over it would burn a call on an
    // editorial decision that was probably right.
    //
    // And never outside the candidate's field, for the reason `verifyFigures`
    // gives. There the loss is the strategy working, so the retry it triggered
    // was a second paid generation per application, spent arguing the model
    // back toward the software numbers it had correctly just dropped.
    droppedFigures:
      analysis?.relevance !== "unrelated" && stated.length > 0 && kept.length === 0
        ? lost.filter(isWorthRetryingFor)
        : [],
    missingEducation:
      profile.education.length > 0 &&
      analysis?.relevance !== "unrelated" &&
      !cv.sections.some((s) => s.kind === "education" && s.items.length > 0),
    /**
     * These two are not omissions like the pair above — they are the model
     * asserting something. They are still worth a retry, and the fabricated
     * technology next door is not, because both are self-contradictions the model
     * can see once it is shown them: the profile says the title, and the CV's own
     * coverage report says the requirement is uncovered. There is a right answer
     * to hand. A fabricated technology has none, so retrying it just produces a
     * different fabrication.
     */
    contradictedRequirements: summaryContradictions(cv),
    retitledRoles: retitledRoles(cv, profile).map((role) => ({
      claimed: role.claimed,
      stated: role.stated.join(" / "),
    })),
    /**
     * These three are the checks that existed as warnings and nothing else. Each
     * one has a right answer the model can reach from what it was already given
     * — rewrite these lines, group these words into statements, open on what the
     * candidate brings — which is the test `contradictedRequirements` above sets
     * for whether a failure is worth a second call. A fabricated technology
     * fails that test and stays out; these pass it.
     */
    copiedBullets: isCopiedRatherThanRewritten(cv, profile) ? verbatimBullets(cv, profile) : [],
    keywordDumpSections: keywordDumpSections(cv),
    summaryRuleViolations: summaryRuleViolations(cv),
    jargonTerms: (() => {
      const terms = jargonTermsIn(cv, profile, analysis);
      return terms.length >= JARGON_WORTH_RETRYING ? terms : [];
    })(),
    inventedFigures: [...new Set(inventedFigures(cv, profile, analysis).map((invented) => invented.figure))],
    overclaimedWork: authorship(cv, profile).overclaimed,
    droppedApproximations: droppedApproximations(cv, profile),
    selfAssessedTraits: selfAssessedTraits(cv),
  };
}

/**
 * Figures worth spending a second model call to recover.
 *
 * A quantity of one is not a quantity, it is a singular: "Administré 1 servidor
 * Linux" and "Optimicé 1 consulta SQL" are weaker lines than the same sentences
 * without the number, and `serializeFigures` now tells the model to drop such a
 * bullet outright. Retrying to force it back would be this file arguing with
 * that instruction, and paying for the argument.
 *
 * Only the bare singular. "1.000" and "12,5" arrive canonicalised as "1000" and
 * "12.5", and "1%" keeps its sign, so none of them are caught here.
 */
function isWorthRetryingFor(figure: string): boolean {
  return figure !== "1";
}

export function hasGaps(gaps: CVGaps): boolean {
  return gapCount(gaps) > 0;
}

/**
 * How much was lost, for comparing two attempts. Every dropped figure counts
 * once, so a retry that keeps two of three is an improvement on one that kept
 * none, and every other failure counts as one more.
 *
 * The consequence, which is intended: a retry can trade one failure for another
 * and tie, in which case `app/api/generate/cv/route.ts` keeps the first attempt.
 * It only replaces a CV that got strictly better.
 */
export function gapCount(gaps: CVGaps): number {
  return (
    gaps.droppedFigures.length +
    (gaps.missingEducation ? 1 : 0) +
    gaps.contradictedRequirements.length +
    gaps.retitledRoles.length +
    // Not `copiedBullets`: that one is reported to the person and told to the model when there is a retry anyway, but it is not
    // a reason for one. A real rewrite ("Doy" → "Dicto") counted as a copy, and the retry it set off is a paid call.
    gaps.keywordDumpSections.length +
    gaps.summaryRuleViolations.length +
    // One per term, like `droppedFigures`: a retry that cuts six stray terms to
    // two is a real improvement even though neither count is zero.
    gaps.jargonTerms.length +
    // One per number, for the same reason: a retry that cuts three invented
    // figures to one has improved.
    gaps.inventedFigures.length +
    // One per job (or the summary): a retry that corrects two of three has improved.
    gaps.overclaimedWork.length +
    // One per number, and one per trait: a retry that fixes two of three has improved.
    gaps.droppedApproximations.length +
    gaps.selfAssessedTraits.length
  );
}

/** Below this share of a skills section being one- or two-word lines, it is prose. */
const KEYWORD_DUMP_SHARE = 0.5;
/** Fewer unused terms than this is editorial judgement, not a missed opportunity. */
const UNUSED_KEYWORDS_WORTH_REPORTING = 3;
/**
 * Above this share of a skills section's technology already appearing in the
 * work history, the section is padding rather than a section.
 *
 * Some overlap is correct: the stack a CV leads with should appear in both
 * places. Across 53 real applications the figure was 45%, and on a single-role
 * profile — where the prompt makes the section mandatory to fill the page — it
 * reached 100%, six lines restating six bullets. Set above the corpus average
 * so the normal case does not warn.
 */
const SKILLS_REDUNDANCY_SHARE = 0.6;
/**
 * Openers that concede rather than claim. A recruiter reads "Familiar with
 * Kubernetes" as "has not used Kubernetes", which is worse than the silence it
 * replaced. Both languages, since the output language follows the posting.
 *
 * Exported because tests/eval/score.ts counts the same lines this warns about,
 * and a metric drifting from the check it measures is worse than no metric.
 */
const HEDGED_OPENER =
  /^\s*(familiar\s+with|familiari[sz]ed\s+with|knowledge\s+of|knowledgeable|exposure\s+to|basic\s+|conocimientos?\s+de|conocimientos?\s+b[aá]sicos?|familiaridad\s+con|familiarizad[oa]\s+con|nociones\s+de|manejo\s+b[aá]sico|b[aá]sic[oa]s?\s+)/i;

export function isHedgedSkillLine(line: string): boolean {
  return HEDGED_OPENER.test(line);
}

/**
 * The CV's experience bullets that are the profile's, word for word.
 *
 * Exported for the same reason `figuresAtStake` and `coverageAudit` are: one
 * detection, one owner. `verifyTailoring` below reports it to the user and
 * `cvGaps` spends a retry on it, and those two disagreeing about what counts as
 * copied would be worse than either check missing.
 */
export function verbatimBullets(cv: CVDocument, profile: Profile): string[] {
  const stated = profile.experience.flatMap((job) => job.bullets);
  return experienceBulletsOf(cv).filter((bullet) =>
    stated.some((source) => textOverlap(bullet, source) >= VERBATIM_OVERLAP),
  );
}

function experienceBulletsOf(cv: CVDocument): string[] {
  return cv.sections.flatMap((s) =>
    s.kind === "experience" ? s.items.flatMap((i) => i.bullets) : [],
  );
}

/**
 * Above this share of the CV's bullets being the profile's own, it was not
 * tailored — it was selected. Half rather than any, because keeping one line
 * close to how the candidate wrote it is an editorial decision and a defensible
 * one; keeping most of them is the model skipping the task.
 */
const VERBATIM_SHARE = 0.5;

export function isCopiedRatherThanRewritten(cv: CVDocument, profile: Profile): boolean {
  const bullets = experienceBulletsOf(cv);
  return bullets.length > 0 && verbatimBullets(cv, profile).length >= bullets.length * VERBATIM_SHARE;
}

/** A section whose lines are bare words rather than statements about the work. */
function isKeywordDump(section: CVDocument["sections"][number]): boolean {
  if (section.kind !== "bullets") return false;
  const terse = section.bullets.filter((b) => b.split(/\s+/).filter(Boolean).length <= 2);
  return terse.length >= section.bullets.length * KEYWORD_DUMP_SHARE;
}

/** Titles of the CV's `bullets` sections that are a list of bare words. */
export function keywordDumpSections(cv: CVDocument): string[] {
  return cv.sections
    .filter((section) => isKeywordDump(section) && section.kind === "bullets")
    .map((section) => (section.kind === "bullets" ? section.title : ""));
}

/**
 * Openers the summary is forbidden to use, and did anyway.
 *
 * `BUILD_CV_SYSTEM` has said since it was written that the summary states what
 * the candidate brings, not what they want — "No 'Busco…', no 'Seeking…'". A
 * real run opened "Ingeniero de software full-stack …, buscando un rol de
 * Desarrollador HTML donde pueda aplicar mis habilidades". It reads as an
 * application letter pasted into a CV, and it tells a recruiter the candidate
 * is describing an ambition rather than a history.
 *
 * Nothing checked it, which is the whole pattern this file exists to break: an
 * instruction in a 900-line prompt that nothing measures is a suggestion.
 */
const WANTING_OPENER =
  /(^|[.;,]\s*|\b(?:y|e|and)\s+)(busco|buscando|en\s+busca\s+de|me\s+encuentro\s+buscando|aspiro\s+a|seeking|looking\s+for|i\s+am\s+looking)\b/i;

export function summaryRuleViolations(cv: Pick<CVDocument, "summary">): string[] {
  return WANTING_OPENER.test(cv.summary) ? [cv.summary.trim()] : [];
}

/**
 * What a candidate says of themselves, which nobody can check and every CV has: the same list `BUILD_CV_SYSTEM` forbids by name.
 * In the summary and in the lists of skills —that is where a trait is written as if it were a skill—, never in a job's lines, where
 * «el trabajo en equipo» may be a thing that was done. «Dinámico/a» is not here: it is also what a site or a structure is called.
 * Matched on `normalize`d text, so accents, gender and punctuation do not need variants.
 */
const TRAITS: ReadonlyArray<readonly [label: string, pattern: RegExp]> = [
  ["trabajo en equipo", /\btrabajo en equipo\b/],
  ["proactivo/a", /\bproactiv(?:o|a|os|as|idad)\b/],
  ["buena comunicación", /\b(?:buena|excelente|efectiva) comunicacion\b|\bcomunicacion (?:efectiva|asertiva)\b/],
  ["orientado/a a resultados", /\borientad[oa]s? a (?:los )?resultados\b/],
  ["apasionado/a", /\bapasionad[oa]s?\b/],
  ["sinergia", /\bsinergia\b|\bsynergy\b/],
  ["team player", /\bteam players?\b|\bteamwork\b/],
  ["detail-oriented", /\bdetail oriented\b/],
  ["results-driven", /\bresults (?:driven|oriented)\b/],
  ["passionate", /\bpassionate\b/],
];

const traitProse = (cv: CVDocument) => cvProse(cv).filter((entry) => entry.kind === "summary" || entry.kind === "bullets");

/** The traits the summary or a skills list says, once each. */
export function selfAssessedTraits(cv: CVDocument): string[] {
  const prose = traitProse(cv).map((entry) => normalize(entry.text));
  return TRAITS.filter(([, pattern]) => prose.some((text) => pattern.test(text))).map(([label]) => label);
}

function verifyTraits(cv: CVDocument): Finding[] {
  return TRAITS.flatMap(([label, pattern]) => {
    const where = traitProse(cv).find((entry) => pattern.test(normalize(entry.text)));
    return where
      ? [{ severity: "warning" as const, field: where.field, detail: `El CV dice «${label}» de vos: lo escribe cualquiera y nadie puede comprobarlo. Mostralo con un hecho de tu perfil o sacalo.` }]
      : [];
  });
}

/** A job's line that opens on what the person was, not on what they did: «Responsable de…», «Encargado/a de…», «A cargo de…». */
const BY_ROLE_OPENER = /^(?:responsable|encargad[oa]|a cargo) de\b|^responsible for\b/;

/** A skill the person marked as basic stays in the profile and out of the CV: it is how they said they know it. */
function verifyBasicSkills(cv: CVDocument, profile: Profile): Finding[] {
  const basic = Object.entries(profile.skillLevels).flatMap(([skill, level]) => (level === "basic" ? [skill] : []));
  return basic.flatMap((skill) => {
    const where = cvProse(cv).find((entry) => entry.kind === "bullets" && mentionsSkill([entry.text], skill));
    return where ? [{ severity: "warning" as const, field: where.field, detail: `El CV lista «${skill}», que marcaste como básica en tu perfil. Sacala de esa línea o cambiale el nivel.` }] : [];
  });
}

function verifyOpeners(cv: CVDocument): Finding[] {
  return cvProse(cv)
    .filter((entry) => entry.kind === "experience" && BY_ROLE_OPENER.test(normalize(entry.text)))
    .map((entry) => ({
      severity: "warning" as const,
      field: entry.field,
      detail: `Una línea abre con «${entry.text.split(/\s+/).slice(0, 3).join(" ")}…»: dice lo que eras, no lo que hiciste. Abrila con el verbo de lo que hiciste.`,
    }));
}

/**
 * The vocabulary of a job ad rather than a claim about the person: words every posting uses and no profile needs to state.
 * Without them the check below says «producto» and «funcionalidades» on every CV. Normalised stems, so that «desarrollo»,
 * «desarrollar» and «desarrollador» are one entry; calibrated against `tests/eval/` (see `postingBorrowings`).
 */
const POSTING_BOILERPLATE = [
  "desarroll", "calidad", "solid", "equipo", "tecnic", "tecnolog", "continu", "herramient", "usuari", "garantiz", "asegur",
  "problema", "colabor", "buena", "excelente", "comunicac", "junto", "relacionad", "formaci", "producto", "proyecto",
  "funcionalidad", "ingenieri", "estandar", "requerimient", "informaci", "objetivo", "necesidad", "mejor", "aprend",
  "existente", "codigo", "facilit", "habilidad", "propia", "dentro", "antes", "activamente", "brind", "alcanz", "concepto", "contexto", "manejo",
];

/** Letters two forms of a word share to count as the same word: «escalable» and «escalabilidad», «productivos» and «producción». */
const STEM = 6;

export type PostingBorrowing = { field: string; words: string[] };

/**
 * Lines of the CV that use words of the posting's ask which the profile never says: the detail the model took from the ad and
 * put in the person's mouth («celulares de gama baja», a task with a tool nobody used). `findUnsupportedTerms` cannot see these
 * —they are ordinary words— and matching a line against the profile line by line is not reliable (see `verifyAuthorship`), so
 * this asks the smaller question: which words of this line are the ad's and not the person's.
 *
 * The title is left out of the ad's words, because a summary may name the role it is for. Skipped when the profile is written
 * in another language than the CV, where every word would read as borrowed.
 *
 * Calibrated against 127 saved applications of one profile (`tests/eval/`, `borrowedLines`): 61 are in the profile's language
 * and checkable, and of their 832 lines 85 (10%) are flagged, 1.4 per CV and never more than 5; 26 of the 61 CVs have none. Read
 * by hand, about 7 in 10 of a sample of 31 flagged lines were a detail the profile does not give (a task, a domain, a tool the
 * glossary lacks). The rest were the profile's own idea in other words («control de versiones» for Git). Without the stem test
 * and the boilerplate list the same corpus flags 21%, mostly «desarrollo», «calidad» and «equipos».
 */
export function postingBorrowings(
  cv: CVDocument,
  profile: Profile,
  analysis: Partial<Pick<JobAnalysis, "keywords" | "requirements" | "responsibilities">>,
): PostingBorrowing[] {
  const borrowed = borrowedFrom(profile, analysis, cv.language);
  // What the summary claims as experience is said once, as the error it is (`summaryDomainClaims`), and not again here.
  const claimed = new Set(summaryDomainClaims(cv, profile, analysis));
  return cvProse(cv)
    .filter((entry) => entry.kind !== "pairs")
    .flatMap(({ field, text, kind }) => {
      // The summary may name the job it is for (`TARGET_CUE`): that stretch alone is the posting's by right, and the rest of the
      // summary is read like any other line — the same word outside it is still the ad's.
      const words = kind === "summary" ? borrowed(withoutTargets(text), text).filter((word) => !claimed.has(word)) : borrowed(text);
      return words.length ? [{ field, words }] : [];
    });
}

/**
 * The words of the posting's ask a text uses and the profile never says: the one rule `postingBorrowings` and `summaryDomainClaims`
 * share, so that what counts as borrowed cannot drift between them. Nothing when the posting asked nothing, or when the profile is written in
 * another language than the CV, where every word would read as borrowed. `original` is the text the tools are read from, when `text` is a
 * cut of it.
 */
function borrowedFrom(
  profile: Profile,
  analysis: Partial<Pick<JobAnalysis, "keywords" | "requirements" | "responsibilities">>,
  language: string,
): (text: string, original?: string) => string[] {
  const asked = new Set(
    [...(analysis.keywords ?? []), ...(analysis.requirements ?? []).map((r) => r.text), ...(analysis.responsibilities ?? [])].flatMap(contentWords),
  );
  const written = documentLanguage(evidenceTextsFrom(profile));
  if (asked.size === 0 || (written && written !== language.trim().toLowerCase().slice(0, 2))) return () => [];

  const evidence = buildEvidenceIndex(profile);
  const profileWords = evidence.haystack.split(/[\s|]+/).filter(Boolean);
  // «producción» is the profile's «productivos», and «seguro» its «segura»: the same word in another form is not the ad's.
  const inProfile = (word: string) => profileWords.some((profileWord) => profileWord.startsWith(word.slice(0, Math.min(STEM, word.length - 1))));
  return (text, original = text) => {
    // A named tool the profile lacks is already an error of its own; saying it twice is noise.
    const tools = new Set(hardTermsIn(original).flatMap((term) => normalize(term).split(" ")));
    return [...new Set(contentWords(text))].filter(
      (word) => asked.has(word) && !tools.has(word) && !POSTING_BOILERPLATE.some((stem) => word.startsWith(stem)) && !supports(evidence, word) && !inProfile(word),
    );
  };
}

/** Lower case and no accents, with the punctuation kept: where a stretch of words ends is read off it. */
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ");

/** The job a summary is for: «para un rol mobile…», «for a mobile role…». It names the posting, and is not a claim about the candidate. */
const TARGET_CUE = /\bpara (?:(?:un|una|el|la) )?(?:rol|roles|puesto|puestos|posicion|posiciones|cargo)\b|\bfor (?:(?:an?|the) )?(?:[a-z-]+ ){0,4}?(?:role|roles|position|positions)\b/g;
/** What says the candidate has done it: «experiencia en…», «especialista en…», «orientado a…». */
const CLAIM_CUE = /\b(?:experiencia en|experto en|experta en|especialista en|trayectoria en|orientad[oa]s? a|experience (?:in|with)|specialist in|expert in|background in)\b/g;
/** A word that opens another clause, and so ends the one before it. */
const CLAUSE_OPENER = new Set(["con", "donde", "que", "y", "e", "aplicando", "aportando", "with", "where", "that", "and", "bringing", "applying"]);
/** At most this many words after the cue belong to it: a stretch longer than that is a sentence of its own, and is read as one. */
const GOVERNED_WORDS = 6;

/**
 * The stretches of a text a cue governs, folded (`fold`): from the cue to the first sign, the first word that opens another clause, or
 * `GOVERNED_WORDS` words after it, whichever comes first. Narrow on purpose — what follows a comma or a «con» is another claim, and is read.
 */
function governedStretches(text: string, cue: RegExp): string[] {
  const folded = fold(text);
  return [...folded.matchAll(cue)].map((match) => {
    const rest = folded.slice(match.index + match[0].length).split(/[,.;:()\u2013\u2014]/)[0]!.split(/\s+/).filter(Boolean);
    const end = rest.findIndex((word) => CLAUSE_OPENER.has(word));
    return [match[0], ...rest.slice(0, Math.min(end < 0 ? rest.length : end, GOVERNED_WORDS))].join(" ");
  });
}

/** The summary without the stretches that name the job it is for, folded: what is left is read like any other line. */
function withoutTargets(text: string): string {
  return governedStretches(text, TARGET_CUE).reduce((rest, stretch) => rest.replace(stretch, " . "), fold(text));
}

/**
 * Words of the posting the summary hands the candidate as experience, and the profile never states: «con experiencia en fintech»,
 * «especialista en pagos». The posting's field describes the job; written after one of those words, it is a claim about a past the person
 * did not have — the one way naming the kind of role (PRM-6) turns into an invention. Only the stretch the claim governs is read
 * (`governedStretches`), and the words are the same ones `postingBorrowings` would call borrowed.
 */
export function summaryDomainClaims(
  cv: Pick<CVDocument, "summary" | "language">,
  profile: Profile,
  analysis: Partial<Pick<JobAnalysis, "keywords" | "requirements" | "responsibilities">>,
): string[] {
  const borrowed = borrowedFrom(profile, analysis, cv.language);
  return [...new Set(governedStretches(cv.summary, CLAIM_CUE).flatMap((stretch) => borrowed(stretch, cv.summary)))];
}

/** The word as the line writes it, with its accent: `contentWords` returns it folded. */
const asWritten = (text: string, word: string) => text.split(/\s+/).find((token) => normalize(token) === word)?.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "") ?? word;

function verifyPostingDetails(cv: CVDocument, profile: Profile, analysis: Parameters<typeof postingBorrowings>[2]): Finding[] {
  const lines = new Map(cvProse(cv).map((entry) => [entry.field, entry.text]));
  const claimed = summaryDomainClaims(cv, profile, analysis).map((word) => `«${asWritten(cv.summary, word)}»`);
  // An error, and not a retry: the person reads it in the confirmation before downloading (`ReviewGate`), and decides.
  const claims: Finding[] = claimed.length
    ? [{ severity: "error", field: "summary", detail: `El resumen dice que tenés experiencia en ${claimed.join(", ")}; tu perfil no lo dice. Sacalo, o cargalo en tu perfil si es así.` }]
    : [];
  return [...claims, ...postingBorrowings(cv, profile, analysis).map(({ field, words }) => {
    const shown = words.slice(0, 4).map((word) => `«${asWritten(lines.get(field) ?? "", word)}»`);
    return {
      severity: "warning" as const,
      field,
      detail: `Revisá: ${shown.join(", ")} ${shown.length === 1 ? "sale" : "salen"} del aviso, no de tu perfil. Dejalo solo si lo hiciste.`,
    };
  })];
}

/**
 * Whether the CV was tailored at all — the one question every other check here
 * is blind to.
 *
 * The rest of this file asks whether the CV overreached: invented a technology,
 * a company, a year, a level of seniority. A CV assembled by copying the
 * profile's own lines across passes all of it perfectly, and is not a tailored
 * CV. That is not hypothetical either: a run for a Python role came back with
 * the profile's ABOUT paragraph as its summary, every bullet verbatim in the
 * profile's own order, and a skills section of eight single words lifted from
 * the posting — honest, schema-valid, and worse than useless, because the
 * summary opened by naming a stack the posting had not asked for.
 *
 * All warnings. Each is a judgement about fit, and whether to send it anyway is
 * the candidate's call, not this function's.
 */
function verifyTailoring(
  cv: CVDocument,
  profile: Profile,
  analysis?: Pick<JobAnalysis, "keywords" | "requirements">,
): Finding[] {
  const findings: Finding[] = [];

  if (profile.about && textOverlap(cv.summary, profile.about) >= VERBATIM_OVERLAP) {
    findings.push({
      severity: "warning",
      field: "summary",
      detail:
        "El resumen es el texto de tu perfil sin adaptar al aviso. Volvé a generar para que hable de este puesto.",
    });
  }

  const experienceBullets = experienceBulletsOf(cv);
  if (isCopiedRatherThanRewritten(cv, profile)) {
    const copied = verbatimBullets(cv, profile);
    findings.push({
      severity: "warning",
      field: "sections",
      detail: `${copied.length} de ${experienceBullets.length} logros están copiados de tu perfil sin reescribir para este aviso.`,
    });
  }

  if (summaryRuleViolations(cv).length > 0) {
    findings.push({
      severity: "warning",
      field: "summary",
      detail:
        "El resumen dice lo que buscás en lugar de lo que traés. Un CV se lee al revés: primero lo que hiciste.",
    });
  }

  // Measured over the profile's own tag vocabulary rather than over words:
  // "Docker" appearing twice is the finding, "and" appearing twice is not.
  const experienceIndex = buildIndexFrom(experienceBullets);
  const tags = [...new Set(profile.experience.flatMap((job) => job.tags))].filter(
    (tag) => tag.length > 2,
  );

  for (const [s, section] of cv.sections.entries()) {
    if (section.kind !== "bullets") continue;

    if (isKeywordDump(section)) {
      findings.push({
        severity: "warning",
        field: `sections[${s}]`,
        detail: `«${section.title}» es una lista de palabras sueltas. Agrupalas en frases que digan dónde usaste cada cosa.`,
      });
    }

    const sectionIndex = buildIndexFrom(section.bullets);
    const named = tags.filter((tag) => supports(sectionIndex, tag));
    const repeated = named.filter((tag) => supports(experienceIndex, tag));
    if (named.length > 0 && repeated.length >= named.length * SKILLS_REDUNDANCY_SHARE) {
      findings.push({
        severity: "warning",
        field: `sections[${s}]`,
        detail: `«${section.title}» repite lo que ya dicen tus logros (${repeated.slice(0, 5).join(", ")}${repeated.length > 5 ? " y más" : ""}). Esa parte de la hoja se está gastando dos veces en lo mismo.`,
      });
    }

    const hedged = section.bullets.filter((b) => HEDGED_OPENER.test(b));
    if (hedged.length > 0) {
      findings.push({
        severity: "warning",
        field: `sections[${s}]`,
        detail: `${hedged.length === 1 ? "Una línea" : `${hedged.length} líneas`} de «${section.title}» ${hedged.length === 1 ? "arranca" : "arrancan"} con una concesión («Familiar with», «Conocimiento de»). Quien lee entiende que no lo tenés. Afirmalo o sacalo.`,
      });
    }
  }

  if (!analysis) return findings;

  // Terms the profile genuinely supports and the posting asks for, that never
  // made it into the CV. Not fabrication — the opposite: evidence left on the
  // table, which is what an ATS filters on.
  const cvIndex = buildIndexFrom(cvProse(cv).map((p) => p.text));
  const { supported } = matchKeywords(buildEvidenceIndex(profile), analysis.keywords);
  const unused = supported.filter((keyword) => !supports(cvIndex, keyword));
  if (unused.length >= UNUSED_KEYWORDS_WORTH_REPORTING) {
    findings.push({
      severity: "warning",
      field: "sections",
      detail: `El aviso pide ${unused.slice(0, 6).join(", ")}${unused.length > 6 ? " y otras" : ""} y tu perfil lo respalda, pero el CV no lo menciona.`,
    });
  }

  const asked = Math.max(
    0,
    ...analysis.requirements.map((r) => Number(normalize(r.text).match(EXPLICIT_YEARS)?.[1] ?? 0)),
  );
  const has = statedYearsOfExperience(profile);
  if (asked > 0 && has > 0 && asked > has) {
    findings.push({
      severity: "warning",
      field: "summary",
      detail: `El aviso pide ${asked} años de experiencia; tus fechas suman ${has}. No es motivo para no postular, pero tenelo presente.`,
    });
  }

  return findings;
}

/**
 * How many stray technology terms are worth a warning. One is a slip; a handful
 * is the CV still being a software CV.
 */
const JARGON_WORTH_REPORTING = 2;

/**
 * How many are worth a retry. Higher than the warning threshold above: two
 * terms is an editorial call `gapCorrection` should not spend a second paid
 * generation arguing about, the same reasoning `isWorthRetryingFor` applies to
 * figures.
 */
const JARGON_WORTH_RETRYING = 3;

/**
 * The analysis fields the jargon check needs. `keywords`, `requirements` and
 * `responsibilities` are read for the exemption below; `title` and `domain`
 * join them because `buildJobIndex`-style posting indices elsewhere in this
 * file are built from all five. Optional because `verifyCV` and `cvGaps` are
 * called from places that do not always have a full `JobAnalysis` to hand.
 */
type JargonAnalysis = { relevance: Relevance } & Partial<
  Pick<JobAnalysis, "title" | "domain" | "keywords" | "requirements" | "responsibilities">
>;

/**
 * Technology the CV names on a job outside the candidate's field, that this
 * posting never asked about.
 *
 * Every other check here asks whether a claim is true. These are true, which is
 * exactly why nothing caught them: `STRATEGIES.unrelated` opens with "STRIP THE
 * JARGON. Never list frameworks, languages or tools. They mean nothing here and
 * read as overqualification, which costs interviews" — and a CV generated for a
 * groundskeeping vacancy came back naming Linux servers, firewalls, DNS, SSL/TLS,
 * RustDesk and TeamViewer.
 *
 * Shared by `verifyJargon` (which only warns) and `cvGaps` (which retries past
 * `JARGON_WORTH_RETRYING`), so the two never disagree about what counts —
 * `cvGaps`'s own docstring warns about exactly that drift.
 */
export function jargonTermsIn(
  cv: CVDocument,
  profile: Profile,
  analysis?: JargonAnalysis,
): string[] {
  if (analysis?.relevance !== "unrelated") return [];

  const evidence = buildEvidenceIndex(profile);
  /**
   * The practical facts are the one thing `STRATEGIES.unrelated` explicitly wants
   * ON this CV — "licence, vehicle and stated availability are frequently the
   * deciding factors". A driving licence class is also two capitals and a digit,
   * so the acronym pass reads "B1" as a technology and this reported the
   * candidate's licence as jargon to strip.
   */
  const practical = buildIndexFrom([
    profile.practical.availability,
    profile.practical.driverLicense,
    profile.practical.workEligibility,
  ]);
  /**
   * A term this posting itself asks for is not jargon here, even outside the
   * candidate's field: a field-technician posting naming "redes" or "cableado
   * estructurado" is a case where the candidate's networking background is the
   * job, not overqualification for it. `serializeJargonBan` in `build-cv.ts`
   * exempts the same terms from the ban it hands the model, so the ban, this
   * warning and the retry below all agree on what counts.
   */
  const posting = buildIndexFrom([
    analysis.title ?? "",
    analysis.domain ?? "",
    ...(analysis.keywords ?? []),
    ...(analysis.requirements ?? []).map((r) => r.text),
    ...(analysis.responsibilities ?? []),
  ]);

  const found = new Set<string>();
  for (const { text } of cvProse(cv)) {
    for (const term of statedHardTerms(text, evidence)) {
      if (!supports(practical, term) && !supports(posting, term)) found.add(term);
    }
  }

  return [...found];
}

/**
 * A warning, not an error: the candidate is entitled to send it, and the terms
 * are theirs. What they need to know is that the page is still speaking the wrong
 * language for the person reading it.
 */
export function verifyJargon(
  cv: CVDocument,
  profile: Profile,
  analysis?: JargonAnalysis,
): Finding[] {
  const terms = jargonTermsIn(cv, profile, analysis);
  if (terms.length < JARGON_WORTH_REPORTING) return [];

  return [
    {
      severity: "warning",
      field: "sections",
      detail:
        `Este puesto está fuera de tu rubro y el CV sigue nombrando ${terms.slice(0, 6).join(", ")}` +
        `${terms.length > 6 ? " y más" : ""}. Son cosas tuyas, pero para quien lee este aviso no ` +
        `dicen nada y suenan a que el puesto te queda chico.`,
    },
  ];
}

export function verifyCV(
  cv: CVDocument,
  profile: Profile,
  /**
   * `relevance` decides whether a missing section is legitimate; `keywords` and
   * `requirements` drive the tailoring checks; `title` and `domain` join them
   * so `verifyJargon` can exempt terms this posting itself asks for. All
   * optional so a caller with only the relevance to hand still gets everything
   * that does not need them.
   */
  analysis?: { relevance: Relevance } &
    Partial<Pick<JobAnalysis, "title" | "domain" | "keywords" | "requirements" | "responsibilities">>,
): Finding[] {
  const findings: Finding[] = [];
  const evidence = buildEvidenceIndex(profile);

  findings.push(...verifyCompleteness(cv, profile, analysis));
  findings.push(...verifyFigures(cv, profile, analysis));
  findings.push(...inventedFindings(inventedFigures(cv, profile, analysis)));
  findings.push(...verifyApproximations(cv, profile));
  findings.push(...verifyVagueQuantities(cv, profile, analysis));
  findings.push(...verifyTraits(cv));
  findings.push(...verifyOpeners(cv));
  findings.push(...verifyBasicSkills(cv, profile));
  findings.push(...verifyRoleTitles(cv, profile));
  findings.push(...verifyAuthorship(cv, profile));
  findings.push(...verifyPairs(cv, profile));
  findings.push(...verifyJargon(cv, profile, analysis));
  if (analysis) findings.push(...verifyPostingDetails(cv, profile, analysis));
  if (analysis?.requirements) {
    findings.push(
      ...verifyCoverage(cv, {
        requirements: analysis.requirements,
        responsibilities: analysis.responsibilities ?? [],
      }),
    );
  }
  findings.push(
    ...verifyTailoring(
      cv,
      profile,
      analysis?.keywords && analysis.requirements
        ? { keywords: analysis.keywords, requirements: analysis.requirements }
        : undefined,
    ),
  );

  // Technologies, services and architecture patterns the profile never states.
  // This is the failure mode the honesty rules lose to most often: told to
  // mirror a posting that asks for Clean Architecture and CQRS, the model
  // writes them in regardless of whether the candidate has ever touched them.
  for (const { field, text } of cvProse(cv)) {
    for (const term of findUnsupportedTerms(text, evidence)) {
      findings.push({
        severity: "error",
        field,
        detail: `El CV menciona «${term}», que no figura en tu perfil. Sacalo o agregalo al perfil si lo usaste.`,
      });
    }
  }

  // Seniority the dates do not support.
  const summary = normalize(cv.summary);
  const stated = statedYearsOfExperience(profile);
  const claimed = Number(summary.match(EXPLICIT_YEARS)?.[1] ?? 0);

  if (stated > 0 && claimed > stated) {
    findings.push({
      severity: "error",
      field: "summary",
      detail: `El resumen dice ${claimed} años de experiencia; tus fechas suman ${stated}.`,
    });
  } else if (stated > 0 && stated < VAGUE_SENIORITY_IMPLIES_YEARS && VAGUE_SENIORITY.test(summary)) {
    findings.push({
      severity: "warning",
      field: "summary",
      detail: `El resumen sugiere una trayectoria larga, pero tus fechas suman ${stated} ${stated === 1 ? "año" : "años"}.`,
    });
  }

  const knownCompanies = profile.experience.map((e) => e.company).filter(Boolean);
  const knownInstitutions = profile.education.map((e) => e.institution).filter(Boolean);
  const knownProjects = profile.projects.map((p) => p.name).filter(Boolean);

  // Every year the profile mentions anywhere, so a reframed date is not flagged.
  const knownYears = new Set<string>();
  for (const e of profile.experience) {
    years(`${e.start} ${e.end}`).forEach((y) => knownYears.add(y));
  }
  for (const e of profile.education) years(`${e.start} ${e.end}`).forEach((y) => knownYears.add(y));
  for (const c of profile.certifications) years(c.date).forEach((y) => knownYears.add(y));

  for (const [sectionIndex, section] of cv.sections.entries()) {
    if (section.kind === "experience") {
      for (const [itemIndex, item] of section.items.entries()) {
        const where = `sections[${sectionIndex}].items[${itemIndex}]`;

        if (!matchesKnown(item.company, knownCompanies)) {
          // A project is the profile's own and has its section; it is no employer, and a job that is one is the
          // projects-as-experience padding this check exists to catch, so it is said apart from a stranger.
          findings.push({
            severity: "error",
            field: `${where}.company`,
            detail: matchesKnown(item.company, knownProjects)
              ? `«${item.company}» es un proyecto, no un puesto.`
              : `El CV menciona «${item.company}», que no figura en tu perfil.`,
          });
        }

        for (const year of years(item.dateRange)) {
          if (!knownYears.has(year)) {
            findings.push({
              severity: "warning",
              field: `${where}.dateRange`,
              detail: `La fecha «${item.dateRange}» usa el año ${year}, que no aparece en tu perfil.`,
            });
          }
        }
      }
    }

    if (section.kind === "education") {
      for (const [itemIndex, item] of section.items.entries()) {
        const where = `sections[${sectionIndex}].items[${itemIndex}]`;

        if (!matchesKnown(item.institution, knownInstitutions)) {
          findings.push({
            severity: "error",
            field: `${where}.institution`,
            detail: `El CV menciona «${item.institution}», que no figura en tu formación.`,
          });
        }

        for (const year of years(item.date)) {
          if (!knownYears.has(year)) {
            findings.push({
              severity: "warning",
              field: `${where}.date`,
              detail: `La fecha «${item.date}» usa el año ${year}, que no aparece en tu perfil.`,
            });
          }
        }
      }
    }
  }

  // The header is copied from the profile verbatim; a mismatch means the model
  // edited fields it was told not to touch.
  if (profile.email && cv.header.email && normalizeContact(cv.header.email) !== normalizeContact(profile.email)) {
    findings.push({
      severity: "error",
      field: "header.email",
      detail: `El email del CV («${cv.header.email}») no coincide con el de tu perfil.`,
    });
  }
  if (profile.phone && cv.header.phone && normalizeContact(cv.header.phone) !== normalizeContact(profile.phone)) {
    findings.push({
      severity: "warning",
      field: "header.phone",
      detail: `El teléfono del CV («${cv.header.phone}») no coincide con el de tu perfil.`,
    });
  }

  return findings;
}


// --- Application form answers -------------------------------------------------

/**
 * The answers are checked for the opposite failure to the CV's.
 *
 * A CV overclaims: `verifyCV` above exists because a model told to mirror a
 * posting writes in a technology the candidate never touched. The answers
 * underclaim, and for a reason that is structural rather than random — the
 * honesty rules are the highest-priority text in that prompt and almost nothing
 * balances them, so the model reads a form question as an invitation to
 * disclaim. The case this was built for: a profile holding React, TypeScript and
 * Node since May 2024 answered "I have 0 years of formal experience in that
 * stack as a specific combination", which is false by two years and signed by
 * the user.
 *
 * So `findUnsupportedTerms` runs here too — the answers can still fabricate —
 * but everything else asks whether the answer sold the candidate short.
 */

/** A number of years as an answer states it: "2", "2 años", "2+ years", "0". */
const ANSWERED_YEARS = /^(\d{1,2})\s*\+?\s*(anos|anios|years)?$/;

/** Wording that means "none" without writing a digit. */
const ANSWERED_NONE = /^(0|cero|zero|ninguno|ninguna|nada|none|no|n a|na)$/;

/** A question about how long, as opposed to one that merely mentions a year. */
const ASKS_HOW_LONG = /\b(anos|anios|years)\b|cuanto tiempo|how long|que experiencia|how much experience/;

/** An answer that opens by conceding rather than by answering. */
const NEGATIVE_OPENER =
  /^(no\b|nunca\b|tengo 0\b|tengo cero\b|actualmente no\b|lamentablemente\b|desafortunadamente\b|unfortunately\b|never\b|i have no\b|i have 0\b|i do not\b|i don t\b)/;

/**
 * Qualifiers that take a true answer back. Each of these appeared in, or is the
 * direct sibling of, the answer this check was written for: the candidate has
 * the experience, says so, and then argues themselves out of it in the same
 * sentence.
 */
const SELF_DEFEATING =
  /(no en el mismo|de manera simultanea|simultaneamente|en simultaneo|experiencia formal|formalmente no|de forma formal|como combinacion|not in the same|not simultaneously|not at the same time|as a specific combination|formal experience)/;

/** Marks a clause as a denial rather than a claim. */
const DENIAL = /\b(no|nunca|tampoco|not|never|without|sin)\b/;

/**
 * Contrastive conjunctions — the seam between a clause's own claim and one
 * that reverses or narrows it.
 *
 * "Pero"/"but" is what actually separates "no version details" from "my stack
 * includes Angular" in one comma-joined, period-free sentence: the model wrote
 * one sentence with two independent claims, and only the first is a denial. A
 * comma does not do this job — see `clauses` below for why it is deliberately
 * not a boundary — but a contrastive conjunction is a stronger, unambiguous
 * signal: its entire grammatical function is to hand off from one claim to a
 * different, often opposite, one, so it never sits mid-denial the way a comma
 * pause does.
 *
 * "sin embargo" and "no obstante" are listed as full phrases, not left to the
 * words they are built from: bare "sin" and "no" are `DENIAL`'s own words, and
 * both phrases contain one as a substring word ("sin embargo" starts with
 * "sin"; "no obstante" starts with "no") despite meaning "however" /
 * "nevertheless" — the opposite of a denial. Splitting on the whole phrase
 * removes it before `DENIAL` ever sees the word it was built from.
 */
const CONTRAST = /\b(?:sin embargo|no obstante|pero|aunque|however|although|but|yet)\b/gi;

/**
 * The answer split into the units a claim can live in.
 *
 * Commas are deliberately not separators: "No, no trabajé con Kubernetes" is one
 * denial, and splitting on the comma would leave "no trabaje con Kubernetes"
 * intact but strand a bare "No" that settles nothing. A contrastive conjunction
 * (`CONTRAST`) is the boundary a comma is not: it marks the one place a clause
 * reliably hands off to an independent, unrelated-in-polarity claim, so
 * `DENIAL` and `hardTermsIn` must not read across it — otherwise a term
 * affirmed after "pero"/"but" gets misread as denied by a "no" that governs
 * the clause before it, or a fabrication before "pero, no ..." gets masked by
 * the unrelated denial after it.
 */
function clauses(text: string): string[] {
  return text
    .split(/[.;!?\n]+/)
    .flatMap((sentence) => sentence.split(CONTRAST))
    .filter((clause) => clause.trim().length > 0);
}

/**
 * One problem with one answer, in both the dialects it has to be said in:
 * `detail` is what the user reads, `correction` is what the model is told on a
 * retry. Produced together so the panel and the second attempt cannot describe
 * the same defect differently — the drift `verifyCV` and `cvGaps` avoid by
 * sharing `figuresAtStake`.
 */
export type AnswerProblemKind =
  /** A figure below what the profile's own dates support. The reported bug. */
  | "understated"
  /** A technology claimed that the profile never states. The CV's failure mode. */
  | "fabricated"
  /** Opened on the gap when there was something to lead with. */
  | "negative-opener"
  /** A qualifier that takes a true answer back. */
  | "self-defeating"
  /** Denies something the CV asserts, to the same reader. */
  | "cv-contradiction";

export type AnswerProblem = {
  index: number;
  kind: AnswerProblemKind;
  severity: "error" | "warning";
  field: string;
  detail: string;
  /** Present on errors only: the ones a second attempt can actually fix. */
  correction?: string;
};

export type AnswerAuditInput = {
  answers: Answers;
  profile: Profile;
  cv?: CVDocument;
  keywords?: readonly string[];
  now?: Date;
};

const spanishYears = (months: number) => {
  const years = Math.floor(months / 12);
  if (years >= 1) return `${years} ${years === 1 ? "año" : "años"}`;
  return `${months} ${months === 1 ? "mes" : "meses"}`;
};

/** The tenures whose term this question actually names. */
function tenuresAsked(question: string, facts: ExperienceFacts) {
  const asked = new Set(hardTermsIn(question).map(normalize));
  return facts.tenures.filter((tenure) => asked.has(normalize(tenure.term)));
}

/**
 * The shortest tenure this answer may honestly claim, in months.
 *
 * The maximum across the technologies the question names, not the intersection.
 * A question naming three tools asks about three tools; treating it as one
 * question about their co-occurrence is the misreading that produced the zero.
 */
function flooredMonths(question: string, facts: ExperienceFacts): number {
  const asked = tenuresAsked(question, facts).filter((t) => t.dated);
  if (asked.length) return Math.max(...asked.map((t) => t.months));
  return ASKS_HOW_LONG.test(normalize(question)) && facts.dated ? facts.totalMonths : 0;
}

export function auditAnswers(input: AnswerAuditInput): AnswerProblem[] {
  const { answers, profile, cv, keywords = [], now } = input;

  const questions = answers.answers.map((a) => a.question);
  const facts = experienceFacts({ profile, questions, keywords, now });
  const evidence = buildEvidenceIndex(profile);
  const cvIndex = cv ? buildIndexFrom(cvProse(cv).map((p) => p.text)) : null;

  const problems: AnswerProblem[] = [];

  for (const [index, entry] of answers.answers.entries()) {
    const at = (suffix: string) => `answers[${index}].${suffix}`;
    const push = (p: Omit<AnswerProblem, "index">) => problems.push({ index, ...p });

    const short = normalize(entry.shortAnswer);
    const answer = normalize(entry.answer);
    const floor = flooredMonths(entry.question, facts);
    const owed = Math.floor(floor / 12);
    const asked = tenuresAsked(entry.question, facts);

    // The reported bug, caught in code: the profile's own dates back this
    // answer and the answer says there is nothing.
    if (floor > 0 && (ANSWERED_NONE.test(short) || /\b(0|cero|zero)\s*(anos|anios|years)\b/.test(answer))) {
      push({
        kind: "understated",
        severity: "error",
        field: at("shortAnswer"),
        detail: `Esta respuesta dice que no tenés experiencia, pero tus fechas respaldan ${spanishYears(floor)}.`,
        correction:
          `You answered this as if the candidate had no experience. The profile's dates back ` +
          `${Math.max(1, owed)} year(s) — ${floor} months. ` +
          (asked.length
            ? `Each technology counts on its own: ${asked
                .map((t) => `${t.term} (${t.months} months)`)
                .join(", ")}. The question does not ask whether they were ever used together.`
            : `Answer with that number.`),
      });
    } else {
      // A number that is merely low. Rounding down is required; rounding to
      // less than the dates support is not.
      const claimed = short.match(ANSWERED_YEARS)?.[1] ?? answer.match(EXPLICIT_YEARS)?.[1];
      if (owed > 0 && claimed !== undefined && Number(claimed) < owed) {
        push({
          kind: "understated",
          severity: "error",
          field: at("shortAnswer"),
          detail: `Esta respuesta dice ${claimed} años; tus fechas respaldan ${owed}.`,
          correction:
            `You answered "${claimed}" where the profile's dates support ${owed} years ` +
            `(${floor} months). Use the computed figure.`,
        });
      }
    }

    /**
     * The CV's own fabrication check, run over the answers — they reach the
     * same reader — but only over the clauses that assert something.
     *
     * A CV never denies anything, so `verifyCV` can treat every named
     * technology as a claim. An answer's whole job is sometimes to deny one:
     * the system prompt tells the model to say plainly that the candidate does
     * not have X, and reading "no trabajé con Kubernetes" as a claim to
     * Kubernetes would flag every honest "no" in the set as a fabrication.
     */
    for (const clause of clauses(entry.answer)) {
      if (DENIAL.test(normalize(clause))) continue;
      for (const term of findUnsupportedTerms(clause, evidence)) {
        push({
          kind: "fabricated",
          severity: "error",
          field: at("answer"),
          detail: `Esta respuesta menciona «${term}», que no figura en tu perfil.`,
          correction: `Your answer claimed "${term}", which the profile never states. Remove it.`,
        });
      }
    }

    // Only where there was something better to open with. A plain "No" to
    // "do you have a driving licence?" is the right answer, not a defect.
    if (asked.length > 0 && NEGATIVE_OPENER.test(answer)) {
      push({
        kind: "negative-opener",
        severity: "warning",
        field: at("answer"),
        detail: `Esta respuesta abre por lo que te falta, teniendo ${asked
          .map((t) => t.term)
          .join(", ")} en tu perfil. Empezá por eso.`,
      });
    }

    if (asked.length > 0 && SELF_DEFEATING.test(answer)) {
      push({
        kind: "self-defeating",
        severity: "warning",
        field: at("answer"),
        detail:
          "Esta respuesta agrega un reparo que nadie preguntó y que te resta. " +
          "Revisá si aporta algo o si conviene sacarlo.",
      });
    }

    // A denial of something the CV asserts. The two documents are read by the
    // same person, and this is the pair that costs the interview.
    if (cvIndex) {
      for (const clause of clauses(entry.answer)) {
        if (!DENIAL.test(normalize(clause))) continue;
        for (const term of hardTermsIn(clause)) {
          if (!supports(cvIndex, term)) continue;
          push({
            kind: "cv-contradiction",
            severity: "warning",
            field: at("answer"),
            detail: `Esta respuesta niega «${term}», que tu CV sí afirma. Los lee la misma persona.`,
          });
        }
      }
    }
  }

  return problems;
}

/** The audit as the findings panel shows it. */
export function verifyAnswers(input: AnswerAuditInput): Finding[] {
  return auditAnswers(input).map(({ severity, field, detail }) => ({ severity, field, detail }));
}

/** What a second attempt is told, mirroring `CVGaps` for the CV. */
export type AnswerGap = { question: string; problem: string };

export function answerGaps(input: AnswerAuditInput): AnswerGap[] {
  const byIndex = (index: number): Answer | undefined => input.answers.answers[index];

  return auditAnswers(input)
    .filter((p): p is AnswerProblem & { correction: string } => p.correction !== undefined)
    .map((p) => ({ question: byIndex(p.index)?.question ?? "", problem: p.correction }));
}

/**
 * The form limit an answer runs over, measured in code.
 *
 * A limit is the one constraint the reader cannot be talked past: the input box
 * on the employer's side cuts the text off or refuses it. Prompt adherence is
 * not measurement, so the same answers are counted here — a retry is told by
 * how much it is over (`answerLimitGaps`, added to the `answerGaps` retry in
 * the route), and whatever is still over when the retry is done is surfaced to
 * the user (`answerLimitFindings`). The limits come from the pasted questions
 * (`parseQuestionLimits`), the same parse the prompt used to tag them.
 */

type LimitWalk = { index: number; used: number; limit: QuestionLimit };

function overLimitAnswers(input: {
  answers: Answers;
  questions: readonly string[];
  questionLimits?: readonly (number | null | undefined)[];
}): LimitWalk[] {
  const parsed = parseQuestionLimits(input.questions, input.questionLimits);
  const over: LimitWalk[] = [];
  for (const [index, entry] of input.answers.answers.entries()) {
    const limit = parsed[index]?.limit;
    if (!limit) continue;
    // The bare value is what gets pasted when the question wants a number; the
    // long answer is what gets pasted the rest of the time.
    const text = entry.answer || entry.shortAnswer;
    if (!text) continue;
    const used = limit.unit === "chars" ? text.length : countWords(text);
    if (used > limit.max) over.push({ index, used, limit });
  }
  return over;
}

export function answerLimitGaps(input: {
  answers: Answers;
  questions: readonly string[];
  questionLimits?: readonly (number | null | undefined)[];
}): AnswerGap[] {
  return overLimitAnswers(input).map(({ index, used, limit }) => ({
    question: input.answers.answers[index]?.question ?? "",
    problem:
      `Your answer is ${used} ${limit.unit === "chars" ? "characters" : "words"}; ` +
      `the form allows at most ${limit.max}. Rewrite it to fit: cut filler and ` +
      "qualifiers first, never the concrete detail.",
  }));
}

export function answerLimitFindings(input: {
  answers: Answers;
  questions: readonly string[];
  questionLimits?: readonly (number | null | undefined)[];
}): Finding[] {
  return overLimitAnswers(input).map(({ index, used, limit }) => ({
    severity: "error",
    field: `answers[${index}].${input.answers.answers[index]?.answer ? "answer" : "shortAnswer"}`,
    detail:
      `Esta respuesta tiene ${used} ${limit.unit === "chars" ? "caracteres" : "palabras"} ` +
      `y el formulario admite ${limit.max}. Recortala antes de pegarla.`,
  }));
}
