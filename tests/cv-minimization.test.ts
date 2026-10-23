import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CVDocument } from "@/components/cv/CVDocument";
import { baseCv, profileToCVDocument } from "@/lib/cv/from-profile";
import { parseCv } from "@/lib/parse/cv-heuristic";
import { linesFromText } from "@/lib/parse/lines";
import { applyParsedDocument } from "@/lib/parse/to-profile";
import { cvDocumentSchema } from "@/lib/schemas/cv";
import { emptyStoredProfile } from "@/lib/schemas/profile-v2";

/**
 * O7 (e5): what a CV is made from leaves out what is not anybody's business — a home address, which in Buenos Aires cost the
 * people who lived in some neighbourhoods 28% of the callbacks (Zanoni et al., BID 2022), a photo, and the health data a driving
 * licence carries. These are the regression tests for a promise that holds today: a CV that one day grows a photo or an address
 * line has to fail here first.
 */

const CV_WITH_EVERYTHING = `MARCOS GIMÉNEZ
Dirección: Av. Corrientes 1234, 5º B
Buenos Aires, Argentina | +54 11 4555 0101 | marcos.gimenez@example.com
Fecha de nacimiento: 02/07/1994
Licencia de conducir: B1
Grupo sanguíneo: 0+
Donante: Sí

EXPERIENCIA LABORAL

Logística Sur | Chofer de reparto | marzo 2021 – actualidad
• Reparto de 40 pedidos por día en zona norte.
• Control de la carga y de los remitos.

FORMACIÓN
Técnico en Logística
Instituto Técnico Buenos Aires
2015 - 2017`;

const NOW = "2026-10-06T12:00:00.000Z";
let n = 0;
const profile = applyParsedDocument(emptyStoredProfile(), parseCv(linesFromText(CV_WITH_EVERYTHING)), { name: "cv.pdf", fileHash: "h", pasted: false, chars: 1 }, { sourceId: "s", now: NOW, newId: () => `id-${++n}` }).profile;
const NOT_ON_A_CV = ["Corrientes", "1234", "5º B", "02/07/1994", "Grupo sanguíneo", "0+", "Donante"];

describe("what a CV never carries", () => {
  it("has no place for a photo or for an address: its header is a name, a city, a phone, an email and links", () => {
    const document = profileToCVDocument(profile);
    expect(cvDocumentSchema.safeParse(document).success).toBe(true);
    expect(Object.keys(document.header).sort()).toEqual(["email", "fullName", "links", "location", "phone"]);
  });

  it("does not read an address, a birth date or a licence's health data into the profile", () => {
    const kept = JSON.stringify({ contact: profile.contact, legacy: profile.legacy, unassigned: profile.unassigned, experience: profile.experience });
    for (const detail of NOT_ON_A_CV) expect(kept, detail).not.toContain(detail);
  });

  it("puts the city and the country in the header, and nothing more of where the person lives", () => {
    const document = profileToCVDocument(profile);
    expect(document.header.location).toBe("Buenos Aires, Argentina");
  });

  it("draws neither an image nor any of those details, in the preview and in the base CV", () => {
    for (const document of [profileToCVDocument(profile), baseCv(profile).document]) {
      const markup = renderToStaticMarkup(createElement(CVDocument, { data: document }));
      expect(markup).not.toMatch(/<img|<picture|<svg[^>]*role="img"/);
      for (const detail of NOT_ON_A_CV) expect(markup, detail).not.toContain(detail);
      expect(markup).toContain("Logística Sur");
    }
  });
});
