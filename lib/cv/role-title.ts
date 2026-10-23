import { normalizeForComparison } from "@/lib/text/normalize";

/**
 * A job title in another language is the same title only if nothing was added to it and nothing taken away. "Desarrollador
 * Mobile" and "Mobile Developer" are one title; "Senior Mobile Developer" and "React Native Developer" are two others, and
 * the only thing that tells them apart is what each word means — so the title is compared as a set of meanings, not of words.
 *
 * Only the words a title is made of are in the table, with their Spanish and English forms (gender included). A word the
 * table does not know stands for itself, so "Mobile", "React Native" and "Software" are compared literally: a title that
 * depends on one of them being translated is a title this cannot vouch for, and the profile's own is kept.
 *
 * shortcut: a compound the table splits differently ("front-end"/"frontend") reads as a different title and falls back to the
 * profile's; add the pair here if it shows up.
 */
const GROUPS: ReadonlyArray<{ es: string[]; en: string[] }> = [
  { es: ["desarrollador", "desarrolladora"], en: ["developer"] },
  { es: ["programador", "programadora"], en: ["programmer"] },
  { es: ["ingeniero", "ingeniera"], en: ["engineer"] },
  { es: ["analista"], en: ["analyst"] },
  { es: ["arquitecto", "arquitecta"], en: ["architect"] },
  { es: ["consultor", "consultora"], en: ["consultant"] },
  { es: ["diseñador", "diseñadora"], en: ["designer"] },
  { es: ["administrador", "administradora"], en: ["administrator"] },
  { es: ["coordinador", "coordinadora"], en: ["coordinator"] },
  { es: ["asistente"], en: ["assistant"] },
  { es: ["especialista"], en: ["specialist"] },
  { es: ["tecnico", "tecnica"], en: ["technician"] },
  { es: ["contador", "contadora"], en: ["accountant"] },
  { es: ["gerente"], en: ["manager"] },
  { es: ["lider"], en: ["lead", "leader"] },
  { es: ["soporte"], en: ["support"] },
  { es: ["datos"], en: ["data"] },
  { es: ["movil"], en: ["mobile"] },
  { es: ["calidad"], en: ["quality"] },
  { es: ["producto"], en: ["product"] },
  { es: ["proyecto", "proyectos"], en: ["project", "projects"] },
  { es: ["ventas"], en: ["sales"] },
  { es: ["pasante", "practicante"], en: ["intern", "trainee"] },
];

/** Seniority is the same word in both, or an abbreviation of it; "semi senior" is two meanings, as it is two words. */
const ABBREVIATIONS: Readonly<Record<string, string>> = { sr: "senior", jr: "junior", ssr: "semi senior" };

/** The words that join a title and say nothing of it, and the "a" of "desarrollador/a". */
const FILLER = new Set(["de", "del", "la", "el", "en", "y", "e", "o", "of", "the", "and", "for", "a", "as", "os"]);

const meaning = new Map<string, string>();
const language = new Map<string, "es" | "en">();
for (const group of GROUPS) {
  for (const lang of ["es", "en"] as const) {
    for (const word of group[lang]) {
      meaning.set(word, group.es[0]!);
      language.set(word, lang);
    }
  }
}

function meanings(role: string): Set<string> {
  const words = normalizeForComparison(role)
    .split(" ")
    .flatMap((word) => (ABBREVIATIONS[word] ?? word).split(" "))
    .filter((word) => word && !FILLER.has(word));
  return new Set(words.map((word) => meaning.get(word) ?? word));
}

/** Whether two titles say the same thing, in either language. */
export function sameRole(a: string, b: string): boolean {
  const left = meanings(a);
  const right = meanings(b);
  return left.size > 0 && left.size === right.size && [...left].every((word) => right.has(word));
}

/**
 * The language a title is written in, when the table can tell. One Spanish word makes it Spanish: an English word inside a
 * Spanish title is everyday ("Desarrollador Mobile"), a Spanish word inside an English one is not.
 */
function languageOf(role: string): "es" | "en" | undefined {
  const found = new Set(normalizeForComparison(role).split(" ").map((word) => language.get(word)));
  return found.has("es") ? "es" : found.has("en") ? "en" : undefined;
}

/**
 * The title the CV prints: the profile's, or the model's when it is that same title in the CV's language.
 *
 * `unsure` is the one case worth telling the person: the profile's title is not in the language of the CV, and the model's
 * version of it could not be shown to mean the same. It prints as the profile has it.
 */
export function localizedRole(profileRole: string, modelRole: string, cvLanguage: string): { role: string; unsure: boolean } {
  const own = profileRole.trim();
  const written = modelRole.trim();
  if (!own) return { role: own, unsure: false };
  if (written && sameRole(own, written)) return { role: normalizeForComparison(own) === normalizeForComparison(written) ? own : written, unsure: false };

  const wanted = cvLanguage.trim().toLowerCase().slice(0, 2);
  const mine = languageOf(own);
  return { role: own, unsure: mine !== undefined && (wanted === "es" || wanted === "en") && mine !== wanted };
}
