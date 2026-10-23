import {
  buildEvidenceIndex,
  buildIndexFrom,
  CLAIM_SUPPORT_THRESHOLD,
  documentLanguage,
  findUnsupportedTerms,
  matchKeywords,
  supports,
  supportShare,
  textOverlap,
  VERBATIM_OVERLAP,
} from "@/lib/ai/evidence";
import {
  coverageAudit,
  cvProse,
  figuresAtStake,
  inventedCoverage,
  isHedgedSkillLine,
  jargonTermsIn,
  postingBorrowings,
  summaryRuleViolations,
  verifyPairs,
  verifyRoleTitles,
} from "@/lib/ai/verify";
import { CODE_HOST, type CVDocument } from "@/lib/schemas/cv";
import type { JobAnalysis } from "@/lib/schemas/job";
import type { Profile } from "@/lib/schemas/profile";

/**
 * Metrics for one generated CV, and the aggregate over a corpus of them.
 *
 * Prompt changes are otherwise unmeasurable: typecheck and the schema tests
 * both pass just as happily on a CV that invents half its content as on a good
 * one. These are the numbers that separate the two, computed the same way
 * whether the CV came out of the model a minute ago or was exported months ago,
 * so a change can be judged against a baseline rather than against an
 * impression of one example.
 */

