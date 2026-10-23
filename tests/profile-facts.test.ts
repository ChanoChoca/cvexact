import { describe, expect, it } from "vitest";
import { addFactText, editFactText, factPath, removeFact, removeJobTool, setFactKind, setFactMetric, toolsOfJob } from "@/lib/profile/facts";
import { addSkill } from "@/lib/profile/entities";
import { editFieldAt, getAt, isBlankText, putBack, restoreArchived, undoLast } from "@/lib/profile/edit";
import { addEntry, blankForm } from "@/lib/onboarding/entries";
import { STAMP, profileWith } from "./helpers/profiles";

let n = 0;
const ctx = (now: string = STAMP) => ({ now, newId: () => `f-${++n}` });
const WORDS = "Llevo las campañas de Google Ads";

function draft() {
  const profile = profileWith({ company: "Nubia Retail", role: "Analista", from: { year: 2021, month: 3 }, to: "current", facts: [{ text: WORDS }, { text: "Preparo informes" }] });
  const job = profile.experience[0]!;
  return { profile, job, first: job.facts[0]!, second: job.facts[1]! };
}

describe("rewording a fact", () => {
  it("makes it the person's edit, and keeps the words it had", () => {
    const { profile, job, first } = draft();
    expect(editFactText(profile, job.id, first.id, "Llevo las campañas de Google Ads y Meta", ctx())).toBe(true);
    expect(job.facts[0]).toMatchObject({ text: "Llevo las campañas de Google Ads y Meta", status: "edited", original: WORDS });
  });

  it("keeps the first words through any number of edits", () => {
    const { profile, job, first } = draft();
    editFactText(profile, job.id, first.id, "Una versión", ctx());
    editFactText(profile, job.id, first.id, "Otra versión", ctx());
    expect(job.facts[0]).toMatchObject({ text: "Otra versión", original: WORDS });
  });

  it("puts the fact back as it was when the first words are typed again", () => {
    const { profile, job, first } = draft();
    editFactText(profile, job.id, first.id, "Otra cosa", ctx());
    editFactText(profile, job.id, first.id, WORDS, ctx());
    expect(job.facts[0]).toMatchObject({ text: WORDS, status: "confirmed" });
    expect(job.facts[0]).not.toHaveProperty("original");
  });

  it("does not count as an edit when nothing changed, and leaves no step in the history", () => {
    const { profile, job, first } = draft();
    const before = profile.history.length;
    expect(editFactText(profile, job.id, first.id, `  ${WORDS}  `, ctx())).toBe(true);
    expect(profile.history).toHaveLength(before);
    expect(job.facts[0]!.status).toBe("confirmed");
  });

  it("does not take a blank text for an edit: that is asking to remove the fact", () => {
    const { profile, job, first } = draft();
    expect(editFactText(profile, job.id, first.id, "   ", ctx())).toBe(false);
    expect(job.facts[0]!.text).toBe(WORDS);
  });

  it("cuts a text longer than a fact can be, where the history can say so", () => {
    const { profile, job, first } = draft();
    editFactText(profile, job.id, first.id, "a".repeat(900), ctx());
    expect(job.facts[0]!.text).toHaveLength(600);
  });

  it("can be undone", () => {
    const { profile, job, first } = draft();
    editFactText(profile, job.id, first.id, "Otra cosa", ctx());
    const undone = undoLast(profile, ctx());
    expect(undone.ok && undone.profile.experience[0]!.facts[0]).toMatchObject({ text: WORDS, status: "confirmed" });
  });

  it("does nothing for a fact that is not there", () => {
    const { profile, job } = draft();
    expect(editFactText(profile, job.id, "no-existe", "x", ctx())).toBe(false);
    expect(editFactText(profile, "no-existe", "x", "x", ctx())).toBe(false);
  });
});

describe("the kind of a fact", () => {
  it("can be changed, and is recorded", () => {
    const { profile, job, first } = draft();
    setFactKind(profile, job.id, first.id, "achievement", ctx());
    expect(job.facts[0]!.kind).toBe("achievement");
    expect(profile.history.at(-1)).toMatchObject({ op: "set" });
  });
});

