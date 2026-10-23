import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CredentialPhoto, PhotoReader, PhotoReceipt, Review, photoReceipt } from "@/components/profile/hub/CredentialPhoto";
import { PracticalFields } from "@/components/profile/hub/PracticalFields";
import { SkillsSection } from "@/components/profile/hub/SkillsSection";
import { readCredential } from "@/lib/ocr/credential";
import { OCR_FAILURE } from "@/lib/ocr/failure";
import { addCertification } from "@/lib/profile/entities";
import { emptyStoredProfile } from "@/lib/schemas/profile-v2";
import { STAMP, newId } from "./helpers/profiles";

/**
 * What is drawn of «Leer de una foto» (e5, O18): nothing at all with the switch off, and with it on the button, the notice that says what happens to the photo before one is
 * chosen, the boxes where what was found is looked at and changed, and a way on after every failure. Choosing a photo and reading it is the browser walkthrough's (`e2e-pt9`).
 */

afterEach(() => vi.unstubAllEnvs());

const on = () => vi.stubEnv("NEXT_PUBLIC_CVP_EXPERIMENTS", "credential_photo");
const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const noop = () => {};

const CARD = "LICENCIA NACIONAL DE CONDUCIR\nCLASE: B1\nNACIMIENTO 03/11/1990\nVENCIMIENTO 12/05/2029";

describe("with the switch off", () => {
  it("draws nothing, for a licence or for a carnet", () => {
    expect(html(createElement(CredentialPhoto, { kind: "license", onUse: noop }))).toBe("");
    expect(html(createElement(CredentialPhoto, { kind: "expiry", onUse: noop }))).toBe("");
  });

  it("leaves the cards as they were: nothing about a photo in the practical facts nor in a certification", () => {
    const profile = emptyStoredProfile();
    addCertification(profile, { name: "Carnet de manipulación de alimentos" }, { now: STAMP, newId });
    const practical = html(createElement(PracticalFields, { profile, now: new Date(STAMP) }));
    const skills = html(createElement(SkillsSection, { profile, onRemoved: noop, now: new Date(STAMP) }));
    for (const drawn of [practical, skills]) {
      expect(drawn).not.toContain("data-credential-photo");
      expect(text(drawn)).not.toMatch(/foto/i);
    }
  });
});

