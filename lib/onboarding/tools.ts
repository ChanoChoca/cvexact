import { fold, wordsOf } from "@/lib/parse/dictionaries";
import type { StoredProfile } from "@/lib/schemas/profile-v2";
import { skillKey } from "@/lib/text/normalize";

/**
 * The tools and technologies a person is likely to name, so that the ones they
 * mention in their own words can be offered back as skills.
 *
 * This only *recognises*. What it returns is the text as the person wrote it —
 * "Google Ads", not whatever this list calls it — and nothing here is ever
 * suggested that they did not say: the alternative, a generic list of skills for
 * their field, is exactly the "skills from a taxonomy" the profile refuses.
 *
 * Deliberately broad and not technical only: a shop assistant's tools are a cash
 * register and Excel, a marketer's are ad platforms, and a dictionary that knew
 * only programming languages would treat most people as having none.
 */

const COMMON: readonly string[] = [
  // Office and productivity
  "Excel", "Word", "Access", "PowerPoint", "Outlook", "Google Sheets", "Google Docs", "Google Slides", "Google Drive",
  "Google Workspace", "Microsoft Office", "Office 365", "Microsoft 365", "Notion", "Trello", "Asana",
  "Jira", "Confluence", "Slack", "Teams", "Microsoft Teams", "Zoom", "Miro", "Airtable", "Monday", "ClickUp",
  "Visio", "Microsoft Project", "OneDrive", "SharePoint", "Dropbox",
  // Marketing, ads, analytics
  "Google Ads", "Google Analytics", "Google Tag Manager", "Google Search Console", "Meta", "Meta Ads",
  "Facebook Ads", "Instagram Ads", "TikTok Ads", "LinkedIn Ads", "Twitter Ads", "Meta Business Suite",
  "Business Manager", "HubSpot", "Mailchimp", "Sendinblue", "Brevo", "ActiveCampaign", "Klaviyo",
  "SEMrush", "Ahrefs", "Moz", "Screaming Frog", "Hootsuite", "Buffer", "Later", "Metricool", "Sprout Social",
  "Hotjar", "Looker Studio", "Data Studio", "Looker", "Tableau", "Power BI", "Metabase", "Mixpanel",
  "Amplitude", "Optimizely", "Unbounce", "WordPress", "Wix", "Squarespace", "Webflow", "Elementor",
  "Yoast", "SEO", "SEM", "CRM", "Email marketing", "Copywriting",
  // Design
  "Photoshop", "Illustrator", "InDesign", "Premiere", "After Effects", "Lightroom", "Figma", "Canva",
  "Sketch", "Adobe XD", "InVision", "Zeplin", "CorelDRAW", "AutoCAD", "SketchUp", "Revit", "ArchiCAD",
  "Blender", "Cinema 4D", "3ds Max", "Maya", "Final Cut", "DaVinci Resolve", "CapCut",
  // Commerce, payments, ERP
  "Shopify", "WooCommerce", "Tienda Nube", "Tiendanube", "VTEX", "Magento", "PrestaShop", "MercadoLibre",
  "Mercado Libre", "Mercado Pago", "Mercado Shops", "Amazon Seller", "Stripe", "PayPal", "SAP", "Salesforce",
  "Odoo", "Tango", "Bejerman", "Xubio", "Contabilium", "Zoho", "Oracle", "NetSuite", "Dynamics", "QuickBooks",
  "Holded", "Facturama", "Alegra", "Siigo", "Aspel", "ContPAQi", "Nubox",
  // Programming and data
  "JavaScript", "TypeScript", "Python", "Java", "Kotlin", "Swift", "Go", "Rust", "PHP", "Ruby", "Scala",
  "C#", "C++", "R", "Julia", "MATLAB", "Bash", "PowerShell", "SQL", "NoSQL", "GraphQL", "HTML", "CSS", "Sass",
  "Tailwind", "Bootstrap", "React", "React Native", "Next.js", "Vue", "Nuxt", "Angular", "Svelte", "Node.js",
  "Express", "NestJS", "Django", "Flask", "FastAPI", "Spring", "Spring Boot", "Laravel", "Rails", ".NET",
  "ASP.NET", "Flutter", "Ionic", "Electron", "jQuery", "Redux", "PostgreSQL", "Postgres", "MySQL", "MariaDB",
  "SQLite", "MongoDB", "Redis", "Elasticsearch", "Firebase", "Supabase", "DynamoDB", "Cassandra", "Kafka",
  "RabbitMQ", "Docker", "Kubernetes", "Terraform", "Ansible", "Jenkins", "GitHub Actions", "GitLab CI",
  "CircleCI", "DevOps", "CI/CD", "AWS", "Azure", "GCP", "Google Cloud", "Cloudflare", "Vercel", "Netlify", "Heroku", "Linux",
  "Git", "GitHub", "GitLab", "Bitbucket", "Postman", "Swagger", "OpenAPI", "Grafana", "Prometheus", "Datadog",
  "Sentry", "Pandas", "NumPy", "scikit-learn", "TensorFlow", "PyTorch", "Spark", "Hadoop", "Airflow", "dbt",
  "Snowflake", "BigQuery", "Redshift", "Databricks", "Jupyter", "Selenium", "Cypress", "Playwright", "Jest",
  "JUnit", "Unity", "Unreal", "Arduino", "Raspberry Pi",
  // Operations, retail, hospitality, health, education
  "Tango Gestión", "Point of Sale", "Punto de venta", "Caja registradora", "Posnet", "Handy", "Autoelevador",
  "Zorra", "Apilador", "Clark", "Moodle", "Google Classroom", "Kahoot", "Genially", "Kardex", "Fudo", "Maxirest",
  "Toast", "Opera", "Protel", "Cloudbeds", "Booking", "Airbnb", "Skype", "WhatsApp Business", "Zendesk",
  "Freshdesk", "Intercom", "Twilio", "Genesys", "Five9", "Avaya", "Cisco",
];

