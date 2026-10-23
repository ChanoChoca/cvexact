import { describe, expect, it } from "vitest";
import { STEPS, afterGuidedStep, afterImportStep, hasMaterial, isStep, nextStep, previousStep, resumeStep, routeOfSources, type Step } from "@/lib/onboarding/flow";
import { emptyStoredProfile } from "@/lib/schemas/profile-v2";

const walk = (route: "cv" | "linkedin" | "both" | "scratch", clean?: boolean): Step[] => {
  const path: Step[] = ["start"];
  let step: Step = "start";
  while (step !== "done") {
    step = nextStep(step, { route, clean });
    path.push(step);
    if (path.length > 20) throw new Error("does not end");
  }
  return path;
};

describe("the way in", () => {
  it("sends whatever a person brings — a CV, a LinkedIn profile, both — to «listo» when the reading has nothing to look at twice", () => {
    for (const route of ["cv", "linkedin", "both"] as const) {
      expect(walk(route, true)).toEqual(["start", "firstValue", "done"]);
    }
  });

  it("sends it to the profile, which is where what is marked is looked at, when the reading has something to look at twice — and to the profile when nobody said", () => {
    for (const route of ["cv", "linkedin", "both"] as const) {
      expect(walk(route, false)).toEqual(["start", "done"]);
      expect(walk(route)).toEqual(["start", "done"]);
    }
  });

  it("has no review of its own for what was brought: the destination is a function of the reading alone", () => {
    expect(afterImportStep(true)).toBe("firstValue");
    expect(afterImportStep(false)).toBe("done");
  });

  it("takes someone with nothing to bring straight to the guided profile, and from it to «listo»", () => {
    expect(walk("scratch")).toEqual(["start", "steps", "firstValue", "done"]);
  });

  it("ends the guided profile at «listo» when there is something for it to be ready with, and at the profile when there is not", () => {
    const stored = emptyStoredProfile();
    expect(afterGuidedStep(stored)).toBe("done");
    // Only who they are is not something to be ready with: «listo» for it would send them back to the steps.
    stored.contact.fullName = { value: "Lucía Pérez", status: "confirmed" };
    expect(afterGuidedStep(stored)).toBe("done");
    stored.skills.push({ id: "k1", name: { value: "Excel" } } as never);
    expect(afterGuidedStep(stored)).toBe("firstValue");
  });

  it("does not let the reading of a document change the way of someone who has nothing to bring", () => {
    expect(walk("scratch", true)).toEqual(walk("scratch"));
  });

  it("has four screens, and none for the moment, the way of telling it, the story, the review, the contact details, the objective or the questions", () => {
    expect([...STEPS]).toEqual(["start", "steps", "firstValue", "done"]);
    for (const gone of ["situation", "dump", "review", "deepen", "contact", "objective", "objectiveEarly"]) expect(isStep(gone), gone).toBe(false);
  });

  it("does not leave the start without having chosen", () => {
    expect(nextStep("start", {})).toBe("start");
  });

  it("goes back the way they came: from the guided profile to the start, and from nowhere else", () => {
    expect(previousStep("start")).toBeNull();
    expect(previousStep("done")).toBeNull();
    expect(previousStep("steps")).toBe("start");
  });

  it("does not go back from «listo» either: both ways on leave the flow, and the profile is where to change what was read", () => {
    expect(previousStep("firstValue")).toBeNull();
    expect(nextStep("firstValue", {})).toBe("done");
  });

  it("has a way forward from every step but the last, and knows its own", () => {
    for (const step of STEPS) {
      if (step !== "done") expect(nextStep(step, { route: "scratch" }), step).not.toBe(step);
      expect(isStep(step)).toBe(true);
    }
    expect(isStep("nonsense")).toBe(false);
  });
});

describe("which way in a profile came by", () => {
  it("is read from the documents it was read from", () => {
    expect(routeOfSources([{ kind: "cv" }])).toBe("cv");
    expect(routeOfSources([{ kind: "linkedin_pdf" }])).toBe("linkedin");
    expect(routeOfSources([{ kind: "linkedin_csv" }])).toBe("linkedin");
    expect(routeOfSources([{ kind: "cv" }, { kind: "linkedin_pdf" }])).toBe("both");
    expect(routeOfSources([{ kind: "linkedin_csv" }, { kind: "cv" }])).toBe("both");
  });

  it("says nothing of what was only said: that is not a document", () => {
    expect(routeOfSources([])).toBeUndefined();
    expect(routeOfSources([{ kind: "dump" }])).toBeUndefined();
    expect(routeOfSources([{ kind: "dump" }, { kind: "cv" }])).toBe("cv");
  });
});

