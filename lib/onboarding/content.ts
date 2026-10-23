/**
 * The words the first-run flow says that are most likely to need changing, in one
 * place. LinkedIn moves its buttons around every so often; when it does, this is
 * the file to edit, and nothing else has to know.
 */

export const LINKEDIN_GUIDE = {
  profileUrl: "https://www.linkedin.com/in/me/",
  /** What it costs and what it needs, said before the first step: the guide asked for a trip out of the app without saying how long it was. */
  before: "Son tres pasos y unos dos minutos. Se hace desde una computadora: la app de LinkedIn en el celular no trae «Guardar como PDF».",
  steps: [
    {
      title: "Abrí tu perfil",
      text: "Entrá a LinkedIn desde una computadora y abrí tu perfil: tu foto, arriba a la izquierda, y «Ver perfil».",
    },
    {
      title: "Guardalo como PDF",
      text: "Debajo de tu foto tocá «Recursos» (o «Más») y elegí «Guardar como PDF». Se descarga un archivo, que suele llamarse «Profile.pdf».",
    },
    {
      title: "Subilo acá",
      text: "Soltá ese archivo en la zona de arriba, o elegilo. Lo leemos en tu navegador: no sale de tu celular o computadora.",
    },
  ],
  note: "LinkedIn cambia sus menús de vez en cuando. Si no encontrás el botón, buscá «Guardar como PDF» en el menú de tu perfil.",
  /**
   * What does not match, and what to do: the places people get stuck, which a drawing cannot say. The menu in English, the phone, what
   * the file holds, and the way out when there is no button at all. Said in words and not shown in screenshots of LinkedIn: they go out
   * of date the next time it moves a button, and a wrong one is worse than none (`StepArt`).
   */
  ifItDoesNotMatch: [
    "Si tu LinkedIn está en inglés, el botón es «Resources» y después «Save to PDF».",
    "Desde la app del celular no aparece. Abrilo desde una computadora, o desde el navegador del celular pidiendo el «sitio de escritorio».",
    "El PDF trae tu experiencia, tus estudios, tus habilidades y tus idiomas. No trae las recomendaciones ni los mensajes.",
    "Si igual no lo encontrás, seleccioná todo el texto de tu perfil, copialo y pegalo con «Pegar el texto», en la zona de arriba.",
  ],
  zipHelp:
    "Es más completo, pero LinkedIn tarda en prepararlo (a veces hasta un día). En LinkedIn: Configuración → Privacidad de los datos → «Obtener una copia de tus datos», y elegí lo que necesitás del perfil. Cuando lo tengas, soltalo en la misma zona de arriba.",
} as const;

/**
 * What the drop zone takes: a CV as a PDF, a Word file or plain text, LinkedIn's own PDF of a profile, or its data
 * archive — the reader tells which is which from what is inside. And photos, which it cannot read but can answer: a
 * phone's file picker offers only what `accept` names, and a photo of a CV that the picker did not offer is a person
 * who found no way in, where one that is offered and then explained is one who learns to paste the text.
 */
export const DOCUMENT_ACCEPT =
  "application/pdf,.pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.txt,text/plain,.zip,application/zip,image/*";

/** The line under the drop zone that says what it reads. */
export const DOCUMENT_HINT = "PDF, Word (.docx) o texto (.txt), o el ZIP de datos de LinkedIn. Se leen en tu navegador: no se suben.";

/** What the review says about a block it is not sure of, per doubt. */
export const DOUBT_TEXT: Record<string, string> = {
  company_or_role: "No supimos cuál de estas líneas es la empresa y cuál el puesto.",
  no_company: "No encontramos la empresa.",
  no_role: "No encontramos el puesto.",
  no_dates: "No encontramos las fechas.",
  no_end: "No encontramos la fecha de fin.",
  unreadable_date: "No pudimos leer una fecha.",
  location_guess: "Separamos la ciudad del nombre; fijate si quedó bien.",
  no_institution: "No encontramos la institución.",
  no_degree: "No encontramos el título.",
};

/**
 * `company_or_role` is the one doubt experience and education share (the
 * heuristic could not tell which of two lines names which), and it reads
 * wrong on an education card in the words written for a job — "empresa y
 * puesto" where there was never a company to begin with. This is that one
 * doubt's education wording, and the label for the swap button beside it.
 */
export const EDUCATION_DOUBT_TEXT = "No supimos cuál de estas líneas es la institución y cuál el título.";
