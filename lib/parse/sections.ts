import { fold } from "./dictionaries";
import { stripBullet } from "./patterns";

/**
 * Section headings, in the words CVs use.
 *
 * A heading is a whole line and nothing else: "Experiencia laboral" is one,
 * "Experiencia con React y Node" is a bullet that starts with the same word. So
 * the match is anchored at both ends, after taking accents, case, punctuation
 * and decoration off the line.
 */

export type SectionKind =
  | "summary"
  | "experience"
  | "volunteer"
  | "education"
  | "skills"
  | "languages"
  | "certifications"
  | "projects"
  | "awards"
  | "interests"
  | "references"
  | "personal"
  | "contact"
  | "practical"
  /**
   * Two of the kinds above under one heading — "Certificaciones e idiomas" —
   * read a line at a time by `parsePairs` rather than forced through whichever
   * single reader the heading alone would pick.
   */
  | "mixed";

const HEADINGS: ReadonlyArray<[SectionKind, RegExp]> = [
  ["summary", /^(perfil( profesional| personal)?|resumen( profesional| ejecutivo)?|sobre mi|acerca de( mi)?|extracto|presentacion|objetivo( profesional| laboral)?|summary|professional summary|profile|professional profile|about( me)?|career objective|objective|introduccion)$/],
  ["experience", /^(experiencia( laboral| profesional| en el sector| relevante| de trabajo)?|historial laboral|trayectoria( laboral| profesional)?|antecedentes laborales|work( experience| history)?|professional experience|employment( history)?|experience|career history|experiencias)$/],
  ["volunteer", /^(voluntariado|experiencia (de|en) voluntariado|volunteer( experience| work)?|volunteering)$/],
  ["education", /^(educacion|formacion( academica| profesional)?|estudios( realizados)?|educacion y formacion|formacion y educacion|academic( background| history)?|education( and training)?|studies|estudios y formacion|titulos( academicos)?|formacion universitaria)$/],
  ["skills", /^(habilidades|aptitudes( principales)?|competencias|conocimientos|herramientas|tecnologias|skills|technical skills|top skills|habilidades tecnicas|habilidades y competencias|competencias tecnicas|skills adicionales|habilidades adicionales|additional skills|core competencies|stack( tecnologico)?|tools|technologies|conocimientos informaticos|skills & expertise|skills and expertise|areas de experiencia)$/],
  ["languages", /^(idiomas|lenguas|languages|conocimiento de idiomas|idiomas y niveles)$/],
  ["certifications", /^(certificaciones|certificados|cursos|cursos y certificaciones|formacion complementaria|capacitaciones|capacitacion|certifications|licenses( & | and )certifications|courses|training|licencias|cursos y capacitaciones|otros cursos|formacion continua|licencias y certificaciones|cursos realizados)$/],
  ["projects", /^(proyectos|proyectos personales|projects|personal projects|portfolio|portafolio|proyectos destacados)$/],
  ["awards", /^(premios|premios y reconocimientos|reconocimientos|honores|honors|awards|logros|achievements|honores y premios|honors awards|honors & awards|honors and awards|publicaciones|publications|patentes|patents)$/],
  ["interests", /^(intereses|hobbies|aficiones|actividades|otros intereses|interests|extracurriculares|actividades extracurriculares|intereses personales)$/],
  ["references", /^(referencias|references|recomendaciones|referencias laborales)$/],
  ["personal", /^(datos personales|informacion personal|personal (data|details|information)|otros datos|informacion adicional|additional information|otros datos de interes|datos de interes)$/],
  ["contact", /^(contacto|contact|contact information|datos de contacto|contactar)$/],
  ["practical", /^(disponibilidad( horaria)?|requisitos|disponibilidad y requisitos|availability|requirements|datos practicos|informacion practica)$/],
];

/** "X y Y", "X e Y", "X & Y", "X and Y" — the one shape a compound heading takes. */
const CONNECTOR = /\s+(?:y|e|&|and)\s+/;

function classifySingle(words: string): SectionKind | null {
  for (const [kind, pattern] of HEADINGS) if (pattern.test(words)) return kind;
  return null;
}

function normalizeHeading(text: string): string {
  return fold(text)
    .replace(/^\s*(?:\d{1,2}[.)-]\s+)/, "")
    .replace(/[:.\-–—_•*#=|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The kind of section a line opens, or null when it is not a heading.
 *
 * A line that starts with a bullet marker is content, whatever it says: "•
 * Idiomas" under a project is a bullet. Two recognised headings joined by "y",
 * "e", "&" or "and" — "Certificaciones e idiomas" — are `"mixed"` when they
 * name different kinds, or just that one kind when, unusually, they name the
 * same one twice.
 */
export function classifyHeading(text: string): SectionKind | null {
  let trimmed = text.trim();
  if (!trimmed || trimmed.length > 60) return null;

  // Decoration that is not a bullet: a section number ("1. Experiencia") and
  // dashes on both sides ("— EXPERIENCIA —"). A marker on the left alone, or a
  // bullet character, is a content line whatever it says: "• Idiomas".
  const numbered = trimmed.match(/^\d{1,2}[.)]\s+(.+)$/);
  if (numbered) trimmed = numbered[1]!.trim();
  const wrapped = trimmed.match(/^[—–-]{1,3}\s*(.+?)\s*[—–-]{1,3}$/);
  if (wrapped) trimmed = wrapped[1]!.trim();
  else if (stripBullet(trimmed).bullet) return null;

  const words = normalizeHeading(trimmed);
  if (!words || words.split(" ").length > 6) return null;
  // A heading has no list or sentence in it: "Skills, Tools" and "Cursos de inglés, francés" are not headings.
  if (/,/.test(trimmed)) return null;

  const direct = classifySingle(words);
  if (direct) return direct;

  const parts = words.split(CONNECTOR);
  if (parts.length === 2) {
    const [a, b] = parts as [string, string];
    const kindA = classifySingle(a);
    const kindB = classifySingle(b);
    if (kindA && kindB) return kindA === kindB ? kindA : "mixed";
  }
  return null;
}
