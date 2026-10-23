import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExpiredCredentialsAlert } from "@/components/cv/ExpiredCredentialsAlert";
import { ExperienceSection } from "@/components/profile/hub/ExperienceSection";
import { CredentialRenewal } from "@/components/profile/hub/CredentialRenewal";
import { TaskList } from "@/components/profile/TaskList";
import { ButtonAnchor, ButtonLink } from "@/components/ui";
import { ToastProvider } from "@/components/ui/toast";
import { credentialGapId } from "@/lib/onboarding/gaps";
import { credentialReviews, reviewedApart } from "@/lib/profile/currency";
import { declinedReceipt } from "@/lib/profile/declined";
import { profileTasks } from "@/lib/profile/tasks";
import { whenAtWords } from "@/lib/profile/sync-status";
import { certificationSchema, type StoredProfile } from "@/lib/schemas/profile-v2";
import { NOW, STAMP, profileWith } from "./helpers/profiles";

/**
 * Stage 4 of the fourth audit (U23–U30), the parts that are not the list itself: what is said when a «no» is answered, one date for what is a moment and
 * the note of a section only when it is older, a button that is a link and not a button inside one, and the credential that is settled where it is told of.
 */

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element).replace(/<!-- -->/g, "");

describe("what is said when a «no» is answered", () => {
  it("takes it back and says what comes next: the next offer that asks for it asks again", () => {
    expect(declinedReceipt({ kind: "requirement", text: "SAP" }, "have")).toBe("Listo: sacamos «SAP» de lo que dijiste que no tenés. Si otro aviso pide «SAP», te lo preguntamos de nuevo.");
  });

  it("says of a skill that was deduced that it may be deduced again", () => {
    expect(declinedReceipt({ kind: "inferred_skill", text: "Excel avanzado" }, "have")).toBe("Listo: «Excel avanzado» puede volver a aparecer entre las habilidades que deducimos de tu perfil.");
  });

  it("keeps it as it was said, and says it is not asked a third time — with no pronoun for something whose gender is not known", () => {
    expect(declinedReceipt({ kind: "requirement", text: "Matrícula" }, "still")).toBe("Listo: queda como lo dijiste, y no te lo volvemos a preguntar.");
    for (const kind of ["requirement", "inferred_skill"] as const) {
      for (const how of ["have", "still"] as const) expect(declinedReceipt({ kind, text: "X" }, how)).not.toMatch(/¿Lo tenés|Sí, lo tengo|Ya la renové/i);
    }
  });
});

describe("the note of a section", () => {
  const at = (month: number) => new Date(2026, month - 1, 15, 12).toISOString();

  it("is said under a section only when it was last looked at in an earlier month than the rest", () => {
    expect(reviewedApart(at(3), at(10))).toBe(at(3));
    expect(reviewedApart(at(10), at(10))).toBeNull();
    expect(reviewedApart(new Date(2026, 9, 2).toISOString(), at(10))).toBeNull();
  });

  it("is nothing for a section nobody has touched, and nothing when there is no whole to compare with", () => {
    expect(reviewedApart(null, at(10))).toBeNull();
    expect(reviewedApart(undefined, at(10))).toBeNull();
    expect(reviewedApart(at(3), null)).toBeNull();
    expect(reviewedApart("not a time", at(10))).toBeNull();
  });
});

describe("a moment on the page", () => {
  it("is the day in words, with the year when it is not this one — and the hour where moments are listed one under another", () => {
    const now = new Date("2026-10-06T12:00:00.000Z");
    expect(whenAtWords("2026-05-03T15:00:00.000Z", now, "UTC")).toBe("el 3 de mayo, 15:00");
    expect(whenAtWords("2025-11-20T09:05:00.000Z", now, "UTC")).toBe("el 20 de noviembre de 2025, 09:05");
    expect(whenAtWords("not a time", now)).toBe("");
  });
});

