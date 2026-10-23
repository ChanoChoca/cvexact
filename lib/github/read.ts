/**
 * What a person's public repositories on GitHub say, read from the browser without a token (e5, O19).
 *
 * GitHub answers a browser directly — its API accepts requests from any origin — so nothing goes through this server: each person's own connection
 * is the one that asks and the one GitHub counts, which is why sixty questions an hour, per address and without an account, is enough for one person
 * and could not be for a server asking on behalf of everyone. Nothing here signs in, asks for a permission or keeps a token (`O24`: no OAuth).
 *
 * What it reads is only the list of the repositories a user owns, and — when the person asks for it, one at a time — the README of one. What it
 * makes of them is a *proposal*: a project to confirm, with the person's own sentence about what they did in it (`lib/github/project.ts`). It never
 * counts stars, commits or followers and shows none (`O27`: nothing that inflates), and it never turns a language into a skill: the language of a
 * repository is, at most, a technology of the project, according to GitHub, and the person's to keep or not.
 *
 * `fetch` is handed in, so each way it can end — a user that is not there, a limit reached, no connection — is tried without a network.
 */

export const GITHUB_API = "https://api.github.com";

/** What GitHub lets someone ask without an account, each hour: said to the person, because it is the one limit they can run into. */
export const GITHUB_HOURLY_LIMIT = 60;

/** How many repositories one reading takes: a page, the most recently pushed first. */
export const GITHUB_PAGE = 100;

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

// --- Who ---------------------------------------------------------------------------------------------

/** A GitHub user name: letters, digits and single hyphens, not at either end, at most 39 characters. */
const LOGIN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

/**
 * The user name in what the person wrote: the name itself, with or without an arroba, or the address of a page of theirs (`github.com/ana-perez`,
 * `https://github.com/ana-perez/mi-tienda`). `null` when it is none of those.
 */
export function githubUserFrom(input: string): string | null {
  let text = input.trim().replace(/^@/, "");
  const address = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/?#\s]+)/i.exec(text);
  if (address) text = address[1]!;
  return LOGIN.test(text) ? text : null;
}

// --- What GitHub says -----------------------------------------------------------------------------------

export type GithubRepo = {
  name: string;
  /** `owner/name`. */
  fullName: string;
  /** The repository's page on GitHub. */
  url: string;
  /** What GitHub holds as its description; empty when it has none. */
  description: string;
  /** Its main language, according to GitHub; empty when it has none. */
  language: string;
  pushedAt: string;
  fork: boolean;
  archived: boolean;
};

const text = (value: unknown, max: number): string => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** A repository out of what GitHub sent, or nothing when it is not one: only a page on github.com is taken as the repository's own. */
export function repoFrom(raw: unknown): GithubRepo | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  const name = text(entry.name, 100);
  const fullName = text(entry.full_name, 140);
  const url = text(entry.html_url, 300);
  if (!name || !/^[\w.-]+\/[\w.-]+$/.test(fullName)) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") return null;
  } catch {
    return null;
  }
  return {
    name,
    fullName,
    url,
    description: text(entry.description, 300),
    language: text(entry.language, 40),
    pushedAt: text(entry.pushed_at, 40),
    fork: entry.fork === true,
    archived: entry.archived === true,
  };
}

export type GithubFailure =
  | { reason: "invalid_user" }
  | { reason: "not_found" }
  | { reason: "rate_limited"; resetAt: Date | null }
  | { reason: "network" }
  | { reason: "unexpected"; status: number };

export type GithubReading = {
  login: string;
  repos: GithubRepo[];
  /** What GitHub says is left of the hour's questions, when it says. */
  remaining: number | null;
};

/** How long GitHub is waited for: a page that waits for ever is one the person cannot leave without leaving it. */
const WAIT_MS = 15_000;

/** What every request is: a read, as a stranger who does not say where they came from — not the cookies of any site and not the address of this page. */
function requestFor(accept: string): RequestInit {
  return {
    method: "GET",
    mode: "cors",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    headers: { Accept: accept },
    // One signal for each request: it is used up by the first.
    ...(typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? { signal: AbortSignal.timeout(WAIT_MS) } : {}),
  };
}

