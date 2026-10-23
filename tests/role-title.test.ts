import { describe, expect, it } from "vitest";
import { localizedRole, sameRole } from "@/lib/cv/role-title";

/**
 * A title in another language is the same title only if nothing was added or taken away: the profile's is the source, and
 * the model's is accepted when it can be shown to say the same.
 */

describe("sameRole", () => {
  it("reads a title across Spanish and English, gender and order aside", () => {
    expect(sameRole("Desarrollador Mobile", "Mobile Developer")).toBe(true);
    expect(sameRole("Desarrollador/a Mobile", "Mobile Developer")).toBe(true);
    expect(sameRole("Software Engineer", "Ingeniero de Software")).toBe(true);
    expect(sameRole("Analista de Datos", "Data Analyst")).toBe(true);
  });

  it("reads seniority and its abbreviations as the same word", () => {
    expect(sameRole("Desarrollador Sr", "Senior Developer")).toBe(true);
    expect(sameRole("Developer Ssr", "Semi Senior Developer")).toBe(true);
  });

  it("does not take a title that gained or lost a word", () => {
    expect(sameRole("Desarrollador Mobile", "Senior Mobile Developer")).toBe(false);
    expect(sameRole("Desarrollador Mobile", "React Native Developer")).toBe(false);
    expect(sameRole("Desarrollador Mobile", "Developer")).toBe(false);
    expect(sameRole("Semi Senior Developer", "Senior Developer")).toBe(false);
  });

  it("compares a word it does not know literally", () => {
    expect(sameRole("Barista", "Barista")).toBe(true);
    expect(sameRole("Barista", "Bartender")).toBe(false);
  });

  it("says nothing of an empty title", () => {
    expect(sameRole("", "")).toBe(false);
  });
});

describe("localizedRole", () => {
  it("prints the model's title when it is the profile's in the CV's language", () => {
    expect(localizedRole("Desarrollador Mobile", "Mobile Developer", "en")).toEqual({ role: "Mobile Developer", unsure: false });
    expect(localizedRole("Software Engineer", "Ingeniero de Software", "es")).toEqual({ role: "Ingeniero de Software", unsure: false });
  });

  it("keeps the profile's own spelling when the model only recased it", () => {
    expect(localizedRole("Desarrollador Mobile", "DESARROLLADOR MOBILE", "es").role).toBe("Desarrollador Mobile");
  });

  it("never promotes: a title that grew is the profile's, with nothing to warn about in the same language (M9)", () => {
    expect(localizedRole("Desarrollador Mobile", "Desarrollador Mobile Senior", "es")).toEqual({ role: "Desarrollador Mobile", unsure: false });
  });

  it("keeps the profile's title and says so when it is in another language and the model's version changed it", () => {
    expect(localizedRole("Desarrollador Mobile", "Senior Mobile Developer", "en")).toEqual({ role: "Desarrollador Mobile", unsure: true });
  });

  it("does not warn when it cannot tell the profile's title is in another language", () => {
    expect(localizedRole("Barista", "Head Barista", "en")).toEqual({ role: "Barista", unsure: false });
  });

  it("gives the profile's title when the model wrote none", () => {
    expect(localizedRole("Cajero", "", "es")).toEqual({ role: "Cajero", unsure: false });
  });
});
