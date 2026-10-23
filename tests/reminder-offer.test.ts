import { readFileSync, readdirSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReminderOffer } from "@/components/profile/ReminderOffer";

/**
 * «¿Querés que tu calendario te lo recuerde?», where a review ends (e5 UX, U45): the same offer O16 makes from the profile's menu, now at the moment it is worth most. Nothing at all
 * with its switch off; with it on, two answers of the same weight and the sentence that says who reminds. Pressing them is the browser walkthrough's (`e2e-ux7`).
 */

afterEach(() => vi.unstubAllEnvs());

const on = () => vi.stubEnv("NEXT_PUBLIC_CVP_EXPERIMENTS", "calendar_reminder");
const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element).replace(/<!-- -->/g, "");
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("with the switch off", () => {
  it("draws nothing: the profile's menu is the one place the reminder was", () => {
    expect(html(createElement(ReminderOffer))).toBe("");
  });

  it("draws nothing either with other switches on", () => {
    vi.stubEnv("NEXT_PUBLIC_CVP_EXPERIMENTS", "note_capture,stale_skills,evidence_links");
    expect(html(createElement(ReminderOffer))).toBe("");
  });
});

describe("with the switch on", () => {
  it("asks once, with a «Sí» and a «No» that weigh the same, and neither is the one to press", () => {
    on();
    const drawn = html(createElement(ReminderOffer));
    expect(drawn).toContain('data-reminder-offer="ask"');
    expect(text(drawn)).toContain("¿Querés que tu calendario te lo recuerde?");
    const buttons = [...drawn.matchAll(/<button[^>]*class="([^"]*)"[^>]*>([^<]*)<\/button>/g)].map((match) => [match[2], match[1]!.replace(/\s+/g, " ").trim()] as const);
    expect(buttons.map(([label]) => label)).toEqual(["Sí, recordármelo", "No, gracias"]);
    expect(new Set(buttons.map(([, classes]) => classes)).size).toBe(1);
  });

  it("says that the calendar is the one that reminds, and that cvexact sends nothing", () => {
    on();
    const said = text(html(createElement(ReminderOffer)));
    expect(said).toContain("Bajás un archivo para tu calendario, que es quien te avisa: cvexact no manda avisos.");
  });

  it("does not push: no urgency, no percentage, no how long it has been", () => {
    on();
    expect(text(html(createElement(ReminderOffer)))).not.toMatch(/urgente|ya mismo|no te olvides|olvidar|%|hace \d|desde hace/i);
  });

  it("does not open the form until it is asked for: that is a second step, with the choices of how often", () => {
    on();
    expect(html(createElement(ReminderOffer))).not.toContain("data-reminder-form");
  });
});

describe("where it is", () => {
  it("at the end of a review: the block that lists what changed, once something was settled and nothing is left open, and the close of a stretch of questions that was a review", () => {
    const block = readFileSync("components/profile/ReviewBlock.tsx", "utf8");
    expect(block).toMatch(/\{open\.length === 0 && settled\.length > 0 \? <ReminderOffer \/> : null\}/);
    const close = readFileSync("components/onboarding/SessionClose.tsx", "utf8");
    // The close of a review does not offer the key of an AI (U39): the reminder takes the place of what was not asked.
    expect(close).toMatch(/\{review \? <ReminderOffer \/> : <AiKeyPrompt>/);
  });

  it("only in those two places", () => {
    const users = ["app", "components", "lib"].flatMap((folder) => walk(folder)).filter((path) => /<ReminderOffer\b/.test(readFileSync(path, "utf8")));
    expect(users.sort()).toEqual(["components/onboarding/SessionClose.tsx", "components/profile/ReviewBlock.tsx"]);
  });
});

function walk(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = `${folder}/${entry.name}`;
    return entry.isDirectory() ? walk(path) : /\.tsx$/.test(entry.name) ? [path] : [];
  });
}
