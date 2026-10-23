import { describe, expect, it } from "vitest";
import {
  buildEmailPrompt,
  resolveEmailSubject,
  stripSubjectFromBody,
  withSignOff,
  WRITE_EMAIL_SYSTEM,
} from "@/lib/ai/prompts/write-email";
import { jobAnalysisSchema, type JobAnalysis } from "@/lib/schemas/job";
import { profileSchema } from "@/lib/schemas/profile";
import { backendProfile } from "./fixtures";

/**
 * The subject is the one line a recruiter's filter reads. A posting that says
 * to write "REF-2043 – Vendedor CABA" and gets "Desarrollador Backend – Ana
 * Gómez" instead is a discarded application, so the subject is settled in code
 * from what `analyze-job` read off the posting — never written by the model.
 *
 * The sign-off block is the other thing the recipient acts on: it is how they
 * reply, and it is copied verbatim, so a fabricated or reformatted line there
 * is a phone number that does not ring.
 */

function analysis(overrides: Partial<JobAnalysis> = {}): JobAnalysis {
  return jobAnalysisSchema.parse({
    title: "Desarrollador Backend",
    company: "Ualá",
    language: "es",
    domain: "software engineering",
    relevance: "direct",
    relevanceReason: "Backend engineer applying to a backend role.",
    requirements: [{ text: "Go", kind: "hard" }],
    ...overrides,
  });
}

function prompt(job: JobAnalysis = analysis(), profile = backendProfile) {
  return buildEmailPrompt({
    profile,
    analysis: job,
    tone: "neutral",
    length: "short",
    outputLanguage: "es",
  });
}

describe("resolveEmailSubject", () => {
  it("uses the subject the posting demanded, verbatim", () => {
    const subject = resolveEmailSubject(
      analysis({ emailSubject: "REF-2043 – Vendedor CABA" }),
    );

    expect(subject).toBe("REF-2043 – Vendedor CABA");
  });

  it("falls back to the job title when the posting demands no subject", () => {
    expect(resolveEmailSubject(analysis())).toBe("Desarrollador Backend");
  });

  it("treats a whitespace-only subject as no subject", () => {
    expect(resolveEmailSubject(analysis({ emailSubject: "   " }))).toBe("Desarrollador Backend");
  });

  it("never appends the candidate's name to the fallback", () => {
    expect(resolveEmailSubject(analysis())).not.toContain(backendProfile.fullName);
  });
});

describe("buildEmailPrompt — subject", () => {
  it("hands the settled subject over and does not ask for one", () => {
    const text = prompt(analysis({ emailSubject: "REF-2043 – Vendedor CABA" }));

    expect(text).toContain("SUBJECT (already set, do not write it): REF-2043 – Vendedor CABA");
    expect(text).not.toContain("Write the subject line");
    expect(text).toContain("Write the email body.");
  });
});

describe("buildEmailPrompt — language", () => {
  /*
   * El email lo lee el empleador y no responde a ningún texto del usuario más
   * allá del aviso: su idioma es el de la publicación que la ruta le pasa, sin
   * excepción por-pregunta como la tienen las respuestas del formulario.
   * (`languageDirective`, no `questionLanguageDirective`.)
   */

  it("va entero en un único idioma: el de la publicación", () => {
    expect(prompt()).toContain('OUTPUT LANGUAGE: write every user-visible string in "es"');
    expect(prompt()).not.toContain("the language its own question was asked in");
  });
});

