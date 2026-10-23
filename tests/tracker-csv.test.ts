import { describe, expect, it } from "vitest";
import { guessMapping, mapRows, parseCsv } from "@/lib/tracker/csv";

describe("parseCsv", () => {
  it("parsea un CSV simple separado por comas", () => {
    const { headers, rows } = parseCsv("Puesto,Empresa\nBackend,Acme\nFrontend,Beta\n");
    expect(headers).toEqual(["Puesto", "Empresa"]);
    expect(rows).toEqual([
      ["Backend", "Acme"],
      ["Frontend", "Beta"],
    ]);
  });

  it("saca el BOM y sniffea ; cuando el archivo lo usa como delimitador", () => {
    const csv = "﻿Puesto;Empresa\nBackend;Acme\n";
    const { headers, rows } = parseCsv(csv);
    expect(headers).toEqual(["Puesto", "Empresa"]);
    expect(rows).toEqual([["Backend", "Acme"]]);
  });

  it("respeta comas, comillas escapadas y saltos de línea dentro de un campo entre comillas", () => {
    const csv = 'Puesto,Notas\n"Backend, Senior","Dijo ""ok"".\nLlamar de nuevo"\n';
    const { rows } = parseCsv(csv);
    expect(rows).toEqual([["Backend, Senior", 'Dijo "ok".\nLlamar de nuevo']]);
  });

  it("tolera CRLF", () => {
    const { headers, rows } = parseCsv("Puesto,Empresa\r\nBackend,Acme\r\n");
    expect(headers).toEqual(["Puesto", "Empresa"]);
    expect(rows).toEqual([["Backend", "Acme"]]);
  });

  it("ignora filas completamente vacías", () => {
    const { rows } = parseCsv("Puesto,Empresa\nBackend,Acme\n\n\nFrontend,Beta\n");
    expect(rows).toHaveLength(2);
  });

  it("una última fila sin salto de línea final igual se lee", () => {
    const { rows } = parseCsv("Puesto,Empresa\nBackend,Acme");
    expect(rows).toEqual([["Backend", "Acme"]]);
  });
});

describe("guessMapping", () => {
  it("reconoce encabezados en español con acentos y mayúsculas mixtas", () => {
    const mapping = guessMapping(["Puesto", "Empresa", "Ubicación", "Salario Mínimo"]);
    expect(mapping.jobTitle).toBe("Puesto");
    expect(mapping.company).toBe("Empresa");
    expect(mapping.location).toBe("Ubicación");
    expect(mapping.salaryMin).toBe("Salario Mínimo");
  });

  it("reconoce encabezados en inglés", () => {
    const mapping = guessMapping(["Company", "Role", "Status"]);
    expect(mapping.company).toBe("Company");
    expect(mapping.jobTitle).toBe("Role");
    expect(mapping.status).toBe("Status");
  });

  it("no mapea una columna sin sinónimo conocido", () => {
    const mapping = guessMapping(["Columna Rara"]);
    expect(Object.keys(mapping)).toHaveLength(0);
  });
});

describe("mapRows", () => {
  const headers = ["Puesto", "Empresa", "Modalidad", "Salario"];
  const mapping = { jobTitle: "Puesto", company: "Empresa", remote: "Modalidad", salaryMin: "Salario" } as const;

  it("mapea filas válidas", () => {
    const { valid, rejected } = mapRows(headers, [["Backend", "Acme", "Remoto", "$1.500"]], mapping);
    expect(rejected).toHaveLength(0);
    expect(valid).toEqual([
      { jobTitle: "Backend", company: "Acme", remote: true, salaryMin: 1500 },
    ]);
  });

  it("rechaza una fila sin puesto ni empresa, con motivo y número de fila", () => {
    const { valid, rejected } = mapRows(headers, [
      ["Backend", "Acme", "", ""],
      ["", "", "Remoto", ""],
    ], mapping);
    expect(valid).toHaveLength(1);
    expect(rejected).toEqual([{ row: 2, reason: expect.stringContaining("puesto") }]);
  });

  it("una columna sin mapear no rompe nada — el campo queda undefined", () => {
    const { valid } = mapRows(["Puesto"], [["Backend"]], { jobTitle: "Puesto" });
    expect(valid).toEqual([{ jobTitle: "Backend" }]);
  });

  it("un estado en español minúscula se reconoce; uno inválido se ignora sin rechazar la fila", () => {
    const { valid } = mapRows(
      ["Puesto", "Estado"],
      [
        ["Backend", "entrevista"],
        ["Frontend", "no-es-un-estado"],
      ],
      { jobTitle: "Puesto", status: "Estado" },
    );
    expect(valid[0].status).toBe("entrevista");
    expect(valid[1].status).toBeUndefined();
  });
});
