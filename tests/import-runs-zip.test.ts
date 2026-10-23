import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { infoFrom, runsFromItems } from "@/lib/import/pdf-runs";
import { readLinkedInZip } from "@/lib/import/zip";
import { sha256Hex, UnreadableFileError } from "@/lib/import/extract";
import { parseLinkedInExport } from "@/lib/parse/linkedin-csv";

describe("runsFromItems", () => {
  it("takes position and font size from the text matrix", () => {
    const runs = runsFromItems(
      [{ str: "Nubia Retail", transform: [12, 0, 0, 12, 190.5, 593.2], width: 61.4, height: 12 }],
      2,
    );
    expect(runs).toEqual([{ str: "Nubia Retail", page: 2, x: 190.5, y: 593.2, width: 61.4, size: 12 }]);
  });

  it("uses the horizontal scale for text drawn sideways", () => {
    const [run] = runsFromItems([{ str: "vertical", transform: [10, 0, 0, 0, 10, 10], width: 40 }], 1);
    expect(run!.size).toBe(10);
  });

  it("leaves out empty text, whitespace, marked-content items and things with no size", () => {
    const runs = runsFromItems(
      [
        { str: "", transform: [10, 0, 0, 10, 0, 0], width: 0 },
        { str: "   ", transform: [10, 0, 0, 10, 0, 0], width: 5 },
        { type: "beginMarkedContent" },
        { str: "sin tamaño", transform: [0, 0, 0, 0, 5, 5], width: 30 },
        null,
        { str: "queda", transform: [10, 0, 0, 10, 5, 5], width: 30 },
      ],
      1,
    );
    expect(runs.map((r) => r.str)).toEqual(["queda"]);
  });
});

describe("infoFrom", () => {
  it("reads the fields the LinkedIn check needs", () => {
    expect(infoFrom({ Author: "LinkedIn", Subject: "Generated from Profile", Title: " ", Producer: "Apache FOP", Other: 1 })).toEqual({
      author: "LinkedIn",
      subject: "Generated from Profile",
      producer: "Apache FOP",
    });
  });

  it("is empty for anything that is not metadata", () => {
    expect(infoFrom(undefined)).toEqual({});
    expect(infoFrom("texto")).toEqual({});
    expect(infoFrom({ Author: 42 })).toEqual({});
  });
});

describe("sha256Hex", () => {
  it("is the SHA-256 of the bytes, in hex", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const buffer = new TextEncoder().encode("abc").buffer as ArrayBuffer;
    expect(await sha256Hex(buffer)).toBe(await sha256Hex("abc"));
  });
});

async function zipOf(files: Record<string, string>): Promise<ArrayBuffer> {
  const zip = new JSZip();
  for (const [name, text] of Object.entries(files)) zip.file(name, text);
  const bytes = await zip.generateAsync({ type: "uint8array" });
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe("readLinkedInZip", () => {
  const POSITIONS = "Company Name,Title,Description,Location,Started On,Finished On\nNubia Retail,Analista,,,Mar 2021,\n";

  it("returns the profile files, by lower-case name, wherever they sit in the archive", async () => {
    const files = await readLinkedInZip(
      await zipOf({
        "Positions.csv": POSITIONS,
        "export/Education.csv": "School Name,Degree Name\nUBA,Lic.\n",
        "Profile.csv": "First Name,Last Name\nAna,Gómez\n",
      }),
    );
    expect(Object.keys(files).sort()).toEqual(["education", "positions", "profile"]);
    expect(files.positions).toBe(POSITIONS);
    expect(parseLinkedInExport(files)?.experience[0]?.company?.value).toBe("Nubia Retail");
  });

  it("does not open what it does not read", async () => {
    const files = await readLinkedInZip(
      await zipOf({
        "Positions.csv": POSITIONS,
        "Connections.csv": "First Name,Last Name\nOtra,Persona\n",
        "messages.csv": "FROM,TO,CONTENT\nx,y,secreto\n",
        "notes.txt": "hola",
      }),
    );
    expect(Object.keys(files)).toEqual(["positions"]);
    expect(JSON.stringify(files)).not.toContain("secreto");
  });

  it("skips macOS resource forks and folders", async () => {
    const files = await readLinkedInZip(
      await zipOf({ "__MACOSX/._Positions.csv": "basura", "Positions.csv": POSITIONS, "carpeta/": "" }),
    );
    expect(Object.keys(files)).toEqual(["positions"]);
  });

  it("says what is wrong when there is nothing of a profile in it", async () => {
    await expect(readLinkedInZip(await zipOf({ "Connections.csv": "a,b\n1,2\n" }))).rejects.toBeInstanceOf(UnreadableFileError);
  });

  it("says what is wrong when it is not a ZIP at all", async () => {
    await expect(readLinkedInZip(new TextEncoder().encode("no soy un zip").buffer as ArrayBuffer)).rejects.toThrow(/No pudimos abrir/);
  });
});
