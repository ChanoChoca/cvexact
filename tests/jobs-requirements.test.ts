import { describe, expect, it } from "vitest";
import { ASKABLE_TYPES, cleanPosting, fold, isAskable, readRequirements, type Requirement } from "@/lib/jobs/requirements";

/**
 * The reader of a posting: what it takes for a requirement, what kind of thing, how much the posting says, and — as much as these — what it
 * leaves alone. `jobs-bank.test.ts` measures it on whole postings written and labelled by hand; this holds the rules one at a time.
 */

const read = (text: string) => readRequirements(text);
const brief = (requirements: readonly Requirement[]) => requirements.map((r) => `${r.type}/${r.obligation}: ${r.fragment}`);
const only = (text: string, type: Requirement["type"]) => read(text).filter((r) => r.type === type);

describe("what kind of thing a requirement is", () => {
  const posting = [
    "Auxiliar administrativo/a",
    "",
    "Requisitos:",
    "- Manejo de Excel y Word",
    "- Experiencia en atención al público",
    "- Licencia de conducir B1",
    "- Matrícula de gasista vigente",
    "- Proactividad y buen trato",
    "- Inglés intermedio",
  ].join("\n");

  it("reads a tool, a task, a condition, a credential, a trait and something else", () => {
    expect(brief(read(posting))).toEqual([
      "tool/unstated: Manejo de Excel y Word",
      "task/unstated: Experiencia en atención al público",
      "condition/unstated: Licencia de conducir B1",
      "credential/unstated: Matrícula de gasista vigente",
      "trait/unstated: Proactividad y buen trato",
      "other/unstated: Inglés intermedio",
    ]);
  });

  it("names what each one is about", () => {
    const [tool, task, condition, credential, trait, other] = read(posting);
    expect(tool!.subjects).toEqual(["Excel", "Word"]);
    expect(task!.subjects).toEqual(["atención al público"]);
    expect(condition!.subjects).toEqual(["Licencia de conducir B1"]);
    expect(condition!.conditions).toEqual(["license"]);
    expect(credential!.subjects).toEqual(["Matrícula de gasista vigente"]);
    expect(trait!.subjects).toEqual([]);
    expect(other!.subjects).toEqual([]);
  });

  it("asks only about what a person can have done, hold or say yes or no to — never a trait, never the rest", () => {
    expect(ASKABLE_TYPES).toEqual(["tool", "task", "condition", "credential"]);
    expect(read(posting).filter(isAskable).map((r) => r.type)).toEqual(["tool", "task", "condition", "credential"]);
  });

  it("does not take the title of the posting for a requirement", () => {
    const requirements = read("Repartidor/a con moto propia - Matriculado/a\n\nBuscamos repartidores para Morón.\n\nRequisitos:\n- Disponibilidad full time");
    expect(brief(requirements)).toEqual(["condition/unstated: Disponibilidad full time"]);
  });

  it("is not fooled by the licence class, the place or the tax that look like a technology", () => {
    const tools = only("Requisitos:\n- Licencia B1\n- Residir en CABA o GBA\n- Liquidación de IVA\n- Experiencia con Tango", "tool");
    expect(tools.flatMap((r) => r.subjects)).toEqual(["Tango"]);
  });

  it("reads the word that is also a tool only where it is the tool: «technical teams» is no Teams, «Microsoft Teams» is", () => {
    expect(read("Requirements:\n- Ability to collaborate across technical teams and business functions")).toEqual([]);
    expect(only("Requisitos:\n- Manejo de Teams y Zoom", "tool").flatMap((r) => r.subjects)).toEqual(["Teams", "Zoom"]);
    // In lower case it needs the lead to say so.
    expect(only("Requisitos:\n- manejo de excel y word", "tool").flatMap((r) => r.subjects)).toEqual(["Excel", "Word"]);
    expect(only("Requisitos:\n- word of mouth y excel", "tool")).toEqual([]);
  });

  it("does not take a word in capitals for an acronym: a posting that shouts holds no tools in «BUENA PRESENCIA» or in the title", () => {
    const requirements = read("MOZO/A PARA RESTAURANTE\n\nSE BUSCA PERSONA CON BUENA PRESENCIA, ONDA, DISPONIBILIDAD HORARIA. MANEJO DE SAP.\n");
    expect(requirements.filter((r) => r.type === "tool").flatMap((r) => r.subjects)).toEqual(["SAP"]);
  });

  it("reads a three-letter acronym in a normal line and drops one in capitals that the glossary does not know", () => {
    expect(only("Requisitos:\n- SQL avanzado", "tool").flatMap((r) => r.subjects)).toEqual(["SQL"]);
    expect(only("Requisitos:\n- URGENTE incorporación inmediata", "tool")).toEqual([]);
  });
});

