import { readdirSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  EXPERIMENTS,
  EXPERIMENTS_KEY,
  EXPERIMENT_IDS,
  experimentOn,
  experimentOnServer,
  parseBuildList,
  parseStoredList,
  policyCovers,
  resolveExperiments,
  type ExperimentId,
  type ExperimentSpec,
} from "@/lib/experiments";
import { LEGAL_VERSION } from "@/lib/legal/operator";
import { useExperiment } from "@/lib/use-experiment";

/**
 * What is built and switched off (`lib/experiments.ts`): all off, turned on only the ways it says, and not in production by anyone who
 * has not been told the policy says what it does. And the queue of what each will ask of the policy is where the registry says it is.
 */

const everything = (value: boolean) => Object.fromEntries(EXPERIMENT_IDS.map((id) => [id, value]));
const allOf = (ids: ExperimentId[]) => Object.fromEntries(EXPERIMENT_IDS.map((id) => [id, ids.includes(id)]));

describe("the switches", () => {
  it("are all off: in production, in development, with nothing said", () => {
    expect(resolveExperiments({ production: true })).toEqual(everything(false));
    expect(resolveExperiments({ production: false })).toEqual(everything(false));
    expect(resolveExperiments({ production: false, build: "", stored: "[]" })).toEqual(everything(false));
  });

  it("are off where the tests run, which has no build variable and no browser", () => {
    for (const id of EXPERIMENT_IDS) {
      expect(experimentOn(id), id).toBe(false);
      expect(experimentOnServer(id), id).toBe(false);
    }
  });

  it("are off for a component too: a render that does not look at a browser says off", () => {
    function Probe({ id }: { id: ExperimentId }) {
      return createElement("span", null, useExperiment(id) ? "on" : "off");
    }
    for (const id of EXPERIMENT_IDS) expect(renderToStaticMarkup(createElement(Probe, { id })), id).toBe("<span>off</span>");
  });

  it("are not turned on by anything in the repository that configures a build or a deployment", () => {
    for (const path of [".env.example", "Dockerfile", "next.config.ts", "package.json", "deploy/docker-compose.yml"]) {
      const lines = readFileSync(path, "utf8").split("\n").filter((line) => !line.trimStart().startsWith("#"));
      expect(lines.filter((line) => line.includes("NEXT_PUBLIC_CVP_EXPERIMENTS")), path).toEqual([]);
    }
  });

  it("each is a different opportunity, built in a stage of the plan, said in a few words", () => {
    const opportunities = EXPERIMENT_IDS.map((id) => EXPERIMENTS[id].opportunity);
    expect(new Set(opportunities).size).toBe(opportunities.length);
    for (const id of EXPERIMENT_IDS) {
      const spec: ExperimentSpec = EXPERIMENTS[id];
      expect(id, id).toMatch(/^[a-z]+(?:_[a-z]+)*$/);
      expect(spec.opportunity, id).toMatch(/^O(?:1[0-9]|2[01])$/);
      expect([7, 8, 9], id).toContain(spec.stage);
      expect(spec.label.length, id).toBeGreaterThan(10);
    }
  });
});

