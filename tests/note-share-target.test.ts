import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Sharing to the app from another one, on Android (e5, O15): the manifest says so only when «Anotá algo» is on in the build, and the address it names is one that no
 * server reads. The worker that answers it is `tests/share-worker.test.ts`; this is what is around it.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function manifestWith(env: Record<string, string>) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  const { default: manifest } = await import("@/app/manifest");
  return manifest();
}

describe("the manifest", () => {
  it("is the one it always was by default: it does not say a word of sharing", async () => {
    const off = await manifestWith({ NEXT_PUBLIC_CVP_EXPERIMENTS: "" });
    expect("share_target" in off).toBe(false);
    expect(JSON.stringify(off)).not.toMatch(/share|anotar/i);
    expect(off.start_url).toBe("/perfil");
  });

  it("is not changed by the other switches", async () => {
    const other = await manifestWith({ NEXT_PUBLIC_CVP_EXPERIMENTS: "evidence_links,calendar_reminder,stale_skills,github_projects" });
    expect("share_target" in other).toBe(false);
  });

  it("says, with «Anotá algo» on in the build, that the app receives what is shared by a POST to an address of its own — and nothing else changes", async () => {
    const off = await manifestWith({ NEXT_PUBLIC_CVP_EXPERIMENTS: "" });
    const on = await manifestWith({ NEXT_PUBLIC_CVP_EXPERIMENTS: "note_capture" });
    expect(on.share_target).toEqual({ action: "/anotar/recibir", method: "POST", enctype: "application/x-www-form-urlencoded", params: { title: "title", text: "text", url: "url" } });
    const { share_target: _share, ...rest } = on;
    void _share;
    expect(rest).toEqual(off);
  });

  it("asks for nothing it does not need: no files, and the three things that a text has", async () => {
    const on = await manifestWith({ NEXT_PUBLIC_CVP_EXPERIMENTS: "note_capture" });
    expect(Object.keys(on.share_target!.params).sort()).toEqual(["text", "title", "url"]);
    expect(on.share_target!.params.files).toBeUndefined();
  });

  it("does not say it in production while the policy in force does not cover it, whatever the build lists", async () => {
    const production = await manifestWith({ NEXT_PUBLIC_CVP_EXPERIMENTS: "note_capture", NODE_ENV: "production" });
    expect("share_target" in production).toBe(false);
  });
});

describe("the address that receives it, if the worker is not there to", () => {
  async function route(env: Record<string, string>) {
    vi.resetModules();
    vi.unstubAllEnvs();
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    return import("@/app/(app)/anotar/recibir/route");
  }

  it("is not there when «Anotá algo» is off: nothing answers, as if the address did not exist", async () => {
    const { POST, GET } = await route({ NEXT_PUBLIC_CVP_EXPERIMENTS: "" });
    expect(POST().status).toBe(404);
    expect(GET().status).toBe(404);
  });

  it("sends the person on to «Anotá algo» saying that nothing arrived, with an address that does not depend on the server's idea of itself", async () => {
    const { POST, GET } = await route({ NEXT_PUBLIC_CVP_EXPERIMENTS: "note_capture" });
    for (const response of [POST(), GET()]) {
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/anotar?compartido=falta");
    }
  });

  it("never reads what was sent: it does not take the request, and nothing in it names a way to read one", () => {
    const source = readFileSync("app/(app)/anotar/recibir/route.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(source).not.toMatch(/formData|\.text\(\)|\.json\(\)|\.body\b|arrayBuffer|request/);
    expect(source).toMatch(/export function POST\(\)/);
  });
});

describe("the page where it lands", () => {
  it("is rendered on each request, as every page that shares the layout with the legal footer is: one built once carries the footer of the build", () => {
    // `scripts/verify-build-legal.mjs` fails the production build when the identity of the operator is baked into a page; this is the same guard before it gets there.
    const page = readFileSync("app/(app)/anotar/page.tsx", "utf8");
    expect(page).toMatch(/export const dynamic = "force-dynamic";/);
  });
});
