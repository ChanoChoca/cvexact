import { describe, expect, it } from "vitest";
import { parseCv, readUndatedJobs } from "@/lib/parse/cv-heuristic";
import { linesFromText } from "@/lib/parse/lines";

/**
 * A section of experience that says what the jobs were and never when. `parseCv` cuts entries at their
 * dates, so it leaves the whole section as text nobody placed; this reads that text for the entries it
 * probably holds, as a guess for a form to check — never as blocks of the profile.
 */

const read = (text: string) => readUndatedJobs(linesFromText(text));

describe("a section that names each job on one line", () => {
  const TEXT = `Cajero en Kiosco del Centro
Atención al cliente, manejo de caja y arqueo diario.

Repositor en Supermercado Sur
Reposición de mercadería y armado de pedidos del depósito.

Mozo en Bar La Esquina
Atención de mesas y cobro.`;

  it("is cut at each of those lines, the role first and then where", () => {
    expect(read(TEXT).map((job) => [job.role, job.company])).toEqual([
      ["Cajero", "Kiosco del Centro"],
      ["Repositor", "Supermercado Sur"],
      ["Mozo", "Bar La Esquina"],
    ]);
  });

  it("takes what is written under each as what was done there, in its own words", () => {
    const [first, second] = read(TEXT);
    expect(first!.tasks).toEqual(["Atención al cliente, manejo de caja y arqueo diario."]);
    expect(second!.tasks).toEqual(["Reposición de mercadería y armado de pedidos del depósito."]);
  });

  it("does not claim a date nobody wrote", () => {
    for (const job of read(TEXT)) {
      expect(job.start).toBeUndefined();
      expect(job.end).toBeUndefined();
    }
  });

  it("is not unsure which name is which when the sentence says it", () => {
    expect(read(TEXT).every((job) => !job.ambiguous)).toBe(true);
  });

  it("holds even when a task is short enough to look like a name", () => {
    const [job, other] = read(`Cajero en Kiosco del Centro
Atención al cliente
Manejo de caja
Repositor en Supermercado Sur
Armado de pedidos`);
    expect(job).toMatchObject({ role: "Cajero", company: "Kiosco del Centro" });
    expect(job!.tasks).toEqual(["Atención al cliente", "Manejo de caja"]);
    expect(other).toMatchObject({ role: "Repositor", company: "Supermercado Sur" });
  });
});

describe("a role that has an 'en' in it", () => {
  it("is cut at the last one: that is where the company starts", () => {
    const jobs = read(`Técnico en electrónica en Radio Sur
• Reparación de equipos
Atención en mostrador en Kiosco del Centro
• Caja`);
    expect(jobs.map((job) => [job.role, job.company])).toEqual([
      ["Técnico en electrónica", "Radio Sur"],
      ["Atención en mostrador", "Kiosco del Centro"],
    ]);
  });
});

describe("a section with the company and the role apart", () => {
  it("reads 'empresa | puesto', with the bullets as tasks", () => {
    const jobs = read(`Kiosco del Centro | Cajero
• Atención al cliente
• Manejo de caja
Supermercado Sur | Repositor
• Reposición de mercadería
• Armado de pedidos`);
    expect(jobs.map((job) => [job.company, job.role])).toEqual([
      ["Kiosco del Centro", "Cajero"],
      ["Supermercado Sur", "Repositor"],
    ]);
    expect(jobs[0]!.tasks).toEqual(["Atención al cliente", "Manejo de caja"]);
  });

  it("reads a name over two lines, when nothing says both at once", () => {
    const jobs = read(`Cajero
Kiosco del Centro
• Atención al cliente
Repositor
Supermercado Sur
• Armado de pedidos`);
    expect(jobs.map((job) => [job.role, job.company])).toEqual([
      ["Cajero", "Kiosco del Centro"],
      ["Repositor", "Supermercado Sur"],
    ]);
  });
});

describe("what a name's own line says of when", () => {
  it("takes a lone year as when it started, and says nothing of the end", () => {
    const [job] = read(`Cajero - Kiosco del Centro (2022)
Atención al cliente y caja.`);
    expect(job).toMatchObject({ role: "Cajero", company: "Kiosco del Centro", start: { year: 2022 } });
    expect(job!.end).toBeUndefined();
  });

  it("takes both ends of a range, and 'actualidad' as still going", () => {
    const [job] = read(`Cajero en Kiosco del Centro (2019 - actualidad)
Atención al cliente y caja.`);
    expect(job).toMatchObject({ role: "Cajero", company: "Kiosco del Centro", start: { year: 2019 }, end: { current: true } });
  });

  it("does not leave the date in the name", () => {
    const [job] = read("Kiosco del Centro | Cajero | 2022");
    expect(job).toMatchObject({ company: "Kiosco del Centro", role: "Cajero", start: { year: 2022 } });
  });
});

describe("when the words do not settle it", () => {
  it("says so when two names score alike, rather than choosing quietly", () => {
    const [job] = read(`Casa Rodríguez | La Esquina
• Atención al cliente`);
    expect(job).toMatchObject({ ambiguous: true });
    expect([job!.role, job!.company].sort()).toEqual(["Casa Rodríguez", "La Esquina"]);
  });

  it("is sure when a name has a word that only a role has", () => {
    const [job] = read(`Kiosco del Centro | Cajero de turno
• Atención al cliente`);
    expect(job).toMatchObject({ role: "Cajero de turno", company: "Kiosco del Centro", ambiguous: false });
  });

  it("is nothing for a paragraph: there is no line that names anything to cut at", () => {
    expect(read("Trabajé varios años como cajero en un kiosco del centro y después como repositor en un supermercado. También hice changas de albañilería.")).toEqual([]);
  });

  it("is nothing for an empty text", () => {
    expect(read("")).toEqual([]);
    expect(read("   \n  \n")).toEqual([]);
  });

  it("is at most a dozen tasks to an entry", () => {
    const [job] = read(`Cajero en Kiosco del Centro
${Array.from({ length: 20 }, (_, i) => `• Tarea número ${i + 1} de la caja`).join("\n")}`);
    expect(job!.tasks).toHaveLength(12);
  });
});

describe("what the parser leaves, and this reads", () => {
  it("is exactly the text the parser leaves unassigned under the experience heading", () => {
    const doc = parseCv(
      linesFromText(`JUAN PÉREZ
Córdoba, Argentina

EXPERIENCIA
Cajero en Kiosco del Centro
Atención al cliente, manejo de caja y arqueo diario.

Repositor en Supermercado Sur
Reposición de mercadería y armado de pedidos del depósito.`),
    );
    expect(doc.experience).toEqual([]);
    const leftover = doc.unassigned.find((item) => item.heading === "EXPERIENCIA");
    expect(leftover).toBeDefined();
    expect(read(leftover!.text).map((job) => [job.role, job.company])).toEqual([
      ["Cajero", "Kiosco del Centro"],
      ["Repositor", "Supermercado Sur"],
    ]);
  });
});
