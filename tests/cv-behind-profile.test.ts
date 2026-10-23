import { describe, expect, it } from "vitest";
import { answerCurrentJob, answerOfferedClaim, deferQuestion, declineOffered, putOffOffered } from "@/lib/onboarding/answer";
import type { Gap } from "@/lib/onboarding/gaps";
import { putOffRenewal, renewCredential, setCredentialAside } from "@/lib/onboarding/renewal";
import { credentialReviews } from "@/lib/profile/currency";
import { generatorKey, toPlainProfile } from "@/lib/profile/project";
import { certificationSchema, emptyStoredProfile, type StoredProfile } from "@/lib/schemas/profile-v2";
import { NOW, withJob } from "./helpers/profiles";

/**
 * When the CV on the page is behind the profile (U11). It used to be said after any answer at all — also «Ahora no», also «Sí, sigo» — and not after
 * «Ya terminé», which is the one that makes the CV wrong (it says «Actualidad» of a job that is over). It is what a generator reads that decides, so it is
 * compared: what is no part of a CV changes nothing of it, and what is, does.
 */

const JOB_ID = "id-job";
const found = { id: "current_job_review:id-job:2026-01", priority: "medium", experienceId: JOB_ID } as const;

function profile(): StoredProfile {
  const stored = emptyStoredProfile();
  const job = withJob(stored, { company: "Logística Sur", role: "Encargada de depósito", from: { year: 2021, month: 3 }, to: "current", facts: [{ text: "Armo los pedidos del turno mañana" }] });
  // `withJob` gives its own ids; the question of the review names the job it was built for.
  job.id = JOB_ID;
  stored.certifications.push(
    certificationSchema.parse({
      id: "cert-1",
      name: { value: "Carnet de manipulación de alimentos", status: "confirmed" },
      expires: { value: { year: 2026, month: 3 }, status: "confirmed" },
    }),
  );
  return stored;
}

const key = (stored: StoredProfile) => generatorKey(toPlainProfile(stored));

/** The profile before and after a change made on a copy of it. */
function around(change: (draft: StoredProfile) => void): { before: string; after: string } {
  const stored = profile();
  const before = key(stored);
  const draft = structuredClone(stored);
  change(draft);
  return { before, after: key(draft) };
}

const lapsed = () => credentialReviews(profile(), NOW)[0]!;
const asGap = (extra: Partial<Gap> = {}): Gap => ({ id: found.id, rule: "current_job_review", priority: "medium", experienceId: JOB_ID, payload: {}, ...extra });

describe("what does not leave the CV behind", () => {
  it.each(["later", "skipped", "na"] as const)("putting a question off (%s) is not a change to what a CV is made of", (state) => {
    const { before, after } = around((draft) => deferQuestion(draft, asGap(), state));
    expect(after).toBe(before);
  });

  it("«Sí, sigo» and «nada nuevo» only say the job still holds", () => {
    const { before, after } = around((draft) => void answerCurrentJob(draft, found, { status: { kind: "still" }, news: "" }));
    expect(after).toBe(before);
  });

  it("a «no» to what an offer asked, and «Ahora no» to it, are the profile's own business and not the CV's", () => {
    const { before, after } = around((draft) => {
      declineOffered(draft, "SAP", "Manejo de SAP");
      putOffOffered(draft);
    });
    expect(after).toBe(before);
  });

  it("a renewed date, and a renewal put off, are not in a CV: the date a credential lapses is not printed", () => {
    const review = lapsed();
    const renewed = around((draft) => void renewCredential(draft, review, { year: 2030, month: 5 }));
    expect(renewed.after).toBe(renewed.before);
    const later = around((draft) => putOffRenewal(draft, review));
    expect(later.after).toBe(later.before);
  });
});

describe("what does", () => {
  it("«Ya terminé»: the job is over, and the CV that says «Actualidad» of it is wrong", () => {
    const { before, after } = around((draft) => void answerCurrentJob(draft, found, { status: { kind: "ended", end: { year: 2026, month: 8 } }, news: "" }));
    expect(after).not.toBe(before);
  });

  it("what they say happened since is new tasks of the job", () => {
    const { before, after } = around((draft) => void answerCurrentJob(draft, found, { status: { kind: "still" }, news: "Armé el turno noche con cuatro personas." }));
    expect(after).not.toBe(before);
  });

  it("a tool or a task they say they did is a line of the job", () => {
    const { before, after } = around((draft) => void answerOfferedClaim(draft, { kind: "tool", thing: "SAP" }, "Cargué los ingresos de mercadería en SAP", JOB_ID));
    expect(after).not.toBe(before);
  });

  it("a credential that is no longer theirs comes out of every CV", () => {
    const review = lapsed();
    const { before, after } = around((draft) => void setCredentialAside(draft, review));
    expect(after).not.toBe(before);
    expect(after).not.toContain("Carnet de manipulación de alimentos");
  });
});
