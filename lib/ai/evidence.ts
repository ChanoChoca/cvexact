import type { Profile } from "@/lib/schemas/profile";
import { normalizeForComparison } from "@/lib/text/normalize";

/**
 * Lexical index of everything the profile actually states, and the vocabulary
 * checks built on top of it.
 *
 * The honesty rules in the prompts are instructions the model routinely loses
 * to the pull of the posting's own vocabulary: told to mirror a job ad that
 * asks for Clean Architecture, DDD and CQRS, it writes them into the CV even
 * when the profile never mentions them. That costs the candidate the interview
 * it wins them. This module is the deterministic half of the answer — it feeds
 * the prompt a hard allow/deny partition of the posting's keywords, and it
 * catches what the model still invents.
 *
 * Deliberately free of `server-only`, the CV schema and the AI SDK: it is pure
 * string work, used by both `lib/ai/prompts/build-cv.ts` and `lib/ai/verify.ts`.
 */

/**
 * Casefold, strip accents and punctuation, collapse whitespace — except `#`
 * and `+`, which stay, so "C", "C#" and "C++" don't collapse into the same
 * term. See `lib/text/normalize.ts` for the full rationale.
 */
export function normalize(value: string): string {
  return normalizeForComparison(value);
}

/**
 * True when `candidate` names the same organisation as one of `known`. Compares
 * both directions so "Adevinta" matches "Adevinta Spain" and vice versa — the
 * model legitimately shortens or expands names.
 */
