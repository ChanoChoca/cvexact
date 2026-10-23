import { describe, expect, it } from "vitest";
import { NOTICE_KINDS, snoozeCovers, syncLine, syncNotice, syncNoticeText, syncStatus, whenWords } from "@/lib/profile/sync-status";
import { parseSyncState, type SyncState } from "@/lib/storage/sync-state";

/**
 * Whether the account has what is on the screen, said in words. Nothing here uploads anything: it reads what this
 * browser remembers of its last meeting with an account against the profile it has now.
 */

const NOW = new Date("2026-10-03T18:00:00.000Z");
const UTC = "UTC";
const AT = "2026-09-28T15:40:00.000Z";
const synced = (rev: number, userId = "u1"): SyncState => ({ userId, rev, at: AT });

describe("whether the account is up to date", () => {
  it("is not a question without an account to be up to date with", () => {
    expect(syncStatus({ rev: 5 }, synced(5), null)).toBe("off");
  });

  it("is «never» when this browser has not met this account: no trace, a trace of another account, or one with no rev", () => {
    expect(syncStatus({ rev: 5 }, {}, "u1")).toBe("never");
    expect(syncStatus({ rev: 5 }, synced(5, "otra-cuenta"), "u1")).toBe("never");
    expect(syncStatus({ rev: 5 }, { userId: "u1", at: AT }, "u1")).toBe("never");
  });

  it("is «synced» while the profile is the one that was sent", () => {
    expect(syncStatus({ rev: 5 }, synced(5), "u1")).toBe("synced");
  });

  it("is «pending» after any save, since a save raises the rev", () => {
    expect(syncStatus({ rev: 6 }, synced(5), "u1")).toBe("pending");
    expect(syncStatus({ rev: 40 }, synced(5), "u1")).toBe("pending");
  });

  it("is «pending» too when the rev went down: an import or the account's own profile put in a different one wholesale", () => {
    expect(syncStatus({ rev: 3 }, synced(57), "u1")).toBe("pending");
  });
});

describe("a date in words", () => {
  it("is the day and the month, and no year in the year it is", () => {
    expect(whenWords(AT, NOW, UTC)).toBe("el 28 de septiembre");
  });

  it("adds the year when it is another", () => {
    expect(whenWords("2025-12-31T12:00:00.000Z", NOW, UTC)).toBe("el 31 de diciembre de 2025");
  });

  it("is nothing for something that is not a date, so a sentence leaves it out instead of saying «el Invalid Date»", () => {
    expect(whenWords("ayer", NOW, UTC)).toBe("");
    expect(whenWords("", NOW, UTC)).toBe("");
  });
});

describe("the line that says where it stands", () => {
  it("says nothing without an account", () => {
    expect(syncLine("off", synced(5), NOW, UTC)).toBeNull();
  });

  it("says the account does not have the profile yet", () => {
    expect(syncLine("never", {}, NOW, UTC)).toBe("Tu cuenta todavía no tiene tu perfil.");
  });

  it("says what is not up there, and since when it is as it is", () => {
    expect(syncLine("pending", synced(5), NOW, UTC)).toBe("Cambios sin subir: tu cuenta tiene tu perfil como estaba el 28 de septiembre.");
  });

  it("says it is all there, and when it was made so", () => {
    expect(syncLine("synced", synced(5), NOW, UTC)).toBe("Tu cuenta tiene tu perfil al día: lo igualaste el 28 de septiembre.");
  });

  it("does not make up a date it was not given", () => {
    expect(syncLine("pending", { userId: "u1", rev: 5 }, NOW, UTC)).toBe("Cambios sin subir.");
    expect(syncLine("synced", { userId: "u1", rev: 5 }, NOW, UTC)).toBe("Tu cuenta tiene tu perfil al día.");
  });
});

describe("the notice in the list of what is left to do", () => {
  const ask = (overrides: Partial<Parameters<typeof syncNotice>[0]> = {}) =>
    syncNotice({ status: "pending", substance: true, state: synced(5), email: "lucia@example.com", now: NOW, timeZone: UTC, ...overrides });

  it("says the account lacks the profile, with the address it is signed in with", () => {
    const notice = ask({ status: "never", state: {} });
    expect(notice).toEqual({
      status: "never",
      title: "Entraste: falta subir tu perfil",
      detail:
        "Tu cuenta, lucia@example.com, todavía no lo tiene: sigue viviendo solo en este navegador. " +
        "Subilo para tenerlo en cualquier celular o computadora y a salvo si se borran los datos de acá.",
    });
  });

  it("does not need the address to say it", () => {
    expect(ask({ status: "never", state: {}, email: undefined })?.detail).toMatch(/^Tu cuenta todavía no lo tiene/);
  });

  it("says what changed is only here, and since when the account has the older one", () => {
    expect(ask()).toEqual({
      status: "pending",
      title: "Cambios sin subir",
      detail: "Tu cuenta tiene tu perfil como estaba el 28 de septiembre; lo que cambiaste desde entonces sigue solo en este navegador.",
    });
  });

  it("is not there when there is nothing to tell: no account, or an account that is up to date", () => {
    expect(ask({ status: "off" })).toBeNull();
    expect(ask({ status: "synced" })).toBeNull();
  });

  it("is not there for a profile with nothing in it worth keeping", () => {
    expect(ask({ substance: false })).toBeNull();
    expect(ask({ status: "never", state: {}, substance: false })).toBeNull();
  });

  it("goes away for a while when it was put off, and comes back when the while is over", () => {
    expect(ask({ state: { ...synced(5), snoozedUntil: "2026-10-10T00:00:00.000Z" } })).toBeNull();
    expect(ask({ state: { ...synced(5), snoozedUntil: "2026-10-01T00:00:00.000Z" } })?.title).toBe("Cambios sin subir");
  });
});

