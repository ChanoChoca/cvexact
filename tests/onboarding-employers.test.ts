import { describe, expect, it } from "vitest";
import { employerRuns, spanOfRun } from "@/lib/onboarding/employers";
import { jobsByRecency, studiesByRecency } from "@/lib/profile/timeline";
import { addEntry, blankForm } from "@/lib/onboarding/entries";
import { emptyStoredProfile, storedProfileSchema, type StoredProfile } from "@/lib/schemas/profile-v2";
import { toPlainProfile } from "@/lib/profile/project";
import { STAMP, newId, profileWith } from "./helpers/profiles";

const names = (runs: ReturnType<typeof employerRuns>) => runs.map((run) => `${run.company}:${run.jobs.map((job) => job.role.value).join("+")}`);

describe("jobs at one employer, one after the other", () => {
  it("are one stretch: a promotion is the same company with a new role", () => {
    const profile = profileWith(
      { company: "Acme", role: "Gerente", from: { year: 2022, month: 1 }, to: "current" },
      { company: "Acme", role: "Analista", from: { year: 2019, month: 5 }, to: { year: 2021, month: 12 } },
      { company: "Beta", role: "Auxiliar", from: { year: 2016 }, to: { year: 2019 } },
    );
    expect(names(employerRuns(jobsByRecency(profile.experience)))).toEqual(["Acme:Gerente+Analista", "Beta:Auxiliar"]);
  });

  it("see the same employer through legal suffixes, spacing and case, as the merge does", () => {
    const profile = profileWith(
      { company: "Flash Page S.A.", role: "Líder", from: { year: 2023 }, to: "current" },
      { company: "FlashPage", role: "Dev", from: { year: 2020 }, to: { year: 2022 } },
    );
    expect(employerRuns(jobsByRecency(profile.experience))).toHaveLength(1);
  });

  it("do not join what is not next to each other: leaving and coming back is two stretches", () => {
    const profile = profileWith(
      { company: "Acme", role: "Gerente", from: { year: 2024 }, to: "current" },
      { company: "Beta", role: "Coordinador", from: { year: 2021 }, to: { year: 2023 } },
      { company: "Acme", role: "Analista", from: { year: 2018 }, to: { year: 2020 } },
    );
    expect(names(employerRuns(jobsByRecency(profile.experience)))).toEqual(["Acme:Gerente", "Beta:Coordinador", "Acme:Analista"]);
  });

  it("never group a job with no company: nothing says it is the same one", () => {
    const profile = profileWith({ role: "Changas", from: { year: 2020 }, to: { year: 2021 } }, { role: "Changas", from: { year: 2018 }, to: { year: 2019 } });
    expect(employerRuns(jobsByRecency(profile.experience)).map((run) => run.jobs.length)).toEqual([1, 1]);
  });

  it("name the stretch as its most recent job wrote the company", () => {
    const profile = profileWith(
      { company: "Acme S.A.", role: "Gerente", from: { year: 2022 }, to: "current" },
      { company: "ACME", role: "Analista", from: { year: 2019 }, to: { year: 2021 } },
    );
    expect(employerRuns(jobsByRecency(profile.experience))[0]!.company).toBe("Acme S.A.");
  });

  it("cover from the earliest start to the latest end, or to today if any is still going", () => {
    const done = profileWith(
      { company: "Acme", role: "Gerente", from: { year: 2021, month: 6 }, to: { year: 2023, month: 3 } },
      { company: "Acme", role: "Analista", from: { year: 2019, month: 5 }, to: { year: 2021, month: 5 } },
    );
    expect(spanOfRun(done.experience)).toEqual({ start: { year: 2019, month: 5 }, end: { year: 2023, month: 3 } });

    const going = profileWith(
      { company: "Acme", role: "Gerente", from: { year: 2022 }, to: "current" },
      { company: "Acme", role: "Analista", from: { year: 2019 }, to: { year: 2021 } },
    );
    expect(spanOfRun(going.experience)).toMatchObject({ start: { year: 2019 }, end: { current: true } });
  });

  it("say nothing about dates nobody gave", () => {
    const profile = profileWith({ company: "Acme", role: "Gerente" }, { company: "Acme", role: "Analista", from: { year: 2019 } });
    expect(spanOfRun(profile.experience)).toEqual({ start: { year: 2019 }, end: {} });
    expect(spanOfRun([])).toEqual({ start: {}, end: {} });
  });
});