/**
 * Names that are also ordinary words — or, like "Julia" and "Maya", first
 * names. Matched only when written with a capital, so "Meta" the company is a
 * tool and "meta" the goal is not, and "Go" is a language but "go" is not
 * anything. Even capitalised they stay *ambiguous*: offered as a question,
 * never added on their own (see `toolMentions`).
 */
const NEEDS_CAPITAL = new Set(
  [
    "Go", "R", "C", "Meta", "Word", "Access", "Notion", "Sketch", "Toast", "Opera", "Later", "Buffer", "Monday", "Moz",
    "Zoom", "Teams", "Express", "Spring", "Swift", "Rails", "Handy", "Clark", "Booking", "Looker", "Miro",
    "Business Manager", "Point of Sale", "Tango", "Julia", "Maya",
  ].map(fold),
);

type Entry = { folded: string; pattern: RegExp; needsCapital: boolean };

const ESCAPE = /[.*+?^${}()|[\]\\]/g;

const ENTRIES: Entry[] = [...new Set(COMMON)]
  // Longest first, so "Google Ads" is taken before a shorter name inside it.
  .sort((a, b) => b.length - a.length)
  .map((name) => {
    const folded = fold(name);
    // Whole-word: not the "R" in "Rosario" nor the "Go" in "Google". The lookarounds
    // stand in for \b, which mishandles names ending in a symbol ("C#", ".NET").
    const body = folded.replace(ESCAPE, "\\$&").replace(/\s+/g, "\\s+");
    return { folded, pattern: new RegExp(`(?<![\\p{L}\\p{N}+#.])${body}(?![\\p{L}\\p{N}+#])`, "giu"), needsCapital: NEEDS_CAPITAL.has(folded) };
  });

/** Every name the list knows, by the key skills are compared with. */
const KNOWN = new Set(COMMON.map(skillKey));

