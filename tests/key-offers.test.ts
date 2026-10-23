import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LimitReached } from "@/components/billing/LimitReached";

/**
 * What leads to the notice of the key of Google (e5 UX, U37): the offer of a key of one's own, after the server has refused, said what it is before it said what it costs. The key
 * has conditions —what is sent to its free tier is used by Google, and it is for people of 18 or older—, and «Google regala una key», a green «GRATIS» and «sin límite» came in
 * front of them. The screens that send there are checked one by one in the browser (`e2e-ux6`); this is the one that can be read without a model or a server.
 */

const html = (reason: "no_credits" | "daily_limit" | "monthly_limit" | "byok_required") => renderToStaticMarkup(createElement(LimitReached, { reason })).replace(/<!-- -->/g, "");
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("the offer of a key of one's own after a refusal", () => {
  for (const reason of ["no_credits", "daily_limit", "monthly_limit", "byok_required"] as const) {
    it(`${reason}: leads with the way on, and says the key has conditions before it says anything good about it`, () => {
      const said = text(html(reason));
      expect(said).toContain("Seguir con tu propia key");
      expect(said).toContain("su nivel gratuito tiene condiciones: te las mostramos antes de que la armes");
      expect(said.indexOf("tiene condiciones")).toBeLessThan(said.indexOf("Armar mi key") === -1 ? Infinity : said.indexOf("Armar mi key"));
    });

    it(`${reason}: does not sell it — no «gratis», no «regala», no label that says it is free`, () => {
      expect(text(html(reason))).not.toMatch(/gratis|regala/i);
    });
  }

  it("opens the setup at once when the key is what is missing, and the setup begins with what Google says", () => {
    const said = text(html("byok_required"));
    expect(said).toContain("Antes de usar la key gratuita de Google");
    expect(said).toContain("Elegí cómo seguir");
  });

  it("keeps the setup behind a button when the refusal is about the budget, which has other ways out", () => {
    const markup = html("daily_limit");
    expect(markup).not.toContain("data-byok-choice");
    expect(text(markup)).toContain("Armar mi key");
  });
});
