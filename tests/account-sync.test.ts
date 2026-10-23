import { describe, expect, it } from "vitest";
import { accountSyncFrom } from "@/lib/profile/account-sync";
import type { SyncState } from "@/lib/storage/sync-state";

/**
 * How the account stands with the profile on screen (U03): what the screens that say where the profile lives read before they say it. It is
 * read from the session and from what this browser remembers of its meetings with the account, and it decides whether a copy in a file is asked for
 * on top of the account, whether «todavía no hay ninguna copia» is said beside «tu cuenta tiene tu perfil al día», and what is not said while
 * the session is still being read.
 */

const AT = "2026-09-28T15:40:00.000Z";
const met = (rev: number, userId = "u1"): SyncState => ({ userId, rev, at: AT });
const user = (extra: Record<string, unknown> = {}) => ({ id: "u1", email: "lucia@example.com", ...extra });
const read = (overrides: Partial<Parameters<typeof accountSyncFrom>[0]> = {}) =>
  accountSyncFrom({ user: null, isPending: false, profile: { rev: 5 }, state: {}, ...overrides });

describe("with nobody signed in", () => {
  it("is no account at all: the copy in a file is the way to keep the profile", () => {
    expect(read()).toMatchObject({ userId: null, unconfirmed: false, status: "off", hasAccount: false, accountHasIt: false });
  });

  it("is the same for a session that does not exist, whatever this browser remembers of an account", () => {
    expect(read({ state: met(5) })).toMatchObject({ status: "off", hasAccount: false, accountHasIt: false });
  });
});

describe("with an account that can sync", () => {
  it("has the profile when it is up to date, and a copy outside this browser", () => {
    expect(read({ user: user(), state: met(5) })).toMatchObject({ userId: "u1", email: "lucia@example.com", status: "synced", hasAccount: true, accountHasIt: true });
  });

  it("has an older one when the profile has changed since: still a copy outside this browser, whose own notice says what it lacks", () => {
    expect(read({ user: user(), state: met(4) })).toMatchObject({ status: "pending", hasAccount: true, accountHasIt: true });
  });

  it("does not have it yet when this browser never met it: the account is what keeps it, and it does not yet", () => {
    expect(read({ user: user() })).toMatchObject({ status: "never", hasAccount: true, accountHasIt: false });
  });

  it("does not take another account's meeting for its own", () => {
    expect(read({ user: user(), state: met(5, "u2") })).toMatchObject({ status: "never", accountHasIt: false });
  });

  it("takes an address with nothing said about it as confirmed, as everything else here does", () => {
    expect(read({ user: user({ emailVerified: undefined }), state: met(5) })).toMatchObject({ userId: "u1", status: "synced" });
    expect(read({ user: user({ emailVerified: true }), state: met(5) })).toMatchObject({ userId: "u1", status: "synced" });
  });
});

describe("with an address not confirmed", () => {
  it("cannot keep the profile, says so, and leaves the copy in a file as the way", () => {
    expect(read({ user: user({ emailVerified: false }), state: met(5) })).toMatchObject({ userId: null, unconfirmed: true, status: "off", hasAccount: false, accountHasIt: false });
  });
});

describe("while the session is still being read", () => {
  it("does not say «vive solo en este navegador» to a browser that has met an account: it is likely signed in", () => {
    expect(read({ isPending: true, state: met(5) })).toMatchObject({ userId: null, status: "off", hasAccount: true, accountHasIt: false });
  });

  it("does not wait for a browser that never did: there is nobody to be signed in as", () => {
    expect(read({ isPending: true })).toMatchObject({ hasAccount: false });
  });

  it("stops assuming once the session says nobody is signed in", () => {
    expect(read({ isPending: false, state: met(5) })).toMatchObject({ hasAccount: false });
  });
});
