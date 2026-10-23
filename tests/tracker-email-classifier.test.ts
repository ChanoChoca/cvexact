import { describe, expect, it } from "vitest";
import {
  CLASSIFIER_CONFIDENCE_THRESHOLD,
  classifyEmail,
  isKnownAtsSender,
} from "@/lib/tracker/email-classifier";

describe("isKnownAtsSender", () => {
  it("reconoce los dominios de ATS de la tabla", () => {
    expect(isKnownAtsSender("no-reply@greenhouse.io")).toBe(true);
    expect(isKnownAtsSender("no-reply@us.greenhouse-mail.io")).toBe(true);
    expect(isKnownAtsSender("no-reply@hire.lever.co")).toBe(true);
    expect(isKnownAtsSender("no-reply@ashbyhq.com")).toBe(true);
    expect(isKnownAtsSender("info@getonbrd.com")).toBe(true);
  });

  it("reconoce Workday por el dominio raíz, con cualquier tenant", () => {
    expect(isKnownAtsSender("acme@myworkday.com")).toBe(true);
    expect(isKnownAtsSender("notifications@acme.myworkday.com")).toBe(true);
  });

  it("no reconoce un remitente cualquiera", () => {
    expect(isKnownAtsSender("reclutador@example.com")).toBe(false);
    expect(isKnownAtsSender("no es un email")).toBe(false);
  });
});

describe("classifyEmail — categorías", () => {
  const base = { from: "no-reply@greenhouse.io", subject: "", bodyText: "" };

  it("rechazo en español", () => {
    const r = classifyEmail({ ...base, subject: "Actualización sobre tu postulación", bodyText: "Lamentamos informarte que no fuiste seleccionado para este puesto." });
    expect(r).toMatchObject({ kind: "classified", category: "rechazo" });
  });

  it("rechazo en inglés", () => {
    const r = classifyEmail({ ...base, subject: "Your application update", bodyText: "Unfortunately we've decided to move forward with other candidates." });
    expect(r).toMatchObject({ kind: "classified", category: "rechazo" });
  });

  it("entrevista", () => {
    const r = classifyEmail({ ...base, subject: "¿Coordinamos una llamada?", bodyText: "Nos gustaría agendar una entrevista." });
    expect(r).toMatchObject({ kind: "classified", category: "entrevista" });
  });

  it("evaluación técnica", () => {
    const r = classifyEmail({ ...base, subject: "Prueba técnica", bodyText: "Te compartimos el link del technical test." });
    expect(r).toMatchObject({ kind: "classified", category: "evaluacion" });
  });

  it("oferta", () => {
    const r = classifyEmail({ ...base, subject: "We'd like to offer you the position", bodyText: "" });
    expect(r).toMatchObject({ kind: "classified", category: "oferta" });
  });

  it("confirmación de recepción", () => {
    const r = classifyEmail({ ...base, subject: "Gracias por postularte", bodyText: "Hemos recibido tu postulación." });
    expect(r).toMatchObject({ kind: "classified", category: "confirmacion" });
  });

  it("rechazo tiene prioridad sobre confirmación cuando el correo menciona las dos cosas", () => {
    const r = classifyEmail({
      ...base,
      subject: "Gracias por postularte",
      bodyText: "Hemos recibido tu postulación, pero lamentamos informarte que no fuiste seleccionado.",
    });
    expect(r).toMatchObject({ category: "rechazo" });
  });
});

describe("classifyEmail — confianza", () => {
  it("keyword + remitente conocido cruza el umbral", () => {
    const r = classifyEmail({ from: "no-reply@hire.lever.co", subject: "Interview invitation", bodyText: "" });
    expect(r.kind).toBe("classified");
    if (r.kind === "classified") {
      expect(r.matchedSender).toBe(true);
      expect(r.confidence).toBeGreaterThanOrEqual(CLASSIFIER_CONFIDENCE_THRESHOLD);
    }
  });

  it("keyword sola, de un remitente desconocido, no cruza el umbral", () => {
    const r = classifyEmail({ from: "reclutador@example.com", subject: "Interview invitation", bodyText: "" });
    expect(r.kind).toBe("classified");
    if (r.kind === "classified") {
      expect(r.matchedSender).toBe(false);
      expect(r.confidence).toBeLessThan(CLASSIFIER_CONFIDENCE_THRESHOLD);
    }
  });

  it("remitente de ATS conocido sin ninguna keyword reconocible, cae a confirmación de baja-media confianza", () => {
    const r = classifyEmail({ from: "no-reply@greenhouse.io", subject: "Novedades", bodyText: "Un mensaje sin ninguna de las palabras clave." });
    expect(r).toMatchObject({ kind: "classified", category: "confirmacion", matchedSender: true });
  });

  it("ni remitente conocido ni keyword: no clasificado", () => {
    const r = classifyEmail({ from: "alguien@example.com", subject: "Hola", bodyText: "Contenido sin nada reconocible." });
    expect(r).toEqual({ kind: "unclassified" });
  });
});

describe("classifyEmail — filtro anti-ruido", () => {
  it("un digest con 'N avisos' en el asunto se descarta", () => {
    const r = classifyEmail({ from: "no-reply@computrabajo.com", subject: "20 avisos que podrían interesarte", bodyText: "" });
    expect(r).toEqual({ kind: "digest" });
  });

  it("un digest semanal genérico se descarta", () => {
    const r = classifyEmail({ from: "no-reply@getonbrd.com", subject: "Tu resumen semanal de empleos", bodyText: "" });
    expect(r).toEqual({ kind: "digest" });
  });

  it("un cuerpo con muchos 'postulate'/'apply now' repetidos se descarta aunque el asunto sea neutro", () => {
    const r = classifyEmail({
      from: "no-reply@getonbrd.com",
      subject: "Novedades para vos",
      bodyText: "Puesto A - postulate. Puesto B - postulate. Puesto C - apply now.",
    });
    expect(r).toEqual({ kind: "digest" });
  });

  it("un correo de estado real sobre un solo puesto no se confunde con un digest", () => {
    const r = classifyEmail({ from: "no-reply@hire.lever.co", subject: "Actualización de tu postulación a Backend Engineer", bodyText: "Nos gustaría coordinar una entrevista." });
    expect(r.kind).toBe("classified");
  });
});