export function matchesKnown(candidate: string, known: string[]): boolean {
  const c = normalize(candidate);
  if (!c) return true; // nothing asserted
  return known.some((k) => {
    const n = normalize(k);
    return n.length > 0 && (n === c || n.includes(c) || c.includes(n));
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Terms whose presence in a CV is a factual claim about the candidate rather
 * than a turn of phrase. Only these — plus acronyms, below — are subject to the
 * allow/deny partition and to the fabrication check.
 *
 * The list is deliberately bounded. Validating every noun in a CV against the
 * profile produces far more noise than signal ("plataformas", "soluciones",
 * "clientes"), and a warning list nobody reads protects nobody. What is here
 * are named technologies, cloud services and architecture patterns: the things
 * an interviewer will actually drill into, and the things a model reaches for
 * when it is copying from the job ad instead of from the profile.
 *
 * Written in display form; matching is on the normalised version, so accents,
 * casing and punctuation do not need variants. Both English and Spanish
 * spellings appear because the posting's language drives the CV's.
 */
const HARD_TERMS: readonly string[] = [
  // Architecture and design patterns. The most-fabricated group by far.
  "Clean Architecture",
  "Arquitectura Limpia",
  "Hexagonal Architecture",
  "Arquitectura Hexagonal",
  "Ports and Adapters",
  "Onion Architecture",
  "Domain Driven Design",
  "Diseño Guiado por el Dominio",
  "Event Sourcing",
  "Event Driven Architecture",
  "Arquitectura Orientada a Eventos",
  "Saga Pattern",
  "Patrón Saga",
  "Circuit Breaker",
  "Service Mesh",
  "API Gateway",
  "Backend for Frontend",
  "Strangler Fig",
  "Microservices",
  "Microservicios",
  "Modular Monolith",
  "Monolito Modular",
  "Serverless",
  "Multi Tenant",
  "Multitenancy",
  "Feature Flags",
  "Test Driven Development",
  "Trunk Based Development",
  "Infrastructure as Code",
  "Zero Trust",
  "Blue Green Deployment",
  "Canary Deployment",
  "Despliegue Canario",
  "Clean Code",
  "Event Storming",

  // Languages and runtimes.
  "Go",
  "Golang",
  "Rust",
  "Java",
  "Kotlin",
  "Scala",
  "Elixir",
  "Erlang",
  "Clojure",
  "Ruby",
  "Python",
  "PHP",
  "Swift",
  "Objective-C",
  "TypeScript",
  "JavaScript",
  "Node.js",
  "Deno",
  "Bun",
  "Dart",
  "Haskell",

  // Frameworks and libraries.
  "Spring Boot",
  "Micronaut",
  "Quarkus",
  "Hibernate",
  "Django",
  "Flask",
  "FastAPI",
  "Laravel",
  "Symfony",
  "Rails",
  "Express.js",
  "NestJS",
  "Fastify",
  "Gin",
  "Echo",
  "Fiber",
  "React",
  "React Native",
  "Angular",
  "Vue",
  "Svelte",
  "Next.js",
  "Nuxt",
  "Astro",
  "Remix",
  "Flutter",
  "Tailwind",
  "GraphQL",
  "gRPC",
  "Protobuf",
  "tRPC",

  // Data stores.
  "PostgreSQL",
  "MySQL",
  "MariaDB",
  "SQL Server",
  "Oracle",
  "SQLite",
  "MongoDB",
  "Cassandra",
  "DynamoDB",
  "Redis",
  "Memcached",
  "Elasticsearch",
  "OpenSearch",
  "Neo4j",
  "ClickHouse",
  "Snowflake",
  "BigQuery",
  "Redshift",
  "Firestore",
  "Supabase",

  // Messaging and streaming.
  "Kafka",
  "RabbitMQ",
  "ActiveMQ",
  "NATS",
  "Pulsar",
  "Celery",
  "Sidekiq",
  "BullMQ",
  "Kinesis",

  // Cloud platforms and services.
  "AWS",
  "GCP",
  "Google Cloud",
  "Azure",
  "Lambda",
  "Step Functions",
  "EventBridge",
  "CloudFormation",
  "CloudFront",
  "Fargate",
  "App Runner",
  "Cloud Run",
  "Cloud Functions",
  "App Engine",
  "Vercel",
  "Netlify",
  "Cloudflare",
  "Heroku",
  "DigitalOcean",

  // Infrastructure, CI and observability.
  "Docker",
  "Kubernetes",
  "Helm",
  "Terraform",
  "Ansible",
  "Pulumi",
  "Jenkins",
  "GitHub Actions",
  "GitLab CI",
  "CircleCI",
  "ArgoCD",
  "Nginx",
  "Apache",
  "Caddy",
  "Prometheus",
  "Grafana",
  "Datadog",
  "New Relic",
  "Sentry",
  "OpenTelemetry",
  "Splunk",
  "Kibana",
  "Linux",
  "Windows Server",

  // Everyday tooling: version control, package managers, bundlers, and the
  // services and apps a bullet names in passing. Absent until a run put "Git"
  // and "npm/yarn" on CVs whose profile never said them, and nothing flagged
  // either: a term the glossary does not know is a term nobody checks.
  "Git",
  "GitHub",
  "npm",
  "yarn",
  "pnpm",
  "Postman",
  "Bash",
  "Webpack",
  "Vite",
  "ESLint",
  "Redux",
  "Expo",
  "Firebase",
  "Swagger",
  "Excel",
  "Fastlane",
  "Express",

  // Testing.
  "JUnit",
  "Mockito",
  "Testcontainers",
  "Jest",
  "Vitest",
  "Playwright",
  "Cypress",
  "Selenium",
  "Pytest",
  "Cucumber",

  // Methodologies and process.
  "Scrum",
  "Kanban",
  "SAFe",
  "Jira",
  "Confluence",

  // LLM and agent tooling. Newer than the rest of this list and just as
  // fabricable: an "AI Engineer" posting names three frameworks the candidate
  // has never opened, and without them here the partition sends the model an
  // empty deny-list on exactly the postings that need one.
  "LangChain",
  "LangGraph",
  "LlamaIndex",
  "CrewAI",
  "PydanticAI",
  "AutoGen",
  "Semantic Kernel",
  "Haystack",
  "Vercel AI SDK",
  "OpenAI API",
  "Hugging Face",
  "Ollama",
  "vLLM",
  "Pinecone",
  "Weaviate",
  "Qdrant",
  "Chroma",
  "pgvector",
  "Milvus",
  "MCP",
  "Model Context Protocol",
  "Salesforce",
  "HubSpot",
  "SAP",
  "Odoo",
  "Zapier",
  "n8n",
  "Twilio",
  "Stripe",

  // Data and ML.
  "Spark",
  "Airflow",
  "dbt",
  "Hadoop",
  "TensorFlow",
  "PyTorch",
  "Pandas",
  "Machine Learning",
  "Aprendizaje Automático",
  "Deep Learning",
  "Data Warehouse",
  "Data Lake",
  "Power BI",
  "Tableau",
  "Looker",

  // Markup, styling, design tooling and accessibility.
  //
  // Absent until a posting for an HTML developer went through, at which point
  // every term it asked about — HTML5, CSS3, Figma, WCAG — either fell through
  // to the acronym pass or was not seen at all. Two consequences, both
  // measured on that run: `findUnsupportedTerms` could not tell a fabricated
  // Figma from a stated one, and the gap chips offered the candidate "Sí, usé
  // HTML5" against a profile that already stated HTML.
  //
  // "Less" and "Sketch" are deliberately absent despite being real tools: both
  // are ordinary words, and a bullet reading "less latency" would answer for
  // one of them.
  "HTML",
  "HTML5",
  "CSS",
  "CSS3",
  "Sass",
  "SCSS",
  "Bootstrap",
  "Material UI",
  "Chakra UI",
  "styled-components",
  "CSS Grid",
  "Flexbox",
  "SVG",
  "Web Components",
  "Progressive Web App",
  "PWA",
  "WebView",
  "Responsive Design",
  "Diseño Responsive",
  "Mobile First",
  "Figma",
  "Adobe XD",
  "Illustrator",
  "Photoshop",
  "Canva",
  "Storybook",
  "WCAG",
  "ARIA",
];

/**
 * Acronyms that read as technical claims but are not: legal entities, places,
 * time zones, and the business vocabulary a posting drags in. Everything else
 * in caps is treated as a claim about what the candidate has worked with.
 */
const ACRONYM_STOPLIST = new Set([
  // Legal entities.
  "SRL",
  "SA",
  "SAS",
  "SL",
  "SPA",
  "LLC",
  "INC",
  "LTD",
  "GMBH",
  "BV",
  "AG",
  // Places and institutions.
  "ONG",
  "UE",
  "EEUU",
  "USA",
  "US",
  "UK",
  "EU",
  "LATAM",
  "CABA",
  "AMBA",
  "PYME",
  "PYMES",
  // Time zones and clock.
  "UTC",
  "GMT",
  "EST",
  "EDT",
  "CST",
  "CDT",
  "PST",
  "PDT",
  "MST",
  "ART",
  "BRT",
  "CET",
  "CEST",
  // Business and process vocabulary, not technology.
  "KPI",
  "KPIS",
  "OKR",
  "OKRS",
  "ROI",
  "SLA",
  "SLO",
  "SLI",
  "B2B",
  "B2C",
  "RRHH",
  "RCA",
  "MVP",
  "POC",
  "PMO",
  "CEO",
  "CTO",
  "CFO",
  "COO",
  "VP",
  // General abbreviations and numerals.
  "CV",
  "IT",
  "TI",
  "OK",
  "AM",
  "PM",
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
]);

/** Two to seven characters of caps/digits — CQRS, DDD, JWT, AWS, S3, CI/CD. */
const ACRONYM_PATTERN = /\b[A-Z][A-Z0-9]{1,6}\b/g;

/**
 * Glossary entries that are also ordinary words in one of the CV languages.
 * "Go" the language and "go to market" normalise identically, as do "Spark"
 * and "spark", "Echo" and "echo". For these the raw text must show the term
 * capitalised before it counts as a claim; every other entry matches
 * case-insensitively.
 */
const CASE_SENSITIVE_TERMS = new Set(
  [
    "Go",
    "Gin",
    "Echo",
    "Fiber",
    "Spark",
    "Swift",
    "Dart",
    "Oracle",
    "Apache",
    "Pandas",
    "Bun",
    "Rails",
    "Helm",
    "Express",
    "Excel",
    "Expo",
  ].map((term) => term.toLowerCase()),
);

/**
 * Terms that name the same thing in the two languages a CV comes out in.
 *
 * `supports` matches strings, and a profile written in Spanish answers a posting
 * written in English only where the word happens to be the same. Mostly that is
 * fine — the glossary above is proper nouns, which do not translate — but the
 * abbreviations do: a profile listing "LLMs", "prompt engineering" and "Vercel
 * AI SDK" was reported as having fabricated «IA» by a CV that used the Spanish
 * initials for the field it had just described.
 *
 * Kept deliberately short. Every entry is a claim that two spellings are
 * interchangeable, and a wrong one silently licenses a fabrication.
 */
const TERM_ALIASES: readonly (readonly string[])[] = [
  ["ia", "ai", "inteligencia artificial", "artificial intelligence"],
  ["ml", "aprendizaje automatico", "machine learning"],

  /**
   * Version suffixes. `statesPhrase` matches whole phrases with only a plural
   * inflection, so a posting asking for HTML5 is not answered by a profile
   * stating HTML — which is how a candidate whose profile listed HTML and CSS
   * was told, about a posting named after both, that neither was mentioned in
   * it. The version is not a different technology.
   *
   * A generic "strip the trailing digits" rule would do this in one line and is
   * the reason there is a table instead: it turns S3 into "s", OAuth2 into
   * "oauth" and Log4j into nonsense, and every one of those silently licenses a
   * fabrication the glossary above exists to catch. The cost of the table is
   * that each spelling has to be written down, separated or not — postings say
   * both "Vue3" and "Vue 3".
   */
  ["html5", "html 5", "html"],
  ["css3", "css 3", "css"],
  ["vue3", "vue 3", "vue", "vuejs", "vue.js"],
  ["angular2", "angular 2", "angular"],
  ["python3", "python 3", "python"],

  /**
   * One tool under the longer or shorter name people write it with, aligned with `SKILL_ALIASES` in `lib/text/normalize.ts`:
   * a profile listing "Postgres" and "Node" was told, about a CV that wrote PostgreSQL and Node.js, that neither was in it.
   * Only the spellings nobody else uses. "RN" is also a nurse, and "TS" and "Go" are also ordinary words and initials, so a
   * table that read them as React Native, TypeScript and Golang would license a claim on someone else's profile: those are
   * asked of the person (`abbreviated_skill`), and the answer renames the skill. "Vue" is in the group above, which must be
   * one group: a term has one entry in the map.
   */
  ["node.js", "node", "nodejs"],
  ["postgresql", "postgres"],
  ["kubernetes", "k8s"],
  ["react", "reactjs", "react.js"],
  ["express", "expressjs", "express.js"],

  /**
   * ES6 is JavaScript, and "JS" is how half of all profiles spell it — the case
   * `BUILD_CV_SYSTEM` already names when it tells the model to mirror the
   * posting's term ("If they wrote 'JS' and the posting says 'JavaScript'").
   *
   * "es6+" is its own spelling, not the same string as "es6": normalizing
   * preserves `+` so that "C++" doesn't collapse into "C", and a posting
   * asking for "ES6+" ("ES6 or newer") pays for that with needing its own
   * entry here instead of matching by accident.
   */
  ["es6", "es6+", "es2015", "ecmascript", "javascript", "js"],

  /**
   * WCAG is deliberately NOT in this group. The three below name one practice
   * in two languages and an abbreviation of it; WCAG names a specific standard,
   * and accepting it as answered by the word "accesibilidad" would let a CV
   * claim a spec the candidate has never opened.
   */
  ["a11y", "accesibilidad", "accessibility"],
];

const ALIASES_BY_TERM = new Map<string, readonly string[]>();
for (const group of TERM_ALIASES) {
  for (const term of group) {
    ALIASES_BY_TERM.set(
      normalize(term),
      group.filter((other) => normalize(other) !== normalize(term)),
    );
  }
}

/**
 * Words that carry no claim on their own. Both CV languages, because the output
 * language belongs to the posting.
 *
 * Used by `supportShare` below to decide what a sentence is actually asserting.
 * Short words are dropped by length there rather than listed here; what needs
 * naming are the long connectives and the CV filler that appears in every
 * sentence regardless of what it says.
 */
const STOPWORDS = new Set([
  // Spanish connectives and CV filler.
  "para",
  "como",
  "sobre",
  "entre",
  "desde",
  "hasta",
  "donde",
  "cuando",
  "porque",
  "tambien",
  "ademas",
  "mediante",
  "durante",
  "segun",
  "cada",
  "todos",
  "todas",
  "otros",
  "otras",
  "mismo",
  "misma",
  "estos",
  "estas",
  "esos",
  "esas",
  "aquel",
  "mientras",
  "aunque",
  "aquellos",
  "aquellas",
  "aquello",
  "sino",
  "pero",
  "experiencia",
  "capacidad",
  "habilidad",
  "conocimiento",
  "conocimientos",
  "responsabilidad",
  "disposicion",
  "nivel",
  "area",
  "areas",
  "tareas",
  "trabajo",
  "puesto",
  "empresa",
  "equipo",
  "forma",
  "manera",
  "tipo",
  "parte",
  "partes",
  // English connectives and CV filler.
  "with",
  "from",
  "that",
  "this",
  "these",
  "those",
  "have",
  "having",
  "been",
  "into",
  "than",
  "then",
  "such",
  "each",
  "were",
  "will",
  "would",
  "should",
  "about",
  "after",
  "before",
  "while",
  "where",
  "which",
  "their",
  "them",
  "experience",
  "ability",
  "knowledge",
  "skills",
  "level",
  "role",
  "team",
  "company",
  "work",
  "working",
  "tasks",
  "responsibility",
  "willingness",
]);

/**
 * The words in `text` that carry a claim: long enough to mean something, and not
 * connective vocabulary.
 *
 * Four characters is the floor because below it almost everything is a
 * preposition or an article in both languages, and the few real terms that short
 * ("SQL", "AWS", "Go") are already covered by `HARD_TERMS` and the acronym pass.
 */
export function contentWords(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((word) => word.length > 4 && !STOPWORDS.has(word));
}

/**
 * The share of a sentence's claim-carrying words the profile states, or `null`
 * when it makes no claim worth checking.
 *
 * `findUnsupportedTerms` above answers "did the CV invent a technology?", which
 * is the whole question for a software posting and almost none of it for any
 * other. A CV for a groundskeeping job came back asserting a willingness to work
 * in varying weather, experience maintaining machinery, and stock-keeping — none
 * of it in the profile, all of it invisible to a glossary of named technologies,
 * because a fabricated claim outside tech is made of ordinary words.
 *
 * A share, not a verdict: no single sentence of a rewritten CV is expected to
 * reuse the profile's exact vocabulary, and the callers pick their own threshold
 * for what counts as unsupported.
 */
export function supportShare(
  index: EvidenceIndex,
  text: string,
): number | null {
  const words = contentWords(text);
  if (words.length === 0) return null;

  const supported = words.filter((word) => supports(index, word)).length;
  return supported / words.length;
}

/**
 * Below this share of its content words being in the profile, a sentence is
 * asserting something the profile does not.
 *
 * Calibrated against the corpus: see `tests/eval-score.test.ts`. Set so the
 * genuinely-rewritten bullets of a same-language CV stay clear of it while the
 * invented skills lines fall under.
 */
export const CLAIM_SUPPORT_THRESHOLD = 0.34;

/**
 * The phrases among `phrases` that the profile does not answer.
 *
 * `matchKeywords` partitions on `HARD_TERMS`, so for a posting that names no
 * technology every keyword lands in `neutral` and the "must not appear" list the
 * prompt is built around comes out empty — precisely on the postings where the
 * candidate has least to work with and the model invents most. This is the same
 * partition made lexically instead of by glossary.
 */
export function unsupportedPhrases(
  index: EvidenceIndex,
  phrases: readonly string[],
): string[] {
  const found = new Map<string, string>();

  for (const phrase of phrases) {
    const trimmed = phrase.trim();
    if (!trimmed || supports(index, trimmed)) continue;

    const share = supportShare(index, trimmed);
    if (share === null || share >= CLAIM_SUPPORT_THRESHOLD) continue;
    found.set(normalize(trimmed), trimmed);
  }

  return [...found.values()];
}

/**
 * Which of the two CV languages a body of text is written in, or `null` when it
 * is neither or too short to tell.
 *
 * `supportShare` compares words, so it reads a faithful English CV built from a
 * Spanish profile as one long fabrication. Callers that measure claims use this
 * to suppress the check rather than misfire it — the same choice
 * `statedYearsOfExperience` makes with dates it cannot parse.
 */
const LANGUAGE_MARKERS: Record<string, readonly string[]> = {
  es: [
    "de",
    "la",
    "el",
    "en",
    "y",
    "con",
    "para",
    "los",
    "las",
    "del",
    "por",
    "una",
  ],
  en: [
    "the",
    "of",
    "and",
    "to",
    "in",
    "for",
    "with",
    "on",
    "a",
    "as",
    "by",
    "an",
  ],
};

export function documentLanguage(texts: readonly string[]): "es" | "en" | null {
  const words = normalize(texts.join(" ")).split(" ").filter(Boolean);
  if (words.length < 20) return null;

  const counts = Object.entries(LANGUAGE_MARKERS).map(([language, markers]) => {
    const set = new Set(markers);
    return { language, hits: words.filter((word) => set.has(word)).length };
  });

  const [best, second] = counts.sort((a, b) => b.hits - a.hits);
  if (!best || best.hits === 0) return null;
  // A clear winner only. Mixed text is exactly the case this must not guess at.
  if (second && second.hits >= best.hits * 0.7) return null;
  return best.language as "es" | "en";
}

const HARD_TERM_SET = new Set(HARD_TERMS.map(normalize));

/**
 * Sorted longest-first so "domain driven design" is consumed before "design"
 * would be, and the finding names the pattern rather than a fragment of it.
 */
const HARD_TERM_LOOKUP: readonly { display: string; normalised: string }[] =
  HARD_TERMS.map((display) => ({
    display,
    normalised: normalize(display),
  })).sort((a, b) => b.normalised.length - a.normalised.length);

/** Case-sensitive whole-word search, for the ambiguous glossary entries. */
function hasCapitalisedForm(text: string, display: string): boolean {
  return new RegExp(`\\b${escapeRegExp(display)}\\b`).test(text);
}

export type EvidenceIndex = {
  /**
   * Every profile string, normalised and joined with a separator no normalised
   * term can contain, so a phrase cannot match across two unrelated entries.
   */
  readonly haystack: string;
};

/**
 * Indexes arbitrary strings. Used for the profile below, and by the eval
 * harness to ask the same "does this text state X?" question of a generated CV.
 */
export function buildIndexFrom(parts: string[]): EvidenceIndex {
  const normalised = parts.map(normalize).filter(Boolean);
  return { haystack: ` ${normalised.join(" | ")} ` };
}

/**
 * Every string in a profile that can license a claim, unindexed.
 *
 * Split out from `buildEvidenceIndex` so a caller can index a profile
 * *together* with something else. The profile interview is the one that needs
 * it: what the user has typed into the chat used to be the only licence for
 * anything the model wrote, which stopped being true the moment a profile could
 * also arrive from an imported CV. Correcting an imported bullet would then be
 * refused as an invention, on the grounds that the user never said a word the
 * document plainly contains.
 */
export function evidenceTextsFrom(profile: Profile): string[] {
  // Places, because a CV states them: the header carries the candidate's city
  // and every role and degree carries its own. Left out, the town the candidate
  // lives in reads as something the profile never mentioned, and a posting in
  // that same town has its location reported as unclaimable.
  const parts: string[] = [
    profile.headline,
    profile.about,
    profile.city,
    profile.country,
  ];

  for (const job of profile.experience) {
    parts.push(
      job.role,
      job.company,
      job.city,
      job.country,
      ...job.bullets,
      ...job.tags,
    );
  }
  for (const edu of profile.education) {
    parts.push(edu.degree, edu.institution, edu.city, edu.country, edu.honors, ...edu.highlights);
  }
  for (const project of profile.projects) {
    parts.push(project.name, project.description, ...project.tags);
  }
  for (const cert of profile.certifications) {
    parts.push(cert.name, cert.issuer);
  }
  parts.push(...profile.skills);
  for (const language of profile.languages) {
    parts.push(language.name, language.level);
  }
  parts.push(...profile.extras);
  // The licence is a claim like any other, and the one the `unrelated` strategy
  // is told to put on the CV ("licence, vehicle and stated availability are
  // frequently the deciding factors"). Left out of the index, "B1" reads to the
  // acronym check as a technology the candidate never mentioned, and a CV
  // stating the user's real licence came back reported as a fabrication.
  parts.push(
    profile.practical.availability,
    profile.practical.workEligibility,
    profile.practical.driverLicense,
  );

  return parts;
}

export function buildEvidenceIndex(profile: Profile): EvidenceIndex {
  return buildIndexFrom(evidenceTextsFrom(profile));
}

/**
 * Singular and plural forms of a final word, so "APIs" in the profile answers
 * for "API" in the posting and "microservicios" answers for "microservicio".
 * Only strips a suffix when what remains is still a word, which keeps "AWS"
 * from becoming "AW".
 */
function inflections(word: string): string[] {
  const forms = new Set([word, `${word}s`]);
  if (word.endsWith("es") && word.length > 4) forms.add(word.slice(0, -2));
  if (word.endsWith("s") && word.length > 3) forms.add(word.slice(0, -1));
  return [...forms];
}

/** True when the profile states `term` anywhere, as a whole phrase. */
export function supports(index: EvidenceIndex, term: string): boolean {
  if (statesPhrase(index, term)) return true;
  // Only after the literal form fails, so an alias can never mask a direct hit.
  return (ALIASES_BY_TERM.get(normalize(term)) ?? []).some((alias) =>
    statesPhrase(index, alias),
  );
}

/**
 * How many of `keywords` the text itself states, counted with the same
 * whole-phrase test `supports` uses.
 *
 * Shared by the two places that ask it of a CV line: the prompt ranks the
 * profile's bullets by it before writing (`rankBullet`), and the fit engine
 * classifies the written lines by it (T1/T2/T3 in `lib/cv/fit.ts`). One walk,
 * one notion of "states the keyword" — a second copy would drift.
 */
export function keywordMatches(keywords: string[], text: string): number {
  if (!text.trim()) return 0;
  const index = buildIndexFrom([text]);
  return keywords.filter((k) => supports(index, k)).length;
}

function statesPhrase(index: EvidenceIndex, term: string): boolean {
  const needle = normalize(term);
  if (!needle) return false;

  const words = needle.split(" ");
  const head = words.slice(0, -1).map(escapeRegExp).join(" ");
  const tail = inflections(words[words.length - 1]!)
    .map(escapeRegExp)
    .join("|");
  const phrase = `${head ? `${head} ` : ""}(?:${tail})`;

  return new RegExp(`(?:^|[\\s|])${phrase}(?:[\\s|]|$)`).test(index.haystack);
}

/**
 * How much of two texts is the same words, 0 to 1, order ignored.
 *
 * Answers a question the index cannot: not "did the CV invent this?" but "did
 * the CV bother to rewrite it?". Tailoring a CV means re-angling the
 * candidate's own material at the posting, and a model that instead selects
 * profile lines and passes them through produces something that is honest,
 * schema-valid, and not a tailored CV at all — the failure mode nothing else
 * here can see, because every word of it traces to the profile.
 *
 * Set-based rather than sequence-based on purpose: reordering a sentence is not
 * rewriting it, and this should say so.
 */
export function textOverlap(a: string, b: string): number {
  const wordsA = new Set(normalize(a).split(" ").filter(Boolean));
  const wordsB = new Set(normalize(b).split(" ").filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let shared = 0;
  for (const word of wordsA) if (wordsB.has(word)) shared += 1;
  return shared / Math.max(wordsA.size, wordsB.size);
}

/**
 * Above this, two texts are the same text. Calibrated against the corpus: of
 * 300 bullets in 53 saved CVs — all of them genuinely rewritten — exactly one
 * scores this high, while the run that copied the profile scores 1.0.
 */
export const VERBATIM_OVERLAP = 0.85;

/**
 * A number as a CV writes one: `500`, `1.000`, `12,5`, `35%`. The separator is
 * whatever the writer's locale uses, so both are accepted and neither survives
 * into the returned token.
 *
 * A digit glued to the end of a word is part of a name, not a quantity —
 * OAuth2, S3, EC2, Log4j, Vue3 — so the match must start at a word boundary.
 * Without that, a profile stating OAuth2 reports "2" as a figure the CV lost
 * whenever it wrote "OAuth" alone. A letter *after* the digits is a unit and is
 * fine: "4s" and "400ms" are quantities.
 */
const FIGURE_PATTERN = /(?<![\p{L}\d])\d[\d.,]*\s*%?/gu;

/**
 * Every number a piece of text states, canonicalised so the same figure written
 * two ways compares equal.
 *
 * Numbers are the one thing on a CV that cannot be recovered by rewriting: the
 * candidate typed each one, `HONESTY_RULES` forbids inventing another, and a
 * bullet that loses its figure in translation cannot get it back. Comparing
 * what the profile stated against what the CV kept is the only way to see that
 * happen — across 69 real applications only 23% of CVs carried a number, while
 * the profile they were built from carried several.
 *
 * Canonical form drops thousands separators and keeps a trailing `%`, because
 * "1.000 usuarios" and "1000 usuarios" are the same claim and "35" and "35%"
 * are not. A trailing separator is punctuation, not part of the number: the
 * "400" in "reduje 400, que es mucho" must match the "400" in the rewrite.
 */
export function extractFigures(text: string): string[] {
  return figureMentions(text).map((mention) => mention.figure);
}

/** A figure where it stands in a text: canonical, as it was written, and where it starts. */
export type FigureMention = { figure: string; raw: string; index: number; end: number };

/** `extractFigures`, with the place of each one — what lets a caller look at the words around a number. */
export function figureMentions(text: string): FigureMention[] {
  const mentions: FigureMention[] = [];

  for (const match of text.matchAll(FIGURE_PATTERN)) {
    const raw = match[0];
    const percent = raw.includes("%");
    // Separators only count between digits; anything trailing is punctuation.
    const digits = raw.replace(/[^\d.,]/g, "").replace(/[.,]+$/, "");
    if (!digits) continue;

    // A single separator with exactly two trailing digits is a decimal comma or
    // point ("12,5" — and "1.50"); every other separator groups thousands.
    const decimal = /^\d+[.,]\d{1,2}$/.test(digits);
    const normalised = decimal
      ? digits.replace(",", ".")
      : digits.replace(/[.,]/g, "");

    const index = match.index ?? 0;
    mentions.push({
      figure: percent ? `${normalised}%` : normalised,
      raw: raw.trim().replace(/[.,]+$/, ""),
      index,
      end: index + raw.length,
    });
  }

  return mentions;
}

/** The distinct figures in a set of texts, in the order first seen. */
export function collectFigures(texts: readonly string[]): string[] {
  return [...new Set(texts.flatMap(extractFigures))];
}

/**
 * Numbers a profile writes in words and a CV writes in digits: «un equipo de cinco personas» is «un equipo de 5 personas»
 * once it is rewritten, and it is the same number. Only what turns into a figure: «un» and «una» are an article, not a quantity.
 */
const NUMBER_WORDS: Readonly<Record<string, number>> = {
  dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13,
  catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, veinticinco: 25,
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90, cien: 100, ciento: 100,
  doscientos: 200, trescientos: 300, cuatrocientos: 400, quinientos: 500, mil: 1000,
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, hundred: 100, thousand: 1000,
};

/** «10 mil», «dos millones»: a number that is a count of thousands or millions. */
const SCALED = /(?<![\p{L}\d])(\d+(?:[.,]\d+)?|\p{L}+)\s+(mil|millon(?:es)?|thousand|million)(?![\p{L}\d])/giu;

/**
 * The figures a set of texts license, once each way of writing them is counted: the digits as they stand, the number
 * words (`cinco`), a count of thousands (`10 mil`, `dos mil`) and the shorthand a CV uses for a large one (`10k`, `1.5M`
 * for what the profile says in full). The same figure in a percent sign or without one is the same figure: the other way
 * round — keeping a number someone typed — `extractFigures` is exact, because there a lost sign is a lost claim.
 *
 * Used to ask whether a number in a CV is one the profile has: it is generous on purpose, since a figure it wrongly
 * calls invented is a person told their CV lies when it does not.
 */
export function statedFigures(texts: readonly string[]): Set<string> {
  const stated = new Set<string>();
  const add = (figure: string) => {
    stated.add(figure);
    // «35» and «35%» license each other.
    stated.add(figure.endsWith("%") ? figure.slice(0, -1) : `${figure}%`);
  };

  for (const text of texts) {
    // «35 por ciento» is «35%».
    const written = text.replace(/(\d)\s*(?:por\s*ciento|percent|per\s*cent)(?![\p{L}])/giu, "$1%");
    for (const figure of extractFigures(written)) {
      add(figure);
      const value = Number(figure.replace("%", ""));
      if (!figure.endsWith("%") && Number.isFinite(value)) {
        // «10000» is also what «10k» says, and «1500000» what «1.5M» does.
        if (value >= 1000 && value % 1000 === 0) add(String(value / 1000));
        if (value >= 1_000_000 && value % 100_000 === 0) add(String(value / 1_000_000));
      }
    }

    for (const word of normalize(written).split(" ")) {
      const value = NUMBER_WORDS[word];
      if (value !== undefined) add(String(value));
    }

    // «miles de usuarios» licenses «miles» wherever it stands, and a count of them («10 millones») the word as well.
    for (const mention of scaleMentions(written, true)) stated.add(mention.figure);

    // Not `normalize`d: it would turn the point of «1.5 millones» into a space.
    const plain = written.normalize("NFD").replace(/\p{M}/gu, "");
    for (const match of plain.matchAll(SCALED)) {
      const count = /^\d/.test(match[1]!) ? Number(match[1]!.replace(",", ".")) : NUMBER_WORDS[match[1]!.toLowerCase()];
      if (count === undefined || !Number.isFinite(count)) continue;
      const scale = /^(?:mil|thousand)$/i.test(match[2]!) ? 1000 : 1_000_000;
      add(String(count * scale));
    }
  }

  return stated;
}

/**
 * A quantity said without a digit: «cientos de estudiantes», «miles de usuarios», «hundreds of clients». It is a figure like
 * any other — the profile is the only place it may come from — and the one a check made of digits cannot see. The `figure` of a
 * mention is the word, lowercased.
 *
 * Not the word that counts a number («10 millones», «dos mil»): the digits or the number word are the figure there. Unless
 * `all`, which is how a text that states a quantity is read for what it licenses.
 */
const SCALE_WORDS = /(?<![\p{L}\d])(cientos|miles|decenas|millones|hundreds|thousands|dozens|millions)(?![\p{L}\d])/giu;

export function scaleMentions(text: string, all = false): FigureMention[] {
  const found: FigureMention[] = [];
  for (const match of text.matchAll(SCALE_WORDS)) {
    const index = match.index ?? 0;
    if (!all) {
      const before = text.slice(0, index).match(/([\p{L}\d.,]+)\s*$/u)?.[1] ?? "";
      if (/\d/.test(before) || Object.hasOwn(NUMBER_WORDS, normalize(before))) continue;
    }
    found.push({ figure: match[1]!.toLowerCase(), raw: match[1]!, index, end: index + match[0].length });
  }
  return found;
}

/** The words that say a number is a guess: «aprox. 12 %», «~12 %», «alrededor de 40», «around 40». */
const ESTIMATE = "aprox(?:imadamente)?\\.?|approx(?:imately)?\\.?|alrededor\\s+de|cerca\\s+de|around|roughly|about|circa|~|≈";
const ESTIMATE_BEFORE = new RegExp(`(?:${ESTIMATE})\\s*(?:de |un |una |unos |unas |a |an |of |the )?$`, "iu");
const ESTIMATE_NEAR = new RegExp(ESTIMATE, "iu");
const ESTIMATE_AFTER = /^\s*(?:aprox|approx)/iu;
/** How far back a CV may put the word and still be read as meaning the number: «aproximadamente un 12 %». */
const ESTIMATE_REACH = 24;

/**
 * Whether the text says this figure is an estimate: the word is right before it («aprox. 12 %», «un 12 % aprox.») — or, when
 * `loosely`, anywhere in the few words ahead of it. The profile is read strictly (a number is exact unless it says otherwise) and
 * the CV loosely (a rewrite may put the word a little further, and a wrongly called loss is a person told their CV lies).
 */
export function saidApproximately(text: string, mention: Pick<FigureMention, "index" | "end">, loosely = false): boolean {
  const before = text.slice(0, mention.index);
  if (ESTIMATE_BEFORE.test(before) || ESTIMATE_AFTER.test(text.slice(mention.end))) return true;
  return loosely && ESTIMATE_NEAR.test(before.slice(-ESTIMATE_REACH));
}

/**
 * The figures that the profile gives only as an estimate (`Reducción — aprox. 12 %`): every time they are written they carry the
 * word. A figure that is exact in some other line is exact. In both ways of writing it, with and without the percent sign.
 */
export function approximateFigures(texts: readonly string[]): Set<string> {
  const estimate = new Map<string, boolean>();
  for (const text of texts) {
    for (const mention of figureMentions(text)) {
      const base = mention.figure.replace("%", "");
      estimate.set(base, (estimate.get(base) ?? true) && saidApproximately(text, mention));
    }
  }
  const estimated = new Set<string>();
  for (const [base, yes] of estimate) if (yes) estimated.add(base).add(`${base}%`);
  return estimated;
}

/**
 * True when `term` is a factual claim rather than a description — a named
 * technology, service or pattern, or an acronym. Everything else ("backend
 * development", "diseño de APIs", "trabajo en equipo") is phrasing the model
 * must stay free to use, so it is neither promoted nor forbidden.
 */
export function isHardTerm(term: string): boolean {
  const normalised = normalize(term);
  if (!normalised) return false;
  if (HARD_TERM_SET.has(normalised)) return true;
  // A bare acronym, as the analysis extracted it: "CQRS", "DDD", "CI/CD".
  const acronyms = term.match(ACRONYM_PATTERN) ?? [];
  return acronyms.length > 0 && normalize(acronyms.join(" ")) === normalised;
}

export type KeywordPartition = {
  /** In the profile. Safe — and worth — mirroring verbatim. */
  supported: string[];
  /** A named technology the profile never mentions. Must not appear in the CV. */
  fabricable: string[];
  /** Descriptive phrasing the index cannot settle either way. */
  neutral: string[];
};

/**
 * Splits the posting's ATS keywords into what the candidate can honestly claim
 * and what they cannot.
 *
 * The prompt used to receive one undifferentiated list under "worth mirroring
 * where the candidate genuinely matches them", which left the model to make a
 * judgement it consistently got wrong in the direction of keyword stuffing.
 * Making the judgement here, in code, turns it into two flat instructions.
 */
export function matchKeywords(
  index: EvidenceIndex,
  keywords: string[],
): KeywordPartition {
  const partition: KeywordPartition = {
    supported: [],
    fabricable: [],
    neutral: [],
  };

  for (const keyword of keywords) {
    const trimmed = keyword.trim();
    if (!trimmed) continue;
    if (supports(index, trimmed)) partition.supported.push(trimmed);
    else if (isHardTerm(trimmed)) partition.fabricable.push(trimmed);
    else partition.neutral.push(trimmed);
  }

  return partition;
}

/**
 * Every named technology `text` asserts, whether or not the profile backs it.
 *
 * Shared by the two questions worth asking of a CV line: which of these terms
 * the profile does not support (a fabrication) and which it does (jargon, which
 * is a problem of its own outside the candidate's field). Both need the same
 * walk, and a second copy of it would drift — the glossary is ordered
 * longest-first and each match is consumed, so the passes are not independent.
 *
 * Feed it CV prose only — summaries, bullets, the values of a pairs section.
 * Section titles are uppercase by template convention ("EXPERIENCIA
 * PROFESIONAL"), so passing one through the acronym pass would flag every word
 * of it.
 */
export function hardTermsIn(text: string): string[] {
  if (!text.trim()) return [];

  const found = new Map<string, string>();
  let remaining = ` ${normalize(text)} `;

  // Multi-word patterns first, removing each match so the acronym pass and the
  // shorter glossary entries cannot re-report a fragment of one already found.
  for (const { display, normalised } of HARD_TERM_LOOKUP) {
    if (
      CASE_SENSITIVE_TERMS.has(normalised) &&
      !hasCapitalisedForm(text, display)
    )
      continue;
    const pattern = new RegExp(
      `(?:^|\\s)${escapeRegExp(normalised)}(?=\\s|$)`,
      "g",
    );
    const stripped = remaining.replace(pattern, " ");
    if (stripped === remaining) continue;
    remaining = stripped;
    found.set(normalised, display);
  }

  for (const acronym of text.match(ACRONYM_PATTERN) ?? []) {
    const normalised = normalize(acronym);
    if (ACRONYM_STOPLIST.has(acronym) || found.has(normalised)) continue;
    // Already accounted for by the glossary pass, which stripped it above.
    if (
      !new RegExp(`(?:^|\\s)${escapeRegExp(normalised)}(?=\\s|$)`).test(
        remaining,
      )
    )
      continue;
    found.set(normalised, acronym);
  }

  return [...found.values()];
}

/** Named technologies asserted in `text` that the profile does not support. */
export function findUnsupportedTerms(
  text: string,
  index: EvidenceIndex,
): string[] {
  return hardTermsIn(text).filter((term) => !supports(index, term));
}

/**
 * Named technologies asserted in `text` that the profile *does* support — the
 * exact complement of `findUnsupportedTerms`.
 *
 * True claims, which is why nothing warned about them before. They are still a
 * defect outside the candidate's field, where `STRATEGIES.unrelated` orders the
 * jargon stripped: a CV written for a groundskeeping vacancy came back naming
 * Linux servers, firewalls, DNS, SSL/TLS and TeamViewer. Every one of those is
 * the candidate's, every one of them reads as overqualification to the person
 * hiring, and an instruction alone did not stop it.
 */
export function statedHardTerms(text: string, index: EvidenceIndex): string[] {
  return hardTermsIn(text).filter((term) => supports(index, term));
}

/**
 * Month index for the prefixes a hand-typed date starts with, Spanish and
 * English. "Marzo" matches `mar` before `may` gets a chance; the order of the
 * object is the order they are tried in, so it is not incidental.
 */
const MONTH_PREFIXES: Record<string, number> = {
  ene: 0,
  jan: 0,
  feb: 1,
  mar: 2,
  abr: 3,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  ago: 7,
  aug: 7,
  sep: 8,
  set: 8,
  oct: 9,
  nov: 10,
  dic: 11,
  dec: 11,
};

/**
 * One hand-typed date, or `null` when it cannot be read.
 *
 * Dates in a profile are free text ("Mayo 2024", "03/2019", "2021"), so this
 * reads what it can and gives up on the rest. Everything below distinguishes
 * that `null` from a real zero, because the two mean opposite things: no
 * readable date is "I do not know", and the moment it is rendered as "0 years"
 * the user signs a false statement.
 */
export function parseProfileDate(value: string): Date | null {
  const normalised = normalize(value);
  const year = normalised.match(/\b(19|20)\d{2}\b/)?.[0];
  if (!year) return null;
  const month =
    Object.entries(MONTH_PREFIXES).find(([prefix]) =>
      normalised.includes(prefix),
    )?.[1] ?? 0;
  return new Date(Number(year), month, 1);
}

/** A role with its dates resolved. `start`/`end` are null together. */
export type RoleSpan = {
  job: Profile["experience"][number];
  start: Date | null;
  end: Date | null;
};

/** The period as `serializeProfile` prints it, so the prompt reads one format. */
export function rolePeriod(job: Profile["experience"][number]): string {
  return `${job.start || "?"} – ${job.current ? "present" : job.end || "?"}`;
}

export function roleSpans(
  profile: Profile,
  now: Date = new Date(),
): RoleSpan[] {
  return profile.experience.map((job) => {
    const start = parseProfileDate(job.start);
    const end = job.current ? now : (parseProfileDate(job.end) ?? now);
    // An end before its start is a typo, not a negative tenure. Treated as
    // undated so it contributes evidence but no arithmetic.
    if (!start || end <= start) return { job, start: null, end: null };
    return { job, start, end };
  });
}

/** Whole months from `from` to `to`, day-of-month ignored. */
export function monthsBetween(from: Date, to: Date): number {
  return (
    (to.getFullYear() - from.getFullYear()) * 12 +
    (to.getMonth() - from.getMonth())
  );
}

/**
 * Months covered by the union of the spans. Overlap counts once.
 *
 * Two concurrent roles — a day job and a freelance contract over the same
 * eighteen months — are eighteen months of experience, not thirty-six. Summing
 * them is how a profile with honest dates produces a seniority claim its own
 * dates do not support.
 */
export function mergedMonths(spans: readonly RoleSpan[]): number {
  const intervals = spans
    .filter(
      (span): span is RoleSpan & { start: Date; end: Date } =>
        span.start !== null,
    )
    .map((span) => ({ start: span.start, end: span.end }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  let months = 0;
  let open: { start: Date; end: Date } | null = null;

  for (const interval of intervals) {
    if (open && interval.start <= open.end) {
      if (interval.end > open.end)
        open = { start: open.start, end: interval.end };
      continue;
    }
    if (open) months += monthsBetween(open.start, open.end);
    open = interval;
  }
  if (open) months += monthsBetween(open.start, open.end);

  return months;
}

/**
 * Whole years of work the profile's dates support, rounded down.
 *
 * Used to check the summary's own claims about seniority, and to give the
 * answer generator a number it does not have to derive. A profile whose dates
 * are all unparseable yields 0, which suppresses the check rather than firing
 * it wrongly — callers that show a number to the user must ask `roleSpans`
 * whether any date was readable at all before printing this.
 */
export function statedYearsOfExperience(
  profile: Profile,
  now: Date = new Date(),
): number {
  return Math.floor(mergedMonths(roleSpans(profile, now)) / 12);
}

/** How long the profile's dates back a single named technology. */
export type Tenure = {
  /** The term as it was asked about, for echoing back verbatim. */
  term: string;
  /** Months of dated work naming it. Overlapping roles counted once. */
  months: number;
  /**
   * Whether any of `roles` carried a readable date. False with a non-empty
   * `roles` means the candidate has the experience and the profile never said
   * when — which is a prompt for the user, not a zero.
   */
  dated: boolean;
  /**
   * True when a role's own bullets or tags name the term. False means it is
   * only in the profile's flat skills list — real, and credited below across
   * whichever roles have some technical signal of their own — but not tied to
   * one project. `describeTenure` reads this to tell the model what it may
   * claim: general usage, never a specific bullet that never named it.
   */
  linked: boolean;
  roles: { role: string; company: string; period: string }[];
};

/**
 * Per-technology tenure, computed from the profile instead of left to the model.
 *
 * The model was doing this arithmetic in its head and getting it wrong in the
 * one direction that costs the user the job: asked how long it had worked with
 * React, TypeScript and Node, a profile holding all three since May 2024
 * answered "0 years", on the reasoning that no single project used all three at
 * once. Nobody asks the question that way. Each term is counted on its own, and
 * a role that names any of them counts for that one.
 */
export function technologyTenure(
  profile: Profile,
  terms: readonly string[],
  now: Date = new Date(),
): Tenure[] {
  const spans = roleSpans(profile, now);
  const indexed = spans.map((span) => ({
    span,
    index: buildIndexFrom([
      span.job.role,
      span.job.company,
      ...span.job.bullets,
      ...span.job.tags,
    ]),
  }));

  // Spans with some technical signal of their own — at least one named
  // technology in their own role/company/bullets/tags. The skills-only
  // fallback below credits a stated-but-unlinked term across these roles
  // only: a role with no technical bullets or tags at all (retail, support)
  // does not become "years of Angular" just because it shares a career with
  // one that does.
  const technicalSpans = indexed
    .filter(
      ({ span }) =>
        hardTermsIn(
          [
            span.job.role,
            span.job.company,
            ...span.job.bullets,
            ...span.job.tags,
          ].join(" "),
        ).length > 0,
    )
    .map(({ span }) => span);

  // A term the profile lists as a skill but no role's own bullets or tags
  // name — Angular in a flat skills array with nothing in any bullet naming
  // it. Not "absent" (`experienceFacts.absent` checks the whole profile,
  // skills included, and rightly does not report this one as lacking) and not
  // linked to a project either: the blind spot where a term was neither
  // backed by a bullet nor reported as missing, so the model had no number to
  // anchor on and drifted into the hedge this fallback exists to close.
  const skillsIndex = buildIndexFrom(profile.skills);

  const seen = new Set<string>();
  const tenures: Tenure[] = [];

  for (const term of terms) {
    const trimmed = term.trim();
    const key = normalize(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const matching = indexed.filter(({ index }) => supports(index, trimmed));

    if (matching.length) {
      tenures.push({
        term: trimmed,
        months: mergedMonths(matching.map(({ span }) => span)),
        dated: matching.some(({ span }) => span.start !== null),
        roles: matching.map(({ span }) => ({
          role: span.job.role,
          company: span.job.company,
          period: rolePeriod(span.job),
        })),
        linked: true,
      });
      continue;
    }

    if (
      !isHardTerm(trimmed) ||
      !technicalSpans.length ||
      !supports(skillsIndex, trimmed)
    )
      continue;

    tenures.push({
      term: trimmed,
      months: mergedMonths(technicalSpans),
      dated: technicalSpans.some((span) => span.start !== null),
      roles: technicalSpans.map((span) => ({
        role: span.job.role,
        company: span.job.company,
        period: rolePeriod(span.job),
      })),
      linked: false,
    });
  }

  return tenures;
}

/**
 * Everything about the candidate's tenure that a form question can turn on,
 * computed once so the prompt and the verifier cannot disagree about it.
 *
 * The terms are drawn from the questions first and the posting second. That
 * order is the point: a form asks "how long have you worked with React,
 * TypeScript and Node?" whether or not the posting's keyword list happens to
 * name all three, and the arithmetic the model needs is the arithmetic for the
 * question in front of it.
 */
export type ExperienceFacts = {
  /** Months of dated work, overlap counted once. */
  totalMonths: number;
  /**
   * Whether any role carried a readable date. False means no number may be put
   * in front of the user at all — not that the answer is zero.
   */
  dated: boolean;
  /** Per-technology tenure, for the terms the profile backs. */
  tenures: Tenure[];
  /** Named technologies the questions or posting ask about and the profile lacks. */
  absent: string[];
};

export function experienceFacts(input: {
  profile: Profile;
  questions: readonly string[];
  keywords?: readonly string[];
  now?: Date;
}): ExperienceFacts {
  const { profile, questions, keywords = [], now = new Date() } = input;

  const spans = roleSpans(profile, now);
  const evidence = buildEvidenceIndex(profile);

  // Questions first, so a term the form asks about outranks one the posting
  // merely listed. `technologyTenure` dedupes, keeping the first spelling.
  const terms = [...questions.flatMap(hardTermsIn), ...keywords];

  return {
    totalMonths: mergedMonths(spans),
    dated: spans.some((span) => span.start !== null),
    tenures: technologyTenure(profile, terms, now),
    // Hard terms only. A descriptive keyword ("trabajo en equipo") is not
    // something a profile can be said to lack, and listing it as absent is how
    // the model gets talked into apologising for a gap that is not one.
    absent: [
      ...new Map(
        terms
          .filter((term) => isHardTerm(term) && !supports(evidence, term))
          .map((term) => [normalize(term), term.trim()]),
      ).values(),
    ],
  };
}
