import type { Profile } from "@/lib/schemas/profile";
import type { JobAnalysis } from "@/lib/schemas/job";
import type { CVDocument } from "@/lib/schemas/cv";
import type { EmailLength, EmailTone } from "@/lib/schemas/outputs";
import { HONESTY_RULES, languageDirective, serializeProfile } from "./shared";
import { normalizeText } from "@/lib/text/normalize";
import { summarizeCV } from "./cv-summary";

/**
 * The message that goes in the body of the email the CV is attached to.
 * Many postings are just "send your CV to this address", and that message is
 * the entire first impression.
 */

export const WRITE_EMAIL_SYSTEM = `
You write the email a candidate sends with their CV attached.

${HONESTY_RULES}

This is an email, not a cover letter. It is read on a phone, in a hurry, among
fifty others. Respect that:

- Open by saying which position this is about. The recipient is hiring for
  several roles and needs to route the message in one line.
- Give two or three concrete reasons this candidate fits, each tied to something
  real from their background. Specifics beat adjectives: "I ran the till on
  eight-hour weekend shifts" beats "I am responsible and hard-working".
- Mention that the CV is attached.
- Close with a plain, confident call to action.
- End with a closing line that suits the tone, and STOP there. Do not write the
  candidate's name, phone or email: the server appends the contact block after
  you, from the profile, so anything you write in its place is either a
  duplicate or an invention.

NEVER:
- Open with "I am writing to express my interest in..." or any other stock
  opener.
- Flatter the company ("your prestigious firm", "I have long admired...").
- Apologise, hedge, or explain away a gap, a career change, or missing
  experience. If the candidate is applying outside their field, present them as
  someone who wants this job — do not justify why they are applying.
- List every job they have had. The CV does that.
- Use markdown, bullet points, headings, or placeholders like [Company Name].
  Plain prose with real line breaks between paragraphs.
- Invent the recipient's name. Use a neutral greeting when the posting does not
  name anyone.
- Write, alter or invent a phone number, email address or link. You do not have
  the candidate's contact details and you are not meant to: they are appended
  afterwards, verbatim from the profile.

SUBJECT: already decided — the posting's own required subject line, or the job
title where it demands none. The prompt shows it to you only so your opening
sentence can name the position naturally, in flowing prose. Never print a
"Subject:" or "Referencia:" line inside the body, never copy that line verbatim
into it, and never start the body with anything a reader could mistake for an
email header: open straight into the greeting.
`.trim();

const TONE_GUIDE: Record<EmailTone, string> = {
  formal: "Formal and respectful. Use the formal register of the output language (usted / vous / Sie). Conservative sign-off.",
  neutral: "Professional and straightforward. Neither stiff nor familiar. This is the safe default.",
  cercano: "Warm and direct, still professional. Use the informal register where the output language and local hiring culture make it natural.",
};

const LENGTH_GUIDE: Record<EmailLength, string> = {
  short: "About 80–120 words. Two short paragraphs.",
  medium: "About 150–220 words. Three paragraphs.",
};

/**
 * The subject the posting demanded, or the job title as it was published.
 *
 * Not a model decision. The old prompt asked for "the role, and the candidate's
 * name" and produced "Desarrollador Backend – Ana López Pérez" over a
 * posting that said to write "REF-2043 – Vendedor CABA" — which is how an
 * application gets filtered out before anyone reads it. `analyze-job` reads the
 * posting's text and is the only stage that can see that instruction, so the
 * subject is settled there and merely carried here.
 */
export function resolveEmailSubject(analysis: JobAnalysis): string {
  return analysis.emailSubject.trim() || analysis.title;
}

/**
 * La firma con la que termina el cuerpo: nombre, correo y teléfono.
 *
 * Antes se le pasaba al modelo dentro del prompt, con la instrucción de copiarla
 * «character for character». Dos problemas con eso, y el segundo es el que la
 * movió de lado.
 *
 * El primero es viejo y conocido: una instrucción de copiar literal es una
 * instrucción, no una garantía, y el propio prompt tenía que dedicarle cuatro
 * renglones a prohibir que la reetiquetara, la fusionara o le agregara algo.
 * Reponerla del lado del servidor la vuelve exacta por construcción — la misma
 * razón por la que `app/api/generate/cv/route.ts` reemplaza el header en vez de
 * pedirlo.
 *
 * El segundo es que mandarla implicaba transferir el teléfono y el correo del
 * candidato a un proveedor en el exterior en cada email generado, para que
 * volvieran copiados. Ver `IDENTITY_WITHHELD` en `./shared.ts`.
 *
 * Los campos vacíos se saltean en vez de imprimirse como "(not given)": esto se
 * pega tal cual al final del email, así que un placeholder acá es un
 * placeholder que lee el destinatario.
 */
