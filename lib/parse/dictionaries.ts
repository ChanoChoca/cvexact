/**
 * The word lists the parsers lean on, Spanish and English.
 *
 * Everything is stored accent-free and lower case — compare with `fold` — so a
 * CV typed as "Ingeniería" and one typed as "INGENIERIA" are the same word.
 * These lists decide *which line is which*; they never supply a value. A word
 * that is missing from one costs a line landing in the review with an amber
 * note, not a wrong fact in the profile.
 */

/** Lower case, no accents, no `ñ`: the form every list below is written in. */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export const wordsOf = (text: string): string[] =>
  fold(text)
    .split(/[^a-z0-9+#]+/)
    .filter(Boolean);

/** Gives each base its usual other forms: plural, feminine. */
function withForms(bases: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const base of bases) {
    out.add(base);
    out.add(`${base}s`);
    out.add(`${base}es`);
    if (base.endsWith("o")) out.add(`${base.slice(0, -1)}a`);
    if (base.endsWith("or")) out.add(`${base}a`);
  }
  return out;
}

/** Words that name what someone does. */
export const ROLE_WORDS = withForms([
  // es
  "analista", "asistente", "gerente", "director", "jefe", "coordinador", "responsable",
  "encargado", "supervisor", "desarrollador", "programador", "ingeniero", "arquitecto",
  "disenador", "consultor", "especialista", "ejecutivo", "tecnico", "administrativo",
  "auxiliar", "secretario", "recepcionista", "vendedor", "cajero", "reponedor", "operario",
  "operador", "chofer", "conductor", "repartidor", "mozo", "camarero", "cocinero", "chef",
  "ayudante", "practicante", "pasante", "becario", "aprendiz", "docente", "profesor",
  "maestro", "tutor", "investigador", "contador", "abogado", "medico", "enfermero",
  "psicologo", "fundador", "socio", "propietario", "gestor", "comercial", "representante",
  "agente", "promotor", "redactor", "editor", "productor", "estratega", "asesor",
  "presidente", "vicepresidente", "gerenciamiento", "capataz", "electricista", "mecanico",
  "albanil", "soldador", "carpintero", "peluquero", "estilista", "barista", "bartender",
  "community", "freelance", "autonomo", "voluntario", "colaborador", "instructor",
  "entrenador", "traductor", "interprete", "cientifico", "tester", "devops",
  "sre", "qa", "reclutador", "recruiter", "arquitecta", "contable", "auditor", "tesorero",
  "planificador", "programadora", "webmaster", "seo", "sem",
  // en
  "manager", "engineer", "developer", "analyst", "designer", "consultant", "specialist",
  "coordinator", "assistant", "associate", "intern", "lead", "head", "officer", "executive",
  "administrator", "representative", "technician", "architect", "founder", "cofounder",
  "co-founder", "owner", "freelancer", "contractor", "teacher", "researcher", "accountant",
  "clerk", "cashier", "server", "cook", "driver", "scientist", "writer", "strategist",
  "advisor", "adviser", "trainee", "apprentice", "president", "ceo", "cto", "cfo", "coo",
  "cio", "cmo", "vp", "principal", "staff", "partner", "supervisor", "salesperson",
  "programmer", "tester", "mentor", "volunteer", "editor", "producer", "translator",
]);

/** Seniority and level words that sit next to a role without being one. */
export const ROLE_MODIFIERS = new Set([
  "senior", "junior", "sr", "jr", "ssr", "semi", "semisenior", "trainee", "lead", "principal",
  "staff", "associate", "asociado", "adjunto", "titular", "interino", "part-time", "full-time",
]);

/** Legal forms and words that, on their own, say "this is an organisation". */
export const COMPANY_STRONG = new Set([
  "sa", "srl", "sl", "sas", "sac", "sau", "slu", "ltda", "ltd", "llc", "inc", "corp",
  "corporation", "gmbh", "ag", "bv", "plc", "co", "cia", "group", "grupo", "holding",
  "consultora", "consulting", "consultoria", "agencia", "agency", "fundacion", "foundation",
  "ong", "hospital", "banco", "bank", "clinica", "clinic", "supermercados", "supermercado",
  "farmacia", "hotel", "restaurante", "restaurant", "ministerio", "municipalidad",
  "ayuntamiento", "gobierno", "government", "universidad", "university", "instituto",
  "institute", "colegio", "school", "escuela", "cooperativa", "partners", "asociados",
  "associates",
]);

/**
 * Words that often sit in a company's name but also in a job title ("Software
 * Engineer", "Digital Marketing Manager"). They count for little, and only when
 * no role word is around to explain them.
 */
export const COMPANY_WEAK = new Set([
  "studio", "estudio", "labs", "lab", "technologies", "tecnologias", "technology",
  "tecnologia", "tech", "systems", "sistemas", "solutions", "soluciones", "software",
  "digital", "media", "empresa", "company", "compania", "comercial", "industrias",
  "industries", "servicios", "services", "logistica", "logistics", "retail",
]);

export const INSTITUTION_WORDS = new Set([
  "universidad", "university", "universitat", "universite", "universita", "instituto",
  "institute", "institut", "colegio", "college", "escuela", "school", "facultad", "faculty",
  "academia", "academy", "politecnico", "polytechnic", "conservatorio", "seminario",
  "bootcamp", "utn", "uba", "itba", "unlp", "unc", "unam", "upv", "uoc", "mit", "iese",
  "esade", "cegep", "liceo", "gymnasium", "campus", "escola", "hochschule",
]);

export const DEGREE_WORDS = new Set([
  "licenciatura", "licenciado", "grado", "ingenieria", "ingeniero", "analista", "tecnico",
  "tecnicatura", "bachelor", "bachelors", "master", "masters", "maestria", "mba", "doctorado",
  "phd", "doctorate", "diplomatura", "diplomado", "diploma", "posgrado", "postgrado",
  "postgraduate", "bachillerato", "secundario", "secundaria", "preparatoria", "curso",
  "course", "certificado", "certificate", "associate", "profesorado", "arquitectura",
  "medicina", "derecho", "abogacia", "contador", "contaduria", "psicologia", "carrera",
  "degree", "major", "minor", "especializacion", "especialista", "tesis", "b.sc", "bsc",
  "msc", "b.a", "m.a", "ba", "bs", "ma", "ms", "formacion", "fp", "ciclo", "superior",
]);

/**
 * A language's name as two documents in two languages would both reduce to —
 * "Inglés" in a CV and "English" in a LinkedIn export are one language — or,
 * for one this list does not know, its own name folded.
 */
export function languageKey(name: string): string {
  const folded = fold(name).replace(/[^a-z]/g, "");
  return LANGUAGE_NAMES[folded] ? fold(LANGUAGE_NAMES[folded]) : folded;
}

export const LANGUAGE_NAMES: Record<string, string> = {
  espanol: "Español", castellano: "Español", spanish: "Español",
  ingles: "Inglés", english: "Inglés",
  frances: "Francés", french: "Francés",
  aleman: "Alemán", german: "Alemán", deutsch: "Alemán",
  italiano: "Italiano", italian: "Italiano",
  portugues: "Portugués", portuguese: "Portugués",
  catalan: "Catalán",
  gallego: "Gallego", euskera: "Euskera", vasco: "Euskera", basque: "Euskera",
  chino: "Chino", chinese: "Chino", mandarin: "Chino", mandarino: "Chino",
  japones: "Japonés", japanese: "Japonés",
  coreano: "Coreano", korean: "Coreano",
  ruso: "Ruso", russian: "Ruso",
  arabe: "Árabe", arabic: "Árabe",
  hebreo: "Hebreo", hebrew: "Hebreo",
  hindi: "Hindi", turco: "Turco", turkish: "Turco",
  holandes: "Neerlandés", neerlandes: "Neerlandés", dutch: "Neerlandés",
  polaco: "Polaco", polish: "Polaco", sueco: "Sueco", swedish: "Sueco",
  noruego: "Noruego", norwegian: "Noruego", danes: "Danés", danish: "Danés",
  finlandes: "Finlandés", finnish: "Finlandés", griego: "Griego", greek: "Griego",
  rumano: "Rumano", romanian: "Rumano", ucraniano: "Ucraniano", ukrainian: "Ucraniano",
  guarani: "Guaraní", quechua: "Quechua", latin: "Latín",
};

/** Words people use for how well they speak a language. Kept as written, never mapped. */
export const LANGUAGE_LEVEL_WORDS = new Set([
  "nativo", "nativa", "native", "bilingue", "bilingual", "materno", "materna", "fluido",
  "fluida", "fluent", "avanzado", "avanzada", "advanced", "intermedio", "intermedia",
  "intermediate", "basico", "basica", "basic", "elemental", "elementary", "principiante",
  "beginner", "profesional", "professional", "conversacional", "conversational",
  "competencia", "proficiency", "proficient", "limited", "limitada", "full", "working",
  "a1", "a2", "b1", "b2", "c1", "c2", "escrito", "oral", "hablado", "written", "spoken",
]);

export const COUNTRIES = new Set([
  "argentina", "bolivia", "brasil", "brazil", "chile", "colombia", "costa rica", "cuba",
  "ecuador", "el salvador", "espana", "spain", "guatemala", "honduras", "mexico", "nicaragua",
  "panama", "paraguay", "peru", "puerto rico", "republica dominicana", "dominican republic",
  "uruguay", "venezuela", "estados unidos", "united states", "usa", "eeuu", "ee uu", "us",
  "canada", "reino unido", "united kingdom", "uk", "inglaterra", "england", "escocia",
  "scotland", "irlanda", "ireland", "francia", "france", "alemania", "germany", "italia",
  "italy", "portugal", "suiza", "switzerland", "austria", "belgica", "belgium", "holanda",
  "paises bajos", "netherlands", "the netherlands", "noruega", "norway", "suecia", "sweden",
  "dinamarca", "denmark", "finlandia", "finland", "polonia", "poland", "rumania", "romania",
  "grecia", "greece", "turquia", "turkey", "rusia", "russia", "ucrania", "ukraine", "china",
  "japon", "japan", "corea del sur", "south korea", "india", "australia", "nueva zelanda",
  "new zealand", "sudafrica", "south africa", "marruecos", "morocco", "egipto", "egypt",
  "israel", "emiratos arabes unidos", "uae", "singapur", "singapore", "tailandia", "thailand",
  "vietnam", "filipinas", "philippines", "indonesia", "malasia", "malaysia", "republica checa",
  "czech republic", "hungria", "hungary", "croacia", "croatia", "serbia", "bulgaria",
  "lituania", "estonia", "letonia", "luxemburgo", "islandia", "malta", "chipre", "cyprus",
]);

/** The first word of a city name that runs to two or three. */
export const CITY_PARTICLES = new Set([
  "san", "santa", "santo", "sant", "los", "las", "el", "la", "new", "nueva", "nuevo", "buenos",
  "puerto", "ciudad", "rio", "mar", "villa", "bahia", "costa", "salt", "palma", "playa",
  "punta", "fort", "port", "saint", "st", "great", "north", "south", "east", "west", "hong",
  "kuala", "tel", "abu", "al", "bad", "las", "vitoria", "gran", "alto", "bajo", "monte",
]);

export const EMPLOYMENT_TYPE_WORDS: ReadonlyArray<[RegExp, "full_time" | "part_time" | "freelance" | "contract" | "internship" | "volunteer"]> = [
  [/\b(jornada completa|tiempo completo|full[- ]?time)\b/i, "full_time"],
  [/\b(media jornada|medio tiempo|part[- ]?time|jornada parcial)\b/i, "part_time"],
  [/\b(freelance|aut[oó]nomo|independiente|por cuenta propia|self[- ]employed)\b/i, "freelance"],
  [/\b(contrato|contract|temporal|temporary|por proyecto)\b/i, "contract"],
  [/\b(pr[aá]cticas?|pasant[ií]a|internship|intern|becario)\b/i, "internship"],
  [/\b(voluntari[oa]do?|volunteer)\b/i, "volunteer"],
];

export const WORK_MODE_WORDS: ReadonlyArray<[RegExp, "onsite" | "remote" | "hybrid"]> = [
  [/\b(remoto|remote|teletrabajo|home office|trabajo a distancia)\b/i, "remote"],
  [/\b(h[ií]brido|hybrid)\b/i, "hybrid"],
  [/\b(presencial|on[- ]?site|en sitio)\b/i, "onsite"],
];

/**
 * Labels of details that are never read into the profile.
 *
 * "Dirección" and "género" are labels only as a label is written — followed by a colon or a dash, or standing alone — because
 * "Dirección de Obra", "Dirección Comercial" and "Género y desarrollo" are what a job or a course is called, and a line struck
 * out for being one would be a line of a CV nobody read.
 */
export const PERSONAL_DATA_LABELS = [
  /^(fecha|lugar) de nacimiento\b/i,
  /^nacimiento\b/i,
  /^(date|place) of birth\b/i,
  /^born\b/i,
  /^edad\b/i,
  /^age\b/i,
  /^(dni|d\.n\.i\.?|cuil|cuit|nie|nif|curp|rut|cedula|c[eé]dula|pasaporte|passport|documento|n[uú]mero de documento|id number|ssn)\b/i,
  /^estado civil\b/i,
  /^(marital status|civil status)\b/i,
  /^sexo\b/i,
  /^(g[eé]nero|gender|sex)\s*(?:[:：–—-]|$)/i,
  /^(hijos|children)\b/i,
  /^domicilio\b/i,
  /^(direcci[oó]n|address)\s*(?:[:：–—-]|$)/i,
  // …or followed by what a street starts with, for the template that drops the colon: «Dirección Av. Corrientes 1234».
  /^direcci[oó]n\s+(?:av\.?|avenida|calle|bv\.?|bulevar|boulevard|pasaje|pje\.?|ruta|diag\.?|diagonal|camino|barrio)(?![\p{L}\p{N}])/iu,
  // What a driving licence carries besides its class: the blood group and factor, and whether the holder is an organ donor (Ley
  // 24.449) — health data, which a CV has no use for and the law protects most (Ley 25.326, arts. 2 and 7). Copied from a licence
  // into a CV, they go no further than the rest. «Donante» only as a label, with its colon or alone: «Donante voluntario en el
  // Hospital Garrahan» is something someone did.
  /^(grupo sangu[ií]neo|grupo y factor|factor (?:rh|sangu[ií]neo)|tipo de sangre|blood (?:type|group))(?![\p{L}\p{N}])/iu,
  /^donante(?:\s+de\s+[oó]rganos)?\s*(?:[:：–—-]|$)/i,
];

/** Words that make a line a page footer, not content. */
export const FOOTER_PATTERNS = [
  /^page\s+\d+\s+(of|de)\s+\d+$/i,
  /^p[aá]gina\s+\d+\s+(de|of)\s+\d+$/i,
  /^\d+\s*\/\s*\d+$/,
];

/**
 * Cities well known enough to be sure of. When the words before a country are one
 * of these, "TechNova Barcelona, España" is a company and a city, not a guess;
 * otherwise where the city starts is a guess, and the entry says so.
 */
export const KNOWN_CITIES = new Set([
  // Argentina
  "buenos aires", "cordoba", "rosario", "mendoza", "la plata", "mar del plata", "tucuman",
  "san miguel de tucuman", "salta", "santa fe", "neuquen", "bahia blanca", "resistencia",
  "corrientes", "posadas", "parana", "junin", "bariloche", "san juan", "san luis", "ushuaia",
  "caba", "ciudad autonoma de buenos aires", "quilmes", "lanus", "san isidro", "tigre",
  "pilar", "moron", "san rafael", "rio cuarto", "villa maria", "rafaela", "tandil",
  // España
  "madrid", "barcelona", "valencia", "sevilla", "zaragoza", "malaga", "murcia", "palma",
  "bilbao", "alicante", "valladolid", "vigo", "gijon", "granada", "a coruna", "vitoria",
  "pamplona", "santander", "san sebastian", "las palmas", "santa cruz de tenerife",
  "cordoba", "oviedo", "salamanca", "toledo", "tarragona", "girona", "lleida", "castellon",
  "badajoz", "burgos", "leon", "logrono", "almeria", "huelva", "cadiz", "jerez", "marbella",
  // México y Centroamérica
  "ciudad de mexico", "mexico df", "cdmx", "guadalajara", "monterrey", "puebla", "tijuana",
  "queretaro", "merida", "cancun", "leon", "toluca", "san jose", "guatemala", "san salvador",
  "tegucigalpa", "managua", "panama", "ciudad de panama", "san pedro sula",
  // Sudamérica y Caribe
  "bogota", "medellin", "cali", "barranquilla", "cartagena", "bucaramanga", "lima",
  "arequipa", "trujillo", "cusco", "santiago", "santiago de chile", "valparaiso",
  "concepcion", "vina del mar", "montevideo", "punta del este", "asuncion", "la paz",
  "santa cruz", "santa cruz de la sierra", "cochabamba", "quito", "guayaquil", "cuenca",
  "caracas", "maracaibo", "la habana", "santo domingo", "san juan", "sao paulo",
  "rio de janeiro", "brasilia", "curitiba", "porto alegre", "belo horizonte", "recife",
  "salvador", "fortaleza", "florianopolis", "campinas",
  // Norteamérica
  "miami", "new york", "nueva york", "los angeles", "san francisco", "san diego", "chicago",
  "boston", "seattle", "austin", "houston", "dallas", "atlanta", "denver", "washington",
  "phoenix", "portland", "las vegas", "orlando", "philadelphia", "san jose", "new orleans",
  "toronto", "vancouver", "montreal", "ottawa", "calgary", "palo alto", "mountain view",
  "menlo park", "cupertino", "sunnyvale", "santa clara", "redmond", "bellevue",
  // Europa y resto
  "london", "londres", "manchester", "edinburgh", "dublin", "paris", "lyon", "marseille",
  "berlin", "munich", "hamburg", "frankfurt", "amsterdam", "rotterdam", "brussels",
  "bruselas", "lisboa", "lisbon", "porto", "oporto", "roma", "rome", "milan", "milano",
  "turin", "zurich", "zurich", "geneva", "ginebra", "vienna", "viena", "prague", "praga",
  "warsaw", "varsovia", "stockholm", "estocolmo", "oslo", "bergen", "copenhagen",
  "copenhague", "helsinki", "athens", "atenas", "istanbul", "estambul", "tel aviv",
  "dubai", "singapore", "singapur", "tokyo", "tokio", "seoul", "shanghai", "beijing",
  "hong kong", "sydney", "melbourne", "auckland", "bangalore", "mumbai", "delhi", "moscu",
  "moscow", "kiev", "kyiv", "budapest", "bucarest", "bucharest", "sofia", "belgrado",
  "cracovia", "krakow", "nueva delhi", "cairo", "el cairo", "casablanca", "johannesburgo",
  "johannesburg", "cape town", "ciudad del cabo", "nairobi", "lagos",
]);
