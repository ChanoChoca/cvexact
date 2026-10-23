import { describe, expect, it } from "vitest";
import { profileSchema } from "@/lib/schemas/profile";
import { storedProfileSchema } from "@/lib/schemas/profile-v2";
import { factToBullet, formatMetric, languageLevelText, linkedSkillTags, metricSuffix, toPlainProfile } from "@/lib/profile/project";
import { migrateV1 } from "@/lib/profile/migrate";
import { serializeProfile } from "@/lib/ai/prompts/shared";
import { devProfile } from "./fixtures";

const fact = (text: string, metric?: Parameters<typeof metricSuffix>[0]["metric"]) => ({ text, metric });

describe("metrics", () => {
  it("writes a range with an en dash and its unit", () => {
    expect(formatMetric({ value: "20-25", unit: "%", approx: true })).toBe("20–25 %");
    expect(formatMetric({ value: "150", unit: "clientes", approx: false })).toBe("150 clientes");
    expect(formatMetric({ value: "12", unit: "", approx: false })).toBe("12");
  });

  it("writes nothing for an answer of 'no lo sé'", () => {
    expect(formatMetric({ unknown: true })).toBe("");
    expect(formatMetric(undefined)).toBe("");
    expect(metricSuffix(fact("Atendí clientes", { unknown: true }))).toBe("");
  });

  it("marks an approximate figure as approximate", () => {
    expect(metricSuffix(fact("Subí la conversión", { value: "20-25", unit: "%", approx: true }))).toBe(
      " — aprox. 20–25 %",
    );
    expect(metricSuffix(fact("Subí la conversión", { value: "20", unit: "%", approx: false }))).toBe(" — 20 %");
  });

  it("does not say a figure twice when the text already gives it", () => {
    expect(metricSuffix(fact("Reduje la carga de 4s a 1,2s", { value: "1,2", unit: "s", approx: false }))).toBe("");
    expect(metricSuffix(fact("Subí un 20-25% la conversión", { value: "20-25", unit: "%", approx: true }))).toBe("");
  });

  it("still adds a figure the text does not give", () => {
    expect(metricSuffix(fact("Reduje la carga de 4s", { value: "1,2", unit: "s", approx: false }))).toBe(" — 1,2 s");
  });

  it("appears on the bullet the generators read", () => {
    const stored = migrateV1(devProfile);
    stored.experience[0]!.facts[0]!.metric = { value: "30", unit: "%", approx: false };
    const first = toPlainProfile(stored).experience[0]!.bullets[0]!;
    expect(first).toBe(`${devProfile.experience[0]!.bullets[0]} — 30 %`);
    expect(factToBullet(stored.experience[0]!.facts[0]!)).toBe(first);
  });
});

describe("languages", () => {
  const level = (value: object) =>
    storedProfileSchema.parse({ languages: [{ id: "l", name: { value: "Inglés" }, level: { value } }] })
      .languages[0]!;

  it("shows the text that was written, when there is one", () => {
    expect(languageLevelText(level({ cefr: "B2", raw: "b2" }))).toBe("b2");
  });

  it("names a level stored as only a code — from an earlier version, or from a document — by the code", () => {
    expect(languageLevelText(level({ cefr: "C1" }))).toBe("C1");
    expect(languageLevelText(level({ cefr: "native" }))).toBe("Nativo");
    expect(languageLevelText(level({}))).toBe("");
  });
});

describe("toPlainProfile", () => {
  it("leaves out what was archived", () => {
    const stored = migrateV1(devProfile);
    const removed = stored.experience[0]!.facts.shift()!;
    stored.archive.push({ id: "a", at: "", kind: "fact", parentPath: [], entity: removed, label: "" });
    expect(toPlainProfile(stored).experience[0]!.bullets).toHaveLength(
      devProfile.experience[0]!.bullets.length - 1,
    );
  });

  it("shows a date picked from the picker as text a generator can read", () => {
    const stored = migrateV1(profileSchema.parse({ experience: [{ id: "e", company: "X", role: "Y" }] }));
    stored.experience[0]!.start.value = { year: 2021, month: 3 };
    stored.experience[0]!.end.value = { year: 2023 };
    expect(toPlainProfile(stored).experience[0]).toMatchObject({ start: "Marzo 2021", end: "2023" });
  });

  it("is not affected by the extra state the stored profile carries", () => {
    const stored = migrateV1(devProfile);
    stored.history.push({ id: "h", at: "", op: "set", path: ["contact", "city"] });
    stored.pending.push({ questionId: "q", ruleId: "r", state: "later", count: 1, at: "" });
    stored.notes.push({ id: "n", text: "algo", at: "" });
    expect(toPlainProfile(stored)).toEqual(devProfile);
  });
});