export type CVScore = {
  label: string;
  /** Named technologies asserted in the CV that the profile does not state. */
  fabricated: string[];
  /** Posting keywords the profile genuinely supports. The honest ceiling. */
  supportedKeywords: number;
  /** How many of those the CV actually used. This is the number to move. */
  supportedKeywordsUsed: number;
  /** Every posting keyword, matched literally. Comparable across corpora. */
  allKeywords: number;
  allKeywordsUsed: number;
  bullets: number;
  words: number;
  hasMetric: boolean;
  sectionKinds: string[];
  /**
   * Completeness, which nothing above measures. Every other metric here scores
   * what a CV says; a CV that says almost nothing scores well on all of them.
   * One shipped with no work history, no education and no email, and the
   * harness would have called it clean.
   */
  hasExperience: boolean;
  hasEducation: boolean;
  hasContactEmail: boolean;
  usesPairs: boolean;
  /** Bullets on the most substantial role — where the corpus anchors at five. */
  topRoleBullets: number;
  /** What the model said about itself, which nothing else checks. */
  selfReportedCovered: number;
  selfReportedTotal: number;
  /**
   * Tailoring, which every metric above is blind to. All of them ask whether
   * the CV overreached; none asks whether it did any work. A CV assembled by
   * copying profile lines verbatim scores perfectly on fabrication, keyword use
   * and completeness, and is not a tailored CV.
   */
  bulletsVerbatim: number;
  /** Denominator for the above: only work-history bullets are rewrites of anything. */
  experienceBullets: number;
  summaryEchoesProfile: boolean;
  summaryWords: number;
  /** Terms of the posting carried by the first bullet — the one line always read. */
  firstBulletKeywords: number;
  /**
   * A skills section of one-word entries is a keyword dump: maximum ATS score,
   * no credibility, and invisible to the fabrication check because every word
   * of it is a real profile tag.
   */
  skillBullets: number;
  skillBulletWords: number;
  oneWordSkillBullets: number;
  /**
   * Redundancy, which the keyword-dump check above cannot see. A skills line
   * reading "Knowledge of containerization and orchestration with Docker and
   * Kubernetes", sitting under a bullet that already deployed with both, is
   * long enough to pass every length check and adds nothing. With one role the
   * prompt makes the section mandatory to fill the page, so this is the failure
   * that padding produces.
   */
  skillTech: number;
  skillTechAlsoInBullets: number;
  /**
   * "Familiar with", "Knowledge of" — a recruiter reads these as "does not know
   * it". If a tool is worth a line it is worth an affirmative one.
   */
  hedgedSkillBullets: number;
  /**
   * Whether the summary says what the candidate wants rather than what they
   * bring. `BUILD_CV_SYSTEM` has forbidden it since it was written and nothing
   * measured it, so "buscando un rol de Desarrollador HTML" shipped.
   */
  summaryWanting: boolean;
  /** More than one is a layout bug: two headings where the prompt asks for one. */
  pairSections: number;
  /**
   * Whether the numbers the candidate typed survived the rewrite.
   *
   * `hasMetric` above only asks whether the CV ended up with a figure, which
   * answers nothing when the profile had none to begin with. These three ask
   * the question that drives the metrics assistant: the user was interrupted,
   * asked for a number, and typed one — did it reach the page? Across 69 real
   * applications three profile bullets carrying figures survived into a CV and
   * all three arrived stripped of them, which is why that assistant kept
   * reappearing with the same request.
   */
  profileFigures: number;
  figuresPreserved: number;
  /** The failure the retry exists for: figures available, none of them kept. */
  droppedEveryFigure: boolean;
  /**
   * Claims the profile does not carry, counted over ordinary sentences rather
   * than over a glossary — the failure `fabricated` above cannot see.
   *
   * `fabricated` counts named technologies, which is the whole of the problem
   * on a software posting and none of it anywhere else. The two CVs in the
   * corpus with the most invented content — a groundskeeping job and a waiting
   * job, asserting weather tolerance, stock-keeping and customer contact from a
   * profile with none of it — both scored zero on it.
   *
   * `null` when the CV is not in the profile's language: `supportShare`
   * compares words, so a faithful English CV built from a Spanish profile reads
   * as one long fabrication. Suppressing the metric is the same choice
   * `statedYearsOfExperience` makes with dates it cannot parse, and the
   * aggregate denominates over the CVs where it applied.
   */
  unsupportedClaims: number | null;
  claimsChecked: number;
  /**
   * Lines using words of the posting's ask that the profile never says, which `unsupportedClaims` cannot see: the ad's own
   * words are ordinary vocabulary, and a line made of them reads as well supported as one made of the candidate's.
   * `null` for the same reason, and by the same test, as `unsupportedClaims`.
   */
  borrowedLines: number | null;
  /** Roles retitled away from the profile's own wording. */
  roleTitlesChanged: number;
  /** "pairs" rows promising something the profile does not state. */
  pairsUnsupported: number;
  /**
   * Technology named on a CV for a job outside the candidate's field. `null`
   * everywhere else, where naming the stack is the whole point — the same
   * `null`-means-not-applicable convention `unsupportedClaims` uses.
   */
  jargonOutsideField: number | null;
  /** Whether the practical block sits last, where the template wants it. */
  pairsSectionLast: boolean;
  /** Code-host links in the header of an out-of-field CV. `null` elsewhere. */
  codeLinksOutsideField: number | null;
  /** Requirements the posting actually states, and how many the CV covers. */
  coverageRequired: number;
  coverageGenuinelyCovered: number;
  /** Coverage entries reporting on something the posting never asked for. */
  coverageInvented: number;
  coverageReported: number;
};

/** Every bullet the profile states, across every role. */
function profileBullets(profile: Profile): string[] {
  return profile.experience.flatMap((job) => job.bullets);
}

