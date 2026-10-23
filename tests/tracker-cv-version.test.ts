import { describe, expect, it } from "vitest";
import { cvVersionFingerprint, suggestCvVersionLabel } from "@/lib/tracker/cv-version";
import type { CVDocument } from "@/lib/schemas/cv";

/** Sólo llena lo que `cvVersionFingerprint`/`suggestCvVersionLabel` leen —
 *  `header.fullName` y `sections` — el resto del documento no le importa a
 *  esta lógica, así que no hace falta un CV completo y válido para probarla. */
function cv(overrides: Partial<CVDocument>): CVDocument {
  return {
    header: { fullName: "Ana Pérez", location: "", phone: "", email: "", links: [] },
    ...overrides,
  } as CVDocument;
}

describe("cvVersionFingerprint", () => {
  it("dos adaptaciones con la misma experiencia dan el mismo fingerprint", () => {
    const a = cv({
      sections: [
        {
          kind: "experience",
          title: "EXPERIENCIA",
          items: [
            { company: "Acme", role: "Backend Engineer", location: "", dateRange: "", bullets: ["Bullet uno"] },
          ],
        },
      ],
    });
    const b = cv({
      sections: [
        {
          kind: "experience",
          title: "EXPERIENCE",
          items: [
            { company: "ACME", role: "backend engineer", location: "", dateRange: "", bullets: ["Bullet distinto, reescrito para otro aviso"] },
          ],
        },
      ],
    });
    expect(cvVersionFingerprint(a)).toBe(cvVersionFingerprint(b));
  });

  it("distinta experiencia incluida da un fingerprint distinto", () => {
    const a = cv({
      sections: [
        {
          kind: "experience",
          title: "EXPERIENCIA",
          items: [{ company: "Acme", role: "Backend", location: "", dateRange: "", bullets: ["x"] }],
        },
      ],
    });
    const b = cv({
      sections: [
        {
          kind: "experience",
          title: "EXPERIENCIA",
          items: [{ company: "Beta", role: "Frontend", location: "", dateRange: "", bullets: ["x"] }],
        },
      ],
    });
    expect(cvVersionFingerprint(a)).not.toBe(cvVersionFingerprint(b));
  });

  it("sin experiencia, cae a la educación", () => {
    const withEdu = cv({
      sections: [
        { kind: "education", title: "EDUCACIÓN", items: [{ institution: "UBA", degree: "", location: "", date: "", honors: "" }] },
      ],
    });
    const withOtherEdu = cv({
      sections: [
        { kind: "education", title: "EDUCACIÓN", items: [{ institution: "UTN", degree: "", location: "", date: "", honors: "" }] },
      ],
    });
    expect(cvVersionFingerprint(withEdu)).not.toBe(cvVersionFingerprint(withOtherEdu));
  });

  it("sin experiencia ni educación, cae al nombre — nunca explota", () => {
    expect(() => cvVersionFingerprint(cv({ sections: [] }))).not.toThrow();
  });
});

describe("suggestCvVersionLabel", () => {
  it("usa el rol más reciente de la experiencia", () => {
    const document = cv({
      sections: [
        {
          kind: "experience",
          title: "EXPERIENCIA",
          items: [{ company: "Acme", role: "Backend Engineer", location: "", dateRange: "", bullets: ["x"] }],
        },
      ],
    });
    expect(suggestCvVersionLabel(document)).toBe("CV Backend Engineer");
  });

  it("sin experiencia, un default legible", () => {
    expect(suggestCvVersionLabel(cv({ sections: [] }))).toBe("CV sin título");
  });
});
