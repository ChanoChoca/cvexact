import { afterEach, describe, expect, it, vi } from "vitest";
import { ENGINE } from "@/lib/onboarding/config";

/**
 * «Ahora no», to the offer of the review of what changed, is remembered in this browser and nowhere else: until when the offer is not made
 * again. It is not an edit of the profile — saying it leaves `rev` and `updatedAt` where they were — and a browser that cannot remember it
 * offers it once more, which is all that can go wrong.
 */

type Store = Map<string, string>;

function installStorage(seed: Record<string, string> = {}, { refuseWrites = false } = {}): Store {
  const map: Store = new Map(Object.entries(seed));
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
      setItem: (key: string, value: string) => {
        if (refuseWrites) throw new Error("QuotaExceededError");
        map.set(key, value);
      },
      removeItem: (key: string) => void map.delete(key),
    },
    addEventListener() {},
    removeEventListener() {},
  };
  return map;
}

async function loadModules() {
  vi.resetModules();
  const [store, local] = await Promise.all([import("@/lib/storage/return-review"), import("@/lib/storage/local")]);
  return { ...store, local };
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  vi.resetModules();
});

describe("the memory of «Ahora no» in «Para revisar»", () => {
  it("is a fortnight from when it was said, under its own key, and is read back", async () => {
    const store = installStorage();
    const { snoozeReturnReview, loadReturnReviewState, local } = await loadModules();
    const now = new Date("2026-10-07T12:00:00.000Z");
    snoozeReturnReview(now);
    expect(local.RETURN_REVIEW_KEY).toBe("cvexact.returnReview.v1");
    const days = (Date.parse(loadReturnReviewState().snoozedUntil!) - now.getTime()) / 86_400_000;
    expect(days).toBe(ENGINE.currency.returnSnoozeDays);
    expect(JSON.parse(store.get("cvexact.returnReview.v1")!)).toEqual({ snoozedUntil: "2026-10-21T12:00:00.000Z" });
  });

  it("is nothing for a browser that never said it, and for what is not a date", async () => {
    installStorage({ "cvexact.returnReview.v1": "not json" });
    const { loadReturnReviewState } = await loadModules();
    expect(loadReturnReviewState()).toEqual({});
    installStorage({ "cvexact.returnReview.v1": JSON.stringify({ snoozedUntil: 7 }) });
    expect((await loadModules()).loadReturnReviewState()).toEqual({});
    installStorage();
    expect((await loadModules()).loadReturnReviewState()).toEqual({});
  });

  it("is not an edit of the profile: nothing of it is written there", async () => {
    const store = installStorage({ "cvexact.profile.v2": "{}" });
    const { snoozeReturnReview } = await loadModules();
    snoozeReturnReview();
    expect(store.get("cvexact.profile.v2")).toBe("{}");
  });

  it("is forgotten, without a word, by a browser that refuses to write", async () => {
    installStorage({}, { refuseWrites: true });
    const { snoozeReturnReview, loadReturnReviewState } = await loadModules();
    expect(() => snoozeReturnReview()).not.toThrow();
    expect(loadReturnReviewState()).toEqual({});
  });

  it("goes with everything else when the browser's data is cleared: it is about this browser, and a shared one keeps nothing", async () => {
    const store = installStorage({ "cvexact.returnReview.v1": JSON.stringify({ snoozedUntil: "2026-10-21T12:00:00.000Z" }) });
    const { local } = await loadModules();
    await local.clearBrowserData();
    expect(store.has("cvexact.returnReview.v1")).toBe(false);
  });

  it("remembers a «no» that was put off, by its id and until when, apart from the block's own «Ahora no»", async () => {
    const store = installStorage();
    const { putOffReviewItem, snoozeReturnReview, loadReturnReviewState } = await loadModules();
    const now = new Date("2026-10-07T12:00:00.000Z");
    putOffReviewItem("declined:d1", now);
    expect(loadReturnReviewState()).toEqual({ putOff: { "declined:d1": "2026-10-21T12:00:00.000Z" } });
    // The block's «Ahora no» does not take the other away, nor the other this one.
    snoozeReturnReview(now);
    expect(JSON.parse(store.get("cvexact.returnReview.v1")!)).toEqual({ snoozedUntil: "2026-10-21T12:00:00.000Z", putOff: { "declined:d1": "2026-10-21T12:00:00.000Z" } });
    putOffReviewItem("declined:d2", now);
    expect(Object.keys(loadReturnReviewState().putOff ?? {}).sort()).toEqual(["declined:d1", "declined:d2"]);
  });

  it("forgets the ones whose time ran out when it writes again, and reads nothing but dates", async () => {
    installStorage({ "cvexact.returnReview.v1": JSON.stringify({ putOff: { "declined:old": "2026-01-01T00:00:00.000Z", "declined:bad": 7 } }) });
    const { putOffReviewItem, loadReturnReviewState } = await loadModules();
    expect(loadReturnReviewState()).toEqual({ putOff: { "declined:old": "2026-01-01T00:00:00.000Z" } });
    putOffReviewItem("declined:new", new Date("2026-10-07T12:00:00.000Z"));
    expect(Object.keys(loadReturnReviewState().putOff ?? {})).toEqual(["declined:new"]);
  });
});
