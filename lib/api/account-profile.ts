"use client";

import type { AccountProbe } from "@/lib/profile/auto-sync";
import { parseAnyProfile } from "@/lib/profile/parse";
import { isBlankProfile, type StoredProfile } from "@/lib/schemas/profile-v2";

/**
 * The profile the account holds, when there is one worth asking about before it is replaced.
 *
 * `POST /api/sync` simply replaces whatever the account has, so whoever uploads over a fuller profile — from a
 * previous upload, from another device — should know before this one overwrites it, not after. The first-run screen
 * always asked; Ajustes did not, and now both ask through this, in the same words.
 *
 * `null` when the account has nothing in it, or cannot be reached: an upload that cannot reach it says so itself,
 * and an account with nothing in it has nothing to lose.
 */
export async function fetchAccountProfile(): Promise<StoredProfile | null> {
  try {
    // Only the profile: what is asked here is whether there is one, not the whole history behind it.
    const response = await fetch("/api/sync?only=profile");
    if (!response.ok) return null;
    const payload = await response.json().catch(() => ({}));
    const existing = parseAnyProfile(payload.profileV2 ?? payload.profile);
    return existing && !isBlankProfile(existing) ? existing : null;
  } catch {
    return null;
  }
}

/**
 * What the account has, told apart from not being able to ask: `fetchAccountProfile` says `null` for both, which is right for
 * a screen offering a profile and wrong for something about to write over it. An answer that did not come is never taken for
 * an account with nothing in it.
 */
export async function probeAccountProfile(): Promise<AccountProbe> {
  try {
    const response = await fetch("/api/sync?only=profile");
    if (response.status === 401) return { kind: "unreachable", reason: "Tu sesión se cerró." };
    if (!response.ok) return { kind: "unreachable", reason: "Tu cuenta no respondió." };
    const payload: unknown = await response.json().catch(() => null);
    if (!payload || typeof payload !== "object") return { kind: "unreachable", reason: "Tu cuenta no respondió." };
    const { profileV2, profile } = payload as { profileV2?: unknown; profile?: unknown };
    const existing = parseAnyProfile(profileV2 ?? profile);
    return existing && !isBlankProfile(existing) ? { kind: "profile", updatedAt: existing.updatedAt } : { kind: "none" };
  } catch {
    return { kind: "unreachable", reason: "No hay conexión." };
  }
}