const numberOf = (value: string | null): number | null => {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** The hour's limit, reached: a 429, or a 403 that says the questions are used up. The body is only read for that and never shown — it carries the person's address. */
async function limitReached(response: Response): Promise<boolean> {
  if (response.status === 429) return true;
  if (response.status !== 403) return false;
  if (response.headers.get("x-ratelimit-remaining") === "0" || response.headers.get("retry-after") !== null) return true;
  const body = (await response.clone().json().catch(() => null)) as { message?: unknown } | null;
  return typeof body?.message === "string" && /rate limit/i.test(body.message);
}

function resetOf(response: Response): Date | null {
  const seconds = numberOf(response.headers.get("x-ratelimit-reset"));
  if (seconds !== null) return new Date(seconds * 1000);
  const wait = numberOf(response.headers.get("retry-after"));
  return wait !== null ? new Date(Date.now() + wait * 1000) : null;
}

async function failureOf(response: Response): Promise<GithubFailure> {
  if (response.status === 404) return { reason: "not_found" };
  if (await limitReached(response)) return { reason: "rate_limited", resetAt: resetOf(response) };
  return { reason: "unexpected", status: response.status };
}

/**
 * The repositories a user owns, the most recently pushed first. One request, one of the sixty an hour. Anything that is not a repository of theirs
 * is left out here only when it is not one at all; forks are left to whoever proposes (`propose`), which says how many it left out.
 */
export async function readRepos(user: string, fetcher: Fetcher = (url, init) => fetch(url, init)): Promise<{ ok: true; reading: GithubReading } | { ok: false; failure: GithubFailure }> {
  const login = githubUserFrom(user);
  if (!login) return { ok: false, failure: { reason: "invalid_user" } };
  let response: Response;
  try {
    response = await fetcher(`${GITHUB_API}/users/${login}/repos?type=owner&sort=pushed&per_page=${GITHUB_PAGE}`, requestFor("application/vnd.github+json"));
  } catch {
    return { ok: false, failure: { reason: "network" } };
  }
  if (!response.ok) return { ok: false, failure: await failureOf(response) };
  const body: unknown = await response.json().catch(() => null);
  if (!Array.isArray(body)) return { ok: false, failure: { reason: "unexpected", status: response.status } };
  const repos = body.flatMap((entry) => {
    const repo = repoFrom(entry);
    return repo ? [repo] : [];
  });
  return { ok: true, reading: { login, repos, remaining: numberOf(response.headers.get("x-ratelimit-remaining")) } };
}

// --- The README ------------------------------------------------------------------------------------------

export type Readme = { title: string; summary: string };

/**
 * What a README says about itself, without reading it as anyone: its first heading and its first paragraph of prose, with the badges, the images,
 * the HTML, the code and the links' addresses taken out. Made by cutting, never by rewording — and shown to the person to help them remember, never
 * written into their profile as theirs.
 */
export function readmeSummary(markdown: string): Readme {
  const clean = markdown
    .replace(/\r\n?/g, "\n")
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/~~~[\s\S]*?~~~/g, "")
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/<[^>]+>/g, "");
  const title = /^#{1,2}\s+(.+)$/m.exec(clean)?.[1]?.replace(/[*_`]/g, "").trim().slice(0, 100) ?? "";
  const blocks = clean.split(/\n\s*\n/).map((block) => block.trim());
  for (const block of blocks) {
    // Headings, lists, tables, quotes and rules are not prose.
    if (block === "" || /^(?:#|[-*+]\s|\d+[.)]\s|>|\||={3,}|-{3,})/.test(block)) continue;
    const prose = block
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[*_`]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (prose.length < 40) continue;
    const summary = prose.length > 300 ? `${prose.slice(0, 300).replace(/\s+\S*$/, "")}…` : prose;
    return { title, summary };
  }
  return { title, summary: "" };
}

/** The README of one repository: one request more, of the sixty an hour, and only when the person asks for it. */
export async function readReadme(fullName: string, fetcher: Fetcher = (url, init) => fetch(url, init)): Promise<{ ok: true; readme: Readme } | { ok: false; failure: GithubFailure }> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(fullName)) return { ok: false, failure: { reason: "invalid_user" } };
  let response: Response;
  try {
    response = await fetcher(`${GITHUB_API}/repos/${fullName}/readme`, requestFor("application/vnd.github.raw+json"));
  } catch {
    return { ok: false, failure: { reason: "network" } };
  }
  if (!response.ok) return { ok: false, failure: await failureOf(response) };
  const body = await response.text().catch(() => "");
  // A README is a page of prose, not a file: a hundred thousand characters is more than anyone writes to say what a project is.
  return { ok: true, readme: readmeSummary(body.slice(0, 100_000)) };
}

// --- What becomes of it --------------------------------------------------------------------------------------

export type Proposal = { repo: GithubRepo; doubts: string[] };

/** A name that is a course, a drill or a copy, more than something someone made: said to the person, never decided for them. */
const LEARNING_NAME = /(?:^|[-_.])(?:tutorial|curso|course|bootcamp|clase|ejercicios?|exercises?|practic[ae]|learning|aprendiendo|clone|copia|todo-?app|hello-?world|test|prueba)(?:$|[-_.\d])/i;

/**
 * Of the repositories, the ones worth offering as a project: the ones the person made, and not copies of someone else's (a fork is left out — and
 * counted, so that it is said), most recently pushed first. What may not be the person's own work comes with what makes it doubtful, in words.
 */
export function propose(repos: readonly GithubRepo[]): { proposals: Proposal[]; forks: number } {
  const own = repos.filter((repo) => !repo.fork);
  const proposals = own
    .map((repo): Proposal => ({
      repo,
      doubts: [
        ...(LEARNING_NAME.test(repo.name) ? ["El nombre parece de un curso o de una práctica: confirmá que es tuyo."] : []),
        ...(repo.archived ? ["Está archivado."] : []),
      ],
    }))
    .sort((a, b) => b.repo.pushedAt.localeCompare(a.repo.pushedAt));
  return { proposals, forks: repos.length - own.length };
}

/** What each way it can fail says, to whoever asked. */
export function failureText(failure: GithubFailure): string {
  switch (failure.reason) {
    case "invalid_user":
      return "Ese usuario no parece de GitHub: escribí solo el nombre, por ejemplo «ana-perez», o la dirección de tu página.";
    case "not_found":
      return "GitHub no encontró a ese usuario. Fijate que esté bien escrito.";
    case "rate_limited": {
      const when = failure.resetAt && !Number.isNaN(failure.resetAt.getTime()) ? failure.resetAt.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false }) : null;
      return `GitHub deja hacer ${GITHUB_HOURLY_LIMIT} consultas por hora sin una cuenta y ya se usaron. ${when ? `Probá de nuevo a las ${when}.` : "Probá de nuevo en un rato."}`;
    }
    case "network":
      return "No pudimos hablar con GitHub. Revisá tu conexión y probá de nuevo.";
    case "unexpected":
      return `GitHub respondió algo que no esperábamos (código ${failure.status}). Probá de nuevo más tarde.`;
  }
}
