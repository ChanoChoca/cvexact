/**
 * The voice and the words of the product, once.
 *
 * Every synonym is one more thing to learn, and each screen that picked its own taught the person a different
 * vocabulary for the same thing: someone who "Agregó" a job on one screen was asked to "Añadir" a study on the next
 * and to "Sumar" a document on the third; the same texts were "Sin asignar" in the tray and "sin ubicar" in the bar
 * that points at it; the same card was "Tus datos" in the review and "Contacto" in the profile. This is the one list.
 *
 * - **Voice.** Voseo to speak to the person ("Contame", "Agregá", "Elegí"), never tuteo ("Cuéntame", "Agrega"). The
 *   product speaks as «nosotros» ("Leímos tu CV", "Lo guardamos así"), never as «yo»: there is no one person behind it,
 *   and the screens that said "Esto es lo que encontré" next to others that said "Lo que leímos" read as two authors.
 * - **Adding** is "Agregar", whatever is added: a job, a study, a skill, a document, a task.
 * - **What a document could not place** is "Sin asignar", and putting it somewhere is "Asignar".
 * - **Studies** are "Formación", the section of the profile; the review and the counts still say "Estudios". A CV's heading
 *   for them is the generator's to choose.
 * - **How to reach the person** is "Datos personales", the section of the profile, and "Contacto" the card of the review.
 * - **The CV the profile adds up to** is "Tu CV", wherever it is shown beside or under something else; the profile that
 *   is shown beside it is "Tu perfil".
 *
 * `tests/voice.test.ts` reads the product's own strings for what is listed here, so that a new screen written from
 * habit fails a test instead of reintroducing a second word. A wording that has a reason to be as it is (a legal text,
 * a marketing illustration of a CV) is outside the places it reads, not an exception inside them.
 */

export type Rule = {
  /** What to say instead. */
  use: string;
  /** What is not said. */
  not: RegExp;
  /** Phrases the rule must catch, so that the rule itself is under test. */
  catches: readonly string[];
  /** Phrases the rule must let through: the right word, and the look-alikes it must not mistake. */
  lets: readonly string[];
  /**
   * Files the rule does not read, each for a reason said where the rule is. A wording that has a reason to be as it is lives outside the places the test
   * reads — except when one file is both: the policy's own sentence that the product also shows (`lib/legal/data-flow.ts`), which is not this rule's to change.
   */
  unless?: readonly string[];
};

/**
 * A word, or any of several, on its own and not as part of a longer one. `\b` cannot say that in Spanish: it takes
 * «í» and «á» for the edge of a word, so «leí» would match inside «leímos» and «sumá» would not match at all.
 */
