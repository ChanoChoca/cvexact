import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Reading GitHub from the browser (e5, O19) needs `api.github.com` in `connect-src`, and the policy keeps that directive narrow on purpose
 * (`next.config.ts`: it is what stops a payload from sending a stolen key anywhere). So the host is there only when the build turns the switch on
 * — and in production not even then until the policy in force says what it does — and it is exactly one host, with nothing else loosened.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** The Content-Security-Policy that `next.config.ts` builds, for a build that says this and runs as this. */
async function policy(env: Record<string, string>): Promise<string> {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  const { default: config } = await import("@/next.config");
  const rules = await config.headers!();
  return rules.find((rule) => rule.source === "/:path*")!.headers.find((header) => header.key === "Content-Security-Policy")!.value;
}

const directive = (csp: string, name: string): string[] => csp.split("; ").find((entry) => entry.startsWith(`${name} `))!.split(" ").slice(1);

describe("connect-src and GitHub", () => {
  it("does not say a word of GitHub by default: a destination that is not used is not one to leave open", async () => {
    const csp = await policy({ NEXT_PUBLIC_CVP_EXPERIMENTS: "" });
    expect(csp).not.toMatch(/github/i);
    // What it always had.
    expect(directive(csp, "connect-src")).toEqual(expect.arrayContaining(["'self'", "https://huggingface.co", "https://cloudflareinsights.com"]));
  });

  it("is the same with the other switches on: only the one for GitHub opens it", async () => {
    const csp = await policy({ NEXT_PUBLIC_CVP_EXPERIMENTS: "evidence_links,official_registries,open_badges,corrected_cv" });
    expect(csp).not.toMatch(/github/i);
  });

  it("opens exactly one host when the build turns on reading GitHub, and changes nothing else", async () => {
    const off = await policy({ NEXT_PUBLIC_CVP_EXPERIMENTS: "" });
    const on = await policy({ NEXT_PUBLIC_CVP_EXPERIMENTS: "github_projects" });
    expect(directive(on, "connect-src")).toContain("https://api.github.com");
    expect(directive(on, "connect-src").filter((source) => /github/i.test(source))).toEqual(["https://api.github.com"]);
    expect(on.replace(" https://api.github.com", "")).toBe(off);
    // Not a wildcard, not any https at all.
    for (const name of ["connect-src", "script-src", "img-src"]) {
      expect(directive(on, name)).not.toContain("*");
      expect(directive(on, name)).not.toContain("https:");
    }
    expect(directive(on, "connect-src")).not.toContain("https://*.github.com");
    expect(directive(on, "script-src").some((source) => /github/i.test(source))).toBe(false);
  });

  it("stays shut in production, whatever the build says, while the policy in force does not cover reading GitHub", async () => {
    const csp = await policy({ NEXT_PUBLIC_CVP_EXPERIMENTS: "github_projects", NODE_ENV: "production" });
    expect(csp).not.toMatch(/github/i);
  });
});
