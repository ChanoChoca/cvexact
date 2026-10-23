import { describe, expect, it } from "vitest";
import { emailProblem } from "@/lib/profile/email";

describe("an email that does not look like one", () => {
  it("has nothing to say about an empty box: an email is not required", () => {
    expect(emailProblem("")).toBeNull();
    expect(emailProblem("   ")).toBeNull();
  });

  it("has nothing to say about an address that looks fine, however it is written", () => {
    expect(emailProblem("marta.quiroga@example.com")).toBeNull();
    expect(emailProblem("  marta+cv@sub.example.com ")).toBeNull();
    expect(emailProblem("josé@example.com")).toBeNull();
  });

  it.each(["marta.quiroga", "marta@", "@example.com", "marta@example", "marta@example.c", "marta @example.com", "marta@@example.com"])(
    "says so of %j, and says what to look at",
    (value) => {
      expect(emailProblem(value)).toMatch(/@/);
    },
  );

  it("catches a line read together with what came after it", () => {
    expect(emailProblem("marta@example.com | +54 351 555 0000")).not.toBeNull();
  });
});
