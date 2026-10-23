import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExpiredCredentialsAlert } from "@/components/cv/ExpiredCredentialsAlert";
import { EXPIRY_YEARS_AHEAD, yearOptions } from "@/components/onboarding/MonthYearPicker";
import { SectionTitle } from "@/components/ui";
import { credentialGapId } from "@/lib/onboarding/gaps";
import { lapsedCredentials } from "@/lib/profile/currency";
import { certificationSchema, emptyStoredProfile } from "@/lib/schemas/profile-v2";
import { NOW } from "./helpers/profiles";

/**
 * What the profile says about a date where the person is: where a
 * CV is handed over, which credential in it is past its own. Said, with the way to settle it, and never held back.
 */

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element).replace(/<!-- -->/g, "");

/** The title as `createElement` sees it with its text passed as an argument: where the text is a prop, it is an argument here. */
const Title = SectionTitle as ComponentType<{ note?: ReactNode; children?: ReactNode }>;

const reviews = (...credentials: Array<{ name: string; year: number; month?: number }>) => {
  const profile = emptyStoredProfile();
  credentials.forEach((entry, index) =>
    profile.certifications.push(
      certificationSchema.parse({
        id: `cert-${index + 1}`,
        name: { value: entry.name, status: "confirmed" },
        expires: { value: { year: entry.year, ...(entry.month ? { month: entry.month } : {}) }, status: "confirmed" },
      }),
    ),
  );
  return lapsedCredentials(profile, NOW);
};

describe("the credentials a CV carries past their date", () => {
  it("says nothing when no date has passed", () => {
    expect(html(createElement(ExpiredCredentialsAlert, { reviews: [] }))).toBe("");
    expect(html(createElement(ExpiredCredentialsAlert, { reviews: reviews({ name: "Matrícula", year: 2031 }) }))).toBe("");
  });

  it("names the one that has, says when, says what the CV does with it, and is one tap from the question", () => {
    const [review] = reviews({ name: "Matrícula de gasista", year: 2026, month: 3 });
    const markup = html(createElement(ExpiredCredentialsAlert, { reviews: [review!] }));
    expect(markup).toContain("data-expired-credentials");
    expect(markup).toContain("Tu CV incluye una credencial con fecha vencida");
    expect(markup).toContain("«Matrícula de gasista» venció en marzo de 2026.");
    expect(markup).toContain("El CV la usa tal como está.");
    expect(markup).toContain("¿Hiciste la renovación?");
    expect(markup).toContain(`href="/perfil/preguntas?pregunta=${encodeURIComponent(credentialGapId(review!))}"`);
  });

  it("says it in the plural for several, each with its own question", () => {
    const found = reviews({ name: "Matrícula de gasista", year: 2026, month: 3 }, { name: "Carnet de manipulación", year: 2025 });
    const markup = html(createElement(ExpiredCredentialsAlert, { reviews: found }));
    expect(markup).toContain("Tu CV incluye 2 credenciales con fecha vencida");
    expect(markup).toContain("«Carnet de manipulación» venció en 2025.");
    expect(markup).toContain("El CV las usa tal como están.");
    expect(markup.match(/¿Hiciste la renovación\?/g)).toHaveLength(2);
  });

  it("does not threaten, count a loss or tell anyone to hurry", () => {
    const [review] = reviews({ name: "Matrícula de gasista", year: 2026, month: 3 });
    const markup = html(createElement(ExpiredCredentialsAlert, { reviews: [review!] }));
    expect(markup).not.toMatch(/urgente|rápido|perdé|perder|chances|no te quedes/i);
  });
});

describe("a title with a note under it", () => {
  it("draws the note under the title, and a note with nothing to say draws no words", () => {
    const text = (markup: string) => markup.replace(/<[^>]+>/g, "");
    const said = html(createElement(Title, { note: createElement("span", null, "una nota") }, "Experiencia"));
    expect(text(said)).toBe("Experienciauna nota");
    // The note is an element that renders nothing: the line it sits in is empty, and the stylesheet hides an empty line (`empty:hidden`).
    const silent = html(createElement(Title, { note: createElement(() => null) }, "Experiencia"));
    expect(text(silent)).toBe("Experiencia");
    expect(silent).toMatch(/<p class="[^"]*empty:hidden"><\/p>/);
    // And a title with no note at all is what it always was.
    expect(html(createElement(Title, {}, "Experiencia"))).not.toContain("<p");
  });
});

describe("the years a date picker offers", () => {
  it("are the newest first, from the newest to the oldest", () => {
    expect(yearOptions(2030, 2027)).toEqual([2030, 2029, 2028, 2027]);
  });

  it("keep a year outside them when the date already says it, because one a picker cannot show is one it shows as empty", () => {
    expect(yearOptions(2030, 2027, 2040)).toEqual([2040, 2030, 2029, 2028, 2027]);
    expect(yearOptions(2030, 2027, 2020)).toEqual([2030, 2029, 2028, 2027, 2020]);
    expect(yearOptions(2030, 2027, 2028)).toEqual([2030, 2029, 2028, 2027]);
  });

  it("are none for an empty span, and the date's own year if it has one", () => {
    expect(yearOptions(2020, 2030)).toEqual([]);
    expect(yearOptions(2020, 2030, 2025)).toEqual([2025]);
  });

  it("look as far ahead as a credential is renewed for", () => {
    expect(EXPIRY_YEARS_AHEAD).toBe(15);
  });
});