export function scoreCV(input: {
  label: string;
  profile: Profile;
  analysis: JobAnalysis;
  cv: CVDocument;
}): CVScore {
  const { label, profile, analysis, cv } = input;

  const evidence = buildEvidenceIndex(profile);
  const outsideField = analysis.relevance === "unrelated";
  const audit = coverageAudit(cv, analysis);
  const prose = cvProse(cv);
  const cvIndex = buildIndexFrom(prose.map((p) => p.text));

  const fabricated = [
    ...new Set(prose.flatMap(({ text }) => findUnsupportedTerms(text, evidence))),
  ];

  const { supported } = matchKeywords(evidence, analysis.keywords);
  const bulletTexts = prose.filter((p) => p.field !== "summary").map((p) => p.text);
  const coverage = cv.coverage.requirements;

  const stated = profileBullets(profile);
  const experienceBullets = cv.sections.flatMap((s) =>
    s.kind === "experience" ? s.items.flatMap((i) => i.bullets) : [],
  );
  const skillBullets = cv.sections.flatMap((s) => (s.kind === "bullets" ? s.bullets : []));

  // The top role's opening line, which is the one a recruiter is guaranteed to
  // read and the one the profile's own ordering, left alone, fills with
  // whatever the candidate happened to type first.
  const items = cv.sections.flatMap((s) => (s.kind === "experience" ? s.items : []));
  const topRole = items.reduce<(typeof items)[number] | undefined>(
    (best, item) => (best && best.bullets.length >= item.bullets.length ? best : item),
    undefined,
  );
  const firstBulletIndex = buildIndexFrom([topRole?.bullets[0] ?? ""]);

  // Redundancy is measured over the profile's own tag vocabulary rather than
  // over words: "Docker" repeated is the finding, "and" repeated is not.
  //
  // Tags of one or two characters are dropped, which costs the check "Go", "C"
  // and "R". `supports` matches a whole word, so "Go" would also match the verb
  // in "go to production" — over a vocabulary this size a couple of missed
  // tools move the ratio far less than that kind of false positive would.
  const tags = [...new Set(profile.experience.flatMap((job) => job.tags))].filter(
    (tag) => tag.length > 2,
  );
  const experienceIndex = buildIndexFrom(experienceBullets);
  const skillIndex = buildIndexFrom(skillBullets);
  const techInSkills = tags.filter((tag) => supports(skillIndex, tag));

  // Computed by the same functions the runtime checks call, so the numbers
  // reported here and the warnings the user sees cannot drift apart.
  const figures = figuresAtStake(cv, profile);

  // Only where the CV and the profile share a language. `supportShare` compares
  // words, so a faithful translation scores like an invention.
  const profileLanguage = documentLanguage([
    profile.about,
    ...profile.experience.flatMap((job) => job.bullets),
    ...profile.extras,
  ]);
  const cvLanguage = documentLanguage(prose.map((p) => p.text));
  // Pairs are excluded: they are a label and a short fact, not a sentence, and
  // the label's own words ("Licencia de conducir") drag the share to zero on
  // rows that are perfectly well supported. `verifyPairs` checks those against
  // the profile field they come from instead.
  const claimable = prose.filter((p) => p.kind !== "pairs");
  const comparable = profileLanguage !== null && profileLanguage === cvLanguage;

  return {
    label,
    fabricated,
    supportedKeywords: supported.length,
    supportedKeywordsUsed: supported.filter((k) => supports(cvIndex, k)).length,
    allKeywords: analysis.keywords.length,
    allKeywordsUsed: analysis.keywords.filter((k) => supports(cvIndex, k)).length,
    bullets: bulletTexts.length,
    words: prose.reduce((n, p) => n + p.text.split(/\s+/).filter(Boolean).length, 0),
    // A percentage or any two-plus-digit figure, over the bullets only. Single
    // digits are usually a team size or a year fragment, not an achievement —
    // and neither is anything in a "pairs" section, which is where a dated
    // certification lives. Counting those took this metric from 9% to 72% the
    // day the pairs section shipped, without one number being added to a CV.
    hasMetric: [...experienceBullets, ...skillBullets].some((b) =>
      /\d+\s*%|\b\d{2,}\b/.test(b),
    ),
    sectionKinds: cv.sections.map((s) => s.kind),
    hasExperience: cv.sections.some((s) => s.kind === "experience" && s.items.length > 0),
    hasEducation: cv.sections.some((s) => s.kind === "education" && s.items.length > 0),
    hasContactEmail: cv.header.email.trim().length > 0,
    usesPairs: cv.sections.some((s) => s.kind === "pairs" && s.items.length > 0),
    topRoleBullets: Math.max(
      0,
      ...cv.sections.flatMap((s) =>
        s.kind === "experience" ? s.items.map((i) => i.bullets.length) : [],
      ),
    ),
    selfReportedCovered: coverage.filter((r) => r.covered).length,
    selfReportedTotal: coverage.length,
    bulletsVerbatim: experienceBullets.filter((bullet) =>
      stated.some((source) => textOverlap(bullet, source) >= VERBATIM_OVERLAP),
    ).length,
    experienceBullets: experienceBullets.length,
    summaryEchoesProfile: textOverlap(cv.summary, profile.about) >= VERBATIM_OVERLAP,
    summaryWords: cv.summary.split(/\s+/).filter(Boolean).length,
    firstBulletKeywords: analysis.keywords.filter((k) => supports(firstBulletIndex, k)).length,
    skillBullets: skillBullets.length,
    skillBulletWords: skillBullets.reduce(
      (n, b) => n + b.split(/\s+/).filter(Boolean).length,
      0,
    ),
    oneWordSkillBullets: skillBullets.filter((b) => b.split(/\s+/).filter(Boolean).length <= 2)
      .length,
    skillTech: techInSkills.length,
    skillTechAlsoInBullets: techInSkills.filter((tag) => supports(experienceIndex, tag)).length,
    hedgedSkillBullets: skillBullets.filter(isHedgedSkillLine).length,
    summaryWanting: summaryRuleViolations(cv).length > 0,
    pairSections: cv.sections.filter((s) => s.kind === "pairs").length,
    profileFigures: figures.stated.length,
    figuresPreserved: figures.kept.length,
    droppedEveryFigure: figures.stated.length > 0 && figures.kept.length === 0,
    unsupportedClaims: comparable
      ? claimable.filter((p) => {
          const share = supportShare(evidence, p.text);
          return share !== null && share < CLAIM_SUPPORT_THRESHOLD;
        }).length
      : null,
    claimsChecked: comparable
      ? claimable.filter((p) => supportShare(evidence, p.text) !== null).length
      : 0,
    // The same detector `verifyCV` warns with, so this is what reaches the user.
    borrowedLines: comparable ? postingBorrowings(cv, profile, analysis).length : null,
    roleTitlesChanged: verifyRoleTitles(cv, profile).length,
    pairsUnsupported: verifyPairs(cv, profile).length,
    // Shares the exact detector `verifyJargon` warns with and `cvGaps` retries
    // with, so this metric measures what actually reaches the user rather than
    // a slightly different definition of jargon.
    jargonOutsideField: outsideField ? jargonTermsIn(cv, profile, analysis).length : null,
    pairsSectionLast:
      !cv.sections.some((s) => s.kind === "pairs") ||
      cv.sections[cv.sections.length - 1]?.kind === "pairs",
    codeLinksOutsideField: outsideField
      ? cv.header.links.filter((l) => CODE_HOST.test(`${l.label} ${l.url}`)).length
      : null,
    coverageInvented: inventedCoverage(cv, analysis).length,
    coverageReported: cv.coverage.requirements.length,
    coverageRequired: audit.total,
    coverageGenuinelyCovered: audit.genuinelyCovered,
  };
}