describe("the order the profile lists jobs and studies in", () => {
  const study = (profile: StoredProfile, spec: { what: string; from?: { year: number }; to?: { year: number }; current?: boolean }) =>
    addEntry(profile, { ...blankForm("study"), what: spec.what, where: "UBA", from: spec.from ?? {}, to: spec.to ?? {}, current: Boolean(spec.current) }, { newId, now: STAMP });

  it("is by date, whatever order they were added in: the newest job typed last is still first", () => {
    const profile = profileWith(
      { company: "Vieja SA", role: "Asistente", from: { year: 2015 }, to: { year: 2018 } },
      { company: "Acme", role: "Gerente", from: { year: 2023 }, to: "current" },
      { company: "Beta", role: "Analista", from: { year: 2019 }, to: { year: 2022 } },
    );
    // Written out and read in again: what the browser does between one visit and the next.
    const read = storedProfileSchema.parse(JSON.parse(JSON.stringify(profile)));
    expect(read.experience.map((job) => job.company.value)).toEqual(["Acme", "Beta", "Vieja SA"]);
    // And so is what the generators are given, with no second order to keep.
    expect(toPlainProfile(read).experience.map((job) => job.company)).toEqual(["Acme", "Beta", "Vieja SA"]);
  });

  it("keeps what has no dates last, in the order it was given", () => {
    const profile = profileWith({ company: "Sin fechas A", role: "x" }, { company: "Acme", role: "y", from: { year: 2020 }, to: { year: 2021 } }, { company: "Sin fechas B", role: "z" });
    const read = storedProfileSchema.parse(JSON.parse(JSON.stringify(profile)));
    expect(read.experience.map((job) => job.company.value)).toEqual(["Acme", "Sin fechas A", "Sin fechas B"]);
  });

  it("is stable: reading what was already in order changes nothing, however many times", () => {
    const profile = profileWith({ company: "A", role: "a", from: { year: 2020 } }, { company: "B", role: "b", from: { year: 2020 } }, { company: "C", role: "c", from: { year: 2020 } });
    const once = storedProfileSchema.parse(JSON.parse(JSON.stringify(profile)));
    const twice = storedProfileSchema.parse(JSON.parse(JSON.stringify(once)));
    expect(twice.experience.map((job) => job.id)).toEqual(once.experience.map((job) => job.id));
  });

  it("puts a study still being done among the latest things, not below everything that has an end", () => {
    const profile = emptyStoredProfile();
    study(profile, { what: "Bachiller", from: { year: 2008 }, to: { year: 2013 } });
    study(profile, { what: "Licenciatura", from: { year: 2018 }, current: true });
    study(profile, { what: "Curso", from: { year: 2016 }, to: { year: 2017 } });
    expect(studiesByRecency(profile.education).map((entry) => entry.degree.value)).toEqual(["Licenciatura", "Curso", "Bachiller"]);
    const read = storedProfileSchema.parse(JSON.parse(JSON.stringify(profile)));
    expect(read.education.map((entry) => entry.degree.value)).toEqual(["Licenciatura", "Curso", "Bachiller"]);
  });

  it("keeps the end an in-progress study was given: a degree due in 2027 is the most recent too", () => {
    const profile = emptyStoredProfile();
    const id = study(profile, { what: "Maestría", from: { year: 2024 }, to: { year: 2027 } })!;
    profile.education.find((entry) => entry.id === id)!.status = { value: "in_progress", status: "confirmed" };
    study(profile, { what: "Curso", from: { year: 2022 }, to: { year: 2023 } });
    expect(studiesByRecency(profile.education).map((entry) => entry.degree.value)).toEqual(["Maestría", "Curso"]);
  });
});
