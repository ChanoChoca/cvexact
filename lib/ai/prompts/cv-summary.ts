import type { CVDocument } from "@/lib/schemas/cv";
import { NAME_PLACEHOLDER } from "./shared";

/**
 * Renders the generated CV as plain text for the prompts that must stay
 * consistent with it (answers, cover email, interview prep).
 *
 * The coverage block is deliberately excluded: it is internal audit data, and
 * feeding a model its own notes about what it failed to cover invites it to
 * apologise for gaps in a cover letter.
 *
 * Every section kind must have a branch. A missing one is silent — the section
 * contributes its heading and nothing else, which is how `pairs` went unnoticed
 * — so the chain below ends in an exhaustiveness check instead of an `if` each.
 */
export function summarizeCV(cv: CVDocument): string {
  const lines: string[] = [];

  // El nombre real no se serializa — mismo criterio que `serializeProfile` en
  // `shared.ts` (ver `IDENTITY_WITHHELD` y `restoreCandidateName` ahí). Los
  // cuatro llamadores de `summarizeCV` (answers, email, video, interview-prep)
  // ya reponen el nombre real sobre su respuesta completa; antes de este
  // cambio, este `header.fullName` era la única vía por la que el nombre real
  // igual les llegaba al modelo pese a ese trabajo.
  lines.push(`Name: ${cv.header.fullName ? NAME_PLACEHOLDER : "(not given)"}`);
  lines.push(`Location: ${cv.header.location}`);
  lines.push(`\nSummary: ${cv.summary}`);

  for (const section of cv.sections) {
    lines.push(`\n${section.title}`);

    if (section.kind === "experience") {
      for (const item of section.items) {
        lines.push(`- ${item.role} @ ${item.company} (${item.location}) [${item.dateRange}]`);
        for (const bullet of item.bullets) lines.push(`    * ${bullet}`);
      }
    }

    else if (section.kind === "education") {
      for (const item of section.items) {
        lines.push(
          `- ${item.degree} @ ${item.institution} (${item.location}) [${item.date}]${item.honors ? ` — ${item.honors}` : ""}`,
        );
      }
    }

    else if (section.kind === "bullets") {
      for (const bullet of section.bullets) lines.push(`- ${bullet}`);
    }

    // Without this the certification or language level that `build-cv.ts` works
    // to force into the CV reaches the reader but not the three generators
    // below it — so the cover email cannot mention the very credential the
    // posting asked for and the CV already answers.
    else if (section.kind === "pairs") {
      for (const item of section.items) {
        lines.push(item.value ? `- ${item.label}: ${item.value}` : `- ${item.label}`);
      }
    }

    // The link is a plain address the generators may cite, so it travels with the project.
    else if (section.kind === "projects") {
      for (const item of section.items) {
        const detail = [item.description, item.url].filter(Boolean).join(" — ");
        lines.push(detail ? `- ${item.name}: ${detail}` : `- ${item.name}`);
      }
    }

    else if (section.kind === "activities") {
      for (const item of section.items) lines.push(`- ${item.text}`);
    }

    // Unreachable today. It stops compiling the day a sixth kind is added.
    else {
      const unhandled: never = section;
      void unhandled;
    }
  }

  return lines.join("\n");
}
