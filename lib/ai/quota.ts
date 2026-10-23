/**
 * A cap that resets on a clock — a free tier's requests or tokens per day — as opposed to a rate that eases in a moment.
 *
 * Google names it in `quotaId` (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`) and Groq in the sentence («tokens per day (TPD)»);
 * both say when it lifts, as `retryDelay` or «retry in 3h12m30s». Matched on the text because that is all a provider's error carries.
 */
const PER_DAY = /per[ _-]?day|\b(?:TPD|RPD)\b/i;

/** «11550s» or «3h12m30s» in seconds, or null. */
function seconds(text: string): number | null {
  const parts = /^(?:(\d+)h)?(?:(\d+)m(?!s))?(?:(\d+(?:\.\d+)?)s)?$/.exec(text.trim());
  if (!parts || !parts[0]) return null;
  return Number(parts[1] ?? 0) * 3600 + Number(parts[2] ?? 0) * 60 + Number(parts[3] ?? 0);
}

/** «unas 3 h», «unos 40 min», or «menos de 1 min». */
function roughly(total: number): string {
  if (total >= 5400) return `unas ${Math.round(total / 3600)} h`;
  if (total >= 90) return `unos ${Math.round(total / 60)} min`;
  return "menos de 2 min";
}

/** Whether the provider's error is a daily quota, and in how long it comes back when it said. */
export function dailyQuota(text: string): { retryIn: string | null } | null {
  if (!PER_DAY.test(text)) return null;
  const said = /"retryDelay"\s*:\s*"([\d.]+s)"/.exec(text)?.[1] ?? /retry in ([0-9hms.]+?)\.?(?:\s|$|")/i.exec(text)?.[1] ?? /try again in ([0-9hms.]+?)\.?(?:\s|$|")/i.exec(text)?.[1];
  const total = said ? seconds(said) : null;
  return { retryIn: total === null ? null : roughly(total) };
}

/**
 * A `fetch` that tells the AI SDK not to ask again when the 429 is a daily quota.
 *
 * The SDK retries every 429 twice, and a quota that comes back tomorrow answers all three the same way; a 403 is the status it does not
 * retry. Only the transport sees it: `asGenerationError` reads the sentence, not the status, and says what happened.
 */
export const noRetryOnDailyQuota: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  if (response.status !== 429) return response;
  const body = await response.clone().text();
  return dailyQuota(body) ? new Response(body, { status: 403, headers: response.headers }) : response;
};
