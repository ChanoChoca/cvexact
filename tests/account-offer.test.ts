import { describe, expect, it } from "vitest";
import { accountOffer } from "@/lib/profile/account-offer";
import { pullReplacesPrompt } from "@/lib/profile/replace-guard";
import { emptyStoredProfile, type StoredProfile } from "@/lib/schemas/profile-v2";
import { profileWith, type JobSpec } from "./helpers/profiles";

/**
 * When to tell someone their account has a profile worth bringing here: on a browser with nothing in it, or with an
 * older one — once, and never again for a version they turned down. Never taken without asking.
 */

const NOW = new Date("2026-10-03T18:00:00.000Z");
const UTC = "UTC";
const JOBS: [JobSpec, JobSpec] = [
  { company: "Nubia Retail", role: "Analista", from: { year: 2021, month: 3 }, to: "current", facts: [{ text: "Armo los pedidos del local" }] },
  { company: "Grupo Lumen", role: "Asistente", from: { year: 2018, month: 9 }, to: { year: 2021, month: 1 }, facts: [{ text: "Atendía clientes" }] },
];
const stamped = (profile: StoredProfile, updatedAt: string, rev = 3): StoredProfile => ({ ...profile, updatedAt, rev });

const account = () => stamped(profileWith(...JOBS), "2026-10-01T10:00:00.000Z");
const richLocal = (updatedAt: string) => stamped(profileWith(JOBS[0]), updatedAt);

const ask = (overrides: Partial<Parameters<typeof accountOffer>[0]> = {}) =>
  accountOffer({ local: emptyStoredProfile(), account: account(), state: {}, now: NOW, timeZone: UTC, ...overrides });

describe("an account profile worth bringing", () => {
  it("is offered to a browser with nothing in it, and replaces nothing", () => {
    const offer = ask();
    expect(offer).toMatchObject({ reason: "empty", replaces: false, title: "Tu cuenta tiene un perfil guardado" });
    expect(offer?.detail).toBe("Tiene 2 puestos (guardado el 1 de octubre). Traelo para seguir desde acá, sin cargar nada de nuevo.");
  });

  it("counts a browser with only a name in it as having nothing: there is nothing there to lose", () => {
    const named = emptyStoredProfile();
    named.contact.fullName = { ...named.contact.fullName, value: "Lucía Pérez" };
    expect(ask({ local: named })?.reason).toBe("empty");
  });

  it("is offered to a browser with an older profile, and says so with both counts", () => {
    const offer = ask({ local: richLocal("2026-09-20T10:00:00.000Z") });
    expect(offer).toMatchObject({ reason: "newer", replaces: true, title: "Tu cuenta tiene un perfil más reciente" });
    expect(offer?.detail).toBe(
      "Tiene 2 puestos (guardado el 1 de octubre); este navegador tiene 1 puesto (del 20 de septiembre). Si lo traés, reemplaza el de acá: antes te bajamos una copia.",
    );
  });

  it("is not offered to a browser that is up to date, or more so than the account", () => {
    expect(ask({ local: richLocal("2026-10-01T10:00:00.000Z") })).toBeNull();
    expect(ask({ local: richLocal("2026-10-02T10:00:00.000Z") })).toBeNull();
  });

  it("is not offered when the account has nothing in it, or nothing to answer with", () => {
    expect(ask({ account: null })).toBeNull();
    expect(ask({ account: emptyStoredProfile() })).toBeNull();
  });
});

describe("a version of the account's profile that was settled here", () => {
  // Brought, put there or turned down: the same to this, and the account's updatedAt is the account's, not this browser's
  // clock — a profile just brought down can look newer than the one that replaced it, if the clocks differ.
  it("is not offered again, and a newer one is", () => {
    const settled = { accountAt: "2026-10-01T10:00:00.000Z" };
    expect(ask({ state: settled })).toBeNull();
    expect(ask({ state: settled, local: richLocal("2026-09-20T10:00:00.000Z") })).toBeNull();
    expect(ask({ state: { accountAt: "2026-09-15T10:00:00.000Z" } })?.reason).toBe("empty");
  });
});

describe("the question before it replaces something", () => {
  it("puts both profiles side by side and says the copy comes first", () => {
    expect(pullReplacesPrompt(richLocal("2026-09-20T10:00:00.000Z"), account())).toBe(
      "Vas a reemplazar el perfil de este navegador (1 puesto) por el de tu cuenta (2 puestos). Antes te bajamos una copia del de este navegador, para que no se pierda. ¿Seguimos?",
    );
  });
});