describe("a button that is a link", () => {
  it("is one control: an anchor that looks like a button, with nothing inside it to press", () => {
    const link = html(createElement(ButtonLink, { href: "/postular", variant: "secondary" }, "Nueva postulación"));
    expect(link).toMatch(/^<a [^>]*href="\/postular"[^>]*>Nueva postulación<\/a>$/);
    expect(link).toContain("inline-flex");
    expect(link).toContain("pointer-coarse:min-h-11");
    expect(link).not.toContain("<button");
    const file = html(createElement(ButtonAnchor, { href: "/api/tracker/export?format=csv", variant: "secondary" }, "Exportar CSV"));
    expect(file).toMatch(/^<a [^>]*href="\/api\/tracker\/export\?format=csv"[^>]*>Exportar CSV<\/a>$/);
  });

  it("is the look of a button, the same as the button's: one size for both", () => {
    const classes = (markup: string) => /class="([^"]*)"/.exec(markup)![1];
    const link = html(createElement(ButtonLink, { href: "/x", compact: true }, "x"));
    expect(classes(link)).toContain("px-2 py-1 text-xs");
  });

  it("is not written as a button inside a link anywhere in the app: two stops of the tab key for one thing, and HTML that is not valid", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (name === "node_modules" || name.startsWith(".")) return [];
        return statSync(path).isDirectory() ? walk(path) : /\.tsx$/.test(name) ? [path] : [];
      });
    const root = join(__dirname, "..");
    const offenders = [...walk(join(root, "app")), ...walk(join(root, "components"))].filter((file) => /<(?:Link|a)\b(?:[^>]|=>)*?>\s*<Button\b/.test(readFileSync(file, "utf8")));
    expect(offenders.map((file) => file.slice(root.length + 1))).toEqual([]);
  });
});

describe("a credential past its date, in the CV of the profile", () => {
  const lapsed = () => {
    const profile = profileWith({ company: "Nubia Retail", role: "Analista", from: { year: 2021, month: 3 }, to: "current", facts: [{ text: "Armo los pedidos" }] });
    profile.certifications.push(certificationSchema.parse({ id: "c1", name: { value: "Matrícula de gasista", status: "confirmed" }, expires: { value: { year: 2026, month: 3 }, status: "confirmed" } }));
    return credentialReviews(profile, NOW);
  };

  it("opens its question in «Para revisar» when the page has one, with a button and no link to another page", () => {
    const markup = html(createElement(ExpiredCredentialsAlert, { reviews: lapsed(), onReview: () => {} }));
    expect(markup).toContain("¿Hiciste la renovación?");
    expect(markup).not.toContain("<a ");
    expect(markup).toContain("<button");
  });

  it("is a link to the question's own page where there is no block to open it in", () => {
    const [review] = lapsed();
    const markup = html(createElement(ExpiredCredentialsAlert, { reviews: [review!] }));
    expect(markup).toContain(`href="/perfil/preguntas?pregunta=${encodeURIComponent(credentialGapId(review!))}"`);
  });
});

describe("the credential in its own card", () => {
  const profile = () => {
    const stored = profileWith({ company: "Nubia Retail", role: "Analista", from: { year: 2021, month: 3 }, to: "current", facts: [{ text: "Armo los pedidos" }] });
    stored.certifications.push(certificationSchema.parse({ id: "c1", name: { value: "Matrícula de gasista", status: "confirmed" }, expires: { value: { year: 2026, month: 3 }, status: "confirmed" } }));
    return stored;
  };
  const card = (stored: StoredProfile) => {
    const [review] = credentialReviews(stored, NOW);
    return html(createElement(ToastProvider, null, createElement(CredentialRenewal, { profile: stored, review: review!, now: NOW })));
  };

  it("asks «¿Hiciste la renovación?», and says what was answered before and not asked as if it had not been", () => {
    expect(card(profile())).toContain("¿Hiciste la renovación?");
    const stored = profile();
    stored.pending.push({ questionId: credentialGapId(credentialReviews(stored, NOW)[0]!), ruleId: "credential_expiry", state: "later", count: 1, at: STAMP });
    const markup = card(stored);
    expect(markup).toContain("Dijiste el 21 de septiembre que todavía no.");
    expect(markup).toContain("Ya hice la renovación");
    expect(markup).not.toContain("¿Hiciste la renovación?");
  });
});

describe("the job that goes on, in its card", () => {
  it("says «En curso · ¿Seguís?» when its question is due, and not when it is not", () => {
    const stored = profileWith({ company: "Nubia Retail", role: "Analista", from: { year: 2021, month: 3 }, to: "current", facts: [{ text: "Armo los pedidos" }] });
    const id = stored.experience[0]!.id;
    const withMark = html(createElement(ExperienceSection, { profile: stored, onRemoved: () => {}, reviewByJob: { [id]: "current_job_review:x:2026-02" }, onReview: () => {} }));
    expect(withMark).toContain("data-job-review");
    expect(withMark).toContain("En curso · ¿Seguís?");
    const without = html(createElement(ExperienceSection, { profile: stored, onRemoved: () => {}, onReview: () => {} }));
    expect(without).not.toContain("En curso · ¿Seguís?");
  });

  it("counts the lines that say what was done, like «Ya tenés», and not the tools listed beside them", () => {
    const stored = profileWith({ company: "Nubia Retail", role: "Analista", from: { year: 2021, month: 3 }, to: "current", facts: [{ text: "Armo los pedidos" }, { kind: "tool", text: "Excel" }, { kind: "achievement", text: "Subí las ventas un 20%" }] });
    const markup = html(createElement(ExperienceSection, { profile: stored, onRemoved: () => {} }));
    expect(markup).toMatch(/data-job-counts[^>]*>2 tareas · 1 con cifra</);
  });
});

