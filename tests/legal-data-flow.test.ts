import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PrivacyPage from "@/app/legales/privacidad/page";
import { EXPERIMENTAL_WARNING } from "@/app/(app)/ajustes/SettingsEditor";
import { GoogleRowNotice, GoogleSetupNotice } from "@/components/ai/GoogleNotice";
import { TransferConsent } from "@/components/legal/TransferConsent";
import {
  GOOGLE_EUROPE,
  GOOGLE_FREE_FACTS,
  GOOGLE_PAID_FACTS,
  GOOGLE_TERMS_IN_FORCE,
  GOOGLE_TERMS_READ_ON_TEXT,
  GOOGLE_TERMS_URL,
  WITHOUT_AI,
} from "@/lib/ai/google-terms";
import { GENERATE, NEVER_SENT, PHOTO, READ, TO_AN_UNVERIFIED_PROVIDER, photoFooter, readFooter } from "@/lib/legal/data-flow";
import { LEGAL_EFFECTIVE_DATE, LEGAL_VERSION } from "@/lib/legal/operator";
import { maskContact } from "@/lib/parse/mask-contact";
import { redactPersonalData } from "@/lib/parse/redact";
import { toPlainProfile } from "@/lib/profile/project";
import { forSync } from "@/lib/profile/sync";
import { RISK_TEXT } from "@/lib/storage/durability";
import { storedProfileSchema } from "@/lib/schemas/profile-v2";

/**
 * What a screen says travels to the model has to be what the privacy policy says (clause 5). The facts live in
 * `lib/legal/data-flow.ts` once; these hold the screens to it, and hold it to the policy by reading the policy as it is
 * shown — rendered, so what the policy takes from the code (`lib/ai/google-terms.ts`) is checked as it reads — so editing
 * either side without the other is a failing test and not a contradiction nobody noticed.
 *
 * And, since the policy of 2026-10-07, what it says is held to the code that does it: what the synchronisation uploads (clause 3),
 * what is taken out of a text before a model reads it (clause 5), what a licence keeps (clause 7).
 */

