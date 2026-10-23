import { describe, expect, it } from "vitest";
import {
  KEEP_DAYS,
  METRIC_NAMES,
  dayKey,
  describeTotals,
  describeWeek,
  emptyMetrics,
  exportMetrics,
  parseMetrics,
  recordInto,
  thisWeek,
  totalsBetween,
  weekStart,
} from "@/lib/metrics/counters";

/**
 * The counters a person can read about their own use: per day, in their own clock, kept a quarter, and with nothing in
 * them that says who they are. The arithmetic and the words are here; where they are kept is `lib/metrics/store.ts`.
 */

// Local dates, as the person's clock has them: month is 0-based, so 9 is October.
const at = (year: number, month: number, day: number, hours = 12) => new Date(year, month, day, hours, 0, 0);

describe("the day a count belongs to", () => {
  it("is the day on the person's own wall clock, written with two digits", () => {
    expect(dayKey(at(2026, 9, 3))).toBe("2026-10-03");
    expect(dayKey(at(2026, 0, 5))).toBe("2026-01-05");
  });

  it("is still that day at its first and last minute", () => {
    expect(dayKey(new Date(2026, 9, 3, 0, 0, 1))).toBe("2026-10-03");
    expect(dayKey(new Date(2026, 9, 3, 23, 59, 59))).toBe("2026-10-03");
  });
});

describe("counting", () => {
  it("adds to the day, and a second thing counted the same day is its own number", () => {
    let state = emptyMetrics();
    state = recordInto(state, "question_answered", at(2026, 9, 3));
    state = recordInto(state, "question_answered", at(2026, 9, 3, 18));
    state = recordInto(state, "cv_downloaded", at(2026, 9, 3));
    expect(state.days["2026-10-03"]).toEqual({ question_answered: 2, cv_downloaded: 1 });
  });

  it("counts each day apart", () => {
    let state = recordInto(emptyMetrics(), "question_answered", at(2026, 9, 3));
    state = recordInto(state, "question_answered", at(2026, 9, 4));
    expect(Object.keys(state.days).sort()).toEqual(["2026-10-03", "2026-10-04"]);
  });

  it("takes an amount, and ignores one that is not a positive whole number", () => {
    const base = emptyMetrics();
    expect(recordInto(base, "question_answered", at(2026, 9, 3), 3).days["2026-10-03"]).toEqual({ question_answered: 3 });
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(recordInto(base, "question_answered", at(2026, 9, 3), bad)).toBe(base);
  });

  it("does not change the state it is given: the store compares by what it read", () => {
    const base = recordInto(emptyMetrics(), "question_answered", at(2026, 9, 3));
    const frozen = JSON.stringify(base);
    recordInto(base, "question_answered", at(2026, 9, 3));
    expect(JSON.stringify(base)).toBe(frozen);
  });

  it("keeps a quarter and no more: today and the 89 days before it are kept, the one before those is not", () => {
    const now = at(2026, 9, 3);
    const day = (back: number) => dayKey(new Date(2026, 9, 3 - back));
    const old = {
      version: 1 as const,
      days: { [day(KEEP_DAYS - 1)]: { question_answered: 1 }, [day(KEEP_DAYS)]: { question_answered: 1 }, [day(200)]: { cv_downloaded: 4 } },
    };
    const next = recordInto(old, "question_answered", now);
    expect(Object.keys(next.days).sort()).toEqual([day(KEEP_DAYS - 1), dayKey(now)].sort());
  });
});

describe("reading what was stored", () => {
  it("starts empty from nothing, from something that is not JSON and from something that is not a state", () => {
    expect(parseMetrics(null)).toEqual(emptyMetrics());
    expect(parseMetrics("{no")).toEqual(emptyMetrics());
    expect(parseMetrics("[]")).toEqual(emptyMetrics());
    expect(parseMetrics('{"days":7}')).toEqual(emptyMetrics());
  });

  it("round-trips what it wrote", () => {
    const state = recordInto(recordInto(emptyMetrics(), "question_answered", at(2026, 9, 3)), "profile_pulled", at(2026, 9, 4));
    expect(parseMetrics(JSON.stringify(state))).toEqual(state);
  });

  it("keeps what is valid and drops the rest, instead of throwing the whole file away", () => {
    const raw = JSON.stringify({
      days: {
        "2026-10-03": { question_answered: 2, invented_counter: 9, cv_downloaded: -1, document_added: 1.5, profile_pulled: "7" },
        "ayer": { question_answered: 1 },
        "2026-10-04": "mucho",
        "2026-10-05": { cv_downloaded: 1 },
      },
    });
    expect(parseMetrics(raw).days).toEqual({ "2026-10-03": { question_answered: 2 }, "2026-10-05": { cv_downloaded: 1 } });
  });

  it("drops a count nobody could have made", () => {
    expect(parseMetrics(JSON.stringify({ days: { "2026-10-03": { question_answered: 10_000_000 } } })).days).toEqual({});
  });
});

