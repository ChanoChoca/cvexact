import { describe, expect, it, vi } from "vitest";
import { copyKindOf, openCopy, type AskToOpen } from "@/lib/storage/copy-file";
import { LOCKED_KIND, MIN_PASSWORD_LENGTH, PBKDF2_ROUNDS, isLockedCopy, lockCopy, passwordProblem, readLockedCopy, unlockCopy } from "@/lib/storage/locked-copy";

/**
 * O1 (e5), for the households that share a computer: a copy that cannot be read without its password. What is checked is what a
 * person relies on — that the file says nothing of the profile without the password, that the right one opens it to exactly what
 * it was, and that a wrong one says so instead of opening something garbled.
 */

const PROFILE_COPY = {
  kind: "cvexact-profile" as const,
  version: 2,
  exportedAt: "2026-10-06T12:00:00.000Z",
  profile: { contact: { fullName: { value: "Lucía Pérez", status: "confirmed" } }, experience: [{ company: { value: "Panadería Ruiz" } }] },
};

describe("a locked copy", () => {
  it("says on the outside what it holds and when it was made, and nothing of the profile", async () => {
    const locked = await lockCopy(PROFILE_COPY, "una clave larga");
    expect(locked).toMatchObject({ kind: LOCKED_KIND, version: 1, holds: "cvexact-profile", exportedAt: PROFILE_COPY.exportedAt });
    expect(locked.kdf).toMatchObject({ name: "PBKDF2", hash: "SHA-256", iterations: PBKDF2_ROUNDS });
    const file = JSON.stringify(locked);
    for (const secret of ["Lucía", "Pérez", "Panadería", "Ruiz", "fullName"]) expect(file).not.toContain(secret);
  });

  it("opens with its password to exactly the file it was", async () => {
    const locked = await lockCopy(PROFILE_COPY, "una clave larga");
    const opened = await unlockCopy(locked, "una clave larga");
    expect(JSON.parse(opened!)).toEqual(PROFILE_COPY);
  });

  it("does not open with another password, nor with a file that was tampered with", async () => {
    const locked = await lockCopy(PROFILE_COPY, "una clave larga");
    expect(await unlockCopy(locked, "otra clave larga")).toBeNull();
    const tampered = { ...locked, data: locked.data.slice(0, -8) + (locked.data.endsWith("AAAAAAAA") ? "BBBBBBBB" : "AAAAAAAA") };
    expect(await unlockCopy(tampered, "una clave larga")).toBeNull();
    expect(await unlockCopy({ ...locked, data: "%%% not base64 %%%" }, "una clave larga")).toBeNull();
  });

  it("is two different files for the same profile and the same password: a salt and an IV of its own", async () => {
    const [a, b] = await Promise.all([lockCopy(PROFILE_COPY, "una clave larga"), lockCopy(PROFILE_COPY, "una clave larga")]);
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.cipher.iv).not.toBe(b.cipher.iv);
    expect(a.data).not.toBe(b.data);
  });

  it("holds a profile as big as a profile can get: the base64 of a few megabytes does not overflow anything", async () => {
    const big = { ...PROFILE_COPY, profile: { ...PROFILE_COPY.profile, filler: "Armo los pedidos del local y coordino al equipo. ".repeat(60_000) } };
    const opened = await unlockCopy(await lockCopy(big, "una clave larga"), "una clave larga");
    expect(opened?.length).toBe(JSON.stringify(big).length);
    expect(JSON.parse(opened!).profile.filler.length).toBe(big.profile.filler.length);
  });

  it("is told apart from an open copy, and from anything else, before a password is asked for", async () => {
    const locked = await lockCopy({ kind: "cvexact-backup", exportedAt: "2026-10-06T12:00:00.000Z" }, "una clave larga");
    expect(readLockedCopy(JSON.stringify(locked))).toMatchObject({ holds: "cvexact-backup" });
    expect(readLockedCopy(JSON.stringify(PROFILE_COPY))).toBeNull();
    expect(readLockedCopy("not json")).toBeNull();
    expect(isLockedCopy({ ...locked, holds: "cvexact-archive" })).toBe(false);
    expect(isLockedCopy({ ...locked, kdf: { ...locked.kdf, iterations: 0 } })).toBe(false);
  });
});

describe("the password chosen for it", () => {
  it("has a length below which it is refused, and has to be typed the same twice", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
    expect(passwordProblem("corta", "corta")).toBe("La contraseña tiene que tener al menos 8 caracteres.");
    expect(passwordProblem("una clave larga", "una clave larg")).toBe("Las dos contraseñas no son iguales.");
    expect(passwordProblem("una clave larga", "una clave larga")).toBeNull();
  });
});

describe("opening a copy brought back", () => {
  it("hands an open copy on as it is, without asking for anything", async () => {
    const ask = vi.fn<AskToOpen>();
    const raw = JSON.stringify(PROFILE_COPY);
    expect(await openCopy(raw, ask)).toEqual({ status: "open", raw, holds: null });
    expect(ask).not.toHaveBeenCalled();
  });

  it("asks for the password of a locked one until it opens, and gives back what it was", async () => {
    const locked = JSON.stringify(await lockCopy(PROFILE_COPY, "una clave larga"));
    const tried: Array<string | null> = [];
    // The dialog: a wrong password first, which `use` turns down, and then the right one.
    const ask: AskToOpen = async (request) => {
      expect(request).toMatchObject({ mode: "enter", holds: "cvexact-profile" });
      for (const password of ["mal escrita", "una clave larga"]) {
        const result = await request.use(password);
        tried.push(result === null ? null : password);
        if (result !== null) return result;
      }
      return null;
    };
    const opened = await openCopy(locked, ask);
    expect(tried).toEqual([null, "una clave larga"]);
    expect(opened.status).toBe("open");
    expect(opened.status === "open" && JSON.parse(opened.raw)).toEqual(PROFILE_COPY);
    expect(opened.status === "open" && opened.holds).toBe("cvexact-profile");
  });

  it("is cancelled, and nothing is read, when the person gives up", async () => {
    const locked = JSON.stringify(await lockCopy(PROFILE_COPY, "una clave larga"));
    expect(await openCopy(locked, async () => null)).toEqual({ status: "cancelled" });
  });

  it("knows a profile from a whole account's copy, by what the file says it is", () => {
    expect(copyKindOf(JSON.stringify(PROFILE_COPY))).toBe("profile");
    expect(copyKindOf(JSON.stringify({ kind: "cvexact-backup" }))).toBe("backup");
    expect(copyKindOf(JSON.stringify({ kind: "cvexact-archive" }))).toBeNull();
    expect(copyKindOf("{")).toBeNull();
  });
});
