import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LinkedInGuide } from "@/components/onboarding/LinkedInGuide";
import { LINKEDIN_GUIDE } from "@/lib/onboarding/content";

/**
 * M08: the guide to getting a LinkedIn profile out of LinkedIn says what the drawings cannot — how long it takes, where it can
 * not be done, what the menu is called in English, what the file holds, and the way out when there is no button — in words,
 * and without changing how the profile comes in.
 */

describe("the LinkedIn guide", () => {
  it("keeps its three steps, which the three drawings are for", () => {
    expect(LINKEDIN_GUIDE.steps).toHaveLength(3);
  });

  it("says before the first step what it costs and what it needs", () => {
    expect(LINKEDIN_GUIDE.before).toMatch(/tres pasos/);
    expect(LINKEDIN_GUIDE.before).toMatch(/computadora/);
    expect(LINKEDIN_GUIDE.before).toMatch(/celular/);
  });

  it("says where people get stuck: the menu in English, the phone, what the PDF holds and what to do when there is no button", () => {
    const stuck = LINKEDIN_GUIDE.ifItDoesNotMatch.join(" ");
    expect(stuck).toContain("«Resources»");
    expect(stuck).toContain("«Save to PDF»");
    expect(stuck).toMatch(/app del celular/);
    expect(stuck).toMatch(/recomendaciones/);
    expect(stuck).toContain("«Pegar el texto»");
    expect(LINKEDIN_GUIDE.steps[1]!.text).toContain("«Profile.pdf»");
  });

  it("does not promise what only LinkedIn decides: the name of the file is what it usually is", () => {
    expect(LINKEDIN_GUIDE.steps[1]!.text).toMatch(/suele llamarse/);
  });

  it("is drawn with all of it, open, and still points at the same place for the file", () => {
    const html = renderToStaticMarkup(createElement(LinkedInGuide, { open: true })).replace(/<!-- -->/g, "");
    expect(html).toContain(LINKEDIN_GUIDE.before);
    expect(html).toContain("Si algo no coincide");
    for (const line of LINKEDIN_GUIDE.ifItDoesNotMatch) expect(html).toContain(line);
    expect(html).toContain(LINKEDIN_GUIDE.zipHelp);
    expect(html).toContain(LINKEDIN_GUIDE.profileUrl);
  });
});
