/**
 * What travels to the model, per action, in the words the screens use.
 *
 * Three screens said it three ways, and two of them said the opposite of the privacy policy (clause 5): a consent
 * that told someone their name and contact details never travel, before an action that sends the text they gave as
 * it is, and two provider warnings that said every generation sends the name and the contact details, when it sends
 * neither. A person who reads the policy and then the screen should find the same thing in both, so the facts live
 * here once, and the policy is what they say: if it changes, this does.
 *
 * Two kinds of action, because that is how the policy tells them apart:
 *  - `generate`: a CV, an email or an answer for a posting. The name goes as a generic token that the server puts back
 *    in the reply, and the phone, the email and the links do not go at all: they are added to the document afterwards.
 *  - `read`: importing a CV, telling the path in one's own words, splitting an answer into shorter facts — and, for whoever turns
 *    it on, having their own model choose which fixed question follows an answer (an experiment). The text that
 *    was written or uploaded is what is processed, because reading it to fill in the profile is what the model is asked to do. What
 *    is taken out of it first is what identifies and is not what is read: the name, the emails, the phones and the links of a profile,
 *    which the browser replaces by marks and puts back in what the model answers (`lib/parse/mask-contact.ts`); and what the product
 *    does not use — a birth date, a document number, a marital status, the blood group a licence carries and the like, which the
 *    browser recognises by their label and strikes out before anything is sent (`lib/parse/redact.ts`) — and a section of references,
 *    which is other people's. Until the stage that wrote this, the name and the contact details did travel with the text: it is the
 *    one place the screens and the policy changed together.
 *
 * Plain strings, with no markup, so that each screen can set them as it likes.
 */

/** What is never sent, whatever the action. */
export const NEVER_SENT = "Tampoco se envía tu contraseña, ni datos de pago, ni tu dirección IP.";

/** `generate`: what goes, and what stays on our side. */
export const GENERATE = {
  sent: "Tu ciudad, tu experiencia, tu formación y el texto del aviso que pegaste.",
  nameStays: "Tu nombre real tampoco viaja",
  nameStaysWhy: ": el servidor lo reemplaza por un token genérico antes de llamar al modelo y lo repone recién en la respuesta que te llega.",
  contactStays: "Tu teléfono, tu correo y tus enlaces no viajan",
  contactStaysWhy: ": no hacen falta para escribir, así que se los agrega nuestro servidor al CV y al email después de generarlos.",
} as const;

/** `read`: what goes, what is taken out of it first, and what that does not reach. */
export const READ = {
  sent: "El texto que escribiste o subiste, sin tu nombre, tu correo, tu teléfono ni los enlaces de tu perfil, y sin los datos personales que no usamos.",
  /** The one sentence of what the browser does before a text is read, which the notice of the free key says as well. */
  masked: "Antes de enviar un texto para leerlo, tu navegador tapa tu nombre, tu correo, tu teléfono y los enlaces de tu perfil, y los datos personales que no usamos.",
  covered: "Tu nombre, tu correo, tu teléfono y los enlaces de tu perfil no viajan",
  coveredWhy: ": tu navegador los reemplaza por marcas antes de enviarlo y los vuelve a poner cuando llega la respuesta. Tapa lo que reconoce, y no más: un apodo, o un teléfono escrito con palabras, no.",
  travels: "Lo que contás de tu experiencia sí viaja, porque es lo que se lee.",
  left: "Los datos personales que no usamos no salen de tu dispositivo",
  leftWhy: ": tu navegador tapa la fecha de nacimiento, el documento, el estado civil, los datos de salud de una licencia y otros que reconoce por su rótulo, y toda la sección de referencias, que tiene datos de otras personas.",
} as const;

/**
 * `photo`: a photo or a scan of a CV, read by the person's own model. It is the one reading that cannot be struck out first —
 * nothing knows where a document number is in a picture until it has been read — so it goes whole, and only with a key of their
 * own: never to our provider on their behalf.
 */
export const PHOTO = {
  sent: "La foto entera, con todo lo que se vea en ella",
  sentWhy: ": también tus datos personales, que no podemos tapar antes de leerla.",
  kept: "No la guardamos: va con el pedido al proveedor que configuraste en Ajustes y se descarta con él. Lo que lee vuelve como texto para que lo compares con tu foto, y de ese texto sí tapamos esos datos antes de usarlo.",
} as const;

/** Under the button that reads a photo with the person's own model: what goes, and that it is theirs to look at before it is used. */
export const photoFooter = (): string => `${PHOTO.sent}${PHOTO.sentWhy} ${PHOTO.kept}`;

/**
 * A short line for a warning about a provider, which says both: what a generation sends, and what a reading does. It
 * goes after a colon ("Lo que le llega: …"), so it starts in lower case.
 */
export const TO_AN_UNVERIFIED_PROVIDER =
  "cada generación le manda tu historial laboral, tu formación y los textos que cargaste, sin tu nombre real ni tus datos de contacto; " +
  "leer un CV o tu relato le manda el texto, sin tu nombre, tu correo, tu teléfono ni los enlaces de tu perfil, y sin los datos personales que no usamos (fecha de nacimiento, documento, estado civil…).";

/** Under a button that reads a text with the person's own model: where it goes, and what goes with it. */
export function readFooter(byok: boolean): string {
  return `${byok ? "El texto se envía al proveedor que configuraste en Ajustes" : "El texto se envía a nuestro proveedor de IA"}; antes tapamos tu nombre, tu correo, tu teléfono y los enlaces de tu perfil, y los datos personales que no usamos (fecha de nacimiento, documento, estado civil…).`;
}
