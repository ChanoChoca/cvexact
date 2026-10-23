import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REGISTRIES, REGISTRY_GROUP_LABEL, mayBeIn, registriesFor, registryById } from "@/lib/evidence/registries";

/**
 * The official registers a person can look themselves up in (e5, O14): addresses that were opened and read on a day, that carry nothing of the profile
 * and that the doc that says how to read them again agrees with.
 */

const doc = readFileSync("docs/registros-oficiales.md", "utf8");

describe("the registers", () => {
  it("are each a different one, with an address that is a page on the web and nothing of anyone's in it", () => {
    expect(new Set(REGISTRIES.map((registry) => registry.id)).size).toBe(REGISTRIES.length);
    expect(new Set(REGISTRIES.map((registry) => registry.url)).size).toBe(REGISTRIES.length);
    for (const registry of REGISTRIES) {
      const url = new URL(registry.url);
      expect(url.protocol, registry.id).toBe("https:");
      // Nothing after the path: not a name, a document, a matrícula or a way of telling who came, in the query or in a fragment.
      expect(url.search, registry.id).toBe("");
      expect(url.hash, registry.id).toBe("");
      expect(url.username + url.password, registry.id).toBe("");
      expect(url.hostname, registry.id).toMatch(/^[a-z0-9.-]+\.(?:gob\.ar|gov\.ar|edu\.ar|com\.ar|com)$/);
    }
  });

  it("say what they are, what to do there and who they cover — and the day the page was read", () => {
    for (const registry of REGISTRIES) {
      expect(registry.name.length, registry.id).toBeGreaterThan(3);
      expect(registry.how.length, registry.id).toBeGreaterThan(15);
      expect(registry.covers.length, registry.id).toBeGreaterThan(15);
      expect(registry.verifiedOn, registry.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(registry.verifiedOn)), registry.id).toBe(false);
      expect(REGISTRY_GROUP_LABEL[registry.group], registry.id).toBeTruthy();
    }
  });

  it("show a study or a certification, and nothing else: no register says what a job or a project was", () => {
    expect(registriesFor("education").map((registry) => registry.id)).toEqual(["graduados"]);
    expect(registriesFor("certification").map((registry) => registry.id)).toEqual(["refeps", "gas-camuzzi", "gas-metrogas", "gas-naturgy-ban", "gas-naturgy-noa", "gas-litoral", "gas-ecogas"]);
    expect(registriesFor("experience")).toEqual([]);
    expect(registriesFor("project")).toEqual([]);
    expect(registryById("graduados")?.name).toBe("Registro Público de Graduados Universitarios");
    expect(registryById("nada")).toBeUndefined();
    expect(registryById(undefined)).toBeUndefined();
  });

  it("know that a degree from before the register began is not one it lacks", () => {
    const graduados = registryById("graduados")!;
    expect(graduados.fromYear).toBe(2012);
    expect(mayBeIn(graduados, 2019)).toBe(true);
    expect(mayBeIn(graduados, 2012)).toBe(true);
    expect(mayBeIn(graduados, 2011)).toBe(false);
    // A study with no year is not one the register is known to lack.
    expect(mayBeIn(graduados, undefined)).toBeUndefined();
    // Nor does a register with no first year say anything of when.
    expect(mayBeIn(registryById("refeps")!, 1999)).toBeUndefined();
  });
});

describe("the doc that says how to read them again", () => {
  it("lists each address the code opens, and no other", () => {
    const listed = [...doc.matchAll(/^\| [^|]+ \| (https:\/\/\S+) \|/gm)].map((match) => match[1]!);
    expect(listed.sort()).toEqual(REGISTRIES.map((registry) => registry.url).sort());
  });

  it("says each register's day, as the code does", () => {
    for (const registry of REGISTRIES) expect(doc, registry.id).toContain(registry.verifiedOn);
  });
});

describe("what opens them", () => {
  function sourceFiles(folder: string): string[] {
    return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
      const path = `${folder}/${entry.name}`;
      return entry.isDirectory() ? sourceFiles(path) : /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
    });
  }
  const sources = ["app", "components", "lib"].flatMap(sourceFiles).map((path) => [path, readFileSync(path, "utf8")] as const);

  it("asks nothing of a register: no request to any of their addresses, from any file", () => {
    const hosts = REGISTRIES.map((registry) => new URL(registry.url).hostname);
    for (const [path, text] of sources) {
      if (path === "lib/evidence/registries.ts") continue;
      for (const host of hosts) {
        // The only way a register's address is used is as the `href` of a link the person opens.
        const uses = text.split("\n").filter((line) => line.includes(host));
        expect(uses.filter((line) => /fetch\(|XMLHttpRequest|sendBeacon/.test(line)), `${path} → ${host}`).toEqual([]);
      }
    }
    expect(sources.some(([path, text]) => path.startsWith("components/profile/hub/EvidenceBlock") && /fetch\(/.test(text))).toBe(false);
    expect(sources.some(([path, text]) => path === "lib/evidence/registries.ts" && /fetch\(/.test(text))).toBe(false);
  });

  it("opens them in another tab, without telling them where the person came from, and with the address and no other", () => {
    const block = readFileSync("components/profile/hub/EvidenceBlock.tsx", "utf8");
    const link = /href=\{registry\.url\}[\s\S]*?>/.exec(block)?.[0] ?? "";
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener noreferrer"');
    // The address is the register's, whole and as it is: nothing is added to it, and the link carries nothing else.
    expect(link.startsWith("href={registry.url}")).toBe(true);
    expect([...link.matchAll(/\s([a-zA-Z-]+)=/g)].map((match) => match[1])).toEqual(["target", "rel", "className"]);
    expect(link).toContain("data-registry-open");
  });
});
