/**
 * The words a posting asks for things in — Argentine Spanish, offices and trades before software — with the one place each is written.
 *
 * Everything here is data for `readRequirements` (`./requirements.ts`): what is an instrument or a system, what is a credential, what is a
 * condition of the person and not a skill, what is a trait, how a posting says that something is indispensable or only valued. It is a
 * dictionary made by hand and meant to be added to by hand: the bank of labelled postings (`tests/fixtures/avisos/`, `docs/banco-de-avisos.md`)
 * says how much of what real postings ask it already reads, and what a new posting teaches it goes here, with the posting beside it.
 *
 * Every pattern is written against text folded the way `fold` does in `requirements.ts` — lower case, no accents, the punctuation left where it
 * is, so that a comma can still end a clause. Nothing here decides what is asked of anybody: a trait is read and is never asked, an age or an
 * appearance is read so that it is never taken for a skill, and what the dictionary does not know is read as nothing at all, never as a guess.
 */

const BEFORE = "(?<![a-z0-9])";
const AFTER = "(?![a-z0-9])";

/** One global pattern for the alternatives, standing alone: never inside a longer word («excel» is not «excelente»). */
export const words = (...sources: readonly string[]): RegExp => new RegExp(`${BEFORE}(?:${sources.join("|")})${AFTER}`, "g");

/** Folds a display form the way the posting is folded, and makes its spaces any run of spaces. */
const foldedSource = (display: string): string =>
  display
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")
    .replace(/\s+/g, "\\s+");

// --- How a posting says what is a must -----------------------------------------------------------------------

/**
 * «Excluyente», «indispensable», «contar con»: what the posting says it will not do without. The heading «Requisitos» is not one: what is under it
 * is not, because of that, a must (it is said «no indicado» when nothing else says it).
 */
export const REQUIRED_MARKERS = words(
  "excluyentes?",
  "indispensables?",
  "imprescindibles?",
  "obligatori[oa]s?",
  "si o si",
  "debes?",
  "deben",
  "debera",
  "deberan",
  "es necesari[oa]",
  "son necesari[oa]s",
  "es requisito",
  "fundamental(?:es)?",
  "se exige",
  "se exigen",
  "exigimos",
  "contar con",
  "poseer",
);

/** «Deseable», «se valora», «plus»: what it would like and does not insist on. */
export const PREFERRED_MARKERS = words(
  "deseables?",
  "valorables?",
  "valorad[oa]s?",
  "se valora",
  "se valoran",
  "se valorara",
  "se valoraran",
  "sera valorad[oa]",
  "seran valorad[oa]s",
  "plus",
  "es un plus",
  "es una suma",
  "suma tener",
  "opcional(?:es)?",
);

/**
 * «Preferentemente», said at the head of what it introduces («Preferentemente con experiencia en ventas»), is a marker; said after what is
 * asked («… en atención al público, preferentemente en entidades financieras»), it qualifies the place and not the requirement.
 */
export const PREFERABLY = words("preferentemente", "preferiblemente", "preferible");

/** «No excluyente», «no es indispensable»: it says it, and says it is not a must — which is the preferred and not the required. */
export const RELAXED_MARKERS = words(
  "no excluyentes?",
  "no es excluyente",
  "no son excluyentes",
  "no indispensables?",
  "no es indispensable",
  "no son indispensables",
  "no obligatori[oa]s?",
  "no es obligatori[oa]",
);

/** «No es necesaria experiencia previa», «sin experiencia»: a posting saying it does *not* ask for something is not asking for it. */
export const NOT_NEEDED = words(
  "no es necesari[oa]s?",
  "no son necesari[oa]s",
  "no se requiere",
  "no se requieren",
  "no se exige",
  "no se exigen",
  "no hace falta",
  "no necesitas",
  "no es requisito",
  "no es requerid[oa]",
  "no requiere",
  "no requieren",
  "sin necesidad de",
  "sin experiencia(?:\\s+previa)?",
  "sin conocimientos?(?:\\s+previos?)?",
);

