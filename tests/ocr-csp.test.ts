import { afterEach, describe, expect, it, vi } from "vitest";
import { OCR_CORE_PLAIN, OCR_CORE_SIMD, OCR_WORKER } from "@/lib/ocr/engine";

/**
 * Reading a photo in the browser (e5, O18) asks the content policy for nothing: the worker, the engine and the language are on this site, so `worker-src 'self'`,
 * `script-src 'self'` (the engine is compiled WebAssembly, which `'unsafe-eval'` already allows) and `connect-src 'self'` are enough. This holds the policy to that: the
 * switch for the photo changes not one character of it, and no third party is named for it — the opposite of what reading GitHub needs (`github-csp.test.ts`).
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function policy(env: Record<string, string>): Promise<string> {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  const { default: config } = await import("@/next.config");
  const rules = await config.headers!();
  return rules.find((rule) => rule.source === "/:path*")!.headers.find((header) => header.key === "Content-Security-Policy")!.value;
}

const directive = (csp: string, name: string): string[] => csp.split("; ").find((entry) => entry.startsWith(`${name} `))!.split(" ").slice(1);

describe("the content policy and the photo reader", () => {
  it("is the same with the switch on and off", async () => {
    const off = await policy({ NEXT_PUBLIC_CVP_EXPERIMENTS: "" });
    const on = await policy({ NEXT_PUBLIC_CVP_EXPERIMENTS: "credential_photo" });
    expect(on).toBe(off);
    const all = await policy({ NEXT_PUBLIC_CVP_EXPERIMENTS: "credential_photo,note_capture,calendar_reminder,stale_skills" });
    expect(all).toBe(off);
  });

  it("lets a worker and its scripts load from this site, and the language be fetched from it", async () => {
    const csp = await policy({ NEXT_PUBLIC_CVP_EXPERIMENTS: "credential_photo" });
    expect(directive(csp, "worker-src")).toContain("'self'");
    expect(directive(csp, "script-src")).toContain("'self'");
    // The engine is WebAssembly inside a script: compiling it needs this, and it is the app's already.
    expect(directive(csp, "script-src").some((source) => source === "'unsafe-eval'" || source === "'wasm-unsafe-eval'")).toBe(true);
    expect(directive(csp, "connect-src")).toContain("'self'");
    for (const path of [OCR_WORKER, OCR_CORE_SIMD, OCR_CORE_PLAIN]) expect(path.startsWith("/")).toBe(true);
  });

  it("names no CDN for it, in any directive", async () => {
    const csp = await policy({ NEXT_PUBLIC_CVP_EXPERIMENTS: "credential_photo" });
    expect(csp).not.toMatch(/jsdelivr|unpkg|cdnjs|tesseract/i);
  });
});
