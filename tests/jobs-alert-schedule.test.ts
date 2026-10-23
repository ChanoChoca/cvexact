import { describe, expect, it } from "vitest";
import { FREQUENCY_HOURS, isAlertDue } from "@/lib/jobs/alert-schedule";

describe("isAlertDue", () => {
  const now = new Date("2026-08-31T12:00:00Z");

  it("is always due when it has never been sent", () => {
    expect(isAlertDue({ frequency: "daily", lastSentAt: null }, now)).toBe(true);
    expect(isAlertDue({ frequency: "weekly", lastSentAt: null }, now)).toBe(true);
  });

  it("is not due right after sending", () => {
    expect(isAlertDue({ frequency: "daily", lastSentAt: now }, now)).toBe(false);
    expect(isAlertDue({ frequency: "weekly", lastSentAt: now }, now)).toBe(false);
  });

  it("a daily alert is due once FREQUENCY_HOURS.daily has passed", () => {
    const justUnder = new Date(now.getTime() - (FREQUENCY_HOURS.daily! - 1) * 60 * 60 * 1000);
    const justOver = new Date(now.getTime() - (FREQUENCY_HOURS.daily! + 1) * 60 * 60 * 1000);
    expect(isAlertDue({ frequency: "daily", lastSentAt: justUnder }, now)).toBe(false);
    expect(isAlertDue({ frequency: "daily", lastSentAt: justOver }, now)).toBe(true);
  });

  it("a weekly alert waits longer than a daily one", () => {
    const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    expect(isAlertDue({ frequency: "daily", lastSentAt: twoDaysAgo }, now)).toBe(true);
    expect(isAlertDue({ frequency: "weekly", lastSentAt: twoDaysAgo }, now)).toBe(false);
  });

  it("falls back to the daily threshold for an unrecognised frequency", () => {
    const justOver = new Date(now.getTime() - (FREQUENCY_HOURS.daily! + 1) * 60 * 60 * 1000);
    expect(isAlertDue({ frequency: "made_up", lastSentAt: justOver }, now)).toBe(true);
  });
});
