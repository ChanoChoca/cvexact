import { describe, expect, it } from "vitest";
import { GITHUB_API, githubUserFrom, failureText, propose, readReadme, readRepos, readmeSummary, repoFrom, type Fetcher, type GithubRepo } from "@/lib/github/read";

/**
 * What a person's public repositories say, read from the browser without a token (e5, O19): who is asked, what is asked, what is made of the answer,
 * and what each way it can fail says — with a fetch that is handed in, so that not a request goes out.
 */

const raw = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  full_name: `perfil-ejemplo/${name}`,
  html_url: `https://github.com/perfil-ejemplo/${name}`,
  description: `Descripción de ${name}`,
  language: "Python",
  pushed_at: "2026-09-01T10:00:00Z",
  fork: false,
  archived: false,
  stargazers_count: 12345,
  forks_count: 99,
  owner: { login: "perfil-ejemplo", avatar_url: "https://avatars.githubusercontent.com/u/1" },
  ...extra,
});

const respond = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });

/** A fetcher that answers what it is told and remembers what it was asked. */
function fake(answer: Response | (() => Response) | Error) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher: Fetcher = async (url, init) => {
    calls.push({ url, init });
    if (answer instanceof Error) throw answer;
    return typeof answer === "function" ? answer() : answer.clone();
  };
  return { fetcher, calls };
}

