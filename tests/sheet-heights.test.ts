import { describe, expect, it } from "vitest";
import { PEEK_REM, SHEET_STOPS, settle, sheetHeights, stepStop, tapStop } from "@/components/ui/sheet-heights";

/** A 390×844 phone: 60 px of tabs under the sheet and 76 px of bar over it. */
const PHONE = sheetHeights({ viewport: 844, below: 60, above: 76 });

describe("the heights of the sheet", () => {
  it("peeks at 7.5 rem, rests at half the screen and opens up to under the top bar and over the tabs", () => {
    expect(PHONE).toEqual({ peek: PEEK_REM * 16, half: 422, full: 708 });
  });

  it("follows the size of the letter for the peek, and not for the rest", () => {
    expect(sheetHeights({ viewport: 844, below: 60, above: 76, rem: 20 }).peek).toBe(150);
  });

  it("never asks for more than there is: a short screen has a peek that is the whole of it, and a half no taller than the full", () => {
    // A phone on its side with the keyboard up: 160 px of screen, 76 of them under the bar.
    const squeezed = sheetHeights({ viewport: 160, below: 0, above: 76 });
    expect(squeezed).toEqual({ peek: 84, half: 84, full: 84 });
    expect(sheetHeights({ viewport: 40, below: 60, above: 76 })).toEqual({ peek: 0, half: 0, full: 0 });
  });

  it("goes up in the order peek, half, full", () => {
    expect(SHEET_STOPS.map((stop) => PHONE[stop])).toEqual([...SHEET_STOPS.map((stop) => PHONE[stop])].sort((a, b) => a - b));
  });
});

describe("where a drag comes to rest", () => {
  it("is the nearest height to where the finger let go", () => {
    expect(settle(130, PHONE)).toBe("peek");
    expect(settle(250, PHONE)).toBe("peek");
    expect(settle(280, PHONE)).toBe("half");
    expect(settle(422, PHONE)).toBe("half");
    expect(settle(560, PHONE)).toBe("half");
    expect(settle(570, PHONE)).toBe("full");
    expect(settle(708, PHONE)).toBe("full");
  });

  it("goes to the lower height on a tie", () => {
    // 271 is exactly between 120 and 422.
    expect(settle(271, PHONE)).toBe("peek");
    expect(settle(272, PHONE)).toBe("half");
  });

  it("goes on to the next height in the direction of a flick, even from a short drag", () => {
    // Pushed up a little from the peek, but quickly: the half, and not back down.
    expect(settle(150, PHONE, 0.9)).toBe("half");
    // Pulled down a little from the full, but quickly: the half, and not back up.
    expect(settle(690, PHONE, -0.9)).toBe("half");
    // From the half, a flick up is the full and a flick down the peek.
    expect(settle(430, PHONE, 0.6)).toBe("full");
    expect(settle(415, PHONE, -0.6)).toBe("peek");
  });

  it("stops at the ends: a flick up from the full stays there, and one down from the peek too", () => {
    expect(settle(708, PHONE, 2)).toBe("full");
    expect(settle(120, PHONE, -2)).toBe("peek");
  });

  it("does not take a slow drag for a flick", () => {
    expect(settle(150, PHONE, 0.39)).toBe("peek");
    expect(settle(150, PHONE, 0.4)).toBe("half");
    expect(settle(690, PHONE, -0.39)).toBe("full");
  });
});

describe("the handle's own steps", () => {
  it("moves one height at a time with the arrows and stays at the ends", () => {
    expect(stepStop("peek", 1)).toBe("half");
    expect(stepStop("half", 1)).toBe("full");
    expect(stepStop("full", 1)).toBe("full");
    expect(stepStop("full", -1)).toBe("half");
    expect(stepStop("half", -1)).toBe("peek");
    expect(stepStop("peek", -1)).toBe("peek");
  });

  it("reaches the three heights with taps alone: up one, and from the top back to the peek", () => {
    expect(tapStop("peek")).toBe("half");
    expect(tapStop("half")).toBe("full");
    expect(tapStop("full")).toBe("peek");
  });
});
