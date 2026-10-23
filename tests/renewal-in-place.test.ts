import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ExpiredCredentialsAlert, type CredentialSettle } from "@/components/cv/ExpiredCredentialsAlert";
import { credentialGap, credentialGapId } from "@/lib/onboarding/gaps";
import { putOffRenewal, renewCredential, renewalPutOffAt, setCredentialAside } from "@/lib/onboarding/renewal";
import { credentialReviews, lapsedCredentials } from "@/lib/profile/currency";
import { certificationSchema, emptyStoredProfile, type StoredProfile } from "@/lib/schemas/profile-v2";
import { NOW } from "./helpers/profiles";

/**
 * The renewal of a credential past its date, settled on the page of an application (U15): where the CV that carries it is in front of the person, and not
 * on another page. It is the question of the profile —the same answers, kept the same way— and what was already said to it is said back.
 */

let counter = 0;
const ctx = (now = "2026-09-02T12:00:00.000Z") => ({ now, newId: () => `r-${++counter}` });

function profile(): StoredProfile {
  const stored = emptyStoredProfile();
  stored.certifications.push(
    certificationSchema.parse({
      id: "cert-1",
      name: { value: "Carnet de manipulación de alimentos", status: "confirmed" },
      expires: { value: { year: 2026, month: 3 }, status: "confirmed" },
    }),
  );
  return stored;
}

const reviewOf = (stored: StoredProfile) => credentialReviews(stored, NOW)[0]!;
const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element).replace(/<!-- -->/g, "");

describe("what was said to the renewal", () => {
  it("is nothing until it is said", () => {
    const stored = profile();
    expect(renewalPutOffAt(stored, reviewOf(stored))).toBeNull();
  });

  it("is the day «Todavía no» was said, and the credential is as it was", () => {
    const stored = profile();
    const review = reviewOf(stored);
    putOffRenewal(stored, review, ctx());
    expect(renewalPutOffAt(stored, review)).toBe("2026-09-02T12:00:00.000Z");
    expect(stored.certifications[0]!.expires?.value).toEqual({ year: 2026, month: 3 });
    expect(stored.certifications[0]!.excluded).toBeUndefined();
    // Still past its date: putting it off does not renew it.
    expect(lapsedCredentials(stored, NOW)).toHaveLength(1);
  });

  it("is not «Todavía no» when the question was turned down for good: that is another answer, and it is not told back as this one", () => {
    const stored = profile();
    const review = reviewOf(stored);
    stored.pending.push({ questionId: credentialGapId(review), ruleId: "credential_expiry", state: "na", count: 1, at: "2026-09-02T12:00:00.000Z" });
    expect(renewalPutOffAt(stored, review)).toBeNull();
  });
});

describe("the answers, kept the way the question keeps them", () => {
  it("«Sí, la hice» keeps the new date, and the credential is not past its date any more", () => {
    const stored = profile();
    const review = reviewOf(stored);
    putOffRenewal(stored, review, ctx());
    expect(renewCredential(stored, review, { year: 2029, month: 5 }, ctx())).toBe(true);
    expect(stored.certifications[0]!.expires?.value).toEqual({ year: 2029, month: 5 });
    expect(lapsedCredentials(stored, NOW)).toEqual([]);
    // What was put off is settled: it is not said back.
    expect(renewalPutOffAt(stored, review)).toBeNull();
  });

  it("«No sé hasta cuándo» takes the date off: a credential with no date is not asked after", () => {
    const stored = profile();
    expect(renewCredential(stored, reviewOf(stored), null, ctx())).toBe(true);
    expect(stored.certifications[0]!.expires?.value).toEqual({});
    expect(credentialReviews(stored, NOW)).toEqual([]);
  });

  it("refuses a date with a month and no year, and keeps nothing of it", () => {
    const stored = profile();
    expect(renewCredential(stored, reviewOf(stored), { month: 5 }, ctx())).toBe(false);
    expect(stored.certifications[0]!.expires?.value).toEqual({ year: 2026, month: 3 });
  });

  it("«Ya no corresponde» keeps it in the profile and out of every CV, and counts as an answer", () => {
    const stored = profile();
    expect(setCredentialAside(stored, reviewOf(stored), ctx())).toBe(true);
    expect(stored.certifications).toHaveLength(1);
    expect(stored.certifications[0]!.excluded).toBe(true);
    expect(lapsedCredentials(stored, NOW)).toEqual([]);
    // Counted against the session like any other answer, in the kind of question it is.
    expect(stored.onboarding.askedThisSession + stored.onboarding.askedQuick).toBe(1);
  });

  it("builds the same question the engine asks for it, so that what is answered here settles it there", () => {
    const stored = profile();
    const review = reviewOf(stored);
    expect(credentialGap(review).id).toBe(credentialGapId(review));
    expect(credentialGap(review).rule).toBe("credential_expiry");
    expect(credentialGap(review).payload.subject).toEqual({ kind: "certification", id: "cert-1" });
  });
});

describe("the alert that settles in place", () => {
  const settle = (extra: Partial<CredentialSettle> = {}): CredentialSettle => ({
    now: NOW,
    putOffAt: () => null,
    onRenewed: vi.fn(),
    onNoLonger: vi.fn(),
    onLater: vi.fn(),
    ...extra,
  });
  const alert = (settling: CredentialSettle) => html(createElement(ExpiredCredentialsAlert, { reviews: lapsedCredentials(profile(), NOW), settle: settling }));

  it("asks in place, with no link to another page, and says what the CV does as always", () => {
    const markup = alert(settle());
    expect(markup).toContain("Tu CV incluye una credencial con fecha vencida");
    expect(markup).toContain("«Carnet de manipulación de alimentos» venció en marzo de 2026.");
    expect(markup).toMatch(/<button[^>]*>¿Hiciste la renovación\?<\/button>/);
    expect(markup).not.toContain("/perfil/preguntas");
    expect(markup).toContain("El CV la usa tal como está.");
  });

  it("says «Todavía no» was said, with the day, and does not ask again as if it had not been", () => {
    const markup = alert(settle({ putOffAt: () => "2026-09-02T12:00:00.000Z" }));
    expect(markup).toContain("Dijiste el 2 de septiembre que todavía no.");
    expect(markup).not.toContain("¿Hiciste la renovación?");
    // The way to say it was renewed is there, in the person's words.
    expect(markup).toMatch(/<button[^>]*>Ya hice la renovación<\/button>/);
  });

  it("is the same alert, with the link to the question, wherever there is nothing to settle in place", () => {
    const markup = html(createElement(ExpiredCredentialsAlert, { reviews: lapsedCredentials(profile(), NOW) }));
    expect(markup).toContain(`href="/perfil/preguntas?pregunta=${encodeURIComponent(credentialGapId(reviewOf(profile())))}"`);
    expect(markup).not.toMatch(/<button/);
  });
});
