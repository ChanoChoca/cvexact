import { describe, expect, it } from "vitest";
import { addGithubProject, hasProjectAt } from "@/lib/github/project";
import { repoFrom } from "@/lib/github/read";
import { activeEvidence } from "@/lib/profile/evidence";
import { toPlainProfile } from "@/lib/profile/project";
import { addEntry, blankForm } from "@/lib/onboarding/entries";
import { STAMP, newId, profileWith } from "./helpers/profiles";

/**
 * A repository, confirmed as a project (e5, O19): what the person says they did in it is the description and the sentence of its evidence; what GitHub
 * says of it is its name and its address, said to be GitHub's, and its language as a technology of the project — never one of the person's skills.
 */

const ctx = { now: STAMP, newId };
const repo = repoFrom({
  name: "tienda",
  full_name: "perfil-ejemplo/tienda",
  html_url: "https://github.com/perfil-ejemplo/tienda",
  description: "Tienda en Django",
  language: "Python",
  pushed_at: "2026-09-01T10:00:00Z",
  fork: false,
  archived: false,
  stargazers_count: 4000,
})!;

const input = { repo, name: "Tienda online", said: "Armé el carrito y los pagos, y la puse en producción.", withLanguage: true };

describe("a repository confirmed as a project", () => {
  it("is a project with the person's own words, the repository's address and its language as a technology according to GitHub", () => {
    const profile = profileWith({ company: "Nubia Retail", role: "Analista", from: { year: 2022 }, to: "current" });
    const result = addGithubProject(profile, input, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const project = profile.projects.find((entry) => entry.id === result.id)!;
    expect(project.name).toMatchObject({ value: "Tienda online", status: "confirmed", source: { kind: "manual", quote: "perfil-ejemplo/tienda" } });
    // Their answer to the fixed question, credited to them as an answer.
    expect(project.description).toMatchObject({ value: "Armé el carrito y los pagos, y la puse en producción.", source: { kind: "answer", questionId: "github_project:perfil-ejemplo/tienda" } });
    expect(project.url).toMatchObject({ value: "https://github.com/perfil-ejemplo/tienda", source: { quote: "https://github.com/perfil-ejemplo/tienda" } });
    expect(project.tags).toMatchObject({ value: ["Python"], source: { quote: "según GitHub" } });
    expect(profile.history.some((entry) => entry.op === "add" && entry.path.join("/") === `projects/${project.id}`)).toBe(true);
  });

  it("puts what shows it beside it: the repository's page, with the same words, said to have come from GitHub", () => {
    const profile = profileWith();
    const result = addGithubProject(profile, input, ctx);
    if (!result.ok) throw new Error("not added");
    const project = profile.projects[0]!;
    expect(activeEvidence(project)).toEqual([
      { id: expect.any(String), type: "link", via: "github", url: "https://github.com/perfil-ejemplo/tienda", phrase: input.said, at: STAMP },
    ]);
    expect(profile.history.at(-1)).toMatchObject({ op: "add", path: ["projects", project.id, "evidence", expect.any(String)] });
  });

  it("never turns a language into a skill, and leaves the technologies out when the person does", () => {
    const profile = profileWith();
    addGithubProject(profile, { ...input, withLanguage: false }, ctx);
    expect(profile.projects[0]!.tags.value).toEqual([]);
    expect(profile.skills).toEqual([]);
    const other = profileWith();
    addGithubProject(other, input, ctx);
    expect(other.skills).toEqual([]);
  });

  it("does not copy what GitHub says of it, nor anything that counts: no description of theirs, no stars", () => {
    const profile = profileWith();
    addGithubProject(profile, input, ctx);
    const text = JSON.stringify(profile.projects);
    expect(text).not.toContain("Tienda en Django");
    expect(text).not.toMatch(/4000|stargazers/);
  });

  it("needs a name and the person's words, and is not added twice, however the address was written", () => {
    const profile = profileWith();
    expect(addGithubProject(profile, { ...input, said: "   " }, ctx)).toEqual({ ok: false, reason: "empty" });
    expect(addGithubProject(profile, { ...input, name: "" }, ctx)).toEqual({ ok: false, reason: "empty" });
    expect(profile.projects).toEqual([]);
    expect(addGithubProject(profile, input, ctx).ok).toBe(true);
    expect(addGithubProject(profile, { ...input, repo: { ...repo, url: "https://www.github.com/perfil-ejemplo/tienda/" } }, ctx)).toEqual({ ok: false, reason: "exists" });
    expect(profile.projects).toHaveLength(1);
  });

  it("knows a project the person already had by its address", () => {
    const profile = profileWith();
    const id = addEntry(profile, { ...blankForm("project"), what: "Mi tienda", where: "Una tienda" }, { newId, now: STAMP })!;
    expect(hasProjectAt(profile, repo.url)).toBe(false);
    profile.projects.find((project) => project.id === id)!.url = { value: "github.com/perfil-ejemplo/tienda", status: "confirmed" };
    expect(hasProjectAt(profile, repo.url)).toBe(true);
  });

  it("goes to the generators as any project of the person's does, and its evidence does not", () => {
    const profile = profileWith();
    addGithubProject(profile, input, ctx);
    const plain = toPlainProfile(profile);
    expect(plain.projects.map((project) => project.name)).toEqual(["Tienda online"]);
    expect(JSON.stringify(plain)).not.toContain("via");
  });
});
