import { describe, expect, it } from "vitest";
import { answerOfferedConditions, answerOfferedCredential, countOffered, declineOffered, keepOffered, putOffOffered } from "@/lib/onboarding/answer";
import { activeDeclined, declinedBy } from "@/lib/profile/declined";
import { emptyStoredProfile } from "@/lib/schemas/profile-v2";
import { NOW, STAMP } from "./helpers/profiles";

/**
 * What is said to the one question a posting puts: where each answer goes, that it counts against the session like any other, and that a «no» is
 * the same «no» the panel makes — kept with its day, and not asked again in the next posting.
 */

let counter = 0;
const ctx = (now: string = STAMP) => ({ now, newId: () => `o-${++counter}` });

describe("«Sí» to a credential", () => {
  it("keeps what they hold, with the month it lapses if they say, as a certification of their own", () => {
    const profile = emptyStoredProfile();
    expect(answerOfferedCredential(profile, { name: "Carnet de manipulación de alimentos", expires: { month: 5, year: 2027 } }, "Carnet de manipulación de alimentos vigente", ctx())).toBe(true);
    expect(profile.certifications).toHaveLength(1);
    const [cert] = profile.certifications;
    expect(cert!.name.value).toBe("Carnet de manipulación de alimentos");
    expect(cert!.expires?.value).toEqual({ month: 5, year: 2027 });
    expect(profile.onboarding.askedThisSession).toBe(1);
  });

  it("keeps it without a date when they give none, and never the offer's words", () => {
    const profile = emptyStoredProfile();
    answerOfferedCredential(profile, { name: "Matrícula de gasista de 2ª", expires: {} }, "Matrícula de gasista de 1ª o 2ª categoría vigente", ctx());
    expect(profile.certifications[0]!.expires).toBeUndefined();
    expect(profile.certifications[0]!.name.value).toBe("Matrícula de gasista de 2ª");
  });

  it("takes back a «no» they had said to it", () => {
    const profile = emptyStoredProfile();
    declineOffered(profile, "Matrícula de gasista", "Matrícula de gasista vigente", ctx());
    expect(activeDeclined(profile)).toHaveLength(1);
    answerOfferedCredential(profile, { name: "Matrícula de gasista" }, "Matrícula de gasista", ctx());
    expect(activeDeclined(profile)).toHaveLength(0);
  });

  it("keeps nothing for a name with nothing in it, and counts nothing", () => {
    const profile = emptyStoredProfile();
    expect(answerOfferedCredential(profile, { name: "   " }, "Matrícula", ctx())).toBe(false);
    expect(profile.certifications).toHaveLength(0);
    expect(profile.onboarding.askedThisSession).toBe(0);
  });
});

describe("«Sí» to a condition", () => {
  it("keeps what they said about how they can work, and only that", () => {
    const profile = emptyStoredProfile();
    expect(answerOfferedConditions(profile, { driverLicense: "B1" }, "Licencia de conducir", ctx())).toBe(true);
    expect(profile.legacy.practical.value).toEqual({ availability: "", driverLicense: "B1", ownVehicle: false, willingToRelocate: false, workEligibility: "" });
    expect(profile.onboarding.askedThisSession).toBe(1);

    expect(answerOfferedConditions(profile, { availability: "Fines de semana" }, "Disponibilidad para fines de semana", ctx())).toBe(true);
    expect(profile.legacy.practical.value.driverLicense).toBe("B1");
    expect(profile.legacy.practical.value.availability).toBe("Fines de semana");
    expect(profile.onboarding.askedThisSession).toBe(2);
  });

  it("keeps a vehicle as a vehicle", () => {
    const profile = emptyStoredProfile();
    answerOfferedConditions(profile, { ownVehicle: true }, "Vehículo propio", ctx());
    expect(profile.legacy.practical.value.ownVehicle).toBe(true);
  });

  it("writes no «no» for what they did not say, and counts nothing for an answer with nothing in it", () => {
    const profile = emptyStoredProfile();
    expect(answerOfferedConditions(profile, { availability: "   " }, "Disponibilidad", ctx())).toBe(false);
    expect(profile.legacy.practical.value.ownVehicle).toBe(false);
    expect(profile.onboarding.askedThisSession).toBe(0);
  });

  it("takes back a «no» they had said to it", () => {
    const profile = emptyStoredProfile();
    declineOffered(profile, "Licencia de conducir", "Licencia de conducir B1", ctx());
    answerOfferedConditions(profile, { driverLicense: "B1" }, "Licencia de conducir", ctx());
    expect(activeDeclined(profile)).toHaveLength(0);
  });
});

describe("«No»", () => {
  it("is a «no» with its day and the offer's line, the same the panel makes", () => {
    const profile = emptyStoredProfile();
    declineOffered(profile, "Excel", "Manejo de Excel (excluyente)", ctx());
    expect(declinedBy(profile, "requirement", "excel")).toMatchObject({ kind: "requirement", text: "Excel", quote: "Manejo de Excel (excluyente)", at: STAMP });
    expect(profile.onboarding.askedThisSession).toBe(1);
  });

  it("is one «no» however many offers ask for it", () => {
    const profile = emptyStoredProfile();
    declineOffered(profile, "Excel", "Manejo de Excel", ctx());
    declineOffered(profile, "excel", "Excel avanzado", ctx());
    expect(profile.declined).toHaveLength(1);
  });

  it("is a step in the history, which can be taken back like any other", () => {
    const profile = emptyStoredProfile();
    const before = profile.history.length;
    declineOffered(profile, "Excel", "Manejo de Excel", ctx());
    expect(profile.history.length).toBeGreaterThan(before);
  });
});

describe("«Ahora no», and the second asking", () => {
  it("counts, and says nothing about whether they have it", () => {
    const profile = emptyStoredProfile();
    putOffOffered(profile);
    expect(profile.declined).toEqual([]);
    expect(profile.onboarding.askedThisSession).toBe(1);
  });

  it("is not an answer the second time either: the «no» stays as it was said, and it is asked once more", () => {
    // Said a year ago, asked again today, put off today (U16): a button that says «ahora no» is not kept as a «no» for good without telling.
    const profile = emptyStoredProfile();
    declineOffered(profile, "Excel", "Manejo de Excel", ctx(NOW.toISOString()));
    const before = structuredClone(declinedBy(profile, "requirement", "Excel"));
    putOffOffered(profile);
    expect(declinedBy(profile, "requirement", "Excel")).toEqual(before);
    expect(declinedBy(profile, "requirement", "Excel")?.offeredAgainAt).toBeUndefined();
    expect(profile.onboarding.askedThisSession).toBe(2);
  });

  it("«Sigue siendo no» keeps it too, and counts", () => {
    const profile = emptyStoredProfile();
    declineOffered(profile, "Excel", "Manejo de Excel", ctx());
    const later = new Date(NOW.getTime() + 400 * 86_400_000).toISOString();
    keepOffered(profile, "Excel", ctx(later));
    expect(declinedBy(profile, "requirement", "Excel")?.offeredAgainAt).toBe(later);
    expect(profile.onboarding.askedThisSession).toBe(2);
  });

  it("a tool or a task said yes to, through the line the person writes, counts with this", () => {
    const profile = emptyStoredProfile();
    countOffered(profile);
    expect(profile.onboarding.askedThisSession).toBe(1);
    expect(profile.onboarding.askedQuick).toBe(0);
  });
});