// --- Where in a posting things are said ------------------------------------------------------------------------

/** A heading that opens the list of what is asked, and says nothing of how much. */
export const REQUIREMENT_HEADINGS: ReadonlySet<string> = new Set([
  "requisitos",
  "requisitos del puesto",
  "requisitos para el puesto",
  "requisitos generales",
  "requisitos del candidato",
  "requerimientos",
  "requerimientos del puesto",
  "perfil",
  "perfil requerido",
  "perfil buscado",
  "perfil del candidato",
  "perfil del postulante",
  "perfil del puesto",
  "perfil que buscamos",
  "tu perfil",
  "se requiere",
  "se necesita",
  "se busca",
  "buscamos",
  "necesitamos",
  "que buscamos",
  "que necesitamos",
  "que pedimos",
  "que necesitas",
  "que se requiere",
  "que requerimos",
  "lo que buscamos",
  "lo que necesitamos",
  "lo que pedimos",
  "lo que necesitas",
  "te pedimos",
  "pedimos",
  "para postularte",
  "sos la persona ideal si",
  "sos la persona indicada si",
  "se solicita",
  "se pide",
  "solicitamos",
  "requirements",
  "qualifications",
  "what we are looking for",
  "what you need",
]);

/** A heading inside the list of what is asked — it names a kind of requirement and keeps whatever the list already said about how much. */
export const SUBHEADINGS: ReadonlySet<string> = new Set([
  "conocimientos",
  "conocimientos requeridos",
  "conocimientos tecnicos",
  "conocimientos y habilidades",
  "habilidades",
  "competencias",
  "formacion",
  "formacion y experiencia",
  "experiencia y formacion",
  "educacion",
  "experiencia",
  "experiencia requerida",
  "herramientas",
  "herramientas y conocimientos",
  "idiomas",
  "documentacion",
  "documentacion requerida",
  "disponibilidad",
]);

/** A heading that says what is a must. */
export const REQUIRED_HEADINGS: ReadonlySet<string> = new Set([
  "requisitos excluyentes",
  "requisitos indispensables",
  "requisitos imprescindibles",
  "requisitos obligatorios",
  "condiciones excluyentes",
  "excluyente",
  "excluyentes",
  "indispensable",
  "indispensables",
  "imprescindible",
  "imprescindibles",
  "obligatorio",
  "obligatorios",
  "lo imprescindible",
  "must have",
  "must haves",
  "required",
  "required qualifications",
]);

/** A heading that says what is only valued. */
export const PREFERRED_HEADINGS: ReadonlySet<string> = new Set([
  "deseable",
  "deseables",
  "requisitos deseables",
  "requisitos no excluyentes",
  "conocimientos deseables",
  "conocimientos valorables",
  "no excluyente",
  "no excluyentes",
  "valorable",
  "valorables",
  "se valora",
  "se valorara",
  "se valoran",
  "tambien valoramos",
  "tambien se valora",
  "plus",
  "es un plus",
  "suma",
  "opcional",
  "opcionales",
  "lo deseable",
  "nice to have",
  "nice to haves",
  "bonus",
  "bonus points",
  "preferred",
  "preferred qualifications",
]);

