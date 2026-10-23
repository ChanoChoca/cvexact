import { describe, expect, it } from "vitest";
import { linkKey, linkLines, MAX_LINKS, parseLinkLines } from "@/lib/profile/links";

describe("links, one to a line", () => {
  it("become links with their scheme, labelled by their address", () => {
    const links = parseLinkLines("linkedin.com/in/perfil-ejemplo\nhttps://github.com/perfil-ejemplo");
    expect(links.map((link) => link.url)).toEqual(["https://linkedin.com/in/perfil-ejemplo", "https://github.com/perfil-ejemplo"]);
    expect(links.every((link) => link.label.length > 0)).toBe(true);
  });

  it("leave out what is not a link, and count one named twice once", () => {
    expect(parseLinkLines("mi portfolio\nperfil-ejemplo.dev\nperfil-ejemplo.dev\n\n")).toEqual([expect.objectContaining({ url: "https://perfil-ejemplo.dev" })]);
  });

  it("stop at the most a profile keeps, which is three", () => {
    expect(MAX_LINKS).toBe(3);
    const many = Array.from({ length: 12 }, (_, i) => `sitio${i}.com`).join("\n");
    expect(parseLinkLines(many)).toHaveLength(MAX_LINKS);
  });

  it("go back to lines to be edited", () => {
    const links = parseLinkLines("perfil-ejemplo.dev\ngithub.com/perfil-ejemplo");
    expect(parseLinkLines(linkLines(links))).toEqual(links);
  });
});

describe("linkKey: one page, however it was written", () => {
  it("is the same for a CV's bare address and a LinkedIn export's own", () => {
    const cv = "linkedin.com/in/perfil-ejemplo-1a2b3c4d5e";
    for (const other of [
      "https://www.linkedin.com/in/perfil-ejemplo-1a2b3c4d5e",
      "http://linkedin.com/in/perfil-ejemplo-1a2b3c4d5e/",
      "https://ar.linkedin.com/in/Perfil-Ejemplo-1a2b3c4d5e?originalSubdomain=ar",
      "www.linkedin.com/in/perfil-ejemplo-1a2b3c4d5e/es",
      "https://www.linkedin.com/in/perfil-ejemplo-1a2b3c4d5e?jobid=1234&lipi=urn%3Ali%3Apage#about",
    ]) {
      expect(linkKey(other), other).toBe(linkKey(cv));
    }
  });

  it("keeps apart what really is another page", () => {
    expect(linkKey("linkedin.com/in/perfil-ejemplo")).not.toBe(linkKey("linkedin.com/in/perfil-ejemplo-dos"));
    expect(linkKey("github.com/perfil-ejemplo")).not.toBe(linkKey("github.com/perfil-ejemplo/cvexact"));
    expect(linkKey("https://flashpage.com.ar/")).toBe(linkKey("flashpage.com.ar"));
  });

  it("does not throw on something that is barely an address", () => {
    expect(() => linkKey("http://[mal")).not.toThrow();
    expect(linkKey("")).toBe("");
  });
});

describe("links, one to a line, written two ways", () => {
  it("count one page written two ways once, keeping the first", () => {
    const links = parseLinkLines("linkedin.com/in/perfil-ejemplo\nhttps://www.linkedin.com/in/perfil-ejemplo/\ngithub.com/perfil-ejemplo");
    expect(links.map((link) => link.url)).toEqual(["https://linkedin.com/in/perfil-ejemplo", "https://github.com/perfil-ejemplo"]);
  });
});