export type Aggregate = {
  applications: number;
  /** Share of CVs asserting at least one technology the profile lacks. */
  cvsWithFabrication: number;
  fabricatedPerCV: number;
  /** Share of the honestly-claimable keywords that reached the CV. */
  supportedKeywordUse: number;
  allKeywordUse: number;
  bulletsPerCV: number;
  wordsPerCV: number;
  cvsWithAMetric: number;
  sectionKindCounts: Record<string, number>;
  selfReportedCoverage: number;
  /** Share of CVs that are structurally complete. Each should be 1. */
  cvsWithExperience: number;
  cvsWithEducation: number;
  cvsWithContactEmail: number;
  cvsWithPairs: number;
  topRoleBulletsPerCV: number;
  /** Share of work-history bullets that reached the CV unrewritten. Lower is better. */
  bulletsVerbatim: number;
  cvsEchoingProfileSummary: number;
  summaryWordsPerCV: number;
  firstBulletKeywordsPerCV: number;
  /** Words per skills-section line. Low means a keyword dump, not a skills section. */
  wordsPerSkillBullet: number;
  oneWordSkillBullets: number;
  /** Share of the skills section's technology that the bullets already named. */
  skillTechRedundancy: number;
  /** Share of skills lines that concede rather than claim. */
  hedgedSkillBullets: number;
  /** Share of CVs whose summary states an ambition instead of a history. */
  cvsWithWantingSummary: number;
  /** Should be at most 1: the prompt asks for a single pairs section. */
  pairSectionsPerCV: number;
  /**
   * Share of the figures available to a CV that reached it. The number the
   * metrics assistant exists to move: everything the user types goes into a
   * profile bullet, and this is whether it survived the rewrite.
   */
  figurePreservation: number;
  /** Share of CVs that had figures available and kept none. Should be 0. */
  cvsDroppingEveryFigure: number;
  /**
   * Share of checkable lines asserting something the profile does not state.
   * The number that separates a reframed CV from an invented one, and the one
   * `cvsWithFabrication` is blind to outside a technical field.
   */
  unsupportedClaims: number;
  /** How many CVs that ratio could be computed on — the rest were translations. */
  claimsComparable: number;
  /** Share of the same checkable lines that carry words from the ad the profile lacks. Over the CVs `claimsComparable` counts. */
  borrowedLines: number;
  /** Roles retitled per CV. Should be 0. */
  roleTitlesChangedPerCV: number;
  /** Availability, licence and eligibility rows the profile does not back. Should be 0. */
  pairsUnsupportedPerCV: number;
  /**
   * Distinct technology terms per out-of-field CV. `STRATEGIES.unrelated` opens
   * with "STRIP THE JARGON", and a groundskeeping CV came back naming Linux,
   * DNS, SSL/TLS and TeamViewer. Should be 0.
   */
  jargonPerUnrelatedCV: number;
  /** Share of CVs whose pairs block sits last, as the template wants. Should be 1. */
  pairsSectionLast: number;
  /** Code-host links left in the header of an out-of-field CV. Should be 0. */
  codeLinksPerUnrelatedCV: number;
  /** How many out-of-field CVs the two above are denominated in. */
  unrelatedCVs: number;
  /**
   * Coverage recomputed from the posting instead of from the report. Sits beside
   * `selfReportedCoverage`, and the gap between them is the number that matters:
   * a candidate meeting 1 of 3 requirements was shown 76%.
   */
  realCoverage: number;
  /** `selfReportedCoverage − realCoverage`. Should be 0. */
  coverageOverstatement: number;
  /** Share of coverage entries reporting on something the posting never asked. */
  coverageInvented: number;
};

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