/** A heading after which come the things the job gives or does, and not the things the person must have. */
export const NEUTRAL_HEADINGS: ReadonlySet<string> = new Set([
  "ofrecemos",
  "que ofrecemos",
  "lo que ofrecemos",
  "que te ofrecemos",
  "se ofrece",
  "beneficios",
  "condiciones",
  "condiciones del puesto",
  "condiciones de trabajo",
  "modalidad",
  "modalidad de trabajo",
  "horario",
  "horarios",
  "jornada",
  "remuneracion",
  "sueldo",
  "salario",
  "lugar de trabajo",
  "zona de trabajo",
  "ubicacion",
  "tareas",
  "tareas a realizar",
  "tareas principales",
  "funciones",
  "responsabilidades",
  "que vas a hacer",
  "lo que vas a hacer",
  "que haras",
  "what you will do",
  "responsibilities",
  "what we offer",
  "benefits",
  "como trabajamos",
  "por que unirte",
  "por que sumarte",
  "descripcion",
  "descripcion del puesto",
  "el puesto",
  "sobre el puesto",
  "sobre nosotros",
  "quienes somos",
  "acerca de",
  "la empresa",
  "sobre la empresa",
  "como postularte",
  "como aplicar",
  "postulacion",
  "postulaciones",
  "contacto",
  "datos de contacto",
  "informacion adicional",
  "importante",
]);

/**
 * Headings that can stand in a paragraph with no colon and no line of their own, as they do once a page of HTML has had its tags taken out
 * («… en Avellaneda. Requisitos Secundario completo Experiencia previa …»). Only those that are not also the way a sentence begins: «Perfil
 * comercial con experiencia» is a sentence; «Requisitos Secundario completo» is a heading and its first item.
 */
export const FLAT_HEADINGS: readonly string[] = [
  "requisitos excluyentes",
  "requisitos indispensables",
  "requisitos deseables",
  "requisitos del puesto",
  "requisitos",
  "requerimientos del puesto",
  "requerimientos",
  "perfil requerido",
  "perfil buscado",
  "responsabilidades",
  "tareas a realizar",
  "funciones",
  "que ofrecemos",
  "lo que ofrecemos",
  "ofrecemos",
  "se ofrece",
  "beneficios",
  "condiciones del puesto",
  "lo que buscamos",
  "lo que vas a hacer",
  "nice to have",
  "must have",
];

/**
 * What a sentence opens with when it says what the job gives or how to reach it, and so is no requirement even where one is expected:
 * «Horario de lunes a viernes de 8 a 17 hs», «Sueldo según convenio», «Presentarse con CV».
 */
export const OFFER_SENTENCE =
  /^(?:horarios?|jornada|sueldo|salario|remuneracion|ubicacion|lugar de trabajo|zona de trabajo|modalidad|beneficios|ofrecemos|se ofrece|te ofrecemos|ingreso inmediato|contrato|capacitacion|obra social|presentarse|enviar|envia|postular|postulate|interesados|aplicar|condiciones|incorporamos|sumate|unite|tareas|funciones|responsabilidades|comision|premios?|bono|pago|duracion|contacto|dias y horarios)(?![a-z0-9])/;

/** A sentence that opens by saying it asks for something: «Se requiere título terciario», «Solicitamos manejo de Excel». */
export const ASKING_SENTENCE = /^(?:se\s+(?:requiere|requieren|solicita|solicitan|pide|piden|exige|exigen)|requerimos|solicitamos|pedimos|exigimos)(?![a-z0-9])/;

/** A sentence that says someone is wanted — what comes with it is read only where it names a requirement, and not each word that sounds like one. */
export const SEARCH_FRAME = /(?:busc\w+|necesit\w+|requer\w+|incorpor\w+|solicit\w+)[^.;]{0,30}(?<![a-z0-9])(?:persona|candidat[oa]s?|perfil|alguien)(?![a-z0-9])/;

// --- What the person must know how to do -------------------------------------------------------------------------

/**
 * How a requirement of knowing or doing something opens: what follows is the thing. The preposition is part of it, because an «experiencia
 * previa» with nothing after it names nothing a person could be asked about. «Capacidad de» and «habilidad para» are not here: what they open
 * is a trait, and is read as one.
 */
