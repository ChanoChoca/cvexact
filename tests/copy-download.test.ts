import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadJson, todayStamp } from "@/lib/storage/download";
import { canShareCopy, shareCopy } from "@/lib/storage/share-copy";

/**
 * Stage 5 of the fourth audit (U33): what a copy is named after, what a download hands back, and what the share sheet of a phone is given. The copy is the one thing a
 * person cannot get back if the file is wrong or lost, so the day in its name and the file that is offered are checked here and not left to the browser.
 */

afterEach(() => vi.unstubAllGlobals());

describe("the day a copy is named after", () => {
  it("is the day on the person's clock and not UTC's: at half past ten at night in Buenos Aires it is still the 10th", () => {
    // A date whose local day is the 10th and whose UTC day is the 11th, whatever zone the machine running this is in.
    const night = { getFullYear: () => 2026, getMonth: () => 9, getDate: () => 10, toISOString: () => "2026-10-11T01:30:00.000Z" } as unknown as Date;
    expect(todayStamp(night)).toBe("2026-10-10");
  });

  it("writes the month and the day with two digits, so the files sort by date", () => {
    expect(todayStamp(new Date(2026, 0, 5, 12))).toBe("2026-01-05");
    expect(todayStamp(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
  });
});

describe("the file a download hands back", () => {
  it("is the one that was downloaded — its name, its type and what is in it — so a screen can offer that same file to the share sheet", async () => {
    const click = vi.fn();
    const anchor = { href: "", download: "", click, remove: vi.fn() };
    vi.stubGlobal("document", { createElement: () => anchor, body: { appendChild: vi.fn() } });

    const file = downloadJson("cvexact-perfil-2026-10-10.json", { kind: "cvexact-profile", rev: 3 });

    expect(anchor.download).toBe("cvexact-perfil-2026-10-10.json");
    expect(click).toHaveBeenCalledTimes(1);
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("cvexact-perfil-2026-10-10.json");
    expect(file.type).toBe("application/json");
    expect(JSON.parse(await file.text())).toEqual({ kind: "cvexact-profile", rev: 3 });
  });
});

describe("the copy offered to the share sheet", () => {
  const file = new File(["{}"], "cvexact-perfil-2026-10-10.json", { type: "application/json" });

  it("is offered only where the browser can share a file: no share, no way to ask, or a no to this file is no button", () => {
    vi.stubGlobal("navigator", {});
    expect(canShareCopy(file)).toBe(false);

    vi.stubGlobal("navigator", { share: vi.fn() });
    expect(canShareCopy(file)).toBe(false);

    vi.stubGlobal("navigator", { share: vi.fn(), canShare: () => false });
    expect(canShareCopy(file)).toBe(false);

    vi.stubGlobal("navigator", {
      share: vi.fn(),
      canShare: () => {
        throw new TypeError("not a file this browser knows");
      },
    });
    expect(canShareCopy(file)).toBe(false);
  });

  it("asks the browser about this very file, and is offered when it says yes", () => {
    const canShare = vi.fn(() => true);
    vi.stubGlobal("navigator", { share: vi.fn(), canShare });
    expect(canShareCopy(file)).toBe(true);
    expect(canShare).toHaveBeenCalledWith({ files: [file] });
  });

  it("gives the system the file and a title, and nothing else: no text, no link, nowhere to send it — where it goes is the person's to choose", async () => {
    const share = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { share, canShare: () => true });

    expect(await shareCopy(file)).toBe("shared");

    expect(share).toHaveBeenCalledTimes(1);
    const [data] = share.mock.calls[0] as unknown as [{ files: File[]; title: string }];
    expect(Object.keys(data).sort()).toEqual(["files", "title"]);
    expect(data.files).toEqual([file]);
    expect(data.title).toBe("Copia de tu perfil de cvexact");
  });

  it("takes the person closing the sheet for what it is — not a failure — and says when it really failed", async () => {
    vi.stubGlobal("navigator", { share: async () => Promise.reject(new DOMException("closed", "AbortError")), canShare: () => true });
    expect(await shareCopy(file)).toBe("cancelled");

    vi.stubGlobal("navigator", { share: async () => Promise.reject(new DOMException("no", "NotAllowedError")), canShare: () => true });
    expect(await shareCopy(file)).toBe("failed");

    vi.stubGlobal("navigator", { share: async () => Promise.reject(new Error("boom")), canShare: () => true });
    expect(await shareCopy(file)).toBe("failed");
  });
});