export function signOffBlock(profile: Profile): string {
  return [profile.fullName, profile.email, profile.phone].filter(Boolean).join("\n");
}

/**
 * Le pega la firma al cuerpo que escribió el modelo.
 *
 * Idempotente sobre un cuerpo que ya la tenga: si el modelo desobedeció y firmó
 * igual con el nombre, no se duplica. La comprobación es sobre el final del
 * texto y no sobre todo él, porque el nombre puede aparecer legítimamente en el
 * medio de una oración.
 */
export function withSignOff(body: string, profile: Profile): string {
  const block = signOffBlock(profile);
  if (!block) return body;

  const trimmed = body.trimEnd();
  if (trimmed.endsWith(block)) return trimmed;

  return `${trimmed}\n\n${block}`;
}

// --- Keeping the subject out of the body --------------------------------------

/**
 * Everything that does not matter for deciding whether a line of the body *is*
 * the subject: case, accents, punctuation and the labels mail clients and models
 * habitually paste in front of one ("Asunto:", "Subject:", "Referencia:", "Ref.").
 */
function normalizeForCompare(text: string): string {
  const folded = normalizeText(text, { punctuation: "keep" });
  const withoutLabel = folded.replace(/^(?:asunto|subject|referencia|ref)\b[.:\-–—]?\s*/, "");
  return normalizeText(withoutLabel, { caseFold: false, stripDiacritics: false, preserveSymbols: "" });
}

/** Standard edit distance — cheap here, both strings are one line long. */
function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * The prompt forbids the body from opening with the subject, and the model does
 * it anyway often enough — usually because its opener instruction collided with
 * that rule. This is what makes the rule true: a copy of the subject that
 * survives generation is what makes the email read like a form letter pasted
 * over a mail header.
 *
 * Only a contiguous run of leading lines that are *essentially* the subject is
 * removed. The match must be near-exact after normalisation and the line cannot
 * be much longer than the subject itself, so a natural opening sentence that
 * merely mentions the job title never gets eaten.
 */
export function stripSubjectFromBody(body: string, subject: string): string {
  const target = normalizeForCompare(subject);
  if (!target || !body) return body;

  const lines = body.split("\n");
  let index = 0;
  while (index < lines.length && !lines[index].trim()) index++;

  while (index < lines.length) {
    const trimmed = lines[index].trim();
    // A real sentence about the role runs longer than a pasted subject can.
    if (trimmed.length > subject.trim().length + 30) break;
    const candidate = normalizeForCompare(trimmed);
    if (!candidate) break;
    const ratio =
      levenshteinDistance(candidate, target) /
      Math.max(candidate.length, target.length);
    if (ratio > 0.2) break;
    index++;
    // Blank lines between repeated copies travel with them.
    while (index < lines.length && !lines[index].trim()) index++;
  }

  return index === 0 ? body : lines.slice(index).join("\n");
}

export function buildEmailPrompt(input: {
  profile: Profile;
  analysis: JobAnalysis;
  cv?: CVDocument;
  tone: EmailTone;
  length: EmailLength;
  outputLanguage: string;
}): string {
  const { profile, analysis, cv, tone, length, outputLanguage } = input;

  return `
${languageDirective(outputLanguage)}

TONE: ${TONE_GUIDE[tone]}
LENGTH: ${LENGTH_GUIDE[length]} The contact block the server appends after you does not count towards that.

SUBJECT (already set, do not write it): ${resolveEmailSubject(analysis)}

=== THE JOB ===
Title: ${analysis.title}
Company: ${analysis.company || "(not stated)"}
Location: ${analysis.location || "(not stated)"}
Field: ${analysis.domain}
How close this is to the candidate's background: ${analysis.relevance} — ${analysis.relevanceReason}
Requirements: ${analysis.requirements.map((r) => r.text).join("; ") || "(none extracted)"}
=== END THE JOB ===

=== THE ATTACHED CV ===
Draw your concrete reasons from this. Do not contradict it.
${cv ? summarizeCV(cv) : "(not generated yet — rely on the profile)"}
=== END ATTACHED CV ===

=== FULL PROFILE ===
${serializeProfile(profile)}
=== END FULL PROFILE ===


Write the email body.
`.trim();
}
