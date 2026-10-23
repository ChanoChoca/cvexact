import { describe, expect, it } from "vitest";
import { blockingExclusions } from "@/lib/ai/preflight";
import { requirementSchema, type Requirement } from "@/lib/schemas/job";
import { profileSchema } from "@/lib/schemas/profile";
import { backendProfile, devProfile } from "./fixtures";

/**
 * The warning that arrives before the generation is paid for.
 *
 * Built for a real case: a waiting job stating "Experiencia previa en el puesto
 * (excluyente)" against a profile with no hospitality history at all. A CV was
 * written, a coverage report said 6 of 8, and the one requirement the ad refused
 * to negotiate was the missing one.
 */

const req = (text: string, overrides: Partial<Requirement> = {}): Requirement =>
  requirementSchema.parse({ text, kind: "hard", ...overrides });

const posting = (...requirements: Requirement[]) => ({ requirements });

describe("blockingExclusions", () => {
  it("warns about an excluding requirement the profile cannot answer", () => {
    const blocked = blockingExclusions(
      devProfile,
      posting(req("Experiencia previa como mozo en restaurante", { excluding: true })),
    );

    expect(blocked).toHaveLength(1);
    expect(blocked[0]!.requirement).toContain("mozo");
  });

  it("says nothing about a requirement the posting does not call excluding", () => {
    expect(
      blockingExclusions(devProfile, posting(req("Experiencia previa como mozo en restaurante"))),
    ).toEqual([]);
  });

  it("says nothing when the profile answers it", () => {
    expect(
      blockingExclusions(
        backendProfile,
        posting(req("Experiencia en Kubernetes y Docker", { excluding: true })),
      ),
    ).toEqual([]);
  });

  it("names the technology that is missing, so the warning is checkable", () => {
    const blocked = blockingExclusions(
      backendProfile,
      posting(req("Experiencia comprobable en Terraform", { excluding: true })),
    );

    expect(blocked[0]!.reason).toContain("Terraform");
  });

  /**
   * A practical fact is answered by the profile's own field, not by its prose —
   * "Disponibilidad los fines de semana" is not a claim to look up in the work
   * history.
   */
  it("reads an excluding schedule against the profile's practical field", () => {
    expect(
      blockingExclusions(
        devProfile,
        posting(req("Disponibilidad de jueves a domingo por la noche", { excluding: true })),
      ),
    ).toEqual([]);

    const noSchedule = profileSchema.parse({
      ...devProfile,
      practical: { ...devProfile.practical, availability: "" },
    });
    const blocked = blockingExclusions(
      noSchedule,
      posting(req("Disponibilidad de jueves a domingo por la noche", { excluding: true })),
    );
    expect(blocked[0]!.reason).toContain("disponibilidad");
  });

  it("reads an excluding licence the same way", () => {
    expect(
      blockingExclusions(
        devProfile,
        posting(req("Licencia de conducir vigente", { excluding: true })),
      ),
    ).toEqual([]);
  });

  /**
   * Silence beats a wrong warning: this is shown before any work is done and its
   * whole value is being believed.
   */
  it("does not warn on a soft requirement, which no profile states checkably", () => {
    expect(
      blockingExclusions(
        devProfile,
        posting(req("Ganas de trabajar y proactividad", { kind: "soft", excluding: true })),
      ),
    ).toEqual([]);
  });

  /**
   * A known limitation, pinned rather than hidden. "Ser mayor de 18" is a hard
   * excluding requirement the profile cannot state and the applicant almost
   * certainly meets, and nothing here can tell it apart from "Experiencia previa
   * como mozo", which is the same shape and is a real gap. The warning is
   * advisory and dismissible, so a false positive costs a click; suppressing it
   * would cost the case the check exists for.
   */
  it("still warns on an unstatable hard requirement, which is the false positive it accepts", () => {
    expect(
      blockingExclusions(devProfile, posting(req("Ser mayor de 18 años", { excluding: true }))),
    ).toHaveLength(1);
  });

  it("returns nothing for a posting with no requirements", () => {
    expect(blockingExclusions(devProfile, posting())).toEqual([]);
  });
});