describe("firma del email", () => {
  /*
   * La firma dejó de viajar en el prompt: el modelo ya no la recibe ni la
   * copia, la agrega el servidor después de generar. El cambio tiene dos
   * motivos y estos tests cubren los dos — que salga exacta por construcción, y
   * que el teléfono y el correo del candidato no se le manden a un proveedor en
   * el exterior para que los devuelva copiados (ver `IDENTITY_WITHHELD` en
   * `lib/ai/prompts/shared.ts`).
   */

  it("el prompt no lleva el teléfono, el correo ni los links", () => {
    const text = prompt();

    expect(text).not.toContain(backendProfile.phone);
    expect(text).not.toContain(backendProfile.email);
    for (const link of backendProfile.links) {
      expect(text).not.toContain(link.url);
    }
  });

  it("le dice al modelo que no escriba los datos de contacto", () => {
    // La regla vive en el system prompt, no en el del turno.
    expect(WRITE_EMAIL_SYSTEM).toContain("the server appends the contact block");
    expect(WRITE_EMAIL_SYSTEM).toContain("You do not have\n  the candidate's contact details");
  });

  it("agrega nombre, correo y teléfono, uno por línea", () => {
    const body = withSignOff("Quedo a disposición.\n\nSaludos,", backendProfile);

    expect(body.split("\n").slice(-3)).toEqual([
      backendProfile.fullName,
      backendProfile.email,
      backendProfile.phone,
    ]);
  });

  it("saltea el dato que el perfil no tiene, sin imprimir un placeholder", () => {
    const noPhone = profileSchema.parse({ ...backendProfile, phone: "" });
    const body = withSignOff("Saludos,", noPhone);

    expect(body.split("\n").slice(-2)).toEqual([noPhone.fullName, noPhone.email]);
    expect(body).not.toContain("(not given)");
  });

  it("no duplica la firma si el modelo desobedeció y firmó igual", () => {
    const already = `Saludos,\n\n${backendProfile.fullName}\n${backendProfile.email}\n${backendProfile.phone}`;

    expect(withSignOff(already, backendProfile)).toBe(already);
  });

  it("no confunde el nombre en el medio de una oración con una firma", () => {
    // El nombre puede aparecer legítimamente en el cuerpo; lo que decide es
    // cómo termina el texto, no si el nombre está en alguna parte.
    const body = withSignOff(`Como ${backendProfile.fullName}, me interesa el puesto.`, backendProfile);

    expect(body.split("\n").slice(-3)).toEqual([
      backendProfile.fullName,
      backendProfile.email,
      backendProfile.phone,
    ]);
  });

  it("no cuenta la firma dentro del presupuesto de palabras", () => {
    expect(prompt()).toContain("does not count towards that");
  });
});

/**
 * The model is told not to open with the subject and pastes it in anyway —
 * usually under an "Asunto:" label, sometimes twice. `stripSubjectFromBody` is
 * what makes the prompt's rule true; these tests pin down what "essentially the
 * subject" means, and above all that a body that merely mentions the role in a
 * real sentence is never touched.
 */
describe("stripSubjectFromBody", () => {
  const subject = "REF-2043 – Vendedor CABA";

  it("removes an exact copy of the subject at the top, with its blank line", () => {
    const body = `${subject}\n\nEstimados, escribo por la búsqueda publicada.`;

    expect(stripSubjectFromBody(body, subject)).toBe(
      "Estimados, escribo por la búsqueda publicada.",
    );
  });

  it("removes a copy carrying an Asunto/Subject-style label", () => {
    const body = `Asunto: ${subject}\n\nHola, les adjunto mi CV.`;

    expect(stripSubjectFromBody(body, subject)).toBe("Hola, les adjunto mi CV.");
  });

  it("removes every copy when the model pasted the subject more than once", () => {
    const body = `${subject}\n\n${subject}\n\nBuenos días, me postulo al puesto.`;

    expect(stripSubjectFromBody(body, subject)).toBe("Buenos días, me postulo al puesto.");
  });

  it("tolerates case, accent and punctuation drift between both copies", () => {
    const body = "ref-2043 - vendedor caba..\n\nEscribo para postularme.";

    expect(stripSubjectFromBody(body, subject)).toBe("Escribo para postularme.");
  });

  it("does not touch a natural opening that merely mentions the title in prose", () => {
    const body =
      "Mi nombre es Ana Gómez y el puesto de Vendedor en su sucursal de CABA "
      + "encaja con los cinco años que llevé tras el mostrador.\n\nSaludos.";

    expect(stripSubjectFromBody(body, subject)).toBe(body);
  });

  it("leaves a clean body byte for byte untouched", () => {
    const body = "Buenos días,\n\nLes adjunto mi CV. Quedo a disposición.\n\nAna Gómez";

    expect(stripSubjectFromBody(body, "Desarrollador Backend")).toBe(body);
  });

  it("is a no-op on empty input or an empty subject", () => {
    expect(stripSubjectFromBody("", subject)).toBe("");
    expect(stripSubjectFromBody("Algo.", "")).toBe("Algo.");
  });
});