describe("how much the posting says", () => {
  it("takes a marker in the line", () => {
    expect(brief(read("Requisitos:\n- Manejo de Excel (excluyente)\n- Conocimientos de Photoshop (deseable)\n- Se valora conocimiento de AutoCAD\n- Indispensable matrícula de electricista"))).toEqual([
      "tool/required: Manejo de Excel (excluyente)",
      "tool/preferred: Conocimientos de Photoshop (deseable)",
      "tool/preferred: Se valora conocimiento de AutoCAD",
      "credential/required: Indispensable matrícula de electricista",
    ]);
  });

  it("takes it from the heading above, when the line says nothing", () => {
    const requirements = read("Requisitos excluyentes:\n- Manejo de Excel\n\nRequisitos deseables:\n- Manejo de Photoshop\n\nRequisitos:\n- Manejo de Word");
    expect(requirements.map((r) => r.obligation)).toEqual(["required", "preferred", "unstated"]);
  });

  it("does not take «Requisitos» for a must, nor «Perfil»", () => {
    expect(read("Requisitos:\n- Manejo de Excel").map((r) => r.obligation)).toEqual(["unstated"]);
    expect(read("Perfil:\n- Manejo de Excel").map((r) => r.obligation)).toEqual(["unstated"]);
  });

  it("reads «no excluyente» as preferred, and not as the «excluyente» inside it", () => {
    expect(read("Requisitos:\n- Estudios en gastronomía (no excluyente)\n- Manejo de Excel, no excluyente").map((r) => r.obligation)).toEqual(["preferred", "preferred"]);
    expect(read("No excluyente: manejo de Excel.").map((r) => r.obligation)).toEqual(["preferred"]);
  });

  it("applies a marker to everything it introduces, and a marker of its own to the clause it is in", () => {
    const requirements = read("Es indispensable contar con carnet de manipulación de alimentos y disponibilidad para fines de semana. Se valorará conocimiento de vinos y manejo de comanda digital.");
    expect(brief(requirements)).toEqual([
      "credential/required: Es indispensable contar con carnet de manipulación de alimentos",
      "condition/required: disponibilidad para fines de semana",
      "task/preferred: Se valorará conocimiento de vinos",
      "tool/preferred: manejo de comanda digital",
    ]);
  });

  it("keeps «Deseable:» to its line when it is a bullet, and gives it to what follows when it is a line of its own", () => {
    expect(read("Requisitos:\n- Deseable: manejo de Photoshop\n- Manejo de Excel").map((r) => r.obligation)).toEqual(["preferred", "unstated"]);
    expect(read("Requisitos:\nManejo de Excel\nDeseable:\nManejo de Photoshop\nManejo de Word").map((r) => r.obligation)).toEqual(["unstated", "preferred", "preferred"]);
  });

  it("reads «Must have» and «Nice to have»", () => {
    const requirements = read("Must have:\n- 4+ años de experiencia con Node.js\n\nNice to have:\n- Experiencia con Docker");
    expect(requirements.map((r) => `${r.type}/${r.obligation}`)).toEqual(["tool/required", "tool/preferred"]);
  });

  it("does not ask about what the posting itself calls a nicety", () => {
    const [needed, nicety] = read("Requisitos:\n- Manejo de Excel\n- Manejo de Photoshop (deseable)");
    expect(isAskable(needed!)).toBe(true);
    expect(isAskable(nicety!)).toBe(false);
  });
});