export const TASK_LEAD = words(
  "(?:minimo\\s+)?(?:de\\s+)?\\d+\\+?\\s*(?:anos?|meses)\\s+de\\s+experiencia(?:\\s+(?:previa|laboral|comprobable|demostrable))?\\s+(?:en|con|como)",
  "experiencia(?![a-z0-9])[^.;,:()]{0,45}?(?<![a-z0-9])(?:en|con|como)",
  "experiencia\\s*:",
  "experiencia(?:\\s+previa)?\\s+\\w+(?:ando|iendo|yendo)",
  "(?:que\\s+)?(?:sepa|sepas|sabe|saber)\\s+\\w+(?:ar|er|ir)",
  "conocimientos?(?![a-z0-9])[^.;,:()]{0,25}?(?<![a-z0-9])(?:de|del|en|sobre|acerca de)",
  "conocimientos?\\s*:",
  "(?:buen\\s+|excelente\\s+|muy buen\\s+)?manejo(?![a-z0-9])[^.;,:()]{0,25}?(?<![a-z0-9])(?:de|del|en)",
  "manejo\\s*:",
  "manejar",
  "dominio(?![a-z0-9])[^.;,:()]{0,15}?(?<![a-z0-9])(?:de|del)",
  "nociones(?![a-z0-9])[^.;,:()]{0,12}?(?<![a-z0-9])(?:de|sobre)",
  "uso\\s+(?:de|del)",
  "lectura\\s+(?:e\\s+interpretacion\\s+)?de",
  "interpretacion\\s+de",
  "saber\\s+(?:usar|manejar|operar)",
  "operar",
);

/**
 * A skill said without a lead, as a noun: «atención al cliente». It counts as a requirement when it is what a line is about — the first thing in
 * it, or after a word of quality («buena», «excelente») — and not when it is the second item of a list that a lead has begun («manejo de un
 * sistema de facturación y caja»: the cash is something that system handles).
 */
export const TASK_PHRASES = words(
  "atencion\\s+(?:al|del)\\s+(?:publico|cliente|clientes)",
  "atencion\\s+telefonica",
  "atencion\\s+de\\s+clientes",
  "atencion\\s+en\\s+mostrador",
  "ventas?",
  "cobranzas?",
  "reposicion",
  "armado\\s+de\\s+pedidos",
  "preparacion\\s+de\\s+pedidos",
  "picking",
  "redaccion",
  "ortografia",
);

/** A word of quality before a skill said as a noun. */
export const QUALITY_WORD = /^(?:muy\s+)?(?:buen[oa]s?|excelente|gran|alt[oa])\s/;

// --- Instruments, machines and systems ------------------------------------------------------------------------------

/**
 * What is named like a tool: software, systems, machines, instruments. Display forms, which are what a question says. Software engineering is
 * read by `hardTermsIn` (the glossary the CV checks already use, which does not know a pivot table from a pinion); this is what a posting for an
 * office, a shop, a kitchen, a warehouse or a building site names.
 */
