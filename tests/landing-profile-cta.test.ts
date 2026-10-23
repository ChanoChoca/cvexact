import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PROFILE_STORAGE_KEY, ProfileNavCta, hasProfileHere } from "@/components/landing/ProfileNavCta";
import { PROFILE_KEY } from "@/lib/storage/local";

/**
 * The landing has one call to action, «Empezar»: to Postular for someone who already has a profile in this browser, and to the profile for someone who does not. The landing is the
 * one page opened before anything of ours is loaded, so it reads the one key it needs by itself — and this holds the two to the same string.
 */

describe("the key the landing reads", () => {
  it("is the one the profile is kept under: if one changes, the button would go to the profile for everyone", () => {
    expect(PROFILE_STORAGE_KEY).toBe(PROFILE_KEY);
  });
});

describe("whether this browser holds a profile to go back to", () => {
  const profile = (fields: Record<string, unknown>) => JSON.stringify({ version: 2, ...fields });

  it("counts a job or a study — nothing else is a career to go back to", () => {
    expect(hasProfileHere(profile({ experience: [{ id: "a" }] }))).toBe(true);
    expect(hasProfileHere(profile({ education: [{ id: "b" }] }))).toBe(true);
    expect(hasProfileHere(profile({ experience: [], education: [{ id: "b" }] }))).toBe(true);
  });

  it("does not count a name and an email: that is a contact card, and the profile is still the way in", () => {
    expect(hasProfileHere(profile({ contact: { fullName: { value: "Lucía Pérez" }, email: { value: "lucia@example.com" } } }))).toBe(false);
    expect(hasProfileHere(profile({ experience: [], education: [] }))).toBe(false);
    expect(hasProfileHere(profile({ skills: [{ id: "s" }] }))).toBe(false);
  });

  it("takes whatever it cannot read for no profile, and never throws", () => {
    for (const raw of [null, "", "no es json", "null", "[]", "42", '"texto"', profile({ experience: "no es una lista" }), profile({ experience: { length: 3 } })]) {
      expect(hasProfileHere(raw), String(raw)).toBe(false);
    }
  });
});

describe("what the landing says before the browser has been asked", () => {
  it("is «Empezar», to the profile: the first paint is the same for everyone, and only a profile found afterwards changes where it goes", () => {
    const markup = renderToStaticMarkup(createElement(ProfileNavCta));
    expect(markup).toContain("Empezar");
    expect(markup).toContain('href="/perfil"');
    expect(markup).not.toContain("Crear mi CV");
    expect(markup).not.toContain("Ir a tu perfil");
  });
});

describe("where the landing uses it", () => {
  it.each(["components/landing/parts.tsx", "components/landing/solar/parts.tsx"])("%s has no fixed «Empezar» and no «Iniciar sesión» in its menu: the button is this one", (path) => {
    const source = readFileSync(path, "utf8");
    expect(source).toMatch(/<ProfileNavCta \/>/);
    expect(source).not.toMatch(/<NavCta[^>]*>\s*Empezar/);
    expect(source).not.toContain("Iniciar sesión");
  });
});