describe("how far a marker reaches", () => {
  it("a marker in the middle of a list of commas is its own clause's and no one else's", () => {
    const requirements = read("Requisitos: experiencia en mecánica ligera, manejo de scanner, herramientas propias deseable, disponibilidad horaria de lunes a sábados, carnet de conducir.");
    // The two tasks are one, and so are the two conditions that nothing marks.
    expect(requirements.map((r) => `${r.type}/${r.obligation}`)).toEqual(["task/unstated", "condition/preferred", "condition/unstated"]);
    expect(requirements.find((r) => /herramientas propias/.test(r.fragment))?.obligation).toBe("preferred");
    expect(requirements.find((r) => /disponibilidad horaria/.test(r.fragment))?.obligation).toBe("unstated");
    expect(requirements.find((r) => /carnet de conducir/.test(r.fragment))?.obligation).toBe("unstated");
  });

  it("a marker that opens a sentence is for everything the sentence names", () => {
    expect(read("Es indispensable contar con carnet de manipulación de alimentos y disponibilidad para fines de semana.").map((r) => r.obligation)).toEqual(["required", "required"]);
    expect(read("Se valorará manejo de Excel y de Word.").map((r) => r.obligation)).toEqual(["preferred"]);
  });

  it("a marker that closes a bullet in brackets is for the whole bullet", () => {
    expect(read("Requisitos:\n- Manejo de Word y Excel (excluyente)").map((r) => `${r.type}/${r.obligation}`)).toEqual(["tool/required"]);
  });

  it("«preferentemente» at the head is a marker; after what is asked it only qualifies the place", () => {
    expect(read("Requisitos:\n- Preferentemente manejo de Excel").map((r) => r.obligation)).toEqual(["preferred"]);
    expect(read("Requisitos indispensables:\n- Experiencia en atención al público, preferentemente en entidades financieras").map((r) => r.obligation)).toEqual(["required"]);
  });

  it("«Suma:» heads what is only valued", () => {
    expect(read("Requisitos:\n- Manejo de Excel\n\nSuma: conocimientos de Photoshop").map((r) => r.obligation)).toEqual(["unstated", "preferred"]);
  });

  it("a restriction that comes from the heading yields to the line's own marker", () => {
    expect(read("Requisitos excluyentes:\n- Manejo de Excel\n- Manejo de Word (deseable)").map((r) => r.obligation)).toEqual(["required", "preferred"]);
  });
});

describe("what a number means", () => {
  it("tells a quantity that ends a sentence from the number of an item", () => {
    const requirements = read("Requisitos: Disponibilidad full time, mayor de 21. Se ofrece sueldo.");
    expect(brief(requirements)).toEqual(["condition/unstated: Disponibilidad full time", "other/unstated: mayor de 21"]);
    const listed = read("Requisitos: 1. Manejo de Excel 2. Licencia de conducir B1 3. Matrícula de gasista");
    expect(listed.map((r) => r.type)).toEqual(["tool", "condition", "credential"]);
  });

  it("does not take «entre 20 y 35 años» for two items", () => {
    expect(brief(read("Requisitos:\n- Edad entre 20 y 35 años"))).toEqual(["other/unstated: Edad entre 20 y 35 años"]);
  });
});

describe("what is said about travelling, and about the tools of the trade", () => {
  it("reads «disponibilidad para viajar» as travel and not as an availability", () => {
    const [requirement] = read("Requisitos:\n- Disponibilidad para viajar al interior");
    expect(requirement!.conditions).toEqual(["travel"]);
  });

  it("reads «herramientas propias» as a fact about the person — with no place in the profile", () => {
    const [requirement] = read("Requisitos:\n- Herramientas propias");
    expect(requirement).toMatchObject({ type: "condition", conditions: ["tools"] });
  });

  it("reads «matriculado en» as a registration, and «matriculado/a» alone, in a title, as nothing to ask", () => {
    expect(only("Requisitos:\n- Contador/a público/a matriculado/a en el CPCE", "credential")).toHaveLength(1);
    expect(read("Gasista matriculado/a para obras en CABA.")).toEqual([]);
  });

  it("does not take a bracket's middle for the start of a requirement", () => {
    const requirements = read("Requerimos enfermeros/as profesionales para turnos de 12 horas (diurnos y nocturnos).");
    for (const requirement of requirements) expect(requirement.fragment.startsWith("nocturnos")).toBe(false);
  });

  it("reads «Se requiere …» outside a list as a requirement, but not the days and shifts it describes", () => {
    expect(brief(read("Importante empresa busca personal. Se requiere título terciario o universitario. Turnos rotativos."))).toEqual(["other/unstated: título terciario o universitario"]);
  });
});

