import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { askMetric } from "@/lib/jobs/requirement-ask";
import { ASK_OUTCOMES, ASK_TYPES, METRICS, describeTemplates, emptyMetrics, exportMetrics, recordInto, templateCounts, type MetricName } from "@/lib/metrics/counters";

/**
 * O21: the counts of each template of question in the file of activity counters (no screen offers it now), for whoever they choose to
 * give it to. Counts and nothing else; and nothing sends it anywhere (`docs/metricas.md`: there is no server for this, and it is not decided that
 * there will be).
 */

const NOW = new Date("2026-10-07T12:00:00.000Z");

const answered = () => {
  let state = emptyMetrics();
  state = recordInto(state, "ask_tool_done", new Date("2026-10-01T10:00:00.000Z"), 2);
  state = recordInto(state, "ask_tool_no", new Date("2026-10-02T10:00:00.000Z"));
  state = recordInto(state, "ask_tool_done", new Date("2026-10-05T10:00:00.000Z"));
  state = recordInto(state, "ask_credential_later", new Date("2026-10-05T11:00:00.000Z"), 4);
  state = recordInto(state, "ask_condition_done", new Date("2026-10-06T10:00:00.000Z"));
  state = recordInto(state, "question_answered", new Date("2026-10-06T10:00:00.000Z"), 9);
  return state;
};

describe("the counts of each template", () => {
  it("are every template and every way it can be answered, which is what the counters name", () => {
    expect(ASK_TYPES).toEqual(["tool", "task", "condition", "credential"]);
    expect(ASK_OUTCOMES).toEqual(["done", "no", "later"]);
    for (const type of ASK_TYPES) {
      for (const outcome of ASK_OUTCOMES) {
        expect(Object.keys(METRICS), `${type}/${outcome}`).toContain(`ask_${type}_${outcome}`);
        expect(askMetric(type, outcome), `${type}/${outcome}`).toBe(`ask_${type}_${outcome}` as MetricName);
      }
    }
  });

  it("add up the days kept, with the zeroes said, and leave out whatever is not a template", () => {
    expect(templateCounts(answered())).toEqual({
      tool: { done: 3, no: 1, later: 0 },
      task: { done: 0, no: 0, later: 0 },
      condition: { done: 1, no: 0, later: 0 },
      credential: { done: 0, no: 0, later: 4 },
    });
    expect(templateCounts(emptyMetrics())).toEqual({
      tool: { done: 0, no: 0, later: 0 },
      task: { done: 0, no: 0, later: 0 },
      condition: { done: 0, no: 0, later: 0 },
      credential: { done: 0, no: 0, later: 0 },
    });
  });

  it("are said in a line for each, so that whoever hands the file over has read what is in it", () => {
    expect(describeTemplates(templateCounts(answered()))).toEqual([
      "Herramientas: 3 sí, 1 no, 0 ahora no",
      "Tareas: 0 sí, 0 no, 0 ahora no",
      "Condiciones (licencia, vehículo, disponibilidad, permiso): 1 sí, 0 no, 0 ahora no",
      "Credenciales: 0 sí, 0 no, 4 ahora no",
    ]);
  });
});

describe("the file", () => {
  it("is what it always was while the switch is off: the days, with no template block", () => {
    const file = exportMetrics(answered(), NOW);
    expect(Object.keys(file).sort()).toEqual(["days", "exportedAt", "kind", "version"]);
    expect(file).toEqual({ kind: "cvexact-usage", version: 1, exportedAt: NOW.toISOString(), days: answered().days });
    expect(exportMetrics(answered(), NOW, { templates: false })).toEqual(file);
  });

  it("carries, when it is on, the counts of each template beside the days, which are not touched", () => {
    const file = exportMetrics(answered(), NOW, { templates: true });
    expect(file.kind).toBe("cvexact-usage");
    expect(file.version).toBe(1);
    expect(file.days).toEqual(answered().days);
    expect(file.templates).toEqual(templateCounts(answered()));
  });

  it("holds numbers and the names of the counters, never a word of what the person wrote", () => {
    const file = exportMetrics(answered(), NOW, { templates: true });
    const leaves: unknown[] = [];
    const walk = (value: unknown) => {
      if (value && typeof value === "object") Object.values(value).forEach(walk);
      else leaves.push(value);
    };
    walk(file.templates);
    expect(leaves.length).toBe(ASK_TYPES.length * ASK_OUTCOMES.length);
    for (const leaf of leaves) expect(typeof leaf).toBe("number");
    expect(JSON.stringify(file)).not.toMatch(/@|https?:|\bhttp/);
  });
});

describe("where it goes", () => {
  it("nowhere: nothing that makes or downloads the file sends it, and no route receives it", () => {
    const files = readdirSync("lib/metrics").map((name) => `lib/metrics/${name}`);
    for (const path of files) expect(readFileSync(path, "utf8"), path).not.toMatch(/\bfetch\(|sendBeacon|XMLHttpRequest|new WebSocket/);
    // No screen reads the export any more (the card that handed it to the browser to save is gone): only the file that makes it.
    const readers = ["app", "components", "lib"].flatMap((folder) => walkFiles(folder)).filter((path) => /exportMetrics\(/.test(readFileSync(path, "utf8")));
    expect(readers.sort()).toEqual(["lib/metrics/counters.ts"]);
    // No route reads the counters of this browser: the ones that exist (the tracker's own funnel, the usage of the generators) are other things.
    expect(walkFiles("app/api").filter((path) => /@\/lib\/metrics\/(?:counters|store)/.test(readFileSync(path, "utf8")))).toEqual([]);
  });
});

function walkFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = `${folder}/${entry.name}`;
    return entry.isDirectory() ? walkFiles(path) : /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}
