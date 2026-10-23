/**
 * Splitting prose into sentences, and packing them into pieces of a given size.
 *
 * Used where a paragraph has to become statements: a long description under a
 * job in a CV, an answer typed as a paragraph. It splits on sentence-ending
 * punctuation followed by a capital, and puts back together what abbreviations
 * and initials tore apart ("Ing. Pérez", "S.A. de C.V.", "3.5 años").
 */

const ABBREVIATIONS = new Set([
  "sr", "sra", "srta", "dr", "dra", "ing", "lic", "arq", "prof", "etc", "vs", "aprox",
  "ej", "ud", "uds", "av", "tel", "cel", "nro", "dpto", "depto", "inc", "ltd", "co",
  "corp", "st", "mr", "mrs", "ms", "jr", "approx", "eg", "ie", "am", "pm", "us", "esp",
  "cap", "fig", "gral", "pág", "pag", "art", "cía", "cia", "mba", "no", "vol",
]);

export function splitSentences(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const pieces = clean.split(/(?<=[.!?…])\s+(?=[A-ZÁÉÍÓÚÑÜ¿¡"“(\d])/u);
  const out: string[] = [];
  for (const piece of pieces) {
    const prev = out[out.length - 1];
    if (prev !== undefined && endsWithAbbreviation(prev)) {
      out[out.length - 1] = `${prev} ${piece}`;
    } else {
      out.push(piece);
    }
  }
  return out.map((sentence) => sentence.trim()).filter(Boolean);
}

function endsWithAbbreviation(sentence: string): boolean {
  if (!sentence.endsWith(".")) return false;
  const last = sentence.slice(0, -1).split(/\s+/).pop() ?? "";
  const bare = last.replace(/[^\p{L}.]/gu, "").toLowerCase();
  // An initial ("J.") or a dotted acronym ("S.A.", "U.S.").
  if (/^\p{L}$/u.test(bare) || /^(?:\p{L}\.)+\p{L}?$/u.test(bare)) return true;
  return ABBREVIATIONS.has(bare.replace(/\./g, ""));
}

/**
 * Sentences packed, in order, into pieces of at most `max` characters. A sentence
 * longer than `max` on its own is cut at the last space that fits — the only
 * case where a piece is not a whole sentence.
 */
export function packSentences(text: string, max: number): string[] {
  const pieces: string[] = [];
  let current = "";
  const push = () => {
    if (current) pieces.push(current);
    current = "";
  };
  for (const sentence of splitSentences(text)) {
    if (sentence.length > max) {
      push();
      let rest = sentence;
      while (rest.length > max) {
        const cut = rest.lastIndexOf(" ", max);
        const at = cut > max / 2 ? cut : max;
        pieces.push(rest.slice(0, at).trim());
        rest = rest.slice(at).trim();
      }
      current = rest;
      continue;
    }
    if (current && current.length + 1 + sentence.length > max) push();
    current = current ? `${current} ${sentence}` : sentence;
  }
  push();
  return pieces;
}
