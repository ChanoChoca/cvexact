import { findUrls, linkLabel } from "@/lib/parse/patterns";
import { linkKey, normalizeUrl } from "@/lib/schemas/profile";

export { linkKey };

export type ProfileLink = { label: string; url: string };

/** The most links a profile keeps. */
export const MAX_LINKS = 3;

/**
 * One link per line, as a person would list them: whatever on a line is a link becomes
 * one, with its scheme added and no label of its own — what a CV prints is the address.
 * Anything that is not a link is left out, and a link named twice is one — however
 * each copy was written ("linkedin.com/in/x", "https://www.linkedin.com/in/x/"), see
 * `linkKey` — so a repeat never takes one of the few places a real link needs.
 */
export function parseLinkLines(text: string): ProfileLink[] {
  const out: ProfileLink[] = [];
  for (const line of text.split("\n")) {
    for (const url of findUrls(line.trim())) {
      const absolute = normalizeUrl(url);
      if (!out.some((link) => linkKey(link.url) === linkKey(absolute))) out.push({ label: linkLabel(absolute).slice(0, 60), url: absolute });
    }
  }
  return out.slice(0, MAX_LINKS);
}

/** The links, back as lines to edit. */
export const linkLines = (links: readonly ProfileLink[]): string => links.map((link) => link.url).join("\n");
