import { describe, expect, it } from "vitest";
import {
  NAME_PLACEHOLDER,
  restoreCandidateName,
  serializeProfile,
  serializeProfileForIntake,
} from "@/lib/ai/prompts/shared";
import { profileSchema } from "@/lib/schemas/profile";
import { backendProfile } from "./fixtures";

/**
 * Minimización de datos en lo que cruza la frontera.
 *
 * Los tiers pagos corren sobre nuestra key, hoy en DeepSeek: cada generación
 * manda el perfil a China, que no integra la lista de países con protección
 * adecuada de la Disp. AAIP 60-E/2016. El consentimiento sostiene la
 * transferencia (Ley 25.326 art. 12); la minimización decide cuánto se
 * transfiere.
 *
 * Los siete prompts del producto que arman un bloque de perfil —build-cv,
 * answer-questions, interview-prep, video-script, write-email, analyze-job,
 * infer-skills— lo hacen con una de estas dos funciones y con ninguna otra.
 * Ese embudo es lo que hace que este archivo alcance: fijar acá que el teléfono,
 * el correo, los links y el nombre no se serializan los saca de los siete a la
 * vez, y una octava ruta que los quisiera mandar tendría que escribir su propio
 * serializador para lograrlo. (`extract`/`split` leen sólo el documento o la
 * respuesta que la persona ya escribió, nunca el perfil guardado, así que
 * quedan fuera de este embudo por la misma razón que `cv-summary` — no porque
 * lo hayan escapado.)
 *
 * Cuatro de esos nueve —answer-questions, write-email, video-script,
 * interview-prep— arman además un segundo bloque, el del CV ya generado, con
 * `summarizeCV` (`lib/ai/prompts/cv-summary.ts`), que no es ninguna de las dos
 * funciones de arriba y por lo tanto queda fuera del embudo que describe este
 * archivo. Ver la auditoría legal pre-lanzamiento: ese bloque mandaba el
 * nombre real sin pasar por acá. Su propio test de minimización vive en
 * `tests/cv-summary.test.ts`, no en éste, porque opera sobre un `CVDocument`
 * y no sobre un `Profile`.
 *
 * El NOMBRE sale como `NAME_PLACEHOLDER` y no como el valor real: es la única
 * excepción que necesitaba una salida además de la retención, porque
 * `answer-questions` responde el formulario del aviso y un formulario puede
 * preguntar el nombre. `restoreCandidateName` es esa salida — lo repone del
 * lado del servidor, sobre la respuesta ya generada, para que el modelo nunca
 * lo haya visto.
 */

const withIdentity = profileSchema.parse({
  ...backendProfile,
  fullName: "Ana Gómez",
  phone: "+54 236 555 0100",
  email: "ana.gomez@example.com",
  links: [
    { label: "github.com/perfil-ejemplo", url: "https://github.com/perfil-ejemplo" },
    { label: "linkedin.com/in/perfil-ejemplo", url: "https://linkedin.com/in/perfil-ejemplo" },
  ],
});

const SERIALIZERS = [
  ["serializeProfile", (p: typeof withIdentity) => serializeProfile(p)],
  ["serializeProfileForIntake", (p: typeof withIdentity) => serializeProfileForIntake(p)],
] as const;

describe.each(SERIALIZERS)("%s", (_name, serialize) => {
  const text = serialize(withIdentity);

  it("no manda el teléfono", () => {
    expect(text).not.toContain(withIdentity.phone);
    expect(text).not.toContain("PHONE");
  });

  it("no manda el correo", () => {
    expect(text).not.toContain(withIdentity.email);
    expect(text).not.toContain("EMAIL");
  });

  it("no manda los links", () => {
    for (const link of withIdentity.links) {
      expect(text).not.toContain(link.url);
      expect(text).not.toContain(link.label);
    }
    expect(text).not.toContain("LINKS");
  });

  it("sigue mandando lo que el modelo necesita para escribir", () => {
    // El contrapeso del test de arriba: minimizar no puede volverse vaciar. Si
    // esto falla, se sacó de más y las generaciones quedaron sin material.
    expect(text).toContain(withIdentity.experience[0].company);
    expect(text).toContain(withIdentity.experience[0].role);
  });

  it("no manda el nombre real, manda un placeholder", () => {
    expect(text).not.toContain(withIdentity.fullName);
    expect(text).toContain(NAME_PLACEHOLDER);
  });
});

describe("restoreCandidateName", () => {
  it("repone el nombre en un string suelto", () => {
    expect(restoreCandidateName(`Hola, soy ${NAME_PLACEHOLDER}.`, "Ana Gómez")).toBe(
      "Hola, soy Ana Gómez.",
    );
  });

  it("repone el nombre a cualquier profundidad, en objetos y arrays", () => {
    const value = {
      answers: [
        { question: "¿Nombre?", answer: NAME_PLACEHOLDER, shortAnswer: NAME_PLACEHOLDER },
        { question: "¿Rol?", answer: "Desarrolladora", shortAnswer: "" },
      ],
    };
    expect(restoreCandidateName(value, "Ana Gómez")).toEqual({
      answers: [
        { question: "¿Nombre?", answer: "Ana Gómez", shortAnswer: "Ana Gómez" },
        { question: "¿Rol?", answer: "Desarrolladora", shortAnswer: "" },
      ],
    });
  });

  it("no toca nada cuando el placeholder no aparece", () => {
    const value = { reply: "Todo listo.", ops: [] };
    expect(restoreCandidateName(value, "Ana Gómez")).toEqual(value);
  });

  it("reemplaza más de una aparición", () => {
    expect(restoreCandidateName(`${NAME_PLACEHOLDER} y ${NAME_PLACEHOLDER}`, "Ana")).toBe(
      "Ana y Ana",
    );
  });
});