describe("what «Ahora no» holds off (U06)", () => {
  const LATER = "2026-10-10T00:00:00.000Z";
  const ask = (overrides: Partial<Parameters<typeof syncNotice>[0]> = {}) =>
    syncNotice({ status: "pending", substance: true, state: synced(5), email: "lucia@example.com", now: NOW, timeZone: UTC, ...overrides });

  it("is the notice it was said to, and no other: changes not uploaded put off do not hide a stuck upload", () => {
    const state = { ...synced(5), snoozedUntil: LATER, snoozedFor: "pending" as const };
    // The same notice stays away…
    expect(ask({ state })).toBeNull();
    // …and the two ways the upload can be stuck are news, said as soon as they are true.
    expect(ask({ state, auto: { phase: "diverged" } })?.status).toBe("diverged");
    expect(ask({ state, auto: { phase: "paused", message: "No pudimos subir tus cambios." } })?.status).toBe("paused");
  });

  it("holds off a stuck upload only when that was what was put off", () => {
    const state = { ...synced(5), snoozedUntil: LATER, snoozedFor: "diverged" as const };
    expect(ask({ state, auto: { phase: "diverged" } })).toBeNull();
    // And a different state of the same account is another notice: it comes back.
    expect(ask({ state, auto: { phase: "paused", message: "x" } })?.status).toBe("paused");
  });

  it("covers, in what was saved before it was told apart, what that button was for: the account lacking something", () => {
    expect(snoozeCovers(undefined, "never")).toBe(true);
    expect(snoozeCovers(undefined, "pending")).toBe(true);
    expect(snoozeCovers(undefined, "diverged")).toBe(false);
    expect(snoozeCovers(undefined, "paused")).toBe(false);
    for (const kind of NOTICE_KINDS) expect(snoozeCovers(kind, kind)).toBe(true);
    expect(snoozeCovers("never", "pending")).toBe(false);
  });

  it("is remembered with the notice it was said to, and a value that is not a notice is let go", () => {
    expect(parseSyncState(JSON.stringify({ userId: "u1", rev: 5, snoozedUntil: LATER, snoozedFor: "paused" })).snoozedFor).toBe("paused");
    expect(parseSyncState(JSON.stringify({ userId: "u1", rev: 5, snoozedUntil: LATER, snoozedFor: "para-siempre" })).snoozedFor).toBeUndefined();
    expect(parseSyncState(JSON.stringify({ userId: "u1", rev: 5, snoozedUntil: LATER })).snoozedFor).toBeUndefined();
  });
});

describe("a stuck upload, in the list of what is left to do", () => {
  const stuck = (auto: Parameters<typeof syncNotice>[0]["auto"]) =>
    syncNotice({ status: "pending", substance: true, state: synced(5), email: "lucia@example.com", now: NOW, timeZone: UTC, auto });

  it("offers the way out it names: trying again is a button on the task, and not «desde Ajustes»", () => {
    const notice = stuck({ phase: "paused", message: "No pudimos subir tus cambios." });
    expect(notice?.detail).toBe("No pudimos subir tus cambios. Siguen a salvo en este navegador: probá de nuevo, o subilos a mano cuando puedas.");
    expect(notice?.detail).not.toMatch(/Ajustes/);
  });

  it("says that the two can be joined, or one of them kept, which the task offers as buttons", () => {
    expect(stuck({ phase: "diverged" })?.detail).toBe(
      "Subir los de este navegador los borraría, y por eso lo frenamos. Podés juntar los dos perfiles, o quedarte con uno solo.",
    );
  });
});

describe("the same words where they are always said", () => {
  // The end of the first-run flow says it whether or not it was put off, and whatever the profile has in it.
  it("say it for a state that is due, and for one that was put off", () => {
    const state = { ...synced(5), snoozedUntil: "2026-10-10T00:00:00.000Z" };
    expect(syncNoticeText({ status: "pending", state, now: NOW, timeZone: UTC })?.title).toBe("Cambios sin subir");
    expect(syncNoticeText({ status: "never", state: {}, email: "lucia@example.com", now: NOW, timeZone: UTC })?.title).toBe("Entraste: falta subir tu perfil");
  });

  it("say nothing when there is nothing to tell", () => {
    expect(syncNoticeText({ status: "off", state: {}, now: NOW })).toBeNull();
    expect(syncNoticeText({ status: "synced", state: synced(5), now: NOW })).toBeNull();
  });

  it("do not make up a date for a trace that has none", () => {
    expect(syncNoticeText({ status: "pending", state: { userId: "u1", rev: 5 }, now: NOW })?.detail).toBe(
      "Tu cuenta tiene una versión anterior de tu perfil; lo que cambiaste desde entonces sigue solo en este navegador.",
    );
  });
});