describe("who is asked about", () => {
  it("is the user name, however the person wrote it", () => {
    for (const input of ["perfil-ejemplo", "@perfil-ejemplo", "  perfil-ejemplo  ", "github.com/perfil-ejemplo", "https://github.com/perfil-ejemplo", "http://www.github.com/perfil-ejemplo/", "https://github.com/perfil-ejemplo/mi-tienda?tab=readme", "A1"]) {
      expect(githubUserFrom(input), input).toBe(input.trim().replace(/^@/, "").replace(/^.*github\.com\//i, "").split(/[/?#]/)[0]);
    }
    expect(githubUserFrom("https://github.com/perfil-ejemplo/mi-tienda")).toBe("perfil-ejemplo");
  });

  it("is nothing when it cannot be a user name: spaces, doubled or edge hyphens, too long, not GitHub", () => {
    for (const input of ["", "   ", "ana perez", "-ana", "ana-", "ana--perez", "a".repeat(40), "ana_perez", "https://gitlab.com/perfil-ejemplo", "https://ejemplo.com/ana", "ana/perez"]) {
      expect(githubUserFrom(input), input).toBeNull();
    }
    expect(githubUserFrom("a".repeat(39))).toBe("a".repeat(39));
  });
});

describe("a repository", () => {
  it("is what GitHub says of one, short and plain: its name, its page, its description and language, and when it was last pushed", () => {
    expect(repoFrom(raw("tienda", { description: "  Una   tienda\n online " }))).toEqual({
      name: "tienda",
      fullName: "perfil-ejemplo/tienda",
      url: "https://github.com/perfil-ejemplo/tienda",
      description: "Una tienda online",
      language: "Python",
      pushedAt: "2026-09-01T10:00:00Z",
      fork: false,
      archived: false,
    });
  });

  it("keeps nothing that counts: no stars, no forks, no owner, no avatar", () => {
    const repo = repoFrom(raw("tienda"))!;
    expect(Object.keys(repo).sort()).toEqual(["archived", "description", "fork", "fullName", "language", "name", "pushedAt", "url"]);
    expect(JSON.stringify(repo)).not.toMatch(/12345|stargazers|avatar/);
  });

  it("is nothing when it is not one, or when its page is not a page of GitHub's", () => {
    expect(repoFrom(null)).toBeNull();
    expect(repoFrom("tienda")).toBeNull();
    expect(repoFrom(raw(""))).toBeNull();
    expect(repoFrom(raw("tienda", { full_name: "tienda" }))).toBeNull();
    expect(repoFrom(raw("tienda", { html_url: "https://ejemplo.com/perfil-ejemplo/tienda" }))).toBeNull();
    expect(repoFrom(raw("tienda", { html_url: "http://github.com/perfil-ejemplo/tienda" }))).toBeNull();
    expect(repoFrom(raw("tienda", { html_url: "javascript:alert(1)" }))).toBeNull();
    expect(repoFrom(raw("tienda", { description: null, language: null, pushed_at: null }))).toMatchObject({ description: "", language: "", pushedAt: "" });
  });
});

describe("reading the repositories", () => {
  it("asks once, of one address of GitHub's, as a stranger that does not say where it came from, with nothing that asks permission first", async () => {
    const { fetcher, calls } = fake(respond([raw("tienda"), raw("blog")], { headers: { "x-ratelimit-remaining": "58" } }));
    const result = await readRepos("@perfil-ejemplo", fetcher);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${GITHUB_API}/users/perfil-ejemplo/repos?type=owner&sort=pushed&per_page=100`);
    expect(calls[0]!.init).toMatchObject({ method: "GET", mode: "cors", credentials: "omit", referrerPolicy: "no-referrer" });
    // And not waited for for ever.
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
    // Only a header a browser sends without asking first: `X-GitHub-Api-Version` made GitHub's own CORS answer fail.
    expect(Object.keys(calls[0]!.init.headers as Record<string, string>)).toEqual(["Accept"]);
    expect(result).toMatchObject({ ok: true, reading: { login: "perfil-ejemplo", remaining: 58 } });
    expect(result.ok && result.reading.repos.map((repo) => repo.name)).toEqual(["tienda", "blog"]);
  });

  it("asks nothing when what was written is not a user", async () => {
    const { fetcher, calls } = fake(respond([]));
    expect(await readRepos("ana perez", fetcher)).toEqual({ ok: false, failure: { reason: "invalid_user" } });
    expect(calls).toEqual([]);
  });

  it("says a user that is not there, and does not make up a list", async () => {
    expect(await readRepos("perfil-ejemplo", fake(respond({ message: "Not Found" }, { status: 404 })).fetcher)).toEqual({ ok: false, failure: { reason: "not_found" } });
  });

  it("says the hour's questions are used up — with the hour they come back — and not what GitHub says of the person's address", async () => {
    const reset = 1_790_000_000;
    for (const response of [
      respond({ message: "API rate limit exceeded for 203.0.113.7." }, { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) } }),
      respond({ message: "API rate limit exceeded for 203.0.113.7." }, { status: 429, headers: { "x-ratelimit-reset": String(reset) } }),
    ]) {
      const result = await readRepos("perfil-ejemplo", fake(response).fetcher);
      expect(result).toEqual({ ok: false, failure: { reason: "rate_limited", resetAt: new Date(reset * 1000) } });
      expect(failureText((result as { failure: Parameters<typeof failureText>[0] }).failure)).not.toContain("203.0.113.7");
    }
    // A 403 that says so in its words, without the headers (a browser may not be shown them): still the limit, with no hour to give.
    const bare = await readRepos("perfil-ejemplo", fake(respond({ message: "API rate limit exceeded for 203.0.113.7." }, { status: 403 })).fetcher);
    expect(bare).toEqual({ ok: false, failure: { reason: "rate_limited", resetAt: null } });
    expect(failureText({ reason: "rate_limited", resetAt: null })).toBe("GitHub deja hacer 60 consultas por hora sin una cuenta y ya se usaron. Probá de nuevo en un rato.");
  });

  it("does not take every 403 for the limit, and says what it was given instead", async () => {
    expect(await readRepos("perfil-ejemplo", fake(respond({ message: "Repository access blocked" }, { status: 403 })).fetcher)).toEqual({ ok: false, failure: { reason: "unexpected", status: 403 } });
    expect(await readRepos("perfil-ejemplo", fake(respond("", { status: 500 })).fetcher)).toEqual({ ok: false, failure: { reason: "unexpected", status: 500 } });
    expect(await readRepos("perfil-ejemplo", fake(respond({ items: [] })).fetcher)).toEqual({ ok: false, failure: { reason: "unexpected", status: 200 } });
    expect(await readRepos("perfil-ejemplo", fake(respond("no es json")).fetcher)).toEqual({ ok: false, failure: { reason: "unexpected", status: 200 } });
  });

  it("says there was no connection, whatever it was that failed, and keeps the repositories that are one", async () => {
    expect(await readRepos("perfil-ejemplo", fake(new TypeError("Failed to fetch")).fetcher)).toEqual({ ok: false, failure: { reason: "network" } });
    const { fetcher } = fake(respond([raw("tienda"), { nada: true }, null, raw("otro", { html_url: "https://ejemplo.com/x" })]));
    const result = await readRepos("perfil-ejemplo", fetcher);
    expect(result.ok && result.reading.repos.map((repo) => repo.name)).toEqual(["tienda"]);
  });

  it("says each failure in words, and gives the hour when it has it", () => {
    for (const failure of [{ reason: "invalid_user" }, { reason: "not_found" }, { reason: "rate_limited", resetAt: null }, { reason: "network" }, { reason: "unexpected", status: 502 }] as const) {
      expect(failureText(failure).length, failure.reason).toBeGreaterThan(30);
    }
    expect(failureText({ reason: "rate_limited", resetAt: new Date(2026, 9, 7, 15, 42) })).toContain("15:42");
    expect(failureText({ reason: "unexpected", status: 502 })).toContain("502");
  });
});

describe("the README", () => {
  const SAMPLE = `---
title: tienda
---
<!-- generado -->
[![build](https://ci.example.com/badge.svg)](https://ci.example.com)
![logo](./logo.png)

# Mi **Tienda** online

<p align="center"><img src="x.png"></p>

> Una nota

Una tienda online hecha con [Django](https://www.djangoproject.com) para vender [indumentaria](https://ejemplo.com) \`sin intermediarios\` y llevar el stock.

## Instalación

\`\`\`bash
pip install -r requirements.txt
\`\`\`

- paso uno
`;

  it("is its first heading and its first paragraph of prose, with the badges, the images, the html, the code and the addresses taken out", () => {
    expect(readmeSummary(SAMPLE)).toEqual({
      title: "Mi Tienda online",
      summary: "Una tienda online hecha con Django para vender indumentaria sin intermediarios y llevar el stock.",
    });
  });

  it("is cut short at a word, and with nothing in it when there is no prose", () => {
    const long = `# Algo\n\n${"palabra ".repeat(100)}`;
    const { summary } = readmeSummary(long);
    expect(summary.length).toBeLessThanOrEqual(301);
    expect(summary.endsWith("…")).toBe(true);
    expect(summary).not.toMatch(/palabr…$/);
    expect(readmeSummary("# Solo un título\n\n- uno\n- dos\n\n| a | b |\n|---|---|")).toEqual({ title: "Solo un título", summary: "" });
    expect(readmeSummary("")).toEqual({ title: "", summary: "" });
    expect(readmeSummary("# T\n\ncorto\n\nOtro párrafo bastante más largo que cuarenta caracteres, sí.")).toMatchObject({ summary: "Otro párrafo bastante más largo que cuarenta caracteres, sí." });
  });

  it("is asked for one repository, as raw text, and says when there is none", async () => {
    const { fetcher, calls } = fake(() => new Response(SAMPLE, { status: 200 }));
    const result = await readReadme("perfil-ejemplo/tienda", fetcher);
    expect(calls[0]!.url).toBe(`${GITHUB_API}/repos/perfil-ejemplo/tienda/readme`);
    expect((calls[0]!.init.headers as Record<string, string>).Accept).toBe("application/vnd.github.raw+json");
    expect(result).toMatchObject({ ok: true, readme: { title: "Mi Tienda online" } });
    expect(await readReadme("perfil-ejemplo/tienda", fake(respond({ message: "Not Found" }, { status: 404 })).fetcher)).toEqual({ ok: false, failure: { reason: "not_found" } });
    expect(await readReadme("no es un repo", fetcher)).toEqual({ ok: false, failure: { reason: "invalid_user" } });
    expect(calls).toHaveLength(1);
  });
});

describe("what is offered as a project", () => {
  const repo = (name: string, extra: Partial<GithubRepo> = {}): GithubRepo => ({ ...repoFrom(raw(name))!, ...extra });

  it("leaves out the copies of someone else's, says how many, and puts the most recently pushed first", () => {
    const { proposals, forks } = propose([
      repo("viejo", { pushedAt: "2024-01-01T00:00:00Z" }),
      repo("copia-de-otro", { fork: true }),
      repo("nuevo", { pushedAt: "2026-09-30T00:00:00Z" }),
      repo("otra-copia", { fork: true }),
      repo("medio", { pushedAt: "2025-06-01T00:00:00Z" }),
    ]);
    expect(forks).toBe(2);
    expect(proposals.map((proposal) => proposal.repo.name)).toEqual(["nuevo", "medio", "viejo"]);
  });

  it("says what makes one doubtful, and never decides: a course, a drill, an archived one", () => {
    const names = ["curso-de-react", "todo-app", "mi_test", "hello-world", "tutorial.js", "ejercicios-python", "practica3", "clone-de-twitter"];
    for (const name of names) expect(propose([repo(name)]).proposals[0]!.doubts, name).toEqual(["El nombre parece de un curso o de una práctica: confirmá que es tuyo."]);
    for (const name of ["tienda", "contest-site", "latest", "mi-blog", "proyecto-final", "inventario"]) expect(propose([repo(name)]).proposals[0]!.doubts, name).toEqual([]);
    expect(propose([repo("tienda", { archived: true })]).proposals[0]!.doubts).toEqual(["Está archivado."]);
    expect(propose([repo("curso-viejo", { archived: true })]).proposals[0]!.doubts).toHaveLength(2);
  });

  it("is nothing when there is nothing, and the absence of a repository is not a thing to be said", () => {
    expect(propose([])).toEqual({ proposals: [], forks: 0 });
    expect(propose([repo("copia", { fork: true })])).toEqual({ proposals: [], forks: 1 });
  });
});
