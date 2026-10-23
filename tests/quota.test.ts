import { APICallError } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { asGenerationError } from "@/lib/ai/pipeline";
import { dailyQuota, noRetryOnDailyQuota } from "@/lib/ai/quota";

const GEMINI =
  '{"error":{"code":429,"message":"Quota exceeded for metric: generate_content_free_tier_requests, limit: 20. Please retry in 3h12m30s.","details":[{"violations":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]},{"retryDelay":"11550s"}]}}';

describe("dailyQuota", () => {
  it("knows a per-day cap and when it lifts", () => {
    expect(dailyQuota(GEMINI)).toEqual({ retryIn: "unas 3 h" });
    expect(dailyQuota("Rate limit reached on tokens per day (TPD): Limit 100000. Please try again in 21m12.5s.")).toEqual({ retryIn: "unos 21 min" });
    expect(dailyQuota("requests per day, nothing about when")).toEqual({ retryIn: null });
  });

  it("leaves a rate that eases in a moment alone", () => {
    expect(dailyQuota("Rate limit reached for model on tokens per minute (TPM). Try again in 4s.")).toBeNull();
    expect(dailyQuota("")).toBeNull();
  });
});

describe("noRetryOnDailyQuota", () => {
  afterEach(() => vi.unstubAllGlobals());

  const answer = (status: number, body: string) => vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status })));

  it("turns a daily quota into the status the SDK does not retry, keeping the body", async () => {
    answer(429, GEMINI);
    const response = await noRetryOnDailyQuota("https://example.invalid");
    expect(response.status).toBe(403);
    expect(await response.text()).toBe(GEMINI);
  });

  it("passes everything else through", async () => {
    answer(429, "Rate limit reached for model. Try again in 4s.");
    expect((await noRetryOnDailyQuota("https://example.invalid")).status).toBe(429);
    answer(200, "{}");
    expect((await noRetryOnDailyQuota("https://example.invalid")).status).toBe(200);
  });
});

describe("asGenerationError", () => {
  it("says a daily quota is one, when it lifts and where to change the model", () => {
    const error = asGenerationError(
      new APICallError({ message: "Quota exceeded", url: "https://example.invalid", requestBodyValues: {}, statusCode: 403, responseBody: GEMINI }),
    );
    expect(error.kind).toBe("rate_limited");
    expect(error.status).toBe(429);
    expect(error.message).toBe("Se agotó la cuota diaria de este modelo con tu key; vuelve en unas 3 h. Podés elegir otro modelo en Ajustes.");
  });

  it("keeps «esperá un momento» for a rate that eases", () => {
    expect(asGenerationError(new Error("Rate limit reached for model. Try again in 4s.")).message).toContain("Esperá un momento");
  });
});
