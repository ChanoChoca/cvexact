import { practicalSchema } from "@/lib/schemas/profile";
import type { SourceKind, StoredProfile } from "@/lib/schemas/profile-v2";
import { dateFromParts, type DateValue } from "./dates";
import { confirmFieldAt, editContext, editFieldAt, recordChange, upsertFieldAt, type EditContext } from "./edit";
import { isPracticalEmpty } from "./practical-facts";

/**
 * What the person does about a credential — a licence, a carnet, a registration — and about what they said of how they can work:
 * say until when it holds, set it aside, say it still stands. Each edits a draft and says whether it found what it was asked
 * about, and each goes through the same door as every other edit, so it is a step in the history and can be undone.
 *
 * Nothing here decides anything for them. A credential past its date is a question (`credential_expiry`), and these are what an
 * answer to it does; none of it runs by itself.
 */

const isBlankDate = (value: DateValue): boolean => value.year === undefined && !value.raw;

/** A date from a picker, as it is kept: a year, and its month if there is one — and nothing at all when there is no year. */
const kept = (expires: DateValue | null): DateValue => (expires && expires.year !== undefined ? dateFromParts(expires.year, expires.month) : {});

/**
 * «No usar en CVs» for a credential: it stays in the profile, with all it says, and goes in no CV and to no model. Absent, and not
 * `false`, when it is used. It is what «Ya no corresponde» does to one that has lapsed and is no longer theirs.
 */
export function setCertificationExcluded(draft: StoredProfile, id: string, excluded: boolean, ctx: EditContext = editContext()): boolean {
  const cert = draft.certifications.find((entry) => entry.id === id);
  if (!cert) return false;
  if (Boolean(cert.excluded) === excluded) return true;
  const before = cert.excluded;
  if (excluded) cert.excluded = true;
  else delete cert.excluded;
  recordChange(draft, { op: "set", path: ["certifications", id, "excluded"], label: cert.name.value, before, after: excluded ? true : undefined }, ctx);
  return true;
}

/**
 * Until when a credential holds, as the person says it: a month and a year, or a year alone. `null`, or a date with no year, takes
 * it off — a credential with no date is not one that lapses as far as anyone can say, and is not asked about. Creates the date when
 * the credential had none.
 */
export function setCertificationExpiry(
  draft: StoredProfile,
  id: string,
  expires: DateValue | null,
  ctx: EditContext = editContext(),
  origin: SourceKind = "manual",
): boolean {
  if (!draft.certifications.some((entry) => entry.id === id)) return false;
  return upsertFieldAt(draft, ["certifications", id, "expires"], kept(expires), isBlankDate, ctx, origin);
}

/** The same for the driving licence, whose class is in the practical facts and whose date is beside them. */
export function setLicenseExpiry(draft: StoredProfile, expires: DateValue | null, ctx: EditContext = editContext(), origin: SourceKind = "manual"): boolean {
  return upsertFieldAt(draft, ["legacy", "driverLicenseExpires"], kept(expires), isBlankDate, ctx, origin);
}

/**
 * «Sigue igual»: what was said about how they can work still holds. Nothing in it changes; the day they last said so does, and that is
 * what the next «¿sigue igual?» counts from. False when nothing was said about it.
 */
export function confirmPractical(draft: StoredProfile, ctx: EditContext = editContext()): boolean {
  if (isPracticalEmpty(draft.legacy.practical.value)) return false;
  return confirmFieldAt(draft, ["legacy", "practical"], ctx.now);
}

/**
 * The licence is no longer theirs: its class goes from what they said about how they can work — a CV would otherwise go on saying it —
 * and its date with it. Taken out the way any edit is, with the way back to what it was in the history; the rest of what they said
 * stays as it was.
 */
export function dropLicense(draft: StoredProfile, ctx: EditContext = editContext()): boolean {
  const current = draft.legacy.practical.value;
  if (current.driverLicense.trim() === "" && !draft.legacy.driverLicenseExpires) return false;
  const next = { ...practicalSchema.parse(current), driverLicense: "" };
  editFieldAt(draft, ["legacy", "practical"], next, isPracticalEmpty, ctx, "manual");
  setLicenseExpiry(draft, null, ctx);
  return true;
}