const word = (alternatives: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{N}])`, "iu");

export const RULES: readonly Rule[] = [
  {
    // Tuteo is not how the product speaks. A verb that is also the third person ("el filtro cambia tu búsqueda") only
    // counts when it opens a sentence, where it can only be an order: «Genera tu CV».
    use: "voseo: «Contalo», «Generá tu CV», «Podés», «Tenés»",
    not: new RegExp(
      "(?<![\\p{L}\\p{N}])(?:cuéntam\\p{L}*|escríbel\\p{L}*|puedes|tienes|quieres|necesitas|haz clic)(?![\\p{L}\\p{N}])" +
        "|(?:^|[.!?¿¡:;—]\\s*)(?:genera|escribe|elige|selecciona|sube|pega|descarga|revisa|completa|guarda|ingresa|prueba|abre|borra|elimina|edita|corrige|confirma|cambia|carga|importa|exporta|conecta|verifica|comprueba)\\s+tus?(?![\\p{L}\\p{N}])",
      "iu",
    ),
    catches: ["Cuéntamelo a mi manera", "Genera tu CV", "Puedes pegarlo", "Revisa tus datos", "Haz clic acá", "Listo. Guarda tu CV"],
    lets: [
      "Contalo a tu manera",
      "Generá tu CV",
      "Podés pegarlo",
      "Revisá tus datos",
      "El CV genera lo que pide el aviso",
      "Elige lo que más le sirve",
      "Es una liberalidad: no cambia tu lugar en ninguna cola",
      "El filtro cambia tu búsqueda",
    ],
  },
  {
    // «Nosotros»: the product is no one person.
    use: "«nosotros»: «Encontramos», «Guardamos», «Te mostramos»",
    not: word(
      "encontré|guardé|dejé|armé|leí|sumé|agregué|quité|junté|te pido|no te pido|te voy|te muestro|te marco|te pregunto|te aviso|lo dejo|las dejo|dejo (?:solo|así|sin)|lo guardo|no las sumo|lo leo|lo junto|las junto|(?:las|los|lo|la) agrego|(?:lo|la|los|las) vuelvo a|no encuentro el",
    ),
    catches: [
      "Lo que ya leí",
      "Lo leo y lo junto",
      "te muestro lo que cambió",
      "Te voy guiando",
      "Listo, no las sumo.",
      "No encuentro el número",
      "Listo, no lo vuelvo a preguntar.",
      "Listo, dejo solo el año.",
      "¿Las agrego?",
    ],
    lets: [
      "Lo que leímos",
      "Leído con IA",
      "Leímos el archivo",
      "ya teníamos leídos",
      "Leído del aviso",
      "Te mostramos lo que cambió",
      "No encuentro mi CV",
      "Listo, no lo volvemos a preguntar.",
      "Listo, dejamos solo el año.",
      "¿Las agregamos?",
      // What a person says about themselves, in their own voice, is theirs: «Vuelvo a trabajar tras una pausa».
      "Vuelvo a trabajar tras una pausa",
      "No tengo más",
    ],
  },
  {
    // One verb for adding.
    use: "«Agregar»",
    not: word("añad\\p{L}*|sum(?:ar|[aáeéoó])\\p{L}*"),
    catches: ["Añadir", "¿Falta algo? Añadilo", "Sumá tu CV", "sumalo", "Sumamos una tarea", "Sumado como logro", "podés sumarlos", "Nada que sumar"],
    lets: ["Agregar", "Agregalo", "Agregamos una tarea", "Agregado como logro", "Nada que agregar"],
  },
  {
    // One name for the tray.
    use: "«Sin asignar» y «Asignar»",
    not: word("sin ubicar|sin-ubicar|ubicar"),
    catches: ["Sin ubicar", "texto sin ubicar", "Ubicar", "#sin-ubicar", "lo que no supimos ubicar"],
    lets: ["Sin asignar", "Asignar", "#sin-asignar", "ubicación"],
  },
  {
    // One name for the card.
    use: "«Datos personales» (el perfil) o «Contacto» (la revisión)",
    not: /^Tus datos$|\ben tus datos\b/,
    catches: ["Tus datos", "Escribirlo en tus datos"],
    lets: ["Datos personales", "Contacto", "Tus datos de contacto"],
  },
  {
    // The date, not the absence (e5, CT6): «Tu perfil se revisó por última vez en mayo», never «Hace 5 meses que no entrabas».
    // How long someone was away is a reproach, and what it would tell them is already a date. Only the product's own words:
    // what the person writes about themselves in their profile is not read here.
    use: "la fecha: «Tu última copia la hiciste el 3 de mayo», «Tu perfil se revisó por última vez en mayo»",
    not: /(?<![\p{L}\p{N}])hace\s+(?:\d+|\$\{[^}]*\}|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|unos|unas|mucho|rato|tiempo|bastante|meses|días|semanas|años)(?:\s+\p{L}+)?\s+que\s+no(?![\p{L}\p{N}])/iu,
    catches: ["Hace 5 meses que no entrabas", "Hace ${away} días que no tocabas tu perfil.", "Hace rato que no hacés una copia", "hace mucho tiempo que no revisás tu perfil", "Hace una semana que no entrás"],
    lets: ["Tu última copia la hiciste el 3 de mayo.", "Tu perfil se revisó por última vez en mayo.", "Hace falta tu nombre", "Desde hace dos años trabajo en una panadería", "No hace falta cuenta."],
  },
  {
    // The same for what lapses (e5, O2): a credential says the date it ran out — «Venció en marzo de 2026» — and not how long ago that was.
    use: "la fecha: «Venció en marzo de 2026», «Vence en noviembre de 2026»",
    not: /(?<![\p{L}\p{N}])venci(?:ó|da|do|das|dos)\s+hace(?![\p{L}\p{N}])/iu,
    catches: ["Venció hace 6 meses", "Tu matrícula está vencida hace dos años", "Carnet vencido hace un mes"],
    lets: ["Venció en marzo de 2026", "Vence en noviembre de 2026", "El plan venció el 3 de mayo", "Hace falta renovarla", "Hace un año que la renové"],
  },
  {
    // What the market wants of someone, and that they are falling behind, is not for the product to say (e5, O5, A2): it asks what the posting asks,
    // and what the person answers is theirs. «Esto apareció en 3 de las últimas 10 ofertas que analizaste» is a count; «aumentá tus chances» is a promise.
    use: "lo que dice el aviso, sin promesa ni pronóstico: «El aviso pide…», «Esto apareció en 3 de las últimas 10 ofertas que analizaste»",
    not: word(
      "aument(?:á|a|ar|es)\\s+tus\\s+(?:chances|posibilidades|probabilidades)|las\\s+empresas\\s+(?:buscan|piden|quieren|exigen|valoran)|te\\s+est(?:á|a)s\\s+quedando\\s+atr(?:á|a)s",
    ),
    catches: [
      "Aumentá tus chances de conseguir trabajo",
      "Aumenta tus posibilidades",
      "Las empresas buscan esto",
      "las empresas piden Excel",
      "Te estás quedando atrás",
    ],
    lets: [
      "El aviso pide Excel",
      "Esto apareció en 3 de las últimas 10 ofertas que analizaste",
      "Una empresa busca vendedores",
      "Todavía falta agregar tu último puesto",
      "Te falta configurar tu key",
    ],
  },
  {
    // One name for the preview, and for what is beside it.
    use: "«Tu CV» y «Tu perfil»",
    not: /^(Así queda tu CV|Así va quedando tu CV|Lo que va quedando|Tu CV, tal como va quedando|Ver cómo queda tu CV|Tu perfil hasta ahora)$/,
    catches: ["Así queda tu CV", "Así va quedando tu CV", "Lo que va quedando", "Tu CV, tal como va quedando", "Ver cómo queda tu CV", "Tu perfil hasta ahora"],
    lets: ["Tu CV", "Tu perfil", "Ver tu CV"],
  },
  {
    // One word for what lets someone drive, and one for what lapses (e5 UX, U21). The licence was «Carnet de conducir» in a label, «Carnet B1» in a line and
    // «licencia de conducir» in a question, all for the same card; and a matrícula, a habilitación and a carnet de manipulación are, for the product, credenciales.
    // What a person calls their own — «Carnet de manipulación de alimentos» — is theirs, and is data, not copy.
    use: "«licencia de conducir» para conducir, y «credencial» para lo demás",
    not: word("carnets?"),
    catches: ["Carnet de conducir", "Tiempo completo · Carnet B1 · Vehículo propio", "Con buena luz y con el carnet llenando la foto", "Cursos, talleres, licencias y carnets", "Disponibilidad, carnet, vehículo"],
    lets: ["Licencia de conducir", "Tiempo completo · Licencia B1 · Vehículo propio", "Con la credencial llenando la foto", "Cursos, talleres, licencias y credenciales"],
  },
  {
    // A pronoun with no noun to agree with is a guess about its gender: «lo» of a matrícula, «la» of a carnet. The question names the thing it asks about (e5 UX, U21).
    use: "el sustantivo y no un «lo» sin nombre: «¿Tenés esa credencial?», «¿Tenés la documentación al día?», «Sí, la tengo»",
    not: new RegExp("¿Lo tenés(?: al día)?\\?|(?<![\\p{L}\\p{N}])Sí, lo tengo(?![\\p{L}\\p{N}])", "iu"),
    catches: ["¿Lo tenés?", "¿Lo tenés al día?", "Sí, lo tengo"],
    lets: ["¿Tenés esa credencial?", "¿Tenés la documentación al día?", "Sí, la tengo", "Tenés lo que pide el aviso", "Lo tenés anotado"],
  },
  {
    // A copy is one idea in two sizes (e5 UX, U32): «Bajar una copia» is the profile, «Bajar la copia completa» is the profile and the postings, and «Recuperar una copia» is how either
    // comes back — the file says which it is. It was «Exportar mi perfil (JSON)», «Exportar cuenta (JSON)», «Exportar con contraseña», «Importar perfil», «Importar copia completa» and a card
    // called «Copia de seguridad» beside another that said where the profile lives: nine names for one thing, and a «JSON» that nobody who needs a copy has to know the word for.
    use: "«Bajar una copia», «Bajar la copia completa» y «Recuperar una copia» (en Ajustes, «Descargar perfil» e «Introducir perfil»): ni «Exportar», ni «Importar perfil», ni «(JSON)», ni «Copia de seguridad»",
    not: /Exportar (?:mi perfil|cuenta|con contraseña)|Importar (?:perfil|copia completa)|copia de seguridad|\(JSON\)/i,
    catches: ["Exportar mi perfil (JSON)", "Exportar cuenta (JSON)", "Exportar con contraseña", "Importar perfil", "Importar copia completa", "Copia de seguridad", "para recuperarlo con «Importar perfil»"],
    lets: ["Bajar una copia", "Bajar la copia completa", "Bajar una copia con contraseña", "Recuperar una copia", "Descargar perfil", "Introducir perfil", "Exportar CSV", "Exportar JSON", "Importar una insignia", "Importar CSV", "Agregar un CV o un perfil de LinkedIn"],
  },
  {
    // What a person holds the product in is a phone or a computer, and says it so (e5 UX, U36): «equipo» is also a team (el equipo de Safari, un equipo de seis), «dispositivo» and «máquina» are what
    // nobody says. The policy says «dispositivo» in the sentence that `data-flow.ts` carries, and that sentence is the policy's, not this rule's: that file is not read for it.
    use: "«celular o computadora»: ni «equipo», ni «dispositivo», ni «máquina»",
    not: new RegExp(
      "(?<![\\p{L}\\p{N}])(?:dispositivos?|máquinas?|este equipo|ese equipo|otro equipo|equipo compartido|equipo donde|al equipo (?:le|se)|el equipo tiene|cambi\\p{L}* de equipo)(?![\\p{L}\\p{N}])",
      "iu",
    ),
    catches: [
      "Vive solo en este equipo",
      "si cambiás de equipo",
      "si al equipo le falta espacio",
      "Para un equipo compartido",
      "para cambiar de dispositivo",
      "en otro dispositivo",
      "si cambiás de máquina",
      "quedó en el equipo donde lo cargaste",
      "El equipo tiene poco espacio libre",
      "Cerrar sesión en otros dispositivos",
    ],
    lets: ["Vive solo en este celular o computadora", "si cambiás de celular o de computadora", "según el equipo de Safari", "Lideró un equipo de seis diseñadores", "Liderazgo de equipos", "Dirección del equipo de producto", "personas a cargo del equipo"],
    unless: ["lib/legal/data-flow.ts"],
  },
  {
    // «Nivel gratuito», as the Google card already says it (e5 UX, U36): «tier» is English for the thing, and a person who has never held an API key is the one who reads it.
    use: "«nivel gratuito», no «tier gratuito»",
    not: word("tier gratuito|tier pago|tiers gratuitos"),
    catches: ["Su tier gratuito da 1 millón de tokens por día", "los proveedores de acá tienen tier gratuito", "no tiene tier gratuito", "Las APIs de los modelos tienen tier gratuito"],
    lets: ["Tiene un nivel gratuito con límites diarios", "su nivel gratuito limita", "no tiene nivel gratuito", "Esto es lo que gasta cada tier de servicio"],
  },
  {
    // The renewal is «la renovación» — «¿Hiciste la renovación?», «Sí, la hice» — and not a verb that takes a «la» or a «lo» of a credential whose gender the product does not know.
    use: "«la renovación»: «¿Hiciste la renovación?», «Sí, la hice», «Ya hice la renovación»",
    not: word("(?:la|lo|las|los)\\s+renov(?:é|aste|amos|aron)"),
    catches: ["Ya la renové", "¿La renovaste?", "Sí, lo renové", "Las renovamos"],
    lets: ["¿Hiciste la renovación?", "Sí, la hice", "Ya hice la renovación", "Renovaste tu plan", "Hace un año que renové el plan"],
  },
  {
    // What leads to the key of Google says that it has conditions before it says that it is free (e5 UX, U37): the key is the way into what Google asks —18 years, nothing personal, what is sent
    // is used— and a button that sells it («es gratis») in front of those is the one thing the notice that comes next should not have to take back. Elsewhere —the price list, the page of support—
    // the product is free with a key of one's own, and says so.
    use: "«Armar mi key», «Hace falta una key»: lo que lleva al aviso de la key de Google no dice que es gratis ni «gratuita» antes de decir que tiene condiciones",
    not: /Armar mi key, es gratis|(?:necesitás|hace falta) una key gratuita|la de Google es gratis|Seguir gratis, sin l[ií]mite|poné tu key en Ajustes, es gratis|Google regala una key/i,
    catches: [
      "Armar mi key, es gratis",
      "Hace falta una key gratuita",
      "Para generar el CV necesitás una key gratuita de Google",
      "Hace falta una key; la de Google es gratis y se arma acá",
      "Seguir gratis, sin límite, con tu propia key",
      "Sin IA disponible · poné tu key en Ajustes, es gratis",
      "Google regala una key con la misma cuenta que usás para Gmail",
    ],
    lets: [
      "Armar mi key",
      "Hace falta una key",
      "Para generar el CV necesitás una key.",
      "La de Google se arma acá, en dos minutos, y antes te mostramos qué condiciones tiene.",
      "Sigo con la key gratuita",
      "Antes de usar la key gratuita de Google",
      "Elegiste la key gratuita.",
      "Gratis de verdad.",
      "Armá tu propia key — es gratis.",
    ],
  },
  {
    // The line under a button that sends a text to a model says what it does in the voice of the rest (e5 UX, U40): «Usa tu IA ·» was an order in the tuteo, and a name for a mark; and the card that
    // says there is no model put the name of the button in front of «necesita una IA»: «Armar mi recorrido con tu IA necesita una IA disponible».
    use: "«Esto usa tu IA» y «Para armar mi recorrido hace falta una IA»: ni «Usa tu IA ·» ni el nombre de un botón como sujeto de «necesita una IA disponible»",
    not: /(?<![\p{L}\p{N}])Usa tu IA(?![\p{L}\p{N}])|[Nn]ecesita una IA disponible/u,
    catches: ["Usa tu IA · El texto se envía al proveedor", "Armar mi recorrido con tu IA necesita una IA disponible.", " necesita una IA disponible."],
    lets: ["Esto usa tu IA.", "Esto usa una IA.", "Para armar mi recorrido hace falta una IA, y ahora no hay ninguna disponible.", "Sin IA disponible · poné tu key en Ajustes", "Armar mi recorrido con tu IA"],
  },
];
