import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { installOffer } from "@/lib/pwa/install";

/**
 * M45: what makes the app installable, and the one invitation to do it — said only where the browser can, and never as a promise
 * about what the browser then does with the profile.
 */

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const CHROME = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const base = { standalone: false, hasPrompt: false, userAgent: CHROME, platform: "Linux x86_64", touchPoints: 0 };

describe("what is offered", () => {
  it("is the browser's own prompt when it announced one", () => {
    expect(installOffer({ ...base, hasPrompt: true })).toBe("prompt");
  });

  it("is the place to look on an iPhone or an iPad, which announce nothing", () => {
    expect(installOffer({ ...base, userAgent: IPHONE, platform: "iPhone" })).toBe("ios");
    // An iPad that asks to be taken for a Mac, and says otherwise by its touch screen.
    expect(installOffer({ ...base, userAgent: CHROME.replace("X11; Linux x86_64", "Macintosh; Intel Mac OS X 10_15_7"), platform: "MacIntel", touchPoints: 5 })).toBe("ios");
  });

  it("is nothing where the browser cannot do it, and nothing once the app is installed", () => {
    expect(installOffer(base)).toBe("none");
    expect(installOffer({ ...base, userAgent: CHROME.replace("X11; Linux x86_64", "Macintosh; Intel Mac OS X 10_15_7"), platform: "MacIntel", touchPoints: 0 })).toBe("none");
    expect(installOffer({ ...base, standalone: true, hasPrompt: true })).toBe("none");
    expect(installOffer({ ...base, standalone: true, userAgent: IPHONE, platform: "iPhone" })).toBe("none");
  });
});

/** Width and height of a PNG, from its header. */
function sizeOf(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("the manifest", () => {
  const app = manifest();

  it("names the app and opens it on the profile, in the dark of the brand", () => {
    expect(app.name).toBe("cvexact");
    expect(app.display).toBe("standalone");
    expect(app.start_url).toBe("/perfil");
    const css = readFileSync("app/globals.css", "utf8");
    const paper = /--color-paper:\s*(#[0-9a-f]{6})/i.exec(css)![1]!;
    expect(app.background_color?.toLowerCase()).toBe(paper.toLowerCase());
    expect(app.theme_color?.toLowerCase()).toBe(paper.toLowerCase());
  });

  it("has icons of the sizes it says, in files that exist, and one that no crop can cut", () => {
    const icons = app.icons ?? [];
    expect(icons.length).toBeGreaterThanOrEqual(3);
    for (const icon of icons) {
      const [width, height] = icon.sizes!.split("x").map(Number);
      expect(sizeOf(`public${icon.src}`), icon.src).toEqual({ width, height });
      expect(icon.type).toBe("image/png");
    }
    expect(icons.some((icon) => icon.sizes === "192x192" && !icon.purpose)).toBe(true);
    expect(icons.some((icon) => icon.sizes === "512x512" && !icon.purpose)).toBe(true);
    expect(icons.some((icon) => icon.purpose === "maskable")).toBe(true);
  });
});
