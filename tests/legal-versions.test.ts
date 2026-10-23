import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEGAL_EFFECTIVE_DATE, LEGAL_VERSION } from "@/lib/legal/operator";

/**
 * The version of the legal texts is what a consent is compared with, so it moves in a batch and once (O8 of e5): these keep the three
 * places that say which one it is — the constant, its date, and `docs/legal/versiones.md` — saying the same, and that document saying
 * the truth about what a new version asks people again.
 */

const doc = readFileSync("docs/legal/versiones.md", "utf8");
const policy = readFileSync("app/legales/privacidad/page.tsx", "utf8").replace(/\s+/g, " ");
const consent = readFileSync("lib/legal/consent.ts", "utf8");

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
/** «2026-10-07» and «2026-09-19.2» are both the day of a version, said as the pages say it. */
const spoken = (version: string): string => {
  const [year, month, day] = version.split(".")[0]!.split("-").map(Number);
  return `${day} de ${MONTHS[month! - 1]} de ${year}`;
};

/** The rows of the first table that follows a heading or a lead-in, as the cells of each. */
const rowsAfter = (marker: string): string[][] => {
  const from = doc.indexOf(marker);
  expect(from, marker).toBeGreaterThanOrEqual(0);
  const lines = doc.slice(from).split("\n");
  const start = lines.findIndex((line) => line.startsWith("|"));
  const rows: string[][] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) break;
    rows.push(line.split("|").slice(1, -1).map((cell) => cell.trim()));
  }
  return rows;
};

describe("the version the texts carry", () => {
  it("has a date, and the date it is in force from is that day", () => {
    expect(LEGAL_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}(\.\d+)?$/);
    expect(LEGAL_EFFECTIVE_DATE).toBe(spoken(LEGAL_VERSION));
  });

  it("is the last one the policy's own header says it went up to", () => {
    const named = [...policy.matchAll(/`LEGAL_VERSION` sube a `([^`]+)`/g)].map((match) => match[1]);
    expect(named.at(-1)).toBe(LEGAL_VERSION);
    expect(policy).toContain(`Pasada del ${LEGAL_VERSION.split(".")[0]}`);
  });

  it("is the one the registry says is in force, with the day", () => {
    expect(doc).toContain(`**Versión vigente: \`${LEGAL_VERSION}\`**`);
    expect(doc).toContain(`vigente desde el ${LEGAL_EFFECTIVE_DATE}`);
  });
});

describe("the registry of what entered each version", () => {
  const history = rowsAfter("## Qué entró en cada versión");

  it("lists the versions in order, the last of them the one in force", () => {
    const versions = history.map(([version]) => version!.replace(/`/g, ""));
    expect(versions.length).toBeGreaterThanOrEqual(8);
    expect([...versions].sort()).toEqual(versions);
    expect(versions.at(-1)).toBe(LEGAL_VERSION);
  });

  it("has a row for every version the policy names, and says what entered in it", () => {
    const rows = new Map(history.map(([version, entered]) => [version!.replace(/`/g, ""), entered!]));
    for (const named of new Set([...policy.matchAll(/`LEGAL_VERSION` sube a `([^`]+)`/g)].map((match) => match[1]!))) expect(rows.has(named), named).toBe(true);
    for (const [version, entered] of rows) expect(entered.length, version).toBeGreaterThan(20);
  });
});

describe("what a new version asks people again", () => {
  /** The kinds of consent that `lib/legal/consent.ts` compares with the version: the `has…Consent` that filter by it. */
  const compared = (): string[] => {
    const kinds: string[] = [];
    for (const body of consent.split("export async function ").slice(1)) {
      if (!/^has\w+Consent/.test(body) || !body.includes("LEGAL_VERSION")) continue;
      const kind = /eq\(schema\.consent\.kind, "(\w+)"\)/.exec(body);
      if (kind) kinds.push(kind[1]!);
    }
    return kinds.sort();
  };

  it("is, in the registry, what the code compares and nothing else", () => {
    const listed = rowsAfter("## La regla: un lote por versión").map((row) => row[1]!.replace(/`/g, "")).sort();
    expect(compared()).toEqual(["job_alerts", "tracker_mail", "transfer"]);
    expect(listed).toEqual(compared());
  });

  it("is said in the policy: the two functions that stop until it is accepted again", () => {
    expect(policy).toContain("Cuando la versión cambia, esos dos avisos se pausan hasta que vuelvas a aceptar desde la app");
  });
});

describe("the files the registry points at", () => {
  it("exist, the plans of the user aside", () => {
    const paths = new Set([...doc.matchAll(/`([\w./()-]+\.(?:ts|tsx|md))`/g)].map((match) => match[1]!).filter((path) => path.includes("/")));
    expect(paths.size).toBeGreaterThan(5);
    for (const path of paths) expect(existsSync(path), path).toBe(true);
  });
});

describe("what is switched off", () => {
  it("is not named in the version in force", () => {
    const history = rowsAfter("## Qué entró en cada versión");
    expect(history.at(-1)![1]!).not.toMatch(/\bO\d{2}\b/);
  });
});
