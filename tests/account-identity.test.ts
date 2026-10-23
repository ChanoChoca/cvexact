import { describe, expect, it } from "vitest";
import { accountPrefill, profileEmail } from "@/lib/profile/account-identity";
import { emptyStoredProfile, type StoredProfile } from "@/lib/schemas/profile-v2";
import { STAMP } from "./helpers/profiles";

function profile(contact: { fullName?: string; email?: string } = {}): StoredProfile {
  const stored = emptyStoredProfile();
  if (contact.fullName) stored.contact.fullName = { value: contact.fullName, status: "confirmed", source: { kind: "cv", at: STAMP } };
  if (contact.email) stored.contact.email = { value: contact.email, status: "confirmed", source: { kind: "cv", at: STAMP } };
  return stored;
}

describe("what the sign-up starts with", () => {
  it("is the name and the email the profile already has", () => {
    expect(accountPrefill(profile({ fullName: " Lucía Méndez ", email: "lucia@example.com " }))).toEqual({ name: "Lucía Méndez", email: "lucia@example.com" });
  });

  it("is nothing for a profile that has neither", () => {
    expect(accountPrefill(profile())).toEqual({ name: "", email: "" });
  });

  it("leaves out an email that does not look like one: a box that starts with a wrong address is worse than an empty one", () => {
    expect(profileEmail(profile({ email: "lucia@" }))).toBe("");
    expect(profileEmail(profile({ email: "sin arroba" }))).toBe("");
    expect(profileEmail(profile({ email: "lucia@example.com" }))).toBe("lucia@example.com");
  });
});