/** What may sit between a sentence's start and its first word: spaces, an opening quote or bracket, a dash, "¿¡". */
const OPENING = /[\s"'«“‘(\[¿¡\-–—]/u;

/**
 * Whether a sentence starts at `at`, so a capital there proves nothing: the
 * start of the text or of a line, or right after ". ! ? • ·". Not after ":"
 * or ";" — in Spanish the next word goes on in lower case, so a capital right
 * after one ("Stack: Go, Docker") is the name's own.
 */
function atSentenceStart(source: string, at: number): boolean {
  for (let i = at - 1; i >= 0; i--) {
    const char = source[i]!;
    if (char === "\n" || ".!?•·".includes(char)) return true;
    if (!OPENING.test(char)) return false;
  }
  return true;
}

/**
 * Whether a capitalised match of an ambiguous name is the ordinary word after
 * all: sentence case ("Meta cumplida en todos los trimestres"), one part of a
 * hyphenated word ("Go-to-market"), or a single letter of an abbreviation
 * ("R.R.H.H.", "R&D").
 */
function ordinaryWord(source: string, at: number, end: number, options: MentionOptions): boolean {
  if (!options.skillsSection && atSentenceStart(source, at)) return true;
  if (/^-\p{L}/u.test(source.slice(end, end + 2)) || /\p{L}-$/u.test(source.slice(Math.max(0, at - 2), at))) return true;
  return end - at === 1 && /^(?:\.\p{L}|&)/u.test(source.slice(end, end + 2));
}

/** One tool named in a text: as written there, accents and all, and whether the name is also an ordinary word. */
export type ToolMention = { value: string; ambiguous: boolean };

export type MentionOptions = {
  /**
   * The text is a line of a skills section, where a name opening a sentence
   * is there because it is a skill ("Go y Rust para servicios de alta
   * concurrencia."): its capital counts, as it would mid-sentence.
   */
  skillsSection?: boolean;
};

/**
 * The text with its accents dropped, for matching, and where in the original
 * each of its characters came from — so what is reported is the name exactly
 * as written ("Tango Gestión"), not the accent-less copy the match ran on.
 */
function withoutAccents(text: string): { source: string; origin: number[]; original: string } {
  const original = text.normalize("NFC");
  let source = "";
  const origin: number[] = [];
  for (let i = 0; i < original.length; ) {
    const char = String.fromCodePoint(original.codePointAt(i)!);
    const base = char.normalize("NFD").replace(/[̀-ͯ]/g, "");
    for (let k = 0; k < base.length; k++) origin.push(i);
    source += base;
    i += char.length;
  }
  origin.push(original.length);
  return { source, origin, original };
}

function readMentions(text: string, options: MentionOptions): readonly ToolMention[] {
  if (!text.trim()) return [];
  const { source, origin, original } = withoutAccents(text);
  const found: Array<{ at: number; mention: ToolMention }> = [];
  const taken: Array<[number, number]> = [];

  for (const entry of ENTRIES) {
    for (const match of source.matchAll(entry.pattern)) {
      const at = match.index ?? 0;
      const end = at + match[0].length;
      if (taken.some(([from, to]) => at < to && end > from)) continue;
      if (entry.needsCapital && (!/^\p{Lu}/u.test(match[0]) || ordinaryWord(source, at, end, options))) continue;
      taken.push([at, end]);
      found.push({ at, mention: { value: original.slice(origin[at]!, origin[end]!).replace(/\s+/g, " "), ambiguous: entry.needsCapital } });
    }
  }

  const seen = new Set<string>();
  return found
    .sort((a, b) => a.at - b.at)
    .map(({ mention }) => mention)
    .filter((mention) => {
      const key = skillKey(mention.value);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * `detectGaps` reads every fact of every job each time it runs, and it runs
 * several times a render; the same lines come back every time.
 */
const MENTIONS = new Map<string, readonly ToolMention[]>();
const MENTIONS_LIMIT = 1000;

/**
 * The tools named in `text`, in the order first mentioned, each once (a longer
 * name swallows a shorter one inside it). The array is shared: read it, never
 * change it.
 */
export function toolMentions(text: string, options: MentionOptions = {}): readonly ToolMention[] {
  const key = `${options.skillsSection ? "s" : "t"}:${text}`;
  const known = MENTIONS.get(key);
  if (known) return known;
  const found = readMentions(text, options);
  if (MENTIONS.size >= MENTIONS_LIMIT) MENTIONS.delete(MENTIONS.keys().next().value!);
  MENTIONS.set(key, found);
  return found;
}

/** The tools named in `text`, as written there, in the order first mentioned. */
export function toolsIn(text: string, options: MentionOptions = {}): string[] {
  return toolMentions(text, options).map((mention) => mention.value);
}

/**
 * Initials that are also something else, by `skillKey`, and what a skill written as them would be called whole. Not an alias table
 * (`TERM_ALIASES` in `lib/ai/evidence.ts` holds the names that mean one thing): «RN» is also a nurse and «TS» an abbreviation of
 * other things, so they are never read as the tool — the person is asked, once, and the answer renames the skill. `means` is how the
 * question says it. «Go» is the language's own name, and its other one is the one an offer may ask for: «Go (Golang)» is answered by a
 * profile and a CV that say either, where «Golang» alone would stop answering for «Go».
 */
export const ABBREVIATED_SKILLS: Readonly<Record<string, { means: string; name: string }>> = {
  rn: { means: "React Native", name: "React Native" },
  ts: { means: "TypeScript", name: "TypeScript" },
  go: { means: "Golang", name: "Go (Golang)" },
};

/** Whether a skill's name is one this list knows as a tool. */
export const isKnownTool = (name: string): boolean => KNOWN.has(skillKey(name));

/**
 * The tools the person turned down — "Ninguna", an unticked chip, a skill
 * they removed — by `skillKey`. Older entries were keyed by `fold`; passing
 * them through `skillKey` again reads both the same.
 */
export function declinedToolKeys(pending: StoredProfile["pending"]): Set<string> {
  return new Set(pending.filter((entry) => entry.state === "na" && entry.ruleId === "loose_tool" && entry.entityId).map((entry) => skillKey(entry.entityId!)));
}

/**
 * Whether any of `texts` names the skill: a tool on the list by the same rules
 * `toolMentions` finds it with ("Go-to-market" does not name Go), anything
 * else by its words, whole and in order ("Administración de sistemas" in
 * "…y administración de sistemas Linux"). A literal match — the only link a
 * skill ever gets without being asked (see `skillSchema`).
 */
export function mentionsSkill(texts: readonly string[], name: string): boolean {
  const key = skillKey(name);
  if (key.length === 0) return false;
  if (KNOWN.has(key)) return texts.some((text) => toolMentions(text).some((mention) => skillKey(mention.value) === key));
  const words = wordsOf(name);
  if (words.join("").length < 3) return false;
  return texts.some((text) => {
    const said = wordsOf(text);
    return said.some((_, start) => words.every((word, k) => said[start + k] === word));
  });
}
