import type { CondensedLine } from "@/lib/cv/fit";

/**
 * What a shorter line did, word by word: what it kept, what it dropped and what
 * it changed.
 *
 * The receipt's part of the bargain the guard cannot keep on its own — no
 * automatic check can prove a rewrite says the same thing, and none of them is
 * presented as if it could. This is what lets a person catch the one case the
 * guard is blind to: a sentence that kept every figure and every name and still
 * ended up meaning something else.
 */

/** A run of words that was kept, dropped, or added. */
export type DiffPart = { kind: "same" | "removed" | "added"; text: string };

/**
 * A word-level diff, by longest common subsequence.
 *
 * Sequence-based here, unlike `textOverlap` in `lib/ai/evidence.ts`: those lines
 * are one sentence long, so the quadratic table costs nothing, and where the
 * words moved is exactly what a person is looking at.
 */
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = before.split(/\s+/).filter(Boolean);
  const b = after.split(/\s+/).filter(Boolean);

  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i]![j] =
        a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }

  const parts: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], text: string) => {
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) last.text = `${last.text} ${text}`;
    else parts.push({ kind, text });
  };

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("same", a[i]!);
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      push("removed", a[i]!);
      i += 1;
    } else {
      push("added", b[j]!);
      j += 1;
    }
  }
  while (i < a.length) push("removed", a[i++]!);
  while (j < b.length) push("added", b[j++]!);

  return parts;
}

/**
 * The shortened lines, with the diff, under the receipt of a fit that shortened
 * something.
 *
 * Says what it is and what it cannot do: the checks that let a rewrite through
 * are about facts — figures, names, negations, who did the work — and none of
 * them can tell whether a sentence still means what it meant. Reading it is the
 * only check there is, and it is the person's.
 */
export function CondensedDiff({ lines }: { lines: readonly CondensedLine[] }) {
  if (lines.length === 0) return null;

  return (
    <div className="space-y-2" data-condensed-diff>
      <p className="text-[13px] text-ink-2">
        Así quedaron las líneas que se acortaron: lo que sobra está tachado y lo que cambió,
        resaltado. Los controles automáticos revisan cifras, fechas, nombres, negaciones y quién hizo
        qué, pero no pueden probar que una frase siga diciendo lo mismo: eso lo ves vos.
      </p>
      <ul className="space-y-2">
        {lines.map((line) => (
          <li key={line.id} className="border-l border-rule pl-3 text-[13px] leading-relaxed text-ink-2">
            <p>
              {wordDiff(line.before, line.after).map((part, index) =>
                part.kind === "removed" ? (
                  <del key={index} className="text-ink-3 line-through">
                    {part.text}{" "}
                  </del>
                ) : part.kind === "added" ? (
                  <mark key={index} className="bg-oro/25 text-ink">
                    {part.text}{" "}
                  </mark>
                ) : (
                  <span key={index}>{part.text} </span>
                ),
              )}
            </p>
            {line.needsReview ? (
              <p className="mt-1 text-xs text-ink-3">Cambió bastante: leélo con atención.</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