describe("with the switch on", () => {
  it("is a button, and says nothing of the photo until it is pressed", () => {
    on();
    const drawn = html(createElement(CredentialPhoto, { kind: "license", onUse: noop }));
    expect(drawn).toContain("data-credential-photo-entry");
    expect(text(drawn)).toBe("Leer de una foto");
    expect(drawn).not.toContain("data-photo-notice");
  });

  it("is in the practical facts, beside the licence and its date, and in each certification", () => {
    on();
    const profile = emptyStoredProfile();
    addCertification(profile, { name: "Carnet de manipulación de alimentos" }, { now: STAMP, newId });
    expect(html(createElement(PracticalFields, { profile, now: new Date(STAMP) }))).toContain("data-credential-photo-entry");
    // On a certification it is the one button of the card —the same that adds a respaldo, when that is on too— and it says what it is for (U41).
    const certifications = html(createElement(SkillsSection, { profile, onRemoved: noop, now: new Date(STAMP) }));
    expect(certifications).toContain("data-evidence-add");
    expect(text(certifications)).toContain("Leer de una foto");
    expect(certifications).not.toContain("data-credential-photo-entry");
  });

  it("is mounted where a licence and a certification are edited, and nowhere that keeps the photo", () => {
    expect(readFileSync("components/profile/hub/PracticalFields.tsx", "utf8")).toContain('<CredentialPhoto\n            kind="license"');
    // A certification reads its photo from the card's one entry (`EvidenceBlock`), which is handed what to do with what was confirmed.
    expect(readFileSync("components/profile/hub/SkillsSection.tsx", "utf8")).toMatch(/<EvidenceBlock[\s\S]*?photo=\{\{\s*kind: "expiry"/);
  });
});

describe("before a photo is chosen", () => {
  it("tells the person what happens to it: read here, not uploaded, not stored, not given to an AI, and what is kept", () => {
    on();
    const drawn = text(html(createElement(PhotoReader, { kind: "license", current: "", onUse: noop, onClose: noop })));
    expect(drawn).toContain("La foto se lee en este navegador");
    expect(drawn).toContain("no se sube, no se guarda y no va a ninguna IA");
    expect(drawn).toContain("solo con la clase y la fecha de vencimiento");
    expect(drawn).toMatch(/baja unos \d+ MB de este mismo sitio/);
    expect(drawn).toContain("antes de guardar");
  });

  it("says only the date for a carnet, which has no class", () => {
    const drawn = text(html(createElement(PhotoReader, { kind: "expiry", current: "", onUse: noop, onClose: noop })));
    expect(drawn).toContain("solo con la fecha de vencimiento");
    expect(drawn).not.toContain("la clase");
  });

  it("says only the class when the screen that reads it keeps no date", () => {
    const drawn = text(html(createElement(PhotoReader, { kind: "license", current: "", onUse: noop, onClose: noop, withExpiry: false })));
    expect(drawn).toContain("solo con la clase");
    expect(drawn).not.toContain("fecha de vencimiento");
  });

  it("takes a photo as any phone gives it, and never opens the camera by itself: that is the system's to offer", () => {
    const drawn = html(createElement(PhotoReader, { kind: "license", current: "", onUse: noop, onClose: noop }));
    expect(drawn).toContain('type="file"');
    expect(drawn).toContain('accept="image/*"');
    expect(drawn).not.toContain("capture=");
    expect(drawn).toMatch(/pointer-coarse:min-h-11/);
    expect(readFileSync("components/profile/hub/CredentialPhoto.tsx", "utf8")).not.toMatch(/getUserMedia|mediaDevices/);
  });

  it("has a way out as easy as the way in", () => {
    const drawn = text(html(createElement(PhotoReader, { kind: "license", current: "", onUse: noop, onClose: noop })));
    expect(drawn).toContain("Cancelar");
  });
});

describe("what was found", () => {
  const review = (kind: "license" | "expiry", card: string, current = "", withExpiry = true) => html(createElement(Review, { kind, found: readCredential(card), current, onUse: noop, onCancel: noop, withExpiry }));

  it("is in boxes to look at and change: the class in a box, the date chosen when there is no doubt which it is", () => {
    const drawn = review("license", CARD);
    expect(drawn).toContain('value="B1"');
    expect(drawn).toContain("Esto es lo que encontramos en la foto");
    expect(drawn).toContain("leer una foto se equivoca");
    // The one date that says it lapses is the chosen chip, and the picker has it.
    expect(drawn).toMatch(/role="radio"[^>]*aria-checked="true"[^>]*>05\/2029/);
    expect(drawn).not.toContain("11/1990");
    expect(text(drawn)).toContain("Las fechas de nacimiento y de otorgamiento no las tenemos en cuenta");
  });

  it("chooses no date when there are several to choose from: the person says which", () => {
    const drawn = review("license", "CLASE B1\nVENCE 12/05/2029\nVTO 03/2034");
    expect(drawn).toContain("05/2029");
    expect(drawn).toContain("03/2034");
    expect(drawn).not.toContain('aria-checked="true"');
  });

  it("says when the class was not found, and still lets the person write it", () => {
    const drawn = review("license", "VENCIMIENTO 12/05/2029");
    expect(text(drawn)).toContain("No encontramos la clase en la foto");
    expect(drawn).toContain("data-photo-license");
  });

  it("says when no date was found, and offers the picker all the same", () => {
    const drawn = review("license", "CLASE: B1");
    expect(text(drawn)).toContain("No encontramos ninguna fecha de vencimiento en la foto");
    expect(drawn).toContain("Vence");
  });

  it("asks only for the class when the screen that reads it keeps no date", () => {
    const drawn = review("license", CARD, "", false);
    expect(drawn).toContain('value="B1"');
    expect(drawn).not.toContain("Fecha de vencimiento");
    expect(drawn).not.toContain("Vence");
  });

  it("has no box for the class when it is a carnet", () => {
    const drawn = review("expiry", "VÁLIDO HASTA 15/08/2027");
    expect(drawn).not.toContain('id="photo-license"');
    expect(drawn).toContain("08/2027");
  });

  it("says what the profile has now, when it says something else", () => {
    expect(text(review("license", CARD, "A"))).toContain("Ahora dice «A». Si lo usás, lo cambiamos.");
    expect(text(review("license", CARD, "B1"))).not.toContain("Ahora dice");
  });

  it("keeps nothing until it is told to: it asks, with a button that does nothing when there is nothing to use", () => {
    expect(review("license", CARD)).toContain("Usar estos datos");
    const nothing = review("license", "asdf");
    expect(nothing).toMatch(/<button[^>]*disabled=""[^>]*>Usar estos datos/);
  });

  it("shows nothing else of the card: not a name, not a document, not an address, not the blood group", () => {
    const drawn = review("license", `${CARD}\nPEREZ LUCIA\nDNI 30.123.456\nDOMICILIO AV. CORRIENTES 1234\nGRUPO SANGUINEO O+ DONANTE SI`);
    for (const secret of ["PEREZ", "LUCIA", "30.123.456", "CORRIENTES", "SANGUINEO", "DONANTE"]) expect(drawn, secret).not.toContain(secret);
  });
});

describe("what was kept (U41)", () => {
  it("says what the photo gave, and what became of it: a licence has a class and a date", () => {
    expect(photoReceipt("license", { license: "B1", expires: { year: 2029, month: 5 } })).toBe("Usamos la clase B1 y el vencimiento mayo de 2029. La foto no quedó guardada en ningún lado.");
  });

  it("says only the date for a carnet, which has no class, and never the class the box of a licence would have", () => {
    expect(photoReceipt("expiry", { license: null, expires: { year: 2028, month: 8 } })).toBe("Usamos el vencimiento agosto de 2028. La foto no quedó guardada en ningún lado.");
    expect(photoReceipt("expiry", { license: "B1", expires: { year: 2028, month: 8 } })).not.toContain("clase");
  });

  it("says what was used when only one of the two was, and that nothing was when neither was", () => {
    expect(photoReceipt("license", { license: "B1", expires: null })).toBe("Usamos la clase B1. La foto no quedó guardada en ningún lado.");
    expect(photoReceipt("license", { license: null, expires: { year: 2030 } })).toMatch(/^Usamos el vencimiento .*2030\. La foto no quedó guardada en ningún lado\.$/);
    expect(photoReceipt("license", { license: null, expires: null })).toBe("No usamos nada. La foto no quedó guardada en ningún lado.");
  });

  it("is a line that offers «Deshacer» when there is a way back, and does not when there is not", () => {
    const withUndo = html(createElement(PhotoReceipt, { line: "Usamos la clase B1.", onUndo: noop }));
    expect(withUndo).toContain("data-photo-done");
    expect(withUndo).toContain('role="status"');
    expect(text(withUndo)).toBe("Usamos la clase B1. Deshacer");
    const without = html(createElement(PhotoReceipt, { line: "Usamos la clase B1." }));
    expect(text(without)).toBe("Usamos la clase B1.");
    expect(without).not.toContain("<button");
  });

  it("is told by whoever reads the photo, and the way back gives back only what the photo gave: that is asked of the screen, not made of the profile as it was", () => {
    const component = readFileSync("components/profile/hub/CredentialPhoto.tsx", "utf8");
    expect(component).toContain("const undo = onUse(result);");
    expect(component).toMatch(/export type OnUse = \(result: PhotoResult\) => \(\(\) => void\) \| void;/);
    // The licence gives its class back (`PracticalFields`), as the certification does its date (`SkillsSection`).
    expect(readFileSync("components/profile/hub/PracticalFields.tsx", "utf8")).toMatch(/onUse=\{\(\{ license \}\) => \{[\s\S]*?return \(\) =>/);
    expect(readFileSync("components/profile/hub/SkillsSection.tsx", "utf8")).toMatch(/photo=\{\{\s*kind: "expiry",\s*onUse: \(\{ expires \}\) => \{[\s\S]*?return \(\) =>/);
  });

  it("does not repeat an id when the card is on a page more than once: the box of the class is found by what it is, not by a name that every card would share", () => {
    on();
    const profile = emptyStoredProfile();
    addCertification(profile, { name: "Carnet A" }, { now: STAMP, newId });
    addCertification(profile, { name: "Carnet B" }, { now: STAMP, newId });
    const drawn = html(createElement(SkillsSection, { profile, onRemoved: noop, now: new Date(STAMP) }));
    const ids = [...drawn.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(readFileSync("components/profile/hub/CredentialPhoto.tsx", "utf8")).not.toContain('id="photo-license"');
  });
});

describe("when it does not work", () => {
  it("says so in words that leave the person a way on, for every way it can fail", () => {
    for (const [reason, message] of Object.entries(OCR_FAILURE)) {
      expect(message, reason).not.toMatch(/error|exception|undefined|null|stack/i);
    }
  });
});

describe("the photo has no way out", () => {
  const sources = ["components/profile/hub/CredentialPhoto.tsx", "lib/ocr/engine.ts", "lib/ocr/image.ts", "lib/ocr/credential.ts", "lib/ocr/failure.ts"];
  const code = (file: string) => readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

  it("is not sent, not stored and not turned into text that could be: none of these files uses what would do it", () => {
    for (const file of sources) {
      expect(code(file), file).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage|indexedDB|FormData|toDataURL|createObjectURL|FileReader|console\./);
    }
  });

  it("does not hand the text of the card to anything: the component keeps what `readCredential` returns and not what it was given", () => {
    const component = code("components/profile/hub/CredentialPhoto.tsx");
    expect(component).toMatch(/readCredential\(await readText\(/);
    expect(component).not.toMatch(/useState<string>|setText|rawText|\.text\b/);
  });
});
