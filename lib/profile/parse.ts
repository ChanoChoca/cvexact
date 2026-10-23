import { profileSchema } from "@/lib/schemas/profile";
import {
  STORED_VERSION,
  emptyStoredProfile,
  storedProfileSchema,
  type StoredProfile,
} from "@/lib/schemas/profile-v2";
import { migrateV1 } from "./migrate";

/**
 * Reads a profile of either shape — from storage, a backup file, a sync body,
 * a database row — as a stored one. `null` means it is neither.
 *
 * The version decides, and a version this build does not know is refused rather
 * than read as an old profile: a file from a newer build parsed as v1 would come
 * out as an empty profile with every default filled in, and importing that would
 * silently replace someone's data with nothing.
 */
export function parseAnyProfile(value: unknown, opts: { now?: string } = {}): StoredProfile | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const version = (value as { version?: unknown }).version;

  if (version === STORED_VERSION) {
    const parsed = storedProfileSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  }
  if (version === undefined || version === 1) {
    const parsed = profileSchema.safeParse(value);
    return parsed.success ? migrateV1(parsed.data, opts) : null;
  }
  return null;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export type ProfileRead = {
  profile: StoredProfile;
  /**
   * Something was stored and could not be read. The profile is empty, and the
   * caller must not treat that as the user's data: it has to keep the raw text
   * somewhere it cannot be overwritten, and say so.
   */
  corrupt: boolean;
};

/**
 * What to make of the raw text under the profile's keys.
 *
 * Pure, so the browser's hooks and its imperative reads decide the same way. The
 * current key wins; the old one is only read when the current one is absent —
 * the case where migrating it failed (a full store), so the app keeps working
 * on the data it has until a write succeeds.
 */
export function readStoredProfile(rawV2: string | null, rawV1: string | null = null): ProfileRead {
  const raw = rawV2 ?? rawV1;
  if (raw === null) return { profile: emptyStoredProfile(), corrupt: false };
  const profile = parseAnyProfile(parseJson(raw));
  return profile ? { profile, corrupt: false } : { profile: emptyStoredProfile(), corrupt: true };
}
