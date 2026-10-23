import { describe, expect, it } from "vitest";
import { declinedToolKeys, isKnownTool, mentionsSkill, toolMentions, toolsIn } from "@/lib/onboarding/tools";
import { splitAnswer } from "@/lib/onboarding/split";

describe("toolsIn", () => {
  it("finds the tools a person names, as they wrote them, in order", () => {
    expect(toolsIn("Llevo las campañas de Google Ads y Meta, el SEO de la web y preparo los informes en Excel")).toEqual([
      "Google Ads",
      "Meta",
      "SEO",
      "Excel",
    ]);
  });

  it("reports each once, and a longer name swallows the shorter one inside it", () => {
    expect(toolsIn("Usé Google Analytics todos los días. Google Analytics y Looker Studio.")).toEqual(["Google Analytics", "Looker Studio"]);
    expect(toolsIn("Trabajo con React Native")).toEqual(["React Native"]);
  });

  it("is not fooled by accents or case in names that are safe", () => {
    expect(toolsIn("armé tableros en power bi y en tableau")).toEqual(["power bi", "tableau"]);
  });

  it("needs a capital for names that are also ordinary words", () => {
    expect(toolsIn("mi meta es crecer; voy a ir por Word y Access")).toEqual(["Word", "Access"]);
    expect(toolsIn("Trabajo en Meta desde 2020")).toEqual(["Meta"]);
    expect(toolsIn("voy a ir a la reunión, go")).toEqual([]);
    expect(toolsIn("Programo en Go y en R")).toEqual(["Go", "R"]);
  });

  it("does not find a tool inside another word", () => {
    expect(toolsIn("Rosario, Google, Gobierno, Excelente atención")).toEqual([]);
    expect(toolsIn("Mucho SEOUL y Cotización")).toEqual([]);
  });

  it("handles names with symbols", () => {
    expect(toolsIn("Escribo C# y .NET, también C++")).toEqual(["C#", ".NET", "C++"]);
    expect(toolsIn("Node.js y Next.js")).toEqual(["Node.js", "Next.js"]);
  });

  it("finds nothing in nothing, or in text about no tool", () => {
    expect(toolsIn("")).toEqual([]);
    expect(toolsIn("Atendía clientes en el mostrador y cerraba la caja")).toEqual([]);
  });

  it("knows everyday tools, not only technical ones", () => {
    expect(toolsIn("Facturaba con Tango y cobraba con Posnet")).toEqual(["Tango", "Posnet"]);
  });

  it("gives a name back as it was written, accents included", () => {
    expect(toolsIn("Liquidaba sueldos en Tango Gestión")).toEqual(["Tango Gestión"]);
  });

  it("names the same tool once, however it was spelled", () => {
    expect(toolsIn("Migré de Postgres a PostgreSQL 16")).toEqual(["Postgres"]);
  });
});

describe("toolMentions: an ordinary word is not a tool", () => {
  const found = (text: string) => toolMentions(text).map((mention) => mention.value);

  it("does not take the capital a sentence starts with for a name's own", () => {
    expect(found("Meta cumplida en todos los trimestres")).toEqual([]);
    expect(found("Opera la máquina envasadora del turno tarde")).toEqual([]);
    expect(found("Atención al cliente. Teams de soporte en dos turnos")).toEqual([]);
    expect(found("- Word y Excel para los informes")).toEqual(["Excel"]);
  });

  it("still takes it after a colon or mid-sentence, where Spanish would not capitalise the word", () => {
    expect(found("Stack: Go, Docker y Kubernetes")).toEqual(["Go", "Docker", "Kubernetes"]);
    expect(found("Campañas en Meta y Google Ads")).toEqual(["Meta", "Google Ads"]);
  });

  it("does not find a name inside a hyphenated word or an abbreviation", () => {
    expect(found("Armé la estrategia Go-to-market del producto")).toEqual([]);
    expect(found("Trabajé en el área de R.R.H.H. y en R&D")).toEqual([]);
    // A full stop after the letter ends a sentence; it does not make an abbreviation.
    expect(found("Analizo los datos en R.")).toEqual(["R"]);
  });

  it("takes a name opening a line of a skills section for the skill it is there for", () => {
    expect(found("Go y Rust para servicios de alta concurrencia.")).toEqual(["Rust"]);
    expect(toolsIn("Go y Rust para servicios de alta concurrencia.", { skillsSection: true })).toEqual(["Go", "Rust"]);
  });

  it("does not take the dance for the accounting system", () => {
    expect(found("Profesora de tango en el club del barrio")).toEqual([]);
  });

  it("says which names are also ordinary words", () => {
    expect(toolMentions("Campañas en Meta, Google Ads y Excel")).toEqual([
      { value: "Meta", ambiguous: true },
      { value: "Google Ads", ambiguous: false },
      { value: "Excel", ambiguous: false },
    ]);
    expect(toolMentions("Facturaba con Tango y Tango Gestión")).toEqual([
      { value: "Tango", ambiguous: true },
      { value: "Tango Gestión", ambiguous: false },
    ]);
  });
});