describe("what a posting offers, and what it says it does not ask", () => {
  it("leaves the offer alone: benefits, hours, pay, how to apply", () => {
    const requirements = read(
      ["Requisitos:", "- Manejo de Excel", "", "Ofrecemos:", "- Disponibilidad inmediata de ingreso", "- Capacitación en Photoshop", "", "Horario: lunes a viernes", "Sueldo según convenio. Presentarse con CV."].join("\n"),
    );
    expect(brief(requirements)).toEqual(["tool/unstated: Manejo de Excel"]);
  });

  it("leaves the duties alone: «Tareas» is what the job does, not what the person has", () => {
    expect(read("Tareas: atención al público, carga de datos en Excel, manejo de caja.\n\nRequisitos:\n- Disponibilidad full time").map((r) => r.type)).toEqual(["condition"]);
  });

  it("does not take «no es necesaria experiencia» for a requirement of experience", () => {
    expect(read("Requisitos:\n- No es necesaria experiencia previa\n- Sin experiencia en ventas\n- No se requiere título\n- Manejo de Excel").map((r) => r.fragment)).toEqual(["Manejo de Excel"]);
    expect(read("Sumate a nuestro equipo de cajas. No es necesaria experiencia previa en caja, te capacitamos.")).toEqual([]);
  });

  it("does not ask what asks for experience in nothing: «Experiencia: 1 año», «en el rubro», «en puestos similares»", () => {
    const requirements = read("Requisitos:\n- Experiencia: 1 año\n- Experiencia en el rubro\n- Experiencia previa en puestos similares\n- Experiencia en reparto");
    expect(brief(requirements)).toEqual(["other/unstated: Experiencia: 1 año", "other/unstated: Experiencia en el rubro", "other/unstated: Experiencia previa en puestos similares", "task/unstated: Experiencia en reparto"]);
    expect(requirements.filter(isAskable).map((r) => r.subjects)).toEqual([["reparto"]]);
  });

  it("does not ask what is only an adjective in a title: «matriculado/a»", () => {
    expect(read("Gasista matriculado/a. Buscamos gasista matriculado/a para obras en CABA.").filter(isAskable)).toEqual([]);
  });
});

describe("what is never taken for a skill", () => {
  it("reads age, appearance, education, language, portfolio, references and health as something else", () => {
    const requirements = read(
      ["Requisitos:", "- Mayor de 21 años", "- Buena presencia", "- Secundario completo", "- Estudiante de Abogacía", "- Inglés avanzado", "- Portfolio de trabajos", "- Referencias laborales comprobables", "- Esquema de vacunación completo"].join("\n"),
    );
    expect(requirements.map((r) => r.type)).toEqual(Array(8).fill("other"));
    expect(requirements.filter(isAskable)).toEqual([]);
  });

  it("tells «estudios» as education from «estudios» as the firms an experience was in", () => {
    expect(brief(read("Requisitos:\n- Estudios secundarios completos\n- Experiencia mínima de 2 años en estudios o agencias"))).toEqual([
      "other/unstated: Estudios secundarios completos",
      "task/unstated: Experiencia mínima de 2 años en estudios o agencias",
    ]);
  });

  it("reads the conditions the profile has no place for — the zone, travel — as conditions of their own kind", () => {
    const [zone, travel] = read("Requisitos:\n- Residir en zona sur o cercanías\n- Disponibilidad para viajar");
    expect(zone!.conditions).toContain("zone");
    expect(travel!.conditions).toContain("travel");
  });

  it("tells a licence from a vehicle from an availability inside one line", () => {
    const [requirement] = read("Requisitos:\n- Licencia de conducir B1, moto propia y disponibilidad full time");
    expect(requirement!.type).toBe("condition");
    expect([...requirement!.conditions].sort()).toEqual(["availability", "license", "vehicle"]);
  });
});