describe("the skills linked to a job", () => {
  const tool = (id: string, text: string) => ({ id, kind: "tool", text, source: { kind: "manual", at: "" }, status: "confirmed" });
  const stored = () =>
    storedProfileSchema.parse({
      experience: [
        { id: "e1", company: { value: "Nubia" }, role: { value: "Desarrollador" }, facts: [tool("t1", "Docker")] },
        { id: "e2", company: { value: "Lumen" }, role: { value: "Analista" }, facts: [] },
      ],
      skills: [
        { id: "s1", name: { value: "PostgreSQL" }, experienceIds: ["e1"] },
        { id: "s2", name: { value: "docker" }, experienceIds: ["e1"] },
        { id: "s3", name: { value: "Figma" }, experienceIds: [] },
        { id: "s4", name: { value: "Kubernetes", status: "proposed" }, experienceIds: ["e1", "e2"] },
        { id: "s5", name: { value: "  " }, experienceIds: ["e1"] },
      ],
    });

  it("are the tags of that job, before the tools it lists, which the generators already read as its tools", () => {
    const plain = toPlainProfile(stored());
    expect(plain.experience[0]!.tags).toEqual(["PostgreSQL", "Kubernetes", "Docker"]);
    expect(plain.experience[1]!.tags).toEqual(["Kubernetes"]);
  });

  it("are not said twice when the job already lists the tool, however it is spelled", () => {
    expect(toPlainProfile(stored()).experience[0]!.tags.filter((tag) => tag.toLowerCase() === "docker")).toEqual(["Docker"]);
  });

  it("are only the ones linked: a skill linked to no job, and a blank one, say nothing about any", () => {
    const tags = toPlainProfile(stored()).experience.flatMap((job) => job.tags);
    expect(tags).not.toContain("Figma");
    expect(tags).not.toContain("");
  });

  it("count whether the skill was read out of the job's own lines or answered, and whether it is still proposed", () => {
    expect(linkedSkillTags(stored().skills, { id: "e2", facts: [] })).toEqual(["Kubernetes"]);
  });

  it("reach the prompt: under the role they were used in, on the line of its tools", () => {
    const prompt = serializeProfile(toPlainProfile(stored()));
    const first = prompt.split("\n").findIndex((line) => line.includes("Desarrollador @ Nubia"));
    const second = prompt.split("\n").findIndex((line) => line.includes("Analista @ Lumen"));
    const lines = prompt.split("\n");
    const toolsAfter = (index: number) => lines.slice(index, index + 4).find((line) => line.trim().startsWith("tools:"));
    expect(toolsAfter(first)).toMatch(/PostgreSQL/);
    expect(toolsAfter(first)).toMatch(/Kubernetes/);
    expect(toolsAfter(second)).toMatch(/Kubernetes/);
    expect(toolsAfter(second)).not.toMatch(/PostgreSQL/);
  });

  it("leave the flat list of skills as it was", () => {
    expect(toPlainProfile(stored()).skills).toEqual(stored().skills.map((skill) => skill.name.value));
    expect(toPlainProfile(stored()).skills).toContain("Figma");
  });

  it("change nothing for a profile whose skills are linked to no job", () => {
    const profile = migrateV1(devProfile);
    for (const skill of profile.skills) skill.experienceIds = [];
    expect(toPlainProfile(profile).experience.map((job) => job.tags)).toEqual(devProfile.experience.map((job) => job.tags));
  });
});

describe("the objective", () => {
  it("reaches the plain profile, where the job feed and /postular read it", () => {
    const stored = storedProfileSchema.parse({ objective: { value: "Diseño de producto" } });
    expect(toPlainProfile(stored).objective).toBe("Diseño de producto");
    expect(toPlainProfile(storedProfileSchema.parse({})).objective).toBe("");
  });

  it("is not part of what a CV says or what the generators are given", () => {
    const stored = storedProfileSchema.parse({ objective: { value: "Diseño de producto" } });
    expect(serializeProfile(toPlainProfile(stored))).not.toContain("Diseño de producto");
  });

  it("goes through the plain profile and back: a profile written before it has none, and one with it keeps it", () => {
    const migrated = migrateV1(profileSchema.parse({ ...devProfile, objective: "Analista de datos" }));
    expect(migrated.objective.value).toBe("Analista de datos");
    expect(toPlainProfile(migrated).objective).toBe("Analista de datos");
    expect(migrateV1(devProfile).objective.value).toBe("");
  });
});
