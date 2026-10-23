import { describe, expect, it } from "vitest";
import { breakWaste, withHeadingsGlued } from "@/lib/cv/pagination";

/**
 * What the page breaks of a printed CV cost. The numbers are a sheet's content (1000) that starts 40 from the top; the blocks are the entries, which
 * the print stylesheet never splits across sheets.
 */

const START = 40;
const AREA = 1000;
const at = (content: number, height: number) => ({ top: START + content, height });

describe("breakWaste", () => {
  it("is nothing for blocks that all fit on their sheets", () => {
    expect(breakWaste([at(0, 400), at(400, 400), at(800, 200)], START, AREA)).toBe(0);
  });

  it("is the gap an entry leaves behind when it would have straddled the break, and it moves whole to the next sheet", () => {
    expect(breakWaste([at(0, 400), at(400, 400), at(800, 400)], START, AREA)).toBe(200);
  });

  it("is nothing for a block that starts on the break, or ends on it", () => {
    expect(breakWaste([at(0, 1000), at(1000, 400)], START, AREA)).toBe(0);
  });

  it("carries a gap into every block after it, so the next break comes sooner", () => {
    // The third moves 200 and the fourth lands whole on the second sheet; the fifth, pushed down by that gap, now straddles the second break.
    expect(breakWaste([at(0, 400), at(400, 400), at(800, 400), at(1200, 400), at(1600, 400)], START, AREA)).toBe(400);
  });

  it("leaves a block taller than a sheet to split, because nothing could keep it whole", () => {
    expect(breakWaste([at(500, 1500)], START, AREA)).toBe(0);
  });
});

describe("withHeadingsGlued", () => {
  it("makes a heading and the entry after it one block, so that the heading is never left at the foot of a sheet", () => {
    const blocks = [{ ...at(700, 30), heading: true }, at(740, 400)];
    expect(withHeadingsGlued(blocks, 16)).toEqual([{ top: START + 700, height: 440 }]);
    expect(breakWaste(withHeadingsGlued(blocks, 16), START, AREA)).toBe(300);
    // Unglued, the heading stays on the first sheet and only the entry moves.
    expect(breakWaste(blocks, START, AREA)).toBe(260);
  });

  it("gives a heading followed by a list a line of it to travel with", () => {
    const blocks = [{ ...at(700, 30), heading: true }, at(900, 100)];
    expect(withHeadingsGlued(blocks, 16)).toEqual([{ top: START + 700, height: 46 }, { top: START + 900, height: 100 }]);
  });

  it("leaves what is not a heading as it is", () => {
    expect(withHeadingsGlued([at(0, 100), at(120, 100)], 16)).toEqual([at(0, 100), at(120, 100)]);
  });
});
