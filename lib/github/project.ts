import { linkKey } from "@/lib/schemas/profile";
import { emptyField, type StoredProfile } from "@/lib/schemas/profile-v2";
import { editContext, recordChange, type EditContext } from "@/lib/profile/edit";
import { addEvidence } from "@/lib/profile/evidence";
import type { GithubRepo } from "./read";

/**
 * A repository, confirmed as a project of the person's (e5, O19). The words that say what it is are theirs: the question is the fixed one — «¿Qué hiciste
 * vos en este proyecto?» — and what they answer is the description of the project and the sentence of its evidence. What GitHub says about the repository
 * is not copied into either: its name and its address are the repository's, said so (`quote`), and its language is a technology of the project *according
 * to GitHub*, kept as a tag the person can take off — and never one of their skills (`O27`).
 */

export type AddGithubProject = {
  repo: GithubRepo;
  /** The name of the project: the repository's, unless the person changed it. */
  name: string;
  /** What they say they did in it. */
  said: string;
  /** Whether the repository's language goes among the technologies of the project. */
  withLanguage: boolean;
};

export type AddGithubResult = { ok: true; id: string } | { ok: false; reason: "empty" | "exists" };

/** Whether the profile already has this repository as a project — by its address, however it was written. */
export const hasProjectAt = (profile: StoredProfile, url: string): boolean => profile.projects.some((project) => project.url.value !== "" && linkKey(project.url.value) === linkKey(url));

export function addGithubProject(draft: StoredProfile, input: AddGithubProject, ctx: EditContext = editContext()): AddGithubResult {
  const name = input.name.replace(/\s+/g, " ").trim().slice(0, 120);
  const said = input.said.replace(/\s+/g, " ").trim().slice(0, 800);
  if (!name || !said) return { ok: false, reason: "empty" };
  if (hasProjectAt(draft, input.repo.url)) return { ok: false, reason: "exists" };

  const id = ctx.newId();
  draft.projects.push({
    id,
    name: { value: name, status: "confirmed", source: { kind: "manual", at: ctx.now, quote: input.repo.fullName } },
    // The person's own words, answering the fixed question: it is their answer, and is credited as one.
    description: { value: said, status: "confirmed", source: { kind: "answer", at: ctx.now, questionId: `github_project:${input.repo.fullName}` } },
    url: { value: input.repo.url, status: "confirmed", source: { kind: "manual", at: ctx.now, quote: input.repo.url } },
    tags:
      input.withLanguage && input.repo.language
        ? { value: [input.repo.language], status: "confirmed", source: { kind: "manual", at: ctx.now, quote: "según GitHub" } }
        : emptyField([] as string[]),
  });
  recordChange(draft, { op: "add", path: ["projects", id], label: name }, ctx);
  addEvidence(draft, { kind: "project", id }, { type: "link", via: "github", url: input.repo.url, phrase: said }, ctx);
  return { ok: true, id };
}