export const TOOLS: readonly string[] = [
  // Office.
  "Excel", "Word", "PowerPoint", "Power Point", "Outlook", "Office", "Office 365", "Microsoft 365", "Paquete Office", "Pack Office",
  "Google Sheets", "Google Docs", "Google Drive", "Google Workspace", "Gmail", "Hojas de cálculo", "Teams", "Zoom", "Slack",
  // Business systems.
  "SAP", "Tango", "Tango Gestión", "Bejerman", "Xubio", "Contabilium", "Odoo", "Colppy", "Calipso", "Presea",
  "AFIP", "ARCA", "Mercado Pago", "Mercado Libre", "Tienda Nube", "Tiendanube", "Shopify", "WordPress", "WooCommerce", "Salesforce",
  "HubSpot", "Zendesk", "Freshdesk", "Power BI", "Tableau", "Looker", "Google Analytics", "Google Ads", "Meta Ads", "Facebook Ads",
  "Instagram", "TikTok", "Facebook", "LinkedIn", "WhatsApp Business", "Mailchimp", "Trello", "Jira", "Notion", "Asana",
  "WMS", "ERP", "CRM", "Active Directory", "TeamViewer", "AnyDesk", "Windows", "Linux", "macOS", "VPN", "Git", "GitHub",
  // Design and drawing.
  "Photoshop", "Illustrator", "InDesign", "After Effects", "Premiere", "Canva", "Figma", "Sketch", "AutoCAD", "SolidWorks", "SketchUp",
  "Revit", "ArchiCAD", "Lightroom", "CorelDRAW", "Blender",
  // Machines and instruments.
  "autoelevador", "autoelevadores", "zorra hidráulica", "zorra", "zorras", "transpaleta", "apilador", "montacargas",
  "amoladora", "soldadora", "fresadora", "taladro", "agujereadora", "sierra circular", "motosierra", "hidrolavadora",
  "bordeadora", "cortadora de césped", "multímetro", "pinza amperométrica", "caja registradora", "balanza", "posnet",
  "terminal de pago", "lector de código de barras", "impresora de etiquetas", "secador", "plancha", "tijeras",
  "máquina de cortar", "freidora", "horno", "batidora", "cortadora de fiambre", "licuadora", "cafetera", "máquina de espresso",
  "cámara de frío", "andamios", "nivel láser", "estación total", "mezcladora", "hormigonera",
  // Systems named by what they do.
  "sistema de gestión", "sistemas de gestión", "sistema de facturación", "sistemas de facturación", "sistema de comanda", "sistemas de comanda",
  "comanda digital", "punto de venta", "software de gestión", "sistema de stock", "herramientas de acceso remoto", "acceso remoto",
  "TCP/IP", "DHCP", "DNS",
];

/** The tools as one pattern, longest first so that «Tango Gestión» is read before «Tango» and «Office 365» before «Office». */
export const TOOL_PATTERN = new RegExp(
  `${BEFORE}(?:${[...new Set(TOOLS)]
    .sort((a, b) => b.length - a.length)
    .map(foldedSource)
    .join("|")})${AFTER}`,
  "g",
);

/**
 * Tools whose name is also a word: «technical teams», «a word of advice», «excel at». Written with a capital they are the tool; in lower case they
 * are only the tool when the clause says so with a lead («manejo de excel», «conocimientos de word»).
 */
export const CAPITALISED_ONLY: ReadonlySet<string> = new Set([
  "teams", "word", "office", "tango", "sketch", "notion", "slack", "drive", "zoom", "excel", "outlook", "premiere", "blender", "looker", "windows",
  "calipso", "presea", "odoo", "asana", "jira", "trello",
]);

/** The display form of a tool, from the way a posting wrote it (folded, with its spaces in one). */
export const TOOL_DISPLAY: ReadonlyMap<string, string> = new Map(
  TOOLS.map((display) => [
    display
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/\s+/g, " "),
    display,
  ]),
);

/** Capitals, places, taxes, classes and bodies that look like a technology to a reader of acronyms, and are not one. */
export const NOT_A_TOOL: ReadonlySet<string> = new Set([
  "CABA", "GBA", "AMBA", "BA", "CPCECABA", "CPCE", "IVA", "ART", "DNI", "CUIL", "CUIT", "RRHH", "CV", "SRL", "SA", "UTN", "UBA", "USD", "ARS", "SMVM",
  "LATAM", "SEO", "ISO", "HACCP", "BPM", "ITIL", "MM", "IP", "TCP", "SMS", "PYME", "PYMES", "CCT", "OSDE",
  // The classes of a driving licence: A1, B1, D2, E1.
  "A1", "A2", "A3", "B1", "B2", "C1", "C2", "C3", "D1", "D2", "D3", "E1", "E2", "G1", "G2", "G3",
]);

// --- What is held --------------------------------------------------------------------------------------------------------