describe("a posting as it comes", () => {
  const lines = [
    "Operario/a de depósito - Zona Sur",
    "",
    "Importante empresa de logística busca operarios/as para su centro de distribución en Avellaneda.",
    "",
    "Requisitos:",
    "- Secundario completo (excluyente)",
    "- Experiencia previa en depósito o logística, mínimo 1 año (excluyente)",
    "- Manejo de autoelevador y zorra hidráulica",
    "- Disponibilidad para turnos rotativos y fines de semana (excluyente)",
    "- Deseable: curso de seguridad e higiene",
    "",
    "Ofrecemos:",
    "- Ingreso inmediato y contrato efectivo",
    "- Comedor en planta",
  ].join("\n");

  const expected = [
    "other/required: Secundario completo (excluyente)",
    "task/required: Experiencia previa en depósito o logística, mínimo 1 año (excluyente)",
    "tool/unstated: Manejo de autoelevador y zorra hidráulica",
    "condition/required: Disponibilidad para turnos rotativos y fines de semana (excluyente)",
    "credential/preferred: Deseable: curso de seguridad e higiene",
  ];

  it("with its lines", () => {
    expect(brief(read(lines))).toEqual(expected);
  });

  it("with Windows line ends", () => {
    expect(brief(read(lines.replace(/\n/g, "\r\n")))).toEqual(expected);
  });

  it("with its page of HTML taken out of its tags — one line, no bullets, as the feed gives it", () => {
    // What `stripHtml` leaves: every run of white space is one space, and a list has no bullets.
    const flat = lines
      .split("\n")
      .map((line) => line.replace(/^- /, ""))
      .join(" ")
      .replace(/\s+/g, " ");
    expect(brief(read(flat)).map((line) => line.replace(/^(\w+\/\w+): .*$/, "$1"))).toEqual(expected.map((line) => line.replace(/^(\w+\/\w+): .*$/, "$1")));
  });

  it("with its bullets and numbers inside the paragraph", () => {
    const requirements = read("Requisitos: 1. Manejo de Excel (excluyente) 2. Disponibilidad full time 3. Licencia de conducir B1 • Matrícula de gasista");
    expect(requirements.map((r) => `${r.type}/${r.obligation}`)).toEqual(["tool/required", "condition/unstated", "condition/unstated", "credential/unstated"]);
  });

  it("in capitals, with its heading in the middle of the paragraph", () => {
    const requirements = read("SE NECESITA VENDEDORA PARA LOCAL EN FLORES. REQUISITOS: BUENA PRESENCIA, MANEJO DE REDES SOCIALES, DISPONIBILIDAD HORARIA (INCLUYE SABADOS), MAYOR DE 21. SE OFRECE SUELDO + COMISIONES. ENVIAR CV A rrhh@example.com");
    expect(requirements.map((r) => r.type)).toEqual(["other", "task", "condition", "other"]);
  });

  it("all in lower case, as a message is written", () => {
    const requirements = read("se necesita ayudante de cocina para pizzeria. con experiencia en pizzeria o parrilla. disponibilidad full time, turno noche y fines de semana. se paga horas extras. presentarse con cv de martes a viernes");
    expect(brief(requirements)).toEqual(["task/unstated: experiencia en pizzeria o parrilla", "condition/unstated: disponibilidad full time, turno noche y fines de semana"]);
  });

  it("under headings with emoji, and with Markdown", () => {
    const requirements = read("🚀 Buscamos Community Manager\n\n📌 Lo que vas a hacer:\n• Planificar contenido en Instagram\n\n✅ Lo que buscamos:\n• **Manejo** de Canva\n• Experiencia en *redes sociales*\n\n🎁 Lo que ofrecemos:\n• Prepaga");
    expect(brief(requirements)).toEqual(["tool/unstated: Manejo de Canva", "task/unstated: Experiencia en redes sociales"]);
  });

  it("with a label and a value, as the job boards give it", () => {
    const requirements = read("Requisitos\nNivel educativo: Secundario completo\nExperiencia: 1 año\nEdad: 25 a 40 años\nConocimientos: Atención al cliente, Excel\nDisponibilidad: Full time\nResidencia: CABA");
    expect(requirements.map((r) => r.type)).toEqual(["other", "other", "other", "task", "tool", "condition", "condition"]);
  });

  it("with its sentences, where a paragraph says what it asks in prose", () => {
    const requirements = read("Restaurante de cocina de autor busca mozo/a con experiencia en salón para turno noche. Es indispensable contar con carnet de manipulación de alimentos vigente. Sueldo según convenio.");
    expect(brief(requirements)).toEqual(["task/unstated: experiencia en salón para turno noche", "credential/required: Es indispensable contar con carnet de manipulación de alimentos vigente"]);
  });

  it("leaves the description of a company alone, and every word that sounds like a requirement in it", () => {
    expect(read("Somos una empresa líder con 20 años en el mercado, formada por equipos de ventas y atención al cliente. Nuestro equipo de estudios jurídicos crece. Trabajamos con Excel y SAP todos los días.")).toEqual([]);
  });
});