describe("resuming", () => {
  const profile = (over: Partial<ReturnType<typeof emptyStoredProfile>["onboarding"]>, entries = 0) => {
    const stored = emptyStoredProfile();
    stored.onboarding = { ...stored.onboarding, ...over };
    for (let i = 0; i < entries; i++) {
      stored.education.push({ ...emptyStoredProfile().education, id: `e${i}` } as never);
    }
    return stored;
  };

  it("starts a person who has not begun at the start", () => {
    expect(resumeStep(emptyStoredProfile())).toBe("start");
  });

  it("puts a person back where they were, in the guided profile with nothing in it too: that is where the material is made", () => {
    expect(resumeStep(profile({ step: "steps", route: "scratch" }))).toBe("steps");
    expect(resumeStep(profile({ step: "steps", route: "scratch" }, 1))).toBe("steps");
    expect(resumeStep(profile({ step: "firstValue", route: "cv" }, 1))).toBe("firstValue");
  });

  it("calls a finished flow finished", () => {
    expect(resumeStep(profile({ step: "steps", done: true }, 1))).toBe("done");
  });

  it("does not show «listo» for nothing: it goes back to where the material comes from", () => {
    expect(resumeStep(profile({ step: "firstValue", route: "scratch" }))).toBe("steps");
    expect(resumeStep(profile({ step: "firstValue", route: "cv" }))).toBe("start");
    expect(resumeStep(profile({ step: "firstValue" }))).toBe("start");
  });

  describe("what is enough to be ready", () => {
    // Not only jobs and studies: a document that brought a skills list, a profile of projects, a story whose
    // sentences are all in the tray. Each is something to look at and add to, and none of them goes back to the start.
    const withOnly = (list: "projects" | "certifications" | "languages" | "skills" | "unassigned", route: "cv" | "scratch" = "cv") => {
      const stored = profile({ step: "firstValue", route });
      const entry: Record<string, unknown> = {
        projects: { id: "p1", name: { value: "Sistema de turnos" } },
        certifications: { id: "c1", name: { value: "Curso" } },
        languages: { id: "l1", name: { value: "Inglés" } },
        skills: { id: "k1", name: { value: "Excel" } },
        unassigned: { id: "u1", text: "Algo", kind: "other" },
      };
      (stored[list] as unknown[]).push(entry[list]);
      return stored;
    };

    it.each(["projects", "certifications", "languages", "skills", "unassigned"] as const)("stays on «listo» with only %s", (list) => {
      expect(resumeStep(withOnly(list))).toBe("firstValue");
      expect(resumeStep(withOnly(list, "scratch"))).toBe("firstValue");
    });

    it("says what counts as material", () => {
      expect(hasMaterial(emptyStoredProfile())).toBe(false);
      expect(hasMaterial(withOnly("projects"))).toBe(true);
      expect(hasMaterial({ experience: [], education: [] })).toBe(false);
      expect(hasMaterial({ experience: [], education: [], skills: [] })).toBe(false);
    });
  });

  it("starts over from a step it does not know", () => {
    expect(resumeStep(profile({ step: "algo-que-ya-no-existe" }))).toBe("start");
    expect(resumeStep(profile({ step: "done" }))).toBe("start");
  });
});

describe("resuming on a screen that no longer exists", () => {
  const profile = (over: Partial<ReturnType<typeof emptyStoredProfile>["onboarding"]>, entries = 0) => {
    const stored = emptyStoredProfile();
    stored.onboarding = { ...stored.onboarding, ...over };
    for (let i = 0; i < entries; i++) stored.education.push({ ...emptyStoredProfile().education, id: `e${i}` } as never);
    return stored;
  };

  it("takes someone who was choosing the moment or the way of telling it, or telling it in a box, to the guided profile — whatever way they had chosen", () => {
    for (const step of ["situation", "mode", "dump"]) {
      for (const mode of [undefined, "dump", "steps"] as const) expect(resumeStep(profile({ step, route: "scratch", situation: "student", mode })), `${step} ${mode}`).toBe("steps");
    }
  });

  it("takes someone who was asked the objective before the timeline to the guided profile, where it is the first part's last box", () => {
    for (const mode of [undefined, "dump", "steps"] as const) {
      expect(resumeStep(profile({ step: "objectiveEarly", route: "scratch", situation: "switch", mode })), `${mode}`).toBe("steps");
    }
  });

  it("takes someone who left on a screen the profile took the place of — a way in, the review, the contact details, the questions — to the profile, if something was read, and to where the material comes from if not", () => {
    for (const step of ["cv", "linkedin", "both", "contact", "review", "objective", "deepen"]) {
      expect(resumeStep(profile({ step, route: "cv" }, 1)), step).toBe("done");
      expect(resumeStep(profile({ step, route: "cv" }, 0)), step).toBe("start");
      expect(resumeStep(profile({ step, route: "scratch" }, 0)), step).toBe("steps");
    }
  });
});