/** A credential: a registration, a card, a certificate, a course — what a person holds and can show, and sometimes lets lapse. */
export const CREDENTIAL = words(
  "matricula(?:s)?",
  // «Contador matriculado en el CPCE» holds a registration; «gasista matriculado/a», in a title, is an adjective with nothing to be asked.
  "matriculad[oa](?:\\/a)?s?\\s+en",
  "carnet\\s+de\\s+(?:manipulacion|autoelevadorista|conductor\\s+profesional|sanidad)",
  "carne\\s+de\\s+(?:manipulacion|autoelevadorista|sanidad)",
  "libreta\\s+sanitaria",
  "habilitacion(?:es)?\\s+(?:municipal|profesional|bromatologica|de\\s+[a-z]+)",
  "certificacion(?:es)?",
  "certificado(?:s)?\\s+(?:de|en)",
  "diplomatura",
  "curso(?:s)?\\s+(?:de|en)",
  "capacitacion(?:es)?\\s+(?:certificada|en|de)\\s+[a-z]+",
);

// --- What the person is able to do or be -----------------------------------------------------------------------------------

/** A driving licence: a condition of the person, held or not, and not a thing they know how to do. */
export const LICENSE = words(
  "licencia(?:\\s+de\\s+(?:conducir|manejo)|\\s+profesional|\\s+clase\\s+\\w+)?",
  "carnet\\s+de\\s+conducir",
  "carne\\s+de\\s+conducir",
  "registro\\s+de\\s+(?:conducir|manejo)",
  "libreta\\s+de\\s+conducir",
  "carnet\\s+profesional",
);
/** «Herramientas propias»: whether the person has the tools of the trade — a fact about them, with no place in the profile to ask it. */
export const OWN_TOOLS = words("herramientas?\\s+propias?", "equipo\\s+propio");
export const VEHICLE = words(
  "(?:moto|auto|vehiculo|movilidad|bicicleta|bici|camioneta|utilitario)\\s+propi[oa]s?",
  "propi[oa]s?\\s+(?:moto|auto|vehiculo|movilidad)",
  "movilidad",
);
/** Availability said outright: it is a requirement wherever it appears. */
export const AVAILABILITY_STRONG = words(
  // «Disponibilidad para viajar» is about travelling; it is read as that.
  "disponibilidad(?!\\s+para\\s+(?:viajar|viajes|mudarse|reubicarse))(?:\\s+horaria|\\s+total|\\s+full\\s*time|\\s+inmediata)?",
  "disponibles?",
  "ingreso\\s+inmediato",
);
/** Availability said by its parts: a day, a shift. A requirement in a list of them; a description of the job elsewhere. */
export const AVAILABILITY_WEAK = words(
  "full\\s*time",
  "part\\s*time",
  "tiempo\\s+completo",
  "medio\\s+tiempo",
  "jornada\\s+(?:completa|reducida)",
  "fines?\\s+de\\s+semana",
  "sabados?",
  "domingos?",
  "feriados?",
  "turnos?\\s+rotativos?",
  "horario\\s+(?:flexible|rotativo|completo|amplio)",
  "rotativ[oa]s?",
  "nocturn[oa]s?",
  "guardias?",
);
export const ZONE_STRONG = words("residir", "residencia", "residente", "reside", "vivir\\s+en", "domicilio\\s+en");
export const ZONE_WEAK = words("zonas?\\s+(?:cercanas?|aledanas?)", "cercanias", "aledan[oa]s?", "alrededores");
export const TRAVEL = words("viajar", "viajes\\s+(?:frecuentes|ocasionales|constantes|al\\s+interior|al\\s+exterior)", "disponibilidad\\s+para\\s+viajes", "traslados?\\s+(?:frecuentes|al\\s+interior)");
export const DOCUMENTS = words(
  "documentacion\\s+(?:en\\s+regla|al\\s+dia|vigente)",
  "permiso\\s+de\\s+trabajo",
  "monotributo",
  "monotributista",
  "residencia\\s+en\\s+regla",
);

// --- What the person is, and not what they have done -----------------------------------------------------------------------

