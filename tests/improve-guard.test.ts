import { describe, expect, it } from "vitest";
import { IMPROVE_LIMIT, IMPROVE_MANY_LIMIT } from "@/lib/ai/prompts/improve";
import { checkImprovement } from "@/lib/onboarding/improve-guard";

/**
 * «Mejorar con IA»: what a model proposes for a line of a job, or for the description of a project, is shown only if it does not say more
 * than the person did. The prompt asks for the same facts and no new figure; this is what holds when a model does not listen, and the only
 * thing that stands between a model and a number on somebody's CV.
 */

const LINE = "Atiendo clientes y armo los pedidos del depósito";
const reason = (verdict: ReturnType<typeof checkImprovement>) => (verdict.ok ? "" : verdict.message);

describe("a proposal that says the same thing", () => {
  it("goes through, trimmed, with the words it came with", () => {
    expect(checkImprovement(LINE, "  Atiendo a los clientes y armo los pedidos del depósito  ", "task")).toEqual({ ok: true, text: "Atiendo a los clientes y armo los pedidos del depósito", same: false });
  });

  it("is nothing to propose when only the spacing differs", () => {
    expect(checkImprovement(LINE, "Atiendo  clientes y armo\nlos pedidos del depósito ", "task")).toMatchObject({ ok: true, same: true });
    expect(checkImprovement(LINE, LINE, "task")).toMatchObject({ ok: true, same: true });
  });

  it("is a change when it is only the case or a word: that is for the person to see", () => {
    expect(checkImprovement(LINE, "atiendo clientes y armo los pedidos del depósito", "task")).toMatchObject({ ok: true, same: false });
  });

  it("keeps a figure the text states however the proposal writes it: in words, in thousands, with the sign", () => {
    const original = "Atendí a cinco clientes por día, un 30 por ciento más que antes, y a 10 mil por año";
    expect(checkImprovement(original, "Atendí a 5 clientes por día, un 30% más que antes, y a 10.000 por año", "task").ok).toBe(true);
    expect(checkImprovement("Subí las ventas un 20%", "Subí las ventas un 20 %", "task").ok).toBe(true);
  });

  it("does not judge a figure that was dropped: it is next to the original, for the person to see", () => {
    expect(checkImprovement("Bajé los faltantes un 30%", "Bajé los faltantes", "task").ok).toBe(true);
  });
});

describe("a proposal that says more", () => {
  it("is thrown out for a figure the text did not state, and names it", () => {
    const verdict = checkImprovement("Bajé los faltantes del depósito", "Bajé un 30% los faltantes del depósito", "task");
    expect(verdict.ok).toBe(false);
    expect(reason(verdict)).toContain("30%");
  });

  it("counts a year, an amount and a count as figures, and a figure that is not the one the text has", () => {
    for (const added of ["Trabajé en el local desde 2019", "Trabajé en el local con 12 personas", "Trabajé en el local por $5.000", "Trabajé en el local 10 horas"]) {
      expect(checkImprovement("Trabajé en el local", added, "task").ok, added).toBe(false);
    }
    expect(checkImprovement("Atendí 30 clientes por día", "Atendí 300 clientes por día", "task").ok).toBe(false);
  });

  it("does not take a digit glued to a name for a figure", () => {
    expect(checkImprovement("Armé la autenticación con OAuth", "Armé la autenticación con OAuth2", "task").ok).toBe(true);
  });
});

describe("a proposal that cannot be used", () => {
  it("is thrown out when it is empty", () => {
    for (const proposal of ["", "   \n "]) expect(checkImprovement(LINE, proposal, "task").ok).toBe(false);
  });

  it("is thrown out when the field could not hold it: 600 for a line of a job, 800 for a project", () => {
    expect(checkImprovement(LINE, "a".repeat(IMPROVE_LIMIT.task), "task").ok).toBe(true);
    expect(checkImprovement(LINE, "a".repeat(IMPROVE_LIMIT.task + 1), "task").ok).toBe(false);
    expect(checkImprovement(LINE, "a".repeat(IMPROVE_LIMIT.project), "project").ok).toBe(true);
    expect(checkImprovement(LINE, "a".repeat(IMPROVE_LIMIT.project + 1), "project").ok).toBe(false);
  });

  it("is thrown out when it carries a mark the text never had, or the strike-out of a detail the product does not use", () => {
    expect(checkImprovement(LINE, "Atiendo clientes y escribo a [CORREO_3]", "task").ok).toBe(false);
    expect(checkImprovement(LINE, "Atiendo clientes ▒▒▒ dato personal omitido ▒▒▒", "task").ok).toBe(false);
  });

  it("lets through a mark the text itself had: it is the person's", () => {
    expect(checkImprovement("Escribí a [CORREO_1] cada semana", "Escribía a [CORREO_1] cada semana", "task").ok).toBe(true);
  });
});

describe("the texts of the other sections", () => {
  it("are held to the same figures: one the text did not state throws the proposal out, whatever the kind", () => {
    expect(checkImprovement("Soy analista de datos", "Soy analista de datos con 10 años de experiencia", "about").ok).toBe(false);
    expect(checkImprovement("Soy analista de datos con 10 años de experiencia", "Analista de datos, 10 años de experiencia", "about").ok).toBe(true);
    expect(checkImprovement("Python", "Python 3", "name").ok).toBe(false);
    expect(checkImprovement("Tesis sobre logística\nPromedio 8", "Tesis sobre logística\nPromedio 9", "points").ok).toBe(false);
  });

  it("are held to the most their own field holds", () => {
    expect(checkImprovement("Analista", "a".repeat(IMPROVE_MANY_LIMIT.headline), "headline").ok).toBe(true);
    expect(checkImprovement("Analista", "a".repeat(IMPROVE_MANY_LIMIT.headline + 1), "headline").ok).toBe(false);
    expect(checkImprovement("Sobre mí", "a".repeat(IMPROVE_MANY_LIMIT.about), "about").ok).toBe(true);
    expect(checkImprovement("Sobre mí", "a".repeat(IMPROVE_MANY_LIMIT.about + 1), "about").ok).toBe(false);
    expect(checkImprovement("ingles", "a".repeat(IMPROVE_MANY_LIMIT.name + 1), "name").ok).toBe(false);
  });

  it("keep a name and a headline to one line, and let a list of points have several", () => {
    expect(reason(checkImprovement("ingles", "Inglés\nAvanzado", "name"))).toContain("no se puede usar");
    expect(checkImprovement("Analista", "Analista\nde datos", "headline").ok).toBe(false);
    expect(checkImprovement("tesis\npromedio", "Tesis\nPromedio", "points").ok).toBe(true);
  });

  it("let a name be written in full: that is the point of it", () => {
    expect(checkImprovement("js", "JavaScript", "name")).toEqual({ ok: true, text: "JavaScript", same: false });
  });
});