export function aggregate(scores: CVScore[]): Aggregate {
  const n = scores.length;
  const sum = (pick: (s: CVScore) => number) => scores.reduce((total, s) => total + pick(s), 0);

  /**
   * The two coverage numbers, side by side. `selfReported` is the model grading
   * its own homework; `real` re-derives it from the posting. The gap between
   * them is what the coverage panel used to be printing.
   */
  const selfReported = ratio(sum((s) => s.selfReportedCovered), sum((s) => s.selfReportedTotal));
  const real = ratio(sum((s) => s.coverageGenuinelyCovered), sum((s) => s.coverageRequired));
  const unrelated = scores.filter((s) => s.jargonOutsideField !== null).length;

  const sectionKindCounts: Record<string, number> = {};
  for (const score of scores) {
    for (const kind of score.sectionKinds) {
      sectionKindCounts[kind] = (sectionKindCounts[kind] ?? 0) + 1;
    }
  }

  return {
    applications: n,
    cvsWithFabrication: ratio(scores.filter((s) => s.fabricated.length > 0).length, n),
    fabricatedPerCV: ratio(sum((s) => s.fabricated.length), n),
    supportedKeywordUse: ratio(sum((s) => s.supportedKeywordsUsed), sum((s) => s.supportedKeywords)),
    allKeywordUse: ratio(sum((s) => s.allKeywordsUsed), sum((s) => s.allKeywords)),
    bulletsPerCV: ratio(sum((s) => s.bullets), n),
    wordsPerCV: ratio(sum((s) => s.words), n),
    cvsWithAMetric: ratio(scores.filter((s) => s.hasMetric).length, n),
    sectionKindCounts,
    selfReportedCoverage: selfReported,
    cvsWithExperience: ratio(scores.filter((s) => s.hasExperience).length, n),
    cvsWithEducation: ratio(scores.filter((s) => s.hasEducation).length, n),
    cvsWithContactEmail: ratio(scores.filter((s) => s.hasContactEmail).length, n),
    cvsWithPairs: ratio(scores.filter((s) => s.usesPairs).length, n),
    topRoleBulletsPerCV: ratio(sum((s) => s.topRoleBullets), n),
    bulletsVerbatim: ratio(sum((s) => s.bulletsVerbatim), sum((s) => s.experienceBullets)),
    cvsEchoingProfileSummary: ratio(scores.filter((s) => s.summaryEchoesProfile).length, n),
    summaryWordsPerCV: ratio(sum((s) => s.summaryWords), n),
    firstBulletKeywordsPerCV: ratio(sum((s) => s.firstBulletKeywords), n),
    wordsPerSkillBullet: ratio(sum((s) => s.skillBulletWords), sum((s) => s.skillBullets)),
    oneWordSkillBullets: ratio(sum((s) => s.oneWordSkillBullets), sum((s) => s.skillBullets)),
    skillTechRedundancy: ratio(sum((s) => s.skillTechAlsoInBullets), sum((s) => s.skillTech)),
    hedgedSkillBullets: ratio(sum((s) => s.hedgedSkillBullets), sum((s) => s.skillBullets)),
    cvsWithWantingSummary: ratio(scores.filter((s) => s.summaryWanting).length, n),
    pairSectionsPerCV: ratio(sum((s) => s.pairSections), n),
    figurePreservation: ratio(sum((s) => s.figuresPreserved), sum((s) => s.profileFigures)),
    // Denominated in the CVs that had something to lose, not in every CV: a
    // profile with no numbers cannot drop one, and counting those would make
    // this improve every time an unrelated posting is applied to.
    cvsDroppingEveryFigure: ratio(
      scores.filter((s) => s.droppedEveryFigure).length,
      scores.filter((s) => s.profileFigures > 0).length,
    ),
    // Denominated only in the CVs the check could run on. A translated CV
    // contributes to neither side, which is the point of the `null`.
    unsupportedClaims: ratio(
      sum((s) => s.unsupportedClaims ?? 0),
      sum((s) => s.claimsChecked),
    ),
    claimsComparable: scores.filter((s) => s.unsupportedClaims !== null).length,
    borrowedLines: ratio(sum((s) => s.borrowedLines ?? 0), sum((s) => s.claimsChecked)),
    roleTitlesChangedPerCV: ratio(sum((s) => s.roleTitlesChanged), n),
    pairsUnsupportedPerCV: ratio(sum((s) => s.pairsUnsupported), n),
    // Denominated in the out-of-field CVs alone. Averaged over a corpus that is
    // 46/58 `direct`, these read as ~0 no matter how bad they are.
    jargonPerUnrelatedCV: ratio(sum((s) => s.jargonOutsideField ?? 0), unrelated),
    codeLinksPerUnrelatedCV: ratio(sum((s) => s.codeLinksOutsideField ?? 0), unrelated),
    unrelatedCVs: unrelated,
    pairsSectionLast: ratio(scores.filter((s) => s.pairsSectionLast).length, n),
    coverageInvented: ratio(sum((s) => s.coverageInvented), sum((s) => s.coverageReported)),
    realCoverage: real,
    coverageOverstatement: selfReported - real,
  };
}

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