describe("«Para hacer», said as what each thing is", () => {
  const profile = () => {
    const stored = profileWith({ company: "Nubia Retail", role: "Analista", from: { year: 2021, month: 3 }, to: "current", facts: [{ text: "Armo los pedidos" }, { kind: "achievement", text: "Subí las ventas un 20%" }] });
    stored.contact.fullName = { value: "Lucía Pérez", status: "confirmed" };
    stored.objective = { value: "Analista", status: "confirmed" };
    stored.onboarding.done = true;
    stored.onboarding.step = "done";
    return stored;
  };

  it("counts what was put off as put off, and a number nobody had as that — and never calls all of it «cosas que dejaste para después»", () => {
    const stored = profile();
    stored.pending.push({ questionId: `no_content:${stored.experience[0]!.id}`, ruleId: "no_content", state: "skipped", count: 1, at: STAMP });
    stored.experience[0]!.facts.push({ id: "f-vague", kind: "responsibility", text: "Atiendo a muchos clientes", source: { kind: "manual", at: STAMP }, status: "confirmed", metric: { unknown: true } });
    const questions = profileTasks(stored, NOW).find((task) => task.id === "questions")!;
    expect(questions.detail).toContain("Para retomar:");
    expect(questions.detail).toContain("1 cifra que no tenías");
    expect(questions.detail).not.toMatch(/2 cosas que dejaste/);
    const onlyFigure = profile();
    onlyFigure.experience[0]!.facts.push({ id: "f-vague", kind: "responsibility", text: "Atiendo a muchos clientes", source: { kind: "manual", at: STAMP }, status: "confirmed", metric: { unknown: true } });
    onlyFigure.pending.push({ questionId: `more_achievements:${onlyFigure.experience[0]!.id}`, ruleId: "more_achievements", state: "na", count: 1, at: STAMP });
    expect(profileTasks(onlyFigure, NOW).find((task) => task.id === "questions")!.detail).not.toContain("dejaste");
  });

  it("does not mark with a pill each row of a list that is already said to be what was left for later", () => {
    const stored = profile();
    stored.pending.push({ questionId: `no_content:${stored.experience[0]!.id}`, ruleId: "no_content", state: "later", count: 1, at: STAMP });
    stored.experience[0]!.facts.push({ id: "f-vague", kind: "responsibility", text: "Atiendo a muchos clientes", source: { kind: "manual", at: STAMP }, status: "confirmed", metric: { unknown: true } });
    const markup = html(createElement(TaskList, { tasks: profileTasks(stored, NOW) }));
    expect(markup).not.toContain("Para después<");
    expect(markup).toContain("Si la encontrás");
  });

  it("lets the words take the line, with the button below them when the screen is narrow", () => {
    const stored = profile();
    stored.experience[0]!.facts.push({ id: "f-vague", kind: "responsibility", text: "Atiendo a muchos clientes", source: { kind: "manual", at: STAMP }, status: "confirmed", metric: { unknown: true } });
    const markup = html(createElement(TaskList, { tasks: profileTasks(stored, NOW) }));
    expect(markup).toContain("flex-[1_1_18rem]");
    expect(markup).not.toContain("min-w-0 flex-1\"><p");
  });
});

describe("a notice on a phone", () => {
  it("stands above the tab bar on the pages that have one, and where it was on the rest: the region is outside the shell and asks whether the page has the bar", () => {
    const markup = html(createElement(ToastProvider, null, "x")).replace(/&amp;/g, "&");
    expect(markup).toContain("[body:has([data-tab-bar])_&]:bottom-[calc(3.75rem+1rem)]");
    // A computer has no tab bar: back to the corner it had.
    expect(markup).toContain("chrome:[body:has([data-tab-bar])_&]:bottom-4");
    // The bar says it is one, with the height the notice clears — written in both places, and here so that the two do not drift apart.
    const shell = readFileSync(join(__dirname, "..", "app", "(app)", "AppShell.tsx"), "utf8");
    expect(shell).toContain("data-tab-bar");
    expect(shell).toContain("[--tab-h:3.75rem]");
  });
});