describe("fragments", () => {
  const posting = "Requisitos:\n- **Manejo** de Excel (excluyente)\n- Experiencia en *ventas*\n\nOfrecemos:\n- Obra social";

  it("are literal pieces of the posting — as it is read, without the marks of Markdown", () => {
    const text = cleanPosting(posting);
    expect(text).toBe("Requisitos:\n- Manejo de Excel (excluyente)\n- Experiencia en ventas\n\nOfrecemos:\n- Obra social");
    for (const requirement of read(posting)) expect(text).toContain(requirement.fragment);
  });

  it("keep the posting's own spelling, accents and capitals", () => {
    expect(read("Requisitos:\n- Conocimientos de CorelDRAW y Excel").map((r) => r.fragment)).toEqual(["Conocimientos de CorelDRAW y Excel"]);
  });

  it("are never longer than a line can show", () => {
    const requirements = read(`Experiencia en ventas, ${"mostrador, ".repeat(200)}`);
    expect(requirements[0]!.fragment.length).toBeLessThanOrEqual(240);
  });

  it("fold the way the dictionary reads: a position in the folded text is a position in the posting", () => {
    const text = "Atención al Público 🚀 ÑANDÚ y\tCaña";
    expect(fold(text)).toHaveLength(text.length);
    expect(fold(text)).toBe("atencion al publico 🚀 nandu y cana");
  });
});

describe("the reader on whatever it is given", () => {
  it("gives nothing for nothing, and for what is no posting", () => {
    for (const text of ["", "   \n\n  ", "!!!! ???? ..... ----- ***** (((( ))))", "Hola, ¿cómo estás?", "a", "\n", "—"]) expect(read(text)).toEqual([]);
  });

  it("does not throw on odd text", () => {
    for (const text of ["((((", "))))", "Requisitos:", "Requisitos: :", ":::", "- - - -", "1. 2. 3.", "**", "\u0000\u0001", "🚀🚀🚀", "Experiencia en", "Manejo de", ".".repeat(50)]) {
      expect(() => read(text)).not.toThrow();
    }
  });

  it("is quick on a long posting, and stops reading at a limit", () => {
    const started = performance.now();
    const requirements = read("Requisitos:\n" + Array.from({ length: 3000 }, (_, i) => `- Manejo de Excel ${i}`).join("\n"));
    expect(performance.now() - started).toBeLessThan(3000);
    expect(requirements.length).toBeLessThanOrEqual(60);
  });

  it("says the same thing twice", () => {
    const text = "Requisitos:\n- Manejo de Excel (excluyente)\n- Licencia de conducir";
    expect(read(text)).toEqual(read(text));
  });

  it("reads each requirement once", () => {
    expect(read("Requisitos:\n- Manejo de Excel\n- Manejo de Excel\n- Manejo de Excel")).toHaveLength(1);
  });

  it("reads a posting in English by the technologies it names", () => {
    const requirements = read("Requirements:\n- Hands-on experience with SQL, PowerShell and Microsoft 365\n- Strong communication skills");
    expect(requirements.map((r) => r.type)).toEqual(["tool"]);
    expect(requirements[0]!.subjects).toEqual(expect.arrayContaining(["SQL", "Microsoft 365"]));
  });
});