/**
 * Traits: how a person is. Read so that they are never taken for a skill, and never asked: a posting asking for «proactivo» is asking for an
 * adjective, and the profile has facts. Stems, so that «responsable», «responsabilidad» and «responsables» are one.
 */
export const TRAITS = words(
  "proactiv\\w*",
  "responsab\\w*",
  "puntual\\w*",
  "compromis\\w*",
  "dinamis\\w*",
  "dinamic\\w*",
  "creativ\\w*",
  "organizad\\w*",
  "organizacion",
  "orden",
  "prolij\\w*",
  "honest\\w*",
  "flexib\\w*",
  "adaptab\\w*",
  "autonom\\w*",
  "liderazgo",
  "empati\\w*",
  "pacienc\\w*",
  "amabil\\w*",
  "trato\\s+amable",
  "buen\\s+trato",
  "buena\\s+predisposicion",
  "predisposicion",
  "ganas\\s+de\\s+[a-z]+",
  "iniciativa",
  "trabajo\\s+en\\s+equipo",
  "capacidad\\s+(?:analitica|de\\s+negociacion|de\\s+analisis|de\\s+organizacion|de\\s+trabajo)",
  "capacidad\\s+para\\s+trabajar\\s+bajo\\s+presion",
  "trabajar\\s+bajo\\s+presion",
  "orientacion\\s+a\\s+(?:resultados|objetivos|clientes)",
  "ojo\\s+para\\s+el\\s+detalle",
  "atencion\\s+al\\s+detalle",
  "confidencialidad",
  "buena\\s+(?:comunicacion|diccion|actitud)",
  "excelente\\s+(?:comunicacion|actitud|diccion)",
  "comunicacion\\s+(?:asincronica|efectiva|clara)",
  "habilidades\\s+interpersonales",
  "actitud\\s+de\\s+servicio",
  "calidez",
  "cordialidad",
  "discrecion",
  "discret[oa]s?",
  "buena\\s+onda",
  "onda",
  "entusiasmo",
  "perseverancia",
  "humildad",
  "curiosidad",
  "colaborativ\\w*",
  "espiritu\\s+de\\s+equipo",
);

// --- What is read and never asked --------------------------------------------------------------------------------------------

/** Age, sex, appearance, marital status: a posting may say it; the product reads it only to leave it alone. */
export const PERSONAL = words(
  "edad",
  "mayor\\s+de\\s+\\d+",
  "menor\\s+de\\s+\\d+",
  "sexo",
  "genero",
  "masculino",
  "femenino",
  "estado\\s+civil",
  "buena\\s+presencia",
  "excelente\\s+presencia",
  "presencia",
  "apariencia",
  "nacionalidad",
  "foto",
  "referencias(?:\\s+(?:laborales|comprobables|verificables|personales))?",
  "antecedentes(?:\\s+penales)?",
  "buena\\s+conducta",
  "vacunacion",
  "esquema\\s+de\\s+vacunacion",
  "apto\\s+(?:medico|fisico)",
);
export const EDUCATION = words(
  "secundari[oa]",
  "terciari[oa]",
  "universitari[oa]",
  "titulo(?:\\s+(?:de|en|universitario|secundario|terciario|habilitante))?",
  "estudiantes?",
  "estudios\\s+(?:secundarios|terciarios|universitarios|completos|cursados|en\\s+curso|en\\s+\\w+)",
  "estudios\\s*:",
  "carreras?",
  "egresad[oa]s?",
  "graduad[oa]s?",
  "licenciad[oa]s?",
  "licenciatura",
  "tecnicatura",
  "posgrado",
  "maestria",
  "bachiller",
  "polimodal",
  "formacion\\s*:",
);
export const LANGUAGE = words("ingles", "portugues", "frances", "aleman", "italiano", "idiomas?", "bilingue");
export const PORTFOLIO = words("portfolio", "portafolio", "book\\s+de\\s+trabajos", "muestras\\s+de\\s+trabajo");
