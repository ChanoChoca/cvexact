import { withProfilePractical } from "@/lib/ai/practical";
import {
  cvDocumentSchema,
  SECTION_MINIMUM,
  type CVDocument,
  type CVSection,
} from "@/lib/schemas/cv";
import type { Profile } from "@/lib/schemas/profile";

/**
 * Editing a generated CV, as data rather than as a form.
 *
 * Until this existed the only remedy for a bad line was regenerating, which is a
 * lottery: the same posting produced one run that was honest and thin and
 * another that was fuller and had invented an availability, and nothing chose
 * between them. A one-line fix should not cost a model call and should not risk
 * the rest of the document.
 *
 * Pure and React-free on purpose — `components/cv/CVEditor.tsx` is the only
 * thing that knows about inputs, and everything worth testing is here.
 *
 * Every operation returns a new document and none of them validate. `commit` is
 * the single gate: it re-parses through `cvDocumentSchema`, which is also where
 * the template's own rules live (canonical section titles, one merged `pairs`
 * section, `pairs` last), so a draft is normalised at exactly one point.
 */

export type EditTarget =
  | { kind: "summary" }
  | { kind: "section"; section: number }
  | { kind: "sectionBullet"; section: number; bullet: number }
  | { kind: "pair"; section: number; item: number }
  | { kind: "projectDescription"; section: number; item: number }
  | { kind: "activityText"; section: number; item: number }
  | { kind: "itemBullet"; section: number; item: number; bullet: number }
  | { kind: "role"; section: number; item: number };

/**
 * Where a `Finding.field` points, or `null` when it points somewhere the editor
 * has no control for.
 *
 * The verifier writes paths like `sections[2].items[0].bullets[3]`, and the
 * findings panel offers a fix per shape of path. Deliberately total about the
 * shapes it does not handle — `coverage`, `header.email`, a bare `sections` —
 * because those findings are about the document as a whole and there is nothing
 * to focus.
 */
export function parseFieldPath(field: string): EditTarget | null {
  if (field === "summary") return { kind: "summary" };

  const item = field.match(/^sections\[(\d+)\]\.items\[(\d+)\](?:\.(\w+)(?:\[(\d+)\])?)?$/);
  if (item) {
    const section = Number(item[1]);
    const index = Number(item[2]);
    if (!item[3]) return { kind: "pair", section, item: index };
    if (item[3] === "role") return { kind: "role", section, item: index };
    if (item[3] === "description") return { kind: "projectDescription", section, item: index };
    if (item[3] === "text") return { kind: "activityText", section, item: index };
    if (item[3] === "bullets" && item[4] !== undefined) {
      return { kind: "itemBullet", section, item: index, bullet: Number(item[4]) };
    }
    return null;
  }

  const bullet = field.match(/^sections\[(\d+)\]\.bullets\[(\d+)\]$/);
  if (bullet) {
    return { kind: "sectionBullet", section: Number(bullet[1]), bullet: Number(bullet[2]) };
  }

  const section = field.match(/^sections\[(\d+)\]$/);
  if (section) return { kind: "section", section: Number(section[1]) };

  return null;
}

/** Replaces one section, leaving the rest of the document identical. */
function withSection(
  cv: CVDocument,
  index: number,
  update: (section: CVSection) => CVSection | null,
): CVDocument {
  const target = cv.sections[index];
  if (!target) return cv;

  const next = update(target);
  const sections =
    next === null
      ? cv.sections.filter((_, i) => i !== index)
      : cv.sections.map((section, i) => (i === index ? next : section));

  return { ...cv, sections };
}

export function setSummary(cv: CVDocument, text: string): CVDocument {
  return { ...cv, summary: text };
}

export function setSectionTitle(cv: CVDocument, index: number, title: string): CVDocument {
  return withSection(cv, index, (section) => ({ ...section, title }));
}

export function setSectionBullet(
  cv: CVDocument,
  index: number,
  bullet: number,
  text: string,
): CVDocument {
  return withSection(cv, index, (section) =>
    section.kind === "bullets"
      ? { ...section, bullets: section.bullets.map((b, i) => (i === bullet ? text : b)) }
      : section,
  );
}

export function removeSectionBullet(cv: CVDocument, index: number, bullet: number): CVDocument {
  return withSection(cv, index, (section) =>
    section.kind === "bullets"
      ? { ...section, bullets: section.bullets.filter((_, i) => i !== bullet) }
      : section,
  );
}

export function setItemBullet(
  cv: CVDocument,
  index: number,
  item: number,
  bullet: number,
  text: string,
): CVDocument {
  return withSection(cv, index, (section) =>
    section.kind === "experience"
      ? {
          ...section,
          items: section.items.map((entry, i) =>
            i === item
              ? { ...entry, bullets: entry.bullets.map((b, j) => (j === bullet ? text : b)) }
              : entry,
          ),
        }
      : section,
  );
}

export function removeItemBullet(
  cv: CVDocument,
  index: number,
  item: number,
  bullet: number,
): CVDocument {
  return withSection(cv, index, (section) =>
    section.kind === "experience"
      ? {
          ...section,
          items: section.items.map((entry, i) =>
            i === item
              ? { ...entry, bullets: entry.bullets.filter((_, j) => j !== bullet) }
              : entry,
          ),
        }
      : section,
  );
}

export function setRole(cv: CVDocument, index: number, item: number, role: string): CVDocument {
  return withSection(cv, index, (section) =>
    section.kind === "experience"
      ? { ...section, items: section.items.map((e, i) => (i === item ? { ...e, role } : e)) }
      : section,
  );
}