describe("the list, by skill", () => {
  it("knows a tool by any spelling of its name", () => {
    expect(isKnownTool("postgres")).toBe(true);
    expect(isKnownTool("NodeJS")).toBe(true);
    expect(isKnownTool("Administración de sistemas")).toBe(false);
  });

  it("finds a skill named in a line: a tool by the list's rules, anything else by its words in order", () => {
    expect(mentionsSkill(["Desarrollo en backend: Spring Boot, Node.js"], "Node.js")).toBe(true);
    expect(mentionsSkill(["Desarrollo en backend: Spring Boot, Node.js"], "nodejs")).toBe(true);
    expect(mentionsSkill(["Armé la estrategia Go-to-market"], "Go")).toBe(false);
    expect(mentionsSkill(["Soporte y administración de sistemas Linux"], "Administración de sistemas")).toBe(true);
    expect(mentionsSkill(["Administré sistemas de turnos"], "Administración de sistemas")).toBe(false);
    expect(mentionsSkill(["Atención de público"], "")).toBe(false);
  });

  it("reads the tools turned down, whether they were saved by the old key or the new one", () => {
    const pending = [
      { questionId: "loose_tool:item:google ads", ruleId: "loose_tool", entityId: "google ads", state: "na" as const, count: 1, at: "" },
      { questionId: "loose_tool:item:postgresql", ruleId: "loose_tool", entityId: "postgresql", state: "na" as const, count: 1, at: "" },
      { questionId: "loose_tool:all", ruleId: "loose_tool", state: "later" as const, count: 1, at: "" },
    ];
    expect(declinedToolKeys(pending)).toEqual(new Set(["googleads", "postgresql"]));
  });
});

describe("splitAnswer", () => {
  it("makes one fact per sentence, in the words that were typed", () => {
    expect(
      splitAnswer("Llevo las campañas de Google Ads y Meta, el SEO de la web y preparo los informes mensuales para dirección. También coordino a la agencia que nos hace el contenido."),
    ).toEqual([
      "Llevo las campañas de Google Ads y Meta, el SEO de la web y preparo los informes mensuales para dirección.",
      "También coordino a la agencia que nos hace el contenido.",
    ]);
  });

  it("takes a list typed as lines as a list, dropping the bullet marks", () => {
    expect(splitAnswer("• Atiendo clientes\n- Cierro la caja\n1) Repongo mercadería")).toEqual([
      "Atiendo clientes",
      "Cierro la caja",
      "Repongo mercadería",
    ]);
  });

  it("does not split at an abbreviation", () => {
    expect(splitAnswer("Respondo al Ing. Pérez y a la Sra. López sobre los pedidos.")).toEqual([
      "Respondo al Ing. Pérez y a la Sra. López sobre los pedidos.",
    ]);
  });

  it("returns nothing for nothing", () => {
    expect(splitAnswer("")).toEqual([]);
    expect(splitAnswer("  \n\n  ")).toEqual([]);
  });

  it("cuts a sentence too long to be a fact at a space, and only then", () => {
    const long = `Palabra ${"palabra ".repeat(120).trim()}.`;
    const facts = splitAnswer(long);
    expect(facts.length).toBeGreaterThan(1);
    expect(facts.every((fact) => fact.length <= 600)).toBe(true);
    expect(facts.join(" ")).toBe(long);
  });
});
