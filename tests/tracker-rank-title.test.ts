import { describe, expect, it } from "vitest";
import { rankTitleCandidates, scoreTitleCandidate } from "@/lib/tracker/rank-title";

describe("scoreTitleCandidate", () => {
  it("puntúa por solape de tokens contra el rol de una experiencia", () => {
    const experience = [{ role: "Desarrollador Java Senior", tags: ["Spring Boot", "PostgreSQL"] }];
    expect(scoreTitleCandidate("Desarrollador/a Java Senior", experience)).toBeGreaterThan(0);
    expect(scoreTitleCandidate("Desarrollador/a Java Senior", experience)).toBeGreaterThan(
      scoreTitleCandidate("Operador/a de Monitoreo de Aplicaciones N1", experience),
    );
  });

  it("también cuenta el solape contra las tags, no sólo el rol", () => {
    const experience = [{ role: "Ingeniero de Software", tags: ["Java", "Spring Boot"] }];
    expect(scoreTitleCandidate("Desarrollador/a Java (Spring Boot)", experience)).toBeGreaterThan(0);
  });

  it("sin ningún solape real, el puntaje es cero — nunca inventa una señal", () => {
    const experience = [{ role: "Diseñador Gráfico", tags: ["Illustrator", "Figma"] }];
    expect(scoreTitleCandidate("Operador/a de Monitoreo de Aplicaciones N1", experience)).toBe(0);
  });

  it("ignora mayúsculas, acentos y stopwords cortas", () => {
    const experience = [{ role: "Administrador de Bases de Datos", tags: [] }];
    expect(scoreTitleCandidate("ADMINISTRADOR DE BASES DE DATOS", experience)).toBeGreaterThan(0);
  });
});

describe("rankTitleCandidates", () => {
  const candidates = [
    "Desarrollador/a COBOL con inglés conversacional",
    "Desarrollador/a Java Senior",
    "Operador/a de Monitoreo de Aplicaciones N1",
  ];

  it("reordena para poner primero el candidato que mejor calza con la experiencia cargada", () => {
    const experience = [{ role: "Desarrollador Java", tags: ["Spring Boot", "PostgreSQL"] }];
    const ranked = rankTitleCandidates(candidates, experience);
    expect(ranked[0]).toBe("Desarrollador/a Java Senior");
    // Es un reordenamiento, no un filtro — los otros siguen presentes.
    expect(ranked).toHaveLength(candidates.length);
    expect(new Set(ranked)).toEqual(new Set(candidates));
  });

  it("sin experiencia cargada, el orden queda intacto — nunca reordena sin señal", () => {
    expect(rankTitleCandidates(candidates, [])).toEqual(candidates);
  });

  it("si ningún candidato solapa con la experiencia, el orden tampoco cambia", () => {
    const experience = [{ role: "Diseñador Gráfico", tags: ["Illustrator"] }];
    expect(rankTitleCandidates(candidates, experience)).toEqual(candidates);
  });

  it("un empate de puntaje conserva el orden original entre los empatados", () => {
    const experience = [{ role: "Desarrollador", tags: [] }];
    // Las dos primeras contienen "Desarrollador" — mismo puntaje — la
    // tercera no tiene ningún solape.
    const ranked = rankTitleCandidates(candidates, experience);
    expect(ranked.indexOf("Desarrollador/a COBOL con inglés conversacional")).toBeLessThan(
      ranked.indexOf("Desarrollador/a Java Senior"),
    );
    expect(ranked.at(-1)).toBe("Operador/a de Monitoreo de Aplicaciones N1");
  });
});
