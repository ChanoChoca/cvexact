import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  signJobAlertUnsubscribeToken,
  verifyJobAlertUnsubscribeToken,
} from "@/lib/jobs/alert-token";

describe("job alert unsubscribe token", () => {
  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = "test-secret-value";
  });

  afterEach(() => {
    delete process.env.BETTER_AUTH_SECRET;
  });

  it("verifies a token it signed for the same user", () => {
    const token = signJobAlertUnsubscribeToken("user-1");
    expect(verifyJobAlertUnsubscribeToken("user-1", token)).toBe(true);
  });

  it("rejects a token altered by even one character", () => {
    const token = signJobAlertUnsubscribeToken("user-1");
    const tampered = token.slice(0, -1) + (token.at(-1) === "a" ? "b" : "a");
    expect(verifyJobAlertUnsubscribeToken("user-1", tampered)).toBe(false);
  });

  it("rejects a valid token used for a different user", () => {
    const token = signJobAlertUnsubscribeToken("user-1");
    expect(verifyJobAlertUnsubscribeToken("user-2", token)).toBe(false);
  });

  it("rejects garbage input instead of throwing", () => {
    expect(verifyJobAlertUnsubscribeToken("user-1", "not-a-real-token")).toBe(false);
    expect(verifyJobAlertUnsubscribeToken("user-1", "")).toBe(false);
  });

  it("changes the token when the secret changes, so a rotated secret invalidates old links", () => {
    const token = signJobAlertUnsubscribeToken("user-1");
    process.env.BETTER_AUTH_SECRET = "a-different-secret";
    expect(verifyJobAlertUnsubscribeToken("user-1", token)).toBe(false);
  });
});