export function formatAggregate(title: string, agg: Aggregate, scores: CVScore[]): string {
  const worst = [...scores]
    .sort((a, b) => b.fabricated.length - a.fabricated.length)
    .slice(0, 8)
    .filter((s) => s.fabricated.length > 0);

  const lines = [
    ``,
    `── ${title} — ${agg.applications} postulaciones ──`,
    `  CVs con tecnología inventada   ${percent(agg.cvsWithFabrication)}`,
    `  Términos inventados por CV     ${agg.fabricatedPerCV.toFixed(2)}`,
    `  Líneas sin respaldo            ${percent(agg.unsupportedClaims)} (en ${agg.claimsComparable}/${agg.applications} CVs)`,
    `  Líneas con palabras del aviso  ${percent(agg.borrowedLines)}`,
    `  Roles re-titulados por CV      ${agg.roleTitlesChangedPerCV.toFixed(2)}`,
    `  Datos prácticos sin respaldo   ${agg.pairsUnsupportedPerCV.toFixed(2)}`,
    `  Jerga en CVs fuera de rubro    ${agg.jargonPerUnrelatedCV.toFixed(2)} (n=${agg.unrelatedCVs})`,
    `  Links de código fuera de rubro ${agg.codeLinksPerUnrelatedCV.toFixed(2)} (n=${agg.unrelatedCVs})`,
    `  Bloque de datos al final       ${percent(agg.pairsSectionLast)}`,
    `  Cobertura inventada            ${percent(agg.coverageInvented)}`,
    `  Uso de keywords respaldadas    ${percent(agg.supportedKeywordUse)}`,
    `  Uso de keywords totales        ${percent(agg.allKeywordUse)}`,
    `  Bullets por CV                 ${agg.bulletsPerCV.toFixed(1)}`,
    `  Palabras por CV                ${agg.wordsPerCV.toFixed(0)}`,
    `  CVs con alguna métrica         ${percent(agg.cvsWithAMetric)}`,
    `  Números del perfil conservados ${percent(agg.figurePreservation)}`,
    `  CVs que perdieron todos        ${percent(agg.cvsDroppingEveryFigure)}`,
    `  Cobertura auto-reportada       ${percent(agg.selfReportedCoverage)}`,
    `  Cobertura real (sobre el aviso) ${percent(agg.realCoverage)}`,
    `  Sobreestimación de cobertura   ${percent(agg.coverageOverstatement)}`,
    `  Bullets sin reescribir         ${percent(agg.bulletsVerbatim)}`,
    `  CVs con resumen calcado        ${percent(agg.cvsEchoingProfileSummary)}`,
    `  Palabras del resumen           ${agg.summaryWordsPerCV.toFixed(0)}`,
    `  Keywords en el primer bullet   ${agg.firstBulletKeywordsPerCV.toFixed(2)}`,
    `  Palabras por línea de skills   ${agg.wordsPerSkillBullet.toFixed(1)}`,
    `  Líneas de skills de 1-2 palab. ${percent(agg.oneWordSkillBullets)}`,
    `  Skills que repiten los bullets ${percent(agg.skillTechRedundancy)}`,
    `  Líneas de skills con hedging   ${percent(agg.hedgedSkillBullets)}`,
    `  Resúmenes que piden, no traen  ${percent(agg.cvsWithWantingSummary)}`,
    `  Secciones pairs por CV         ${agg.pairSectionsPerCV.toFixed(2)}`,
    `  CVs con experiencia            ${percent(agg.cvsWithExperience)}`,
    `  CVs con educación              ${percent(agg.cvsWithEducation)}`,
    `  CVs con email de contacto      ${percent(agg.cvsWithContactEmail)}`,
    `  CVs con sección pairs          ${percent(agg.cvsWithPairs)}`,
    `  Bullets del rol principal      ${agg.topRoleBulletsPerCV.toFixed(2)}`,
    `  Secciones emitidas             ${
      Object.entries(agg.sectionKindCounts)
        .sort(([, a], [, b]) => b - a)
        .map(([kind, count]) => `${kind}=${count}`)
        .join(" ") || "(ninguna)"
    }`,
  ];

  if (worst.length) {
    lines.push(`  Peores casos:`);
    for (const score of worst) {
      lines.push(`    ${score.label.slice(0, 40).padEnd(40)} ${score.fabricated.join(", ")}`);
    }
  }

  return lines.join("\n");
}

