import { describe, expect, it } from "vitest";
import { forSync } from "@/lib/profile/sync";
import { migrateV1 } from "@/lib/profile/migrate";
import { toPlainProfile } from "@/lib/profile/project";
import { devProfile } from "./fixtures";

const NOW = "2026-09-21T00:00:00.000Z";

describe("forSync", () => {
  const stored = () => {
    const profile = migrateV1(devProfile, { now: NOW });
    profile.history.push({ id: "h", at: NOW, op: "set", path: ["contact", "city"] });
    profile.archive.push({ id: "a", at: NOW, kind: "skill", parentPath: ["skills"], entity: {}, label: "x" });
    profile.sources.push({ id: "s", kind: "cv", name: "mi-cv.pdf", fileHash: "hash", pasted: false, chars: 5, importedAt: NOW });
    return profile;
  };

  it("leaves the trail behind: history, what was removed, the names of files", () => {
    const out = forSync(stored());
    expect(out.history).toEqual([]);
    expect(out.archive).toEqual([]);
    expect(out.sources[0]).toMatchObject({ name: "", fileHash: "hash", id: "s" });
  });

  it("keeps the profile itself, every value with where it came from", () => {
    const out = forSync(stored());
    expect(out.contact.fullName).toEqual(stored().contact.fullName);
    expect(toPlainProfile(out)).toEqual(devProfile);
  });

  it("does not touch what it was given", () => {
    const profile = stored();
    forSync(profile);
    expect(profile.history).toHaveLength(1);
    expect(profile.archive).toHaveLength(1);
    expect(profile.sources[0]!.name).toBe("mi-cv.pdf");
  });
});
