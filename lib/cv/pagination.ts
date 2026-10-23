/**
 * What the page breaks of a printed CV cost, so that a CV of two sheets is judged by the height it will really take.
 *
 * An entry, a project and a heading are never split across sheets (`break-inside: avoid` in the print stylesheet): one that would
 * have straddled the break moves whole to the next sheet and leaves a gap behind. The natural height of the document cannot see it, and
 * it is as large as the entry — measured, a CV of twelve three-line entries printed on three sheets at 2082 px, with 2188 px on two.
 * The browser lays the blocks out; this only walks them the way a printer would, and says how much taller the document comes out.
 *
 * Pure: positions in, a height out, so the printing and the screen read the same arithmetic.
 */

/** A piece of the document that is not split across a break: where it starts, measured from the top of the document, and how tall it is. */
export type Block = { top: number; height: number };

/**
 * The extra height the breaks add. `start` is where the content begins on the first sheet (the document's top padding, which each sheet
 * repeats) and `area` what one sheet's content holds. Blocks come in the order they are drawn, and a block taller than a sheet is left to
 * split: nothing could keep it whole.
 */
export function breakWaste(blocks: readonly Block[], start: number, area: number): number {
  let waste = 0;
  for (const block of blocks) {
    if (block.height > area) continue;
    const top = block.top - start + waste;
    const end = (Math.floor(top / area) + 1) * area;
    // Moved to the top of the next sheet when it begins on this one and does not end on it: a block that starts on the break is already there.
    if (top < end && top + block.height > end + 0.5) waste += end - top;
  }
  return waste;
}

/**
 * A heading is never left alone at the foot of a sheet (`break-after: avoid`): it travels with what follows, which is walked as one block.
 * `blocks` are the headings and the unsplittable entries in the order they are drawn, each marked for what it is, and `line` stands for the
 * first line of whatever follows a heading that is not itself a block (the rows of a list of facts).
 */
export function withHeadingsGlued(blocks: ReadonlyArray<Block & { heading?: boolean }>, line: number): Block[] {
  const glued: Block[] = [];
  for (let at = 0; at < blocks.length; at += 1) {
    const block = blocks[at]!;
    if (!block.heading) {
      glued.push({ top: block.top, height: block.height });
      continue;
    }
    const next = blocks[at + 1];
    // The block that follows is the heading's own when it starts within a line of where the heading ends; otherwise something else is there.
    const follows = next && !next.heading && next.top - (block.top + block.height) < line;
    glued.push({ top: block.top, height: follows ? next.top + next.height - block.top : block.height + line });
    if (follows) at += 1;
  }
  return glued;
}