describe("a fact's figure", () => {
  it("is added beside the words, never in them", () => {
    const { profile, job, first } = draft();
    setFactMetric(profile, job.id, first.id, { value: "20", unit: "%", approx: false }, ctx());
    expect(job.facts[0]).toMatchObject({ text: WORDS, metric: { value: "20", unit: "%", approx: false } });
  });

  it("is taken off with null, and nothing is recorded when there was none", () => {
    const { profile, job, first } = draft();
    const before = profile.history.length;
    setFactMetric(profile, job.id, first.id, null, ctx());
    expect(profile.history).toHaveLength(before);
    setFactMetric(profile, job.id, first.id, { unknown: true }, ctx());
    setFactMetric(profile, job.id, first.id, null, ctx());
    expect(job.facts[0]).not.toHaveProperty("metric");
  });
});

describe("removing a fact", () => {
  it("takes it out of the job and keeps it in the archive", () => {
    const { profile, job, first } = draft();
    removeFact(profile, job.id, first.id, ctx());
    expect(job.facts.map((fact) => fact.text)).toEqual(["Preparo informes"]);
    expect(profile.archive).toHaveLength(1);
    expect(profile.archive[0]).toMatchObject({ kind: "fact", label: WORDS, index: 0 });
  });

  it("can be brought back to where it was", () => {
    const { profile, job, first } = draft();
    removeFact(profile, job.id, first.id, ctx());
    const restored = restoreArchived(profile, profile.archive[0]!.id, ctx());
    expect(restored.ok && restored.profile.experience[0]!.facts.map((fact) => fact.text)).toEqual([WORDS, "Preparo informes"]);
  });

  it("leaves nothing to bring back for a blank one", () => {
    const { profile, job } = draft();
    job.facts.push({ id: "blank", kind: "responsibility", text: "", source: { kind: "manual", at: STAMP }, status: "confirmed" });
    removeFact(profile, job.id, "blank", ctx());
    expect(profile.archive).toEqual([]);
  });
});

describe("adding a fact by hand", () => {
  it("is the person's, as they wrote it", () => {
    const { profile, job } = draft();
    const fact = addFactText(profile, job.id, "  Atiendo a los clientes  ", "responsibility", ctx())!;
    expect(fact).toMatchObject({ text: "Atiendo a los clientes", kind: "responsibility", status: "confirmed", source: { kind: "manual", at: STAMP } });
    expect(job.facts.at(-1)).toBe(fact);
    expect(profile.history.at(-1)).toMatchObject({ op: "add" });
  });

  it("adds nothing for a blank text or a job that is not there", () => {
    const { profile, job } = draft();
    expect(addFactText(profile, job.id, "  ", "responsibility", ctx())).toBeNull();
    expect(addFactText(profile, "no-existe", "algo", "responsibility", ctx())).toBeNull();
    expect(job.facts).toHaveLength(2);
  });
});