const squash = (text: string) => text.replace(/\s+/g, " ");
/** What a person reads: no tags, a space where a paragraph or an item ends, and the entities of the text put back. */
const textOf = (html: string) =>
  squash(
    html
      .replace(/<!-- -->/g, "")
      .replace(/<\/(?:p|li|h1|h2|h3|section|div|ul|footer|nav)>/g, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'"),
  );
const source = squash(readFileSync("app/legales/privacidad/page.tsx", "utf8"));
const policyHtml = renderToStaticMarkup(createElement(PrivacyPage));
const policy = textOf(policyHtml);
const read = (path: string) => squash(readFileSync(path, "utf8"));

describe("what the policy says, which the screens repeat", () => {
  it("says that for a generation the name goes as a generic token and the contact details do not go", () => {
    expect(policy).toContain("Tu nombre viaja como un token genérico");
    expect(policy).toContain("Tu nombre real, tu teléfono, tu correo electrónico, tus enlaces");
    expect(GENERATE.nameStays).toBe("Tu nombre real tampoco viaja");
    expect(GENERATE.contactStays).toBe("Tu teléfono, tu correo y tus enlaces no viajan");
  });

  it("says that importing a CV, telling the path and splitting an answer are the exception: the text goes, and who you are does not", () => {
    expect(policy).toContain("Las excepciones son");
    expect(policy).toContain("importar un CV");
    // And, for whoever turns it on, the experiment that has their model choose among our fixed questions: it is said, and said to write nothing.
    expect(policy).toContain("tu IA elija cuál de nuestras preguntas fijas sigue");
    expect(policy).toContain("en los cuatro casos");
    expect(policy).toContain("elige una de las preguntas de una lista nuestra");
    expect(policy).toContain("Todo lo que contás de tu experiencia viaja con él");
    expect(policy).toContain("Lo que no viaja es quién sos");
    expect(READ.sent).toMatch(/^El texto que escribiste o subiste/);
    expect(READ.covered).toBe("Tu nombre, tu correo, tu teléfono y los enlaces de tu perfil no viajan");
    expect(READ.travels).toMatch(/experiencia sí viaja/);
  });

  it("no longer says what it said before the name and the contact were taken out: that they travel with the text", () => {
    for (const old of ["incluido tu nombre real si aparece ahí", "viajan con él, al mismo proveedor"]) expect(policy).not.toContain(old);
    for (const [id, text] of Object.entries({ READ: Object.values(READ).join(" "), footer: readFooter(true), provider: TO_AN_UNVERIFIED_PROVIDER })) {
      expect(text, id).not.toMatch(/viajan con (él|ese texto)|con tu nombre y tus datos de contacto|con lo que contenga/);
    }
  });

  it("says that the browser puts marks where the name, the emails, the phones and the links are, and the marks it shows are the ones it puts", () => {
    expect(policy).toContain("tu navegador reemplaza tu nombre, tus correos, tus teléfonos y los enlaces de tus perfiles");
    expect(policy).toContain("«[NOMBRE_1]»");
    expect(policy).toContain("«[CORREO_1]»");
    expect(policy).toContain("tu navegador pone cada dato en el lugar de su marca");
    expect(policy).toContain("Tu nombre y tus datos de contacto los lee tu navegador del documento, con sus propias reglas, y no el modelo");
    const cv = ["Lucía Pérez", "lucia@example.com", "Tel.: 351 555-1234", "linkedin.com/in/perfil-ejemplo", "", "EXPERIENCIA", "Analista en Acme"].join("\n");
    const masked = maskContact(cv, { kind: "document", names: ["Lucía Pérez"] });
    for (const mark of ["[NOMBRE_1]", "[CORREO_1]", "[TELEFONO_1]", "[ENLACE_1]"]) expect(masked.text, mark).toContain(mark);
    expect(masked.text).not.toMatch(/Lucía Pérez|lucia@example\.com|351 555-1234|linkedin\.com\/in\/perfil-ejemplo/);
    // …and what is put back is what was there, so what the model quotes is found in the text as the person wrote it.
    expect(masked.restore("Escribía a [CORREO_1]")).toBe("Escribía a lucia@example.com");
  });

  it("says where it looks, and what it does not recognise — and that is what the code does", () => {
    expect(policy).toContain("Tapa lo que reconoce, y no más");
    expect(policy).toContain("el correo y los enlaces de tus perfiles donde estén");
    expect(policy).toContain("el teléfono y los demás enlaces donde un documento guarda sus datos de contacto");
    expect(policy).toContain("No reconoce un apodo, un nombre de pila solo");
    const cv = [
      "Lucía Pérez",
      "",
      "EXPERIENCIA",
      "Escribía a ventas@example.com y llamaba al 351 555-1234 todos los días.",
      "Mi perfil: github.com/perfil-ejemplo y el sitio www.acme.com.ar",
      "Me dicen Lu. Lucía lo sabe.",
      "PÉREZ, Lucía firmó el acta.",
    ].join("\n");
    const { text } = maskContact(cv, { kind: "document", names: ["Lucía Pérez"] });
    // An email and the link of a profile, wherever they stand; the name, in any order.
    expect(text).not.toMatch(/ventas@acme\.com|github\.com\/perfil-ejemplo|PÉREZ, Lucía/);
    // A phone in a sentence, a link that is not a profile, a nickname and a first name alone, are not taken out.
    for (const stays of ["351 555-1234", "www.acme.com.ar", "Me dicen Lu.", "Lucía lo sabe."]) expect(text, stays).toContain(stays);
    // A name nobody has as theirs is not recognised either, in a story: the profile has none yet, and a story has no header to read one from.
    expect(maskContact("Soy Lucía Pérez, mi correo es lucia@example.com", { kind: "free", names: [] }).text).toBe("Soy Lucía Pérez, mi correo es [CORREO_1]");
  });

  it("says that the details the product does not use are struck out in the browser first, and the screens say it the same way", () => {
    expect(policy).toContain("Salvo los datos personales que el producto no usa");
    expect(policy).toContain("tu navegador tapa");
    for (const detail of ["estado civil", "documento", "referencias"]) {
      expect(policy, detail).toContain(detail);
      expect(READ.leftWhy, detail).toContain(detail);
    }
    expect(READ.sent).toMatch(/sin los datos personales que no usamos/);
    expect(READ.left).toBe("Los datos personales que no usamos no salen de tu dispositivo");
    // And what is not recognised is not promised: the clause says it goes by the label.
    expect(policy).toContain("Lo que no lleva rótulo, o está escrito de otra manera, no se reconoce");
  });

  it("says that the health data of a licence are among them, and they are: by their label, and not a «donante» that is something someone did", () => {
    expect(policy).toContain("datos de salud que trae una licencia de conducir (el grupo y factor sanguíneo y ser donante de órganos)");
    expect(READ.leftWhy).toContain("datos de salud de una licencia");
    const { text, omitted } = redactPersonalData("Grupo sanguíneo: 0+\nDonante de órganos: sí\nFactor RH: positivo\nDonante voluntario en el Hospital Garrahan");
    expect(omitted).toBe(3);
    expect(text).toContain("Donante voluntario en el Hospital Garrahan");
    expect(text).not.toMatch(/0\+|positivo/);
  });

  it("says that a photo of a CV is the one reading nothing can be struck out of first, and only with their own key", () => {
    expect(policy).toContain("Una foto o un escaneo de tu CV es la excepción de la excepción");
    expect(policy).toContain("se envía entera");
    expect(policy).toContain("solo con tu propia API key y nunca a nuestro proveedor");
    expect(policy).toContain("La imagen no se guarda en nuestros servidores");
    expect(policy).toContain("copiá el texto de la foto y pegalo");
    expect(PHOTO.sent).toBe("La foto entera, con todo lo que se vea en ella");
    expect(PHOTO.sentWhy).toMatch(/datos personales, que no podemos tapar/);
    expect(photoFooter()).toContain("No la guardamos");
    expect(photoFooter()).toContain("de ese texto sí tapamos esos datos antes de usarlo");
  });

  it("is a promise the route keeps: it refuses anyone without a key of their own, and keeps nothing of the image", () => {
    const route = read("app/api/generate/transcribe/route.ts");
    expect(route).toContain('tier !== "byok"');
    expect(route).toContain("byok_required");
    expect(route).not.toMatch(/writeFile|insert\(|\.values\(|localStorage|cache/);
    expect(read("lib/ai/vision.ts")).not.toMatch(/writeFile|insert\(|\.values\(/);
  });

  it("says that the synchronisation of the profile is the person's, and also what they turned on", () => {
    expect(policy).toContain("La sincronización es una acción tuya, explícita");
    expect(policy).toContain("«Mantener sincronizado»");
    expect(policy).toContain("un permiso aparte");
    expect(policy).toContain("se sube únicamente el perfil");
    expect(policy).toContain("se frena y te lo preguntamos");
  });

  it("says that the password and the IP address are never sent", () => {
    expect(policy).toContain("Tampoco se envía tu contraseña ni tu dirección IP");
    expect(NEVER_SENT).toMatch(/contraseña/);
    expect(NEVER_SENT).toMatch(/dirección IP/);
  });
});

describe("the free tier of Google, which the policy says in the sentences the screens say", () => {
  it("says what Google says of the free tier and of the paid one, with the dates, and where to read it", () => {
    for (const fact of [...GOOGLE_FREE_FACTS, ...GOOGLE_PAID_FACTS]) expect(policy, fact.id).toContain(fact.says);
    expect(policy).toContain(GOOGLE_EUROPE.says);
    expect(policy).toContain(GOOGLE_TERMS_IN_FORCE);
    expect(policy).toContain(GOOGLE_TERMS_READ_ON_TEXT);
    expect(policyHtml).toContain(`href="${GOOGLE_TERMS_URL}"`);
    // They are the policy's because they are imported, not copied: when Google's terms change and that file does, so does this.
    expect(source).toContain("GOOGLE_FREE_FACTS.map");
  });

  it("is the very sentence of the notice that is shown before the key is made, and in the row where it is kept", () => {
    const setup = textOf(renderToStaticMarkup(createElement(GoogleSetupNotice)));
    const row = textOf(renderToStaticMarkup(createElement(GoogleRowNotice)));
    for (const fact of GOOGLE_FREE_FACTS) {
      expect(setup, fact.id).toContain(fact.says);
      expect(row, fact.id).toContain(fact.says);
    }
    expect(setup).toContain(READ.masked);
    expect(row).toContain(READ.masked);
  });

  it("says that nobody here can know which tier a key is, that it is said before the key is made, and that nothing is said of the others", () => {
    expect(policy).toContain("Nosotros no podemos saber de qué nivel es tu key");
    expect(policy).toContain("podés elegir entre la key gratuita, una del nivel pago o seguir sin IA");
    expect(policy).toContain("De los demás proveedores no decimos nada, porque no leímos sus condiciones");
  });

  it("does not say whether Google's clause about professional use reaches whoever uses their own key: that is for the lawyers", () => {
    expect(policy).not.toMatch(/uso profesional|consumer use|not for consumer/i);
    expect(source).toContain("Q2");
  });
});

describe("what the policy says is uploaded when the profile is synchronised (clause 3), which is what the account receives", () => {
  const NOW = "2026-10-07T12:00:00.000Z";
  const full = () =>
    storedProfileSchema.parse({
      contact: { fullName: { value: "Lucía Pérez", status: "confirmed", source: { kind: "dump", docId: "d1", quote: "Soy Lucía Pérez", via: "ai", at: NOW }, confirmedAt: NOW } },
      certifications: [{ id: "c1", name: { value: "Matrícula de gasista", status: "confirmed" }, expires: { value: { year: 2027, month: 3 }, status: "confirmed" } }],
      legacy: {
        practical: { value: { availability: "Tiempo completo", driverLicense: "B1", ownVehicle: true, willingToRelocate: false, workEligibility: "DNI" }, status: "confirmed" },
        driverLicenseExpires: { value: { year: 2031, month: 2 }, status: "confirmed" },
      },
      sources: [{ id: "d1", kind: "cv", name: "mi-cv.pdf", fileHash: "abc", pasted: false, chars: 10, importedAt: NOW, via: "ai", madeAt: "2026-01-01T00:00:00.000Z" }],
      notes: [{ id: "n1", text: "Una nota", at: NOW }],
      unassigned: [{ id: "u1", text: "Premio al mejor equipo", kind: "awards", sourceId: "d1" }],
      declined: [{ id: "x1", kind: "requirement", text: "SAP", quote: "Manejo de SAP", at: NOW }],
      pending: [{ questionId: "more_achievements:e1", ruleId: "more_achievements", state: "later", count: 1, at: NOW }],
      onboarding: { step: "questions" },
      history: [{ id: "h", at: NOW, op: "set", path: ["contact", "city"] }],
      archive: [{ id: "a", at: NOW, kind: "skill", parentPath: ["skills"], entity: {}, label: "x" }],
    });

  it("says what goes with each datum, what else goes, and what does not", () => {
    for (const said of [
      "de dónde salió (si salió de un documento, la frase de ese documento que lo respalda, y si lo leyó una IA)",
      "cuándo lo agregaste y cuándo lo confirmaste por última vez",
      "hasta cuándo valen",
      "lo que contestaste que no tenés, con la fecha en que lo dijiste y la línea del aviso a la que se lo dijiste",
      "tus datos prácticos (disponibilidad, clase de licencia, vehículo, mudanza y permiso de trabajo)",
      "las preguntas que dejaste para después y el paso del armado en el que estás",
      "una huella para no leerlo dos veces: no el archivo, ni su nombre, ni su texto",
      "No sube el historial de tus cambios ni lo que quitaste del perfil",
    ]) {
      expect(policy, said).toContain(said);
    }
  });

  it("uploads each of them, with its origin, its dates, its «no» and its expiry", () => {
    const sent = forSync(full());
    expect(sent.contact.fullName.confirmedAt).toBe(NOW);
    expect(sent.contact.fullName.source).toMatchObject({ docId: "d1", quote: "Soy Lucía Pérez", via: "ai", at: NOW });
    expect(sent.certifications[0]!.expires?.value).toEqual({ year: 2027, month: 3 });
    expect(sent.legacy.driverLicenseExpires?.value).toEqual({ year: 2031, month: 2 });
    expect(sent.legacy.practical.value).toMatchObject({ availability: "Tiempo completo", driverLicense: "B1", ownVehicle: true, willingToRelocate: false, workEligibility: "DNI" });
    expect(sent.declined).toEqual([{ id: "x1", kind: "requirement", text: "SAP", quote: "Manejo de SAP", at: NOW }]);
    expect(sent.notes).toHaveLength(1);
    expect(sent.unassigned).toHaveLength(1);
    expect(sent.pending).toHaveLength(1);
    expect(sent.onboarding.step).toBe("questions");
    expect(sent.sources[0]).toMatchObject({ id: "d1", kind: "cv", fileHash: "abc", pasted: false, via: "ai", madeAt: "2026-01-01T00:00:00.000Z" });
  });

  it("and not the trail: no history, nothing that was removed, no name of a file, and no text of a document", () => {
    const sent = forSync(full());
    expect(sent.history).toEqual([]);
    expect(sent.archive).toEqual([]);
    expect(sent.sources[0]!.name).toBe("");
    expect(JSON.stringify(sent)).not.toContain("mi-cv.pdf");
    expect(Object.keys(sent.sources[0]!)).not.toEqual(expect.arrayContaining(["lines", "text"]));
  });

  it("is what the route stores, which applies it again where the profile arrives", () => {
    expect(read("app/api/sync/route.ts")).toContain("profile = forSync(profile)");
    expect(read("lib/api/sync-client.ts")).toContain("forSync(");
  });
});

describe("what the policy says never reaches a model, which the generators are not given", () => {
  const NOW = "2026-10-07T12:00:00.000Z";
  const profile = () =>
    storedProfileSchema.parse({
      contact: { fullName: { value: "Lucía Pérez", status: "confirmed", source: { kind: "dump", quote: "Soy la titular", at: NOW }, confirmedAt: "2026-10-01T00:00:00.000Z" } },
      certifications: [{ id: "c1", name: { value: "Matrícula de gasista", status: "confirmed" }, expires: { value: { year: 2027, month: 3 }, status: "confirmed" } }],
      legacy: {
        practical: { value: { availability: "", driverLicense: "B1", ownVehicle: false, willingToRelocate: false, workEligibility: "" }, status: "confirmed" },
        driverLicenseExpires: { value: { year: 2031, month: 2 }, status: "confirmed" },
      },
      declined: [{ id: "x1", kind: "requirement", text: "Tango", quote: "Manejo de Tango Gestión", at: NOW }],
    });

  it("says so: the dates, the expiries and the «no» do not go, and the class of the licence does", () => {
    expect(policy).toContain("Y no llegan a ningún modelo las fechas en que confirmaste cada dato, ni hasta cuándo vale una credencial o tu licencia, ni lo que contestaste que no tenés");
    expect(policy).toContain("el carnet de conducir (la clase, no su vencimiento)");
  });

  it("is so: none of it is in the plain profile the generators read, and the class is", () => {
    const plain = JSON.stringify(toPlainProfile(profile()));
    for (const absent of ["confirmedAt", "2026-10-01", "expires", "2027", "driverLicenseExpires", "2031", "Tango", "Manejo de Tango", "Soy la titular", "declined"]) expect(plain, absent).not.toContain(absent);
    expect(plain).toContain("B1");
  });
});

describe("what the policy says of a licence and of the credentials that lapse (clause 7), and of who the service is for (clause 12)", () => {
  it("says that the profile asks for the class and, if the person wants, for the expiry; not for the number, the blood group or a photo", () => {
    expect(policy).toContain("La licencia de conducir y otras credenciales");
    expect(policy).toContain("el perfil te pide la clase y, si querés, hasta cuándo vale");
    expect(policy).toContain("no te pide el número, ni el grupo sanguíneo, ni una foto, porque una licencia trae datos de salud");
    // The screens that ask for a licence ask for its class: one field of eighty characters that says «Licencia de conducir», and «¿De qué clase?».
    expect(read("components/profile/hub/PracticalFields.tsx")).toContain('"Licencia de conducir"');
    expect(read("components/wizard/RequirementAsk.tsx")).toContain("¿De qué clase?");
    expect(read("components/profile/hub/PracticalFields.tsx")).not.toMatch(/n[uú]mero de (la )?licencia|grupo sangu/i);
  });

  it("says that the expiry of a credential is kept to ask, never goes to a model, and goes with the profile when it is synchronised", () => {
    expect(policy).toContain("se guarda la fecha para preguntártelo, no llega nunca a un modelo, y se sincroniza si sincronizás tu perfil (cláusula 3)");
  });

  it("says that the service is for people of 16 or more, and that a key of Google asks 18", () => {
    expect(policy).toContain("El servicio está pensado para personas de 16 años o más");
    expect(policy).toContain("Con IA, puede haber una edad más");
    expect(policy).toContain("exige 18 años o más: si tenés 16 o 17, no actives una key de Google");
    expect(GOOGLE_FREE_FACTS.find((fact) => fact.id === "adults")!.says).toMatch(/18 años/);
    expect(read("app/legales/terminos/page.tsx")).toContain("16 años o más");
  });

  it("says what works without a model, in the sentences the screens say it", () => {
    expect(policy).toContain(WITHOUT_AI.works);
    expect(policy).toContain(WITHOUT_AI.needs);
  });
});

describe("what the policy says of where the profile lives (clause 2)", () => {
  it("says that the browser can delete it, and what Safari does, as the app says it", () => {
    expect(policy).toContain("tu navegador lo borre");
    expect(policy).toContain("Safari, en una pestaña, borra lo que un sitio guarda cuando pasan siete días de uso del navegador sin que entres a ese sitio");
    expect(RISK_TEXT.seven_days).toMatch(/siete días/);
  });

  it("says that a copy with a password cannot be opened without it, not even by us", () => {
    expect(policy).toContain("una contraseña que sólo conocés vos: sin ella no se puede abrir, tampoco por nosotros, y no hay forma de recuperarla");
    const locked = read("lib/storage/locked-copy.ts");
    expect(locked).toMatch(/PBKDF2/);
    expect(locked).toMatch(/AES-GCM/);
  });
});

describe("the version, which moved with these changes", () => {
  it("is the one the page shows, with the date it is in force from, and the pass that is the last of the header says so", () => {
    expect(policy).toContain(`Vigente desde el ${LEGAL_EFFECTIVE_DATE} · versión ${LEGAL_VERSION}`);
    expect(source).toContain(`\`LEGAL_VERSION\` sube a \`${LEGAL_VERSION}\` en la misma pasada`);
  });
});

describe("the warnings about a provider nobody can verify", () => {
  const warnings = Object.entries(EXPERIMENTAL_WARNING);

  it("say what a generation sends and what a reading sends, and not that a generation sends the name and the contact", () => {
    expect(warnings.length).toBeGreaterThanOrEqual(3);
    for (const [id, warning] of warnings) {
      expect(warning, id).toContain(TO_AN_UNVERIFIED_PROVIDER);
      expect(warning, id).not.toMatch(/tu nombre, tu contacto/);
    }
  });

  it("say the two things apart: a generation leaves the name and the contact out, a reading sends the text without who the person is", () => {
    expect(TO_AN_UNVERIFIED_PROVIDER).toMatch(/sin tu nombre real ni tus datos de contacto/);
    expect(TO_AN_UNVERIFIED_PROVIDER).toMatch(/leer un CV o tu relato le manda el texto, sin tu nombre, tu correo, tu teléfono ni los enlaces de tu perfil, y sin los datos personales que no usamos/);
  });
});

describe("under a button that reads a text with the person's model", () => {
  it("says it goes without the name, the email, the phone and the links, what else is struck out first, and to whom", () => {
    const struck = "antes tapamos tu nombre, tu correo, tu teléfono y los enlaces de tu perfil, y los datos personales que no usamos (fecha de nacimiento, documento, estado civil…).";
    expect(readFooter(true)).toBe(`El texto se envía al proveedor que configuraste en Ajustes; ${struck}`);
    expect(readFooter(false)).toBe(`El texto se envía a nuestro proveedor de IA; ${struck}`);
  });

  it("is the line that AiAction shows", () => {
    expect(read("components/onboarding/AiAction.tsx")).toContain("readFooter(ai.byok)");
  });
});

describe("the permission asked before a text is read by the paid tier's provider", () => {
  const html = (kind: "generate" | "read") => renderToStaticMarkup(createElement(TransferConsent, { kind })).replace(/<!-- -->/g, "").replace(/\s+/g, " ");

  it("says what happens to a text that is read, and not what happens to a generation", () => {
    const read = html("read");
    expect(read).toContain(READ.sent);
    expect(read).toContain(READ.covered);
    expect(read).toContain(READ.travels);
    expect(read).toContain(READ.left);
    expect(read).not.toContain(GENERATE.nameStays);
    expect(read).not.toContain(GENERATE.contactStays);
    expect(read).not.toMatch(/con tu nombre|viajan con/);
  });

  it("says what happens to a generation, as it always did, when that is what it asks about", () => {
    const generate = html("generate");
    expect(generate).toContain(GENERATE.nameStays);
    expect(generate).toContain(GENERATE.contactStays);
    expect(generate).not.toContain(READ.covered);
  });

  it("is what AiAction shows before a reading", () => {
    expect(read("components/onboarding/AiAction.tsx")).toContain('<TransferConsent kind="read"');
  });

  it("asks for one thing in both: to generate the documents and to read the texts", () => {
    for (const kind of ["generate", "read"] as const) expect(html(kind)).toContain("generar los documentos que pida y de leer los textos que le pida leer");
  });
});

describe("the synchronisation of the profile, which any account has", () => {
  it("is not sold as part of paying: not in the plan's features, not in what a purchase buys, not in the offer when the limit is reached", () => {
    expect(read("app/precios/page.tsx")).not.toContain('"Sincronización entre dispositivos"');
    expect(read("components/billing/LimitReached.tsx")).not.toMatch(/perfil sincronizado/);
    expect(read("components/account/AccountPanel.tsx")).not.toMatch(/con el perfil sincronizado entre tus dispositivos/);
    expect(read("app/(app)/ajustes/SettingsEditor.tsx")).not.toMatch(/compra no tener que ocuparte de esto y tener el perfil sincronizado/);
  });

  it("is not checked against a plan by the route that does it: nothing in it asks whether the account pays", () => {
    const route = read("app/api/sync/route.ts");
    expect(route).not.toMatch(/from "@\/lib\/(billing|payments|plans)/);
    expect(route).not.toMatch(/tierOf|isPaid|hasActivePlan|requirePaid|requireTier/);
  });
});