describe("a week", () => {
  it("begins on Monday, wherever in it the person is", () => {
    // 2026-10-05 is a Monday.
    for (const [day, expected] of [
      [5, "2026-10-05"],
      [6, "2026-10-05"],
      [9, "2026-10-05"],
      [11, "2026-10-05"],
      [12, "2026-10-12"],
    ] as const) {
      expect(dayKey(weekStart(at(2026, 9, day)))).toBe(expected);
    }
  });

  it("begins in the month before when the Monday does", () => {
    // Thursday 1 October 2026: its Monday was 28 September.
    expect(dayKey(weekStart(at(2026, 9, 1)))).toBe("2026-09-28");
  });

  it("counts from Monday to today, and not the Sunday before", () => {
    let state = emptyMetrics();
    state = recordInto(state, "question_answered", at(2026, 9, 4)); // Sunday before
    state = recordInto(state, "question_answered", at(2026, 9, 5)); // Monday
    state = recordInto(state, "question_answered", at(2026, 9, 7)); // Wednesday
    state = recordInto(state, "question_answered", at(2026, 9, 9)); // tomorrow, in the future of "today"
    expect(thisWeek(state, at(2026, 9, 7)).question_answered).toBe(2);
  });

  it("adds a range with both ends included", () => {
    let state = emptyMetrics();
    for (const day of [3, 4, 5, 6]) state = recordInto(state, "cv_downloaded", at(2026, 9, day));
    expect(totalsBetween(state, at(2026, 9, 4), at(2026, 9, 5))).toEqual({ cv_downloaded: 2 });
  });
});

describe("saying it", () => {
  it("says only what there is, as a person would", () => {
    expect(describeWeek({ question_answered: 12, question_put_off: 3, cv_downloaded: 1 })).toBe("Esta semana respondiste 12 preguntas, dejaste 3 para después y bajaste 1 CV.");
  });

  it("agrees in number", () => {
    expect(describeWeek({ question_answered: 1 })).toBe("Esta semana respondiste 1 pregunta.");
    expect(describeWeek({ document_added: 2, cv_downloaded: 2 })).toBe("Esta semana agregaste 2 documentos y bajaste 2 CVs.");
    expect(describeWeek({ profile_uploaded: 1 })).toBe("Esta semana subiste tu perfil a tu cuenta una vez.");
    expect(describeWeek({ profile_pulled: 3 })).toBe("Esta semana trajiste tu perfil de tu cuenta 3 veces.");
  });

  it("says nothing for a week with nothing, so that it is not reported as if it were something", () => {
    expect(describeWeek({})).toBeNull();
    expect(describeWeek({ review_marked_confirmed: 1 })).toBeNull();
  });

  it("lists every counter that has a count, in the person's words, in a fixed order", () => {
    expect(describeTotals({ cv_downloaded: 1, question_answered: 2, review_marked_confirmed: 1 })).toEqual([
      "2 preguntas respondidas",
      "1 vez que diste por buenos los puestos marcados",
      "1 CV bajado",
    ]);
  });

  it("counts whether the profile survives a browser, where the person can see it (e5, I7)", () => {
    expect(describeTotals({ profile_recovered: 1, persistence_granted: 2 })).toEqual([
      "1 vez que recuperaste tu perfil en un navegador donde no estaba",
      "2 veces que el navegador aceptó conservar tus datos",
    ]);
  });

  it("has words for every counter, in both numbers", () => {
    for (const name of METRIC_NAMES) {
      expect(describeTotals({ [name]: 1 })[0]).toMatch(/^1 \S/);
      expect(describeTotals({ [name]: 2 })[0]).toMatch(/^2 \S/);
    }
  });
});

describe("what the person downloads", () => {
  it("is the days as counted and when it was made, and nothing that says who they are", () => {
    const state = recordInto(emptyMetrics(), "question_answered", at(2026, 9, 3));
    const file = exportMetrics(state, new Date("2026-10-03T18:00:00.000Z"));
    expect(file).toEqual({ kind: "cvexact-usage", version: 1, exportedAt: "2026-10-03T18:00:00.000Z", days: { "2026-10-03": { question_answered: 1 } } });
    expect(Object.keys(file).sort()).toEqual(["days", "exportedAt", "kind", "version"]);
  });
});