export function formatComparison(before: Aggregate, after: Aggregate): string {
  // A baseline recorded before a metric existed has no value for it. That is
  // the normal state right after adding one, and it must not crash the run
  // that is meant to establish the new number.
  const row = (name: string, a: number | undefined, b: number, format: (v: number) => string) => {
    const current = `${format(b).padStart(8)}`;
    if (a === undefined) return `  ${name.padEnd(31)}${"—".padStart(8)} → ${current}   (nueva)`;

    const delta = b - a;
    const sign = delta > 0 ? "+" : "";
    return `  ${name.padEnd(31)}${format(a).padStart(8)} → ${current}   ${sign}${format(delta)}`;
  };
  const fixed = (digits: number) => (v: number) => v.toFixed(digits);

  return [
    ``,
    `── línea de base → actual ──`,
    row("CVs con tecnología inventada", before.cvsWithFabrication, after.cvsWithFabrication, percent),
    row("Términos inventados por CV", before.fabricatedPerCV, after.fabricatedPerCV, fixed(2)),
    row("Líneas sin respaldo", before.unsupportedClaims, after.unsupportedClaims, percent),
    row("Líneas con palabras del aviso", before.borrowedLines, after.borrowedLines, percent),
    row(
      "Roles re-titulados por CV",
      before.roleTitlesChangedPerCV,
      after.roleTitlesChangedPerCV,
      fixed(2),
    ),
    row(
      "Datos prácticos sin respaldo",
      before.pairsUnsupportedPerCV,
      after.pairsUnsupportedPerCV,
      fixed(2),
    ),
    row("Cobertura inventada", before.coverageInvented, after.coverageInvented, percent),
    row("Sobreestimación de cobertura", before.coverageOverstatement, after.coverageOverstatement, percent),
    row("Jerga fuera de rubro / CV", before.jargonPerUnrelatedCV, after.jargonPerUnrelatedCV, (v) => v.toFixed(2)),
    row("Links de código fuera de rubro", before.codeLinksPerUnrelatedCV, after.codeLinksPerUnrelatedCV, (v) => v.toFixed(2)),
    row("Bloque de datos al final", before.pairsSectionLast, after.pairsSectionLast, percent),
    row("Uso de keywords respaldadas", before.supportedKeywordUse, after.supportedKeywordUse, percent),
    row("Bullets por CV", before.bulletsPerCV, after.bulletsPerCV, fixed(1)),
    row("Palabras por CV", before.wordsPerCV, after.wordsPerCV, fixed(0)),
    row("CVs con alguna métrica", before.cvsWithAMetric, after.cvsWithAMetric, percent),
    row("Números del perfil conservados", before.figurePreservation, after.figurePreservation, percent),
    row(
      "CVs que perdieron todos",
      before.cvsDroppingEveryFigure,
      after.cvsDroppingEveryFigure,
      percent,
    ),
    row("CVs con experiencia", before.cvsWithExperience, after.cvsWithExperience, percent),
    row("CVs con educación", before.cvsWithEducation, after.cvsWithEducation, percent),
    row("CVs con email de contacto", before.cvsWithContactEmail, after.cvsWithContactEmail, percent),
    row("CVs con sección pairs", before.cvsWithPairs, after.cvsWithPairs, percent),
    row("Bullets del rol principal", before.topRoleBulletsPerCV, after.topRoleBulletsPerCV, fixed(2)),
    row("Bullets sin reescribir", before.bulletsVerbatim, after.bulletsVerbatim, percent),
    row(
      "CVs con resumen calcado",
      before.cvsEchoingProfileSummary,
      after.cvsEchoingProfileSummary,
      percent,
    ),
    row("Palabras del resumen", before.summaryWordsPerCV, after.summaryWordsPerCV, fixed(0)),
    row(
      "Keywords en el primer bullet",
      before.firstBulletKeywordsPerCV,
      after.firstBulletKeywordsPerCV,
      fixed(2),
    ),
    row("Palabras por línea de skills", before.wordsPerSkillBullet, after.wordsPerSkillBullet, fixed(1)),
    row("Líneas de skills de 1-2 palab.", before.oneWordSkillBullets, after.oneWordSkillBullets, percent),
    row("Skills que repiten los bullets", before.skillTechRedundancy, after.skillTechRedundancy, percent),
    row("Líneas de skills con hedging", before.hedgedSkillBullets, after.hedgedSkillBullets, percent),
    row("Resúmenes que piden, no traen", before.cvsWithWantingSummary, after.cvsWithWantingSummary, percent),
    row("Secciones pairs por CV", before.pairSectionsPerCV, after.pairSectionsPerCV, fixed(2)),
  ].join("\n");
}