export function setPair(
  cv: CVDocument,
  index: number,
  item: number,
  patch: { label?: string; value?: string },
): CVDocument {
  return withSection(cv, index, (section) =>
    section.kind === "pairs"
      ? { ...section, items: section.items.map((e, i) => (i === item ? { ...e, ...patch } : e)) }
      : section,
  );
}

export function removePair(cv: CVDocument, index: number, item: number): CVDocument {
  return withSection(cv, index, (section) =>
    section.kind === "pairs"
      ? { ...section, items: section.items.filter((_, i) => i !== item) }
      : section,
  );
}

/**
 * A project's description is the only part the editor touches: its name and its
 * link come from the profile, so there is nothing in `patch` for them to say.
 */
export function setProject(cv: CVDocument, index: number, item: number, description: string): CVDocument {
  return withSection(cv, index, (section) =>
    section.kind === "projects"
      ? { ...section, items: section.items.map((e, i) => (i === item ? { ...e, description } : e)) }
      : section,
  );
}

export function removeProject(cv: CVDocument, index: number, item: number): CVDocument {
  return withSection(cv, index, (section) =>
    section.kind === "projects"
      ? { ...section, items: section.items.filter((_, i) => i !== item) }
      : section,
  );
}

/** An activity's text is the only part the editor touches: which one it is comes from the profile. */
export function setActivity(cv: CVDocument, index: number, item: number, text: string): CVDocument {
  return withSection(cv, index, (section) =>
    section.kind === "activities"
      ? { ...section, items: section.items.map((e, i) => (i === item ? { ...e, text } : e)) }
      : section,
  );
}

export function removeActivity(cv: CVDocument, index: number, item: number): CVDocument {
  return withSection(cv, index, (section) =>
    section.kind === "activities"
      ? { ...section, items: section.items.filter((_, i) => i !== item) }
      : section,
  );
}

export function removeItem(cv: CVDocument, index: number, item: number): CVDocument {
  // The two kinds are handled apart rather than together: `items` has a
  // different element type in each, and a shared branch widens it to the union,
  // which then fits neither.
  return withSection(cv, index, (section) => {
    if (section.kind === "experience") {
      return { ...section, items: section.items.filter((_, i) => i !== item) };
    }
    if (section.kind === "education") {
      return { ...section, items: section.items.filter((_, i) => i !== item) };
    }
    return section;
  });
}

export function removeSection(cv: CVDocument, index: number): CVDocument {
  return withSection(cv, index, () => null);
}

/**
 * Moves a section one place up or down.
 *
 * `pairs` is not movable: `cvDocumentSchema` puts it last on every parse, so an
 * arrow that appeared to move it would silently undo itself on the next commit.
 * The editor hides the control rather than offering one that lies.
 */
export function moveSection(cv: CVDocument, index: number, direction: -1 | 1): CVDocument {
  const target = index + direction;
  const moving = cv.sections[index];
  if (!moving || moving.kind === "pairs") return cv;
  if (target < 0 || target >= cv.sections.length) return cv;
  if (cv.sections[target]?.kind === "pairs") return cv;

  const sections = [...cv.sections];
  sections[index] = sections[target]!;
  sections[target] = moving;
  return { ...cv, sections };
}

export function canMoveSection(cv: CVDocument, index: number, direction: -1 | 1): boolean {
  return moveSection(cv, index, direction) !== cv;
}

/**
 * How many entries a section still has, and how many it needs.
 *
 * `cvDocumentSchema` drops a section that falls under its minimum, so deleting
 * the second bullet of a `bullets` section deletes the section. Discovering that
 * from a re-parse is not a usable answer, so the editor asks first.
 */
export function removalCost(
  cv: CVDocument,
  index: number,
): { remaining: number; minimum: number; removesSection: boolean } | null {
  const section = cv.sections[index];
  if (!section) return null;

  const spec = SECTION_MINIMUM[section.kind];
  if (!spec) return null;

  const count = section.kind === "bullets" ? section.bullets.length : section.items.length;
  const remaining = count - 1;
  return { remaining, minimum: spec.min, removesSection: remaining < spec.min };
}

export type CommitResult =
  | { ok: true; cv: CVDocument }
  | { ok: false; message: string };

/**
 * Validates and normalises a draft.
 *
 * The single gate between the editor and everything downstream. PDF, DOCX and
 * the answers/email/interview routes all re-parse a stored CV through
 * `cvDocumentSchema`, so a draft that passes here is one every consumer accepts —
 * and the schema's own repairs run at the same time, which is why the editor
 * does not need to know that section titles are fixed or that `pairs` goes last.
 *
 * `profile` is optional and, when given, re-imposes the practical rows. A user
 * can type "jueves a domingo" into an availability row by hand; that is the same
 * commitment the generator was stopped from making, and it should not survive
 * just because a person typed it instead of a model.
 */
export function commit(draft: CVDocument, profile?: Profile): CommitResult {
  const parsed = cvDocumentSchema.safeParse(
    profile ? withProfilePractical(draft, profile) : draft,
  );

  if (parsed.success) return { ok: true, cv: parsed.data };

  const issue = parsed.error.issues[0];
  return {
    ok: false,
    message: issue
      ? `${describePath(issue.path)}: ${issue.message}`
      : "El CV quedó en un estado que no se puede guardar.",
  };
}

/** A Zod path, in the words the editor's own labels use. */
function describePath(path: readonly PropertyKey[]): string {
  const [head] = path;
  if (head === "summary") return "El resumen";
  if (head === "sections") return "Una sección";
  return "El CV";
}