describe("what next.config.ts loads", () => {
  // The config file opens the content policy to GitHub only when the build turns that switch on, so it imports the registry; and the loader that reads
  // a `next.config.ts` rewrites an `@/…` import in the config itself but not in the files that one reaches ("Cannot find module './lib/…'"). A guard,
  // because the failure is the dev server and the build not starting at all, and nothing else in the suite would say so.
  it("is reached with relative imports only: an alias in the chain from the config would stop the server from starting", () => {
    const chain = ["lib/experiments.ts", "lib/legal/operator.ts", "lib/payments/sales.ts"];
    for (const path of chain) {
      const imports = readFileSync(path, "utf8").split("\n").filter((line) => /^\s*(?:import|export)\b.*\bfrom\s+["']/.test(line) || /^\s*import\s+["']/.test(line));
      expect(imports.filter((line) => /["']@\//.test(line)), path).toEqual([]);
    }
    expect(readFileSync("next.config.ts", "utf8")).toContain('from "./lib/experiments"');
  });
});

function sourceFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = `${folder}/${entry.name}`;
    return entry.isDirectory() ? sourceFiles(path) : /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("what each switch turns on", () => {
  const files = ["app", "components", "lib"].flatMap(sourceFiles).filter((path) => path !== "lib/experiments.ts" && path !== "lib/use-experiment.ts");
  const sources = files.map((path) => [path, readFileSync(path, "utf8")] as const);

  it("is read by the code it is for, and by a hook or a function and not by a copy of its id: a switch nobody reads is a promise nobody keeps", () => {
    // `template_counts` was read only by the card of activity in Ajustes, which was taken out: the switch waits for a screen that offers the file again.
    for (const id of EXPERIMENT_IDS.filter((id) => id !== "template_counts")) {
      const readers = sources.filter(([, text]) => new RegExp(`(?:useExperiment|experimentOn)\\("${id}"\\)`).test(text)).map(([path]) => path);
      expect(readers.length, id).toBeGreaterThan(0);
    }
  });

  it("is read only through the one rule: nothing else looks at the variable of the build or at what the browser keeps", () => {
    for (const [path, text] of sources) {
      expect(text, path).not.toContain("NEXT_PUBLIC_CVP_EXPERIMENTS");
      expect(text.replace(/EXPERIMENTS_KEY/g, ""), path).not.toContain("cvexact.experiments.v1");
    }
  });
});

describe("how one is turned on", () => {
  it("by the build, with a list of ids, whatever else is in it", () => {
    expect(parseBuildList(" repeated_requirement , nada, corrected_cv,, repeated_requirement ,REPEATED_REQUIREMENT")).toEqual(["repeated_requirement", "corrected_cv"]);
    expect(parseBuildList(undefined)).toEqual([]);
    expect(parseBuildList("")).toEqual([]);
    expect(resolveExperiments({ production: true, build: "corrected_cv" })).toEqual(allOf(["corrected_cv"]));
  });

  it("in a browser that is not in production, by what it kept: a list of ids, and nothing that is not one", () => {
    expect(parseStoredList('["interview_question","x",3,"interview_question"]')).toEqual(["interview_question"]);
    for (const garbage of ["", "{", "null", "{}", '"corrected_cv"', "42"]) expect(parseStoredList(garbage), garbage).toEqual([]);
    expect(resolveExperiments({ production: false, stored: '["interview_question"]' })).toEqual(allOf(["interview_question"]));
    expect(EXPERIMENTS_KEY).toBe("cvexact.experiments.v1");
  });

  it("not in production by what a browser kept: the person in front of the product does not choose what it experiments with", () => {
    expect(resolveExperiments({ production: true, stored: JSON.stringify(EXPERIMENT_IDS) })).toEqual(everything(false));
  });

  it("both ways at once are one list", () => {
    expect(resolveExperiments({ production: false, build: "template_counts", stored: '["corrected_cv"]' })).toEqual(allOf(["template_counts", "corrected_cv"]));
  });
});

describe("the policy, which a switch that asks for it does not get past in production", () => {
  /** An experiment that asks for the policy, for as long as the test lasts: none of today's does. */
  function asking<T>(id: ExperimentId, spec: Partial<ExperimentSpec>, run: () => T): T {
    const specs = EXPERIMENTS as unknown as Record<ExperimentId, ExperimentSpec>;
    const before = specs[id];
    specs[id] = { ...before, ...spec };
    try {
      return run();
    } finally {
      specs[id] = before;
    }
  }

  it("is covered for the ones that do not ask for it, and not yet for the ones that do: no policy says what they do", () => {
    for (const id of EXPERIMENT_IDS) {
      const spec: ExperimentSpec = EXPERIMENTS[id];
      expect(policyCovers(id), id).toBe(!spec.asksPolicy);
      // Nothing that asks for it has a version that says it, until a pass of the policy writes it.
      if (spec.asksPolicy) expect(spec.policyFrom, id).toBeUndefined();
    }
  });

  it("keeps every one that asks off in production, whatever the build says, until the policy in force says what it does", () => {
    const asking = EXPERIMENT_IDS.filter((id) => (EXPERIMENTS[id] as ExperimentSpec).asksPolicy);
    // The four of O13, O14, O19 and O20 (stage 8): the address and the sentence go with the profile when it is synced, and GitHub is a new destination.
    // And two of stage 9: the note with its day and how it came goes with the profile too (O15), and the photo of a credential is read in the browser, which the policy has
    // to say before anyone does it (O18).
    expect(asking).toEqual(["evidence_links", "official_registries", "github_projects", "open_badges", "note_capture", "credential_photo"]);
    expect(resolveExperiments({ production: true, build: asking.join(",") })).toEqual(everything(false));
    expect(resolveExperiments({ production: false, build: asking.join(",") })).toEqual(allOf(asking));
  });

  it("keeps one that asks for it off in production while no policy says what it does, even if the build lists it", () => {
    asking("interview_question", { asksPolicy: true }, () => {
      expect(policyCovers("interview_question")).toBe(false);
      expect(resolveExperiments({ production: true, build: "interview_question,corrected_cv" })).toEqual(allOf(["corrected_cv"]));
    });
  });

  it("keeps it off while the policy in force is older than the one that says it, and turns it on from then", () => {
    asking("interview_question", { asksPolicy: true, policyFrom: "2026-11-02" }, () => {
      expect(policyCovers("interview_question", "2026-10-07")).toBe(false);
      expect(policyCovers("interview_question", "2026-11-01.2")).toBe(false);
      expect(policyCovers("interview_question", "2026-11-02")).toBe(true);
      expect(policyCovers("interview_question", "2026-11-02.2")).toBe(true);
      expect(policyCovers("interview_question", "2026-12-01")).toBe(true);
      expect(resolveExperiments({ production: true, build: "interview_question", legalVersion: "2026-10-07" })).toEqual(everything(false));
      expect(resolveExperiments({ production: true, build: "interview_question", legalVersion: "2026-11-02" })).toEqual(allOf(["interview_question"]));
    });
  });

  it("lets a browser in development try one that asks for it: it is where a study is prepared, and nobody else sees it", () => {
    asking("interview_question", { asksPolicy: true }, () => {
      expect(resolveExperiments({ production: false, stored: '["interview_question"]' })).toEqual(allOf(["interview_question"]));
    });
  });

  it("has a version that is a date, to be compared with the one in force", () => {
    expect(LEGAL_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}(\.\d+)?$/);
  });
});

describe("the registry of what is built and switched off", () => {
  it("names each opportunity once, in a stage of the plan", () => {
    const opportunities = EXPERIMENT_IDS.map((id) => EXPERIMENTS[id].opportunity);
    expect(new Set(opportunities).size).toBe(opportunities.length);
    for (const id of EXPERIMENT_IDS) {
      const spec: ExperimentSpec = EXPERIMENTS[id];
      expect([7, 8, 9], id).toContain(spec.stage);
      expect(spec.label.length, id).toBeGreaterThan(10);
    }
  });

  it("says which ones ask for the policy, and today none is covered", () => {
    const asking = EXPERIMENT_IDS.filter((id) => EXPERIMENTS[id].asksPolicy);
    expect(asking).toEqual([
      "evidence_links",
      "official_registries",
      "github_projects",
      "open_badges",
      "note_capture",
      "credential_photo",
    ]);
    for (const id of asking) {
      const spec: ExperimentSpec = EXPERIMENTS[id];
      expect(policyCovers(id), id).toBe(false);
      if (spec.policyFrom !== undefined) expect(spec.policyFrom, id).toMatch(/^\d{4}-\d{2}-\d{2}(\.\d+)?$/);
    }
    for (const id of EXPERIMENT_IDS.filter((id) => !EXPERIMENTS[id].asksPolicy)) {
      const spec: ExperimentSpec = EXPERIMENTS[id];
      expect(policyCovers(id), id).toBe(true);
      expect(spec.policyFrom, id).toBeUndefined();
    }
  });

  it("leaves the rest without a policy date", () => {
    for (const id of EXPERIMENT_IDS) {
      const spec: ExperimentSpec = EXPERIMENTS[id];
      if (spec.asksPolicy) continue;
      expect(spec.policyFrom, id).toBeUndefined();
    }
  });
});