describe("taking back a change by what it wrote", () => {
  it("puts a fact back exactly as it was, and leaves nothing in the history", () => {
    const { profile, job, first } = draft();
    const path = factPath(job.id, first.id);
    const before = structuredClone(first);
    const steps = profile.history.length;
    editFactText(profile, job.id, first.id, "Llevo las campañas de Google Ads y Meta", ctx());
    const wrote = structuredClone(job.facts[0]);
    expect(putBack(profile, path, before, wrote, ctx())).toBe(true);
    expect(job.facts[0]).toEqual(before);
    expect(profile.history).toHaveLength(steps);
  });

  it("keeps a fact as it was read, not as a person confirmed it: taking back is not standing behind it", () => {
    const { profile, job, first } = draft();
    first.status = "proposed";
    const before = structuredClone(first);
    editFactText(profile, job.id, first.id, "Otra cosa", ctx());
    putBack(profile, factPath(job.id, first.id), before, structuredClone(job.facts[0]), ctx());
    expect(job.facts[0]).toMatchObject({ text: WORDS, status: "proposed" });
  });

  it("does not put it back when it was changed again since, and says so", () => {
    const { profile, job, first } = draft();
    const path = factPath(job.id, first.id);
    const before = structuredClone(first);
    editFactText(profile, job.id, first.id, "Una versión mejor", ctx());
    const wrote = structuredClone(job.facts[0]);
    editFactText(profile, job.id, first.id, "Y otra, a mano", ctx());
    expect(putBack(profile, path, before, wrote, ctx())).toBe(false);
    expect(job.facts[0]!.text).toBe("Y otra, a mano");
  });

  it("takes with it only the change it made, not an edit made seconds before: both fall in the same step of the history", () => {
    const { profile, job, first } = draft();
    const path = factPath(job.id, first.id);
    editFactText(profile, job.id, first.id, "Corregida a mano", ctx());
    const before = structuredClone(job.facts[0]);
    editFactText(profile, job.id, first.id, "Corregida a mano y mejorada", ctx());
    const wrote = structuredClone(job.facts[0]);
    expect(putBack(profile, path, before, wrote, ctx())).toBe(true);
    expect(job.facts[0]).toMatchObject({ text: "Corregida a mano", status: "edited", original: WORDS });
    expect(profile.history.at(-1)).toMatchObject({ op: "set", before: { text: WORDS }, after: { text: "Corregida a mano" } });
  });

  it("does the same for a field, such as the description of a project", () => {
    const { profile } = draft();
    addEntry(profile, { ...blankForm("project"), what: "Tablero de ventas" }, { newId: () => `p-${++n}`, now: STAMP });
    const id = profile.projects[0]!.id;
    const path = ["projects", id, "description"];
    editFieldAt(profile, path, "Un tablero con las ventas", isBlankText, ctx());
    const before = structuredClone(getAt(profile, path));
    editFieldAt(profile, path, "Un tablero que reúne las ventas", isBlankText, ctx());
    const wrote = structuredClone(getAt(profile, path));
    expect(putBack(profile, path, before, wrote, ctx())).toBe(true);
    expect(profile.projects[0]!.description).toMatchObject({ value: "Un tablero con las ventas" });
    expect(putBack(profile, path, before, wrote, ctx())).toBe(false);
  });

  it("does nothing for something that is not there, or with nothing to put back", () => {
    const { profile, job, first } = draft();
    expect(putBack(profile, factPath(job.id, "no-existe"), first, first, ctx())).toBe(false);
    expect(putBack(profile, factPath(job.id, first.id), undefined, first, ctx())).toBe(false);
  });
});

describe("the tools of a job", () => {
  const withTools = (...facts: { text: string; kind?: "tool"; excluded?: boolean }[]) => {
    const profile = profileWith({ company: "Nubia Retail", role: "Analista", facts: [{ text: WORDS }, ...facts.map((fact) => ({ text: fact.text, kind: "tool" as const }))] });
    const job = profile.experience[0]!;
    facts.forEach((fact, index) => {
      if (fact.excluded) job.facts[index + 1]!.excluded = true;
    });
    return { profile, job };
  };

  it("lists a skill linked to the job and a tool fact of the same name once, however it is spelled", () => {
    const { profile, job } = withTools({ text: "NodeJS" }, { text: "Docker" });
    addSkill(profile, "Node.js", ctx(), job.id);
    expect(toolsOfJob(profile, job).map((tool) => tool.name)).toEqual(["Node.js", "Docker"]);
    expect(toolsOfJob(profile, job)[0]).toMatchObject({ skillId: profile.skills[0]!.id, factIds: [job.facts[1]!.id] });
  });

  it("leaves out a tool fact the person left out of their CVs, and a skill linked to another job", () => {
    const { profile, job } = withTools({ text: "Docker", excluded: true });
    addSkill(profile, "Excel", ctx());
    expect(toolsOfJob(profile, job)).toEqual([]);
  });

  it("takes a tool off for good: unlinks its skill, keeps the skill, and archives its fact", () => {
    const { profile, job } = withTools({ text: "Docker" });
    addSkill(profile, "Docker", ctx(), job.id);
    expect(removeJobTool(profile, job.id, toolsOfJob(profile, job)[0]!, ctx())).toBe(true);
    expect(toolsOfJob(profile, job)).toEqual([]);
    expect(profile.skills).toHaveLength(1);
    expect(profile.archive).toHaveLength(1);
  });
});
