import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CVDocument as CVDocumentView } from "@/components/cv/CVDocument";
import { composeFromProfile } from "@/lib/ai/profile-sources";
import { buildCVPrompt, BUILD_CV_SYSTEM, STRATEGIES } from "@/lib/ai/prompts/build-cv";
import { ANALYZE_JOB_SYSTEM } from "@/lib/ai/prompts/analyze-job";
import { profileMaterial, serializeProfile } from "@/lib/ai/prompts/shared";
import { verifyCV } from "@/lib/ai/verify";
import { baseCv } from "@/lib/cv/from-profile";
import { cvToBlob } from "@/lib/docx/cv-docx";
import { cvDocumentSchema, type CVDocument } from "@/lib/schemas/cv";
import { jobAnalysisSchema } from "@/lib/schemas/job";
import { profileSchema } from "@/lib/schemas/profile";
import { emptyStoredProfile } from "@/lib/schemas/profile-v2";
import { addSkill } from "@/lib/profile/entities";
import { toPlainProfile } from "@/lib/profile/project";
import { backendProfile } from "./fixtures";
import { STAMP, newId, profileWith } from "./helpers/profiles";

/**
 * What the person says about a job (a note under it) and about a skill (how well they know it) reaches the page as they said it, and nothing
 * else: the model neither writes the note nor promotes a skill, and a basic skill is not printed.
 */

const analysis = jobAnalysisSchema.parse({
  title: "Software Engineer Backend",
  language: "es",
  domain: "software engineering",
  relevance: "direct",
  relevanceReason: "x",
  requirements: [],
  responsibilities: ["Diseñar servicios backend."],
  priorities: ["Bajar los costos de infraestructura", "Escalar el equipo de pagos"],
  keywords: ["Go"],
});

const levelled = profileSchema.parse({ ...backendProfile, skillLevels: { Go: "strong", Redis: "working", Kafka: "basic" }, skills: ["Go", "Redis", "Kafka", "Docker"] });

describe("how well each skill is known, in the prompt", () => {
  it("marks each mark the person made, and says a basic one is not for the CV", () => {
    const text = serializeProfile(levelled, { highlight: (skill) => skill === "Go" });
    expect(text).toContain("Go* (strong)");
    expect(text).toContain("Redis (regular use)");
    expect(text).toContain("Kafka (basic: not listed in the CV)");
    expect(text).toMatch(/Docker(?! \()/);
  });

  it("does not count a basic skill as a line to fill", () => {
    // Named in a bullet, so that none of them is «not used in any role»: the marks are what is under test.
    const base = profileSchema.parse({
      ...backendProfile,
      experience: [{ ...backendProfile.experience[0], tags: [], bullets: ["Trabajé con Go, Redis, Kafka, Docker, Rust, Zig, Lua y Perl."] }],
      skills: ["Go", "Redis", "Kafka", "Docker", "Rust", "Zig", "Lua", "Perl"],
    });
    const withBasics = profileSchema.parse({ ...base, skillLevels: Object.fromEntries(["Go", "Redis", "Kafka", "Docker", "Rust"].map((name) => [name, "basic"])) });
    expect(profileMaterial(withBasics).skillLines).toBeLessThan(profileMaterial(base).skillLines);
  });

  it("asks the model to group by level and to leave the basic ones out", () => {
    expect(BUILD_CV_SYSTEM).toContain('"(strong)" and "(regular use)"');
    expect(BUILD_CV_SYSTEM).toContain('"(basic: not listed in the CV)" is not listed');
  });

  it("warns when a skills line lists one the person marked as basic", () => {
    const cv = (line: string): CVDocument =>
      cvDocumentSchema.parse({
        language: "es",
        header: { fullName: "Ana Gómez", location: "Junín" },
        summary: "Ingeniera de software.",
        sections: [{ kind: "bullets", title: "SKILLS", bullets: [line, "Redis para cachear"] }],
        coverage: { requirements: [], omitted: [] },
      });
    const warned = verifyCV(cv("Mensajería con Kafka y colas"), levelled, { relevance: "direct" }).filter((f) => f.detail.includes("marcaste como básica"));
    expect(warned).toHaveLength(1);
    expect(warned[0]!.detail).toContain("«Kafka»");
    expect(verifyCV(cv("Servicios en Go"), levelled, { relevance: "direct" }).some((f) => f.detail.includes("marcaste como básica"))).toBe(false);
  });

  it("puts the strong ones first in the base CV and leaves the basic ones in the profile", () => {
    const stored = profileWith({ company: "Nubesur", role: "Dev", from: { year: 2022 }, to: "current", facts: [{ text: "Maqueté pantallas" }] });
    for (const name of ["Docker", "Kafka", "Go", "Redis"]) addSkill(stored, name, { now: STAMP, newId });
    const [docker, kafka, go, redis] = stored.skills;
    docker!.level = undefined;
    kafka!.level = { value: "basic", status: "confirmed" };
    go!.level = { value: "strong", status: "confirmed" };
    redis!.level = { value: "working", status: "confirmed" };
    const pairs = baseCv(stored).document.sections.find((section) => section.kind === "pairs");
    expect(pairs?.kind === "pairs" && pairs.items.find((item) => item.label === "Habilidades")?.value).toBe("Go, Redis, Docker");
  });
});

describe("a job's note", () => {
  const generated = (): CVDocument =>
    cvDocumentSchema.parse({
      language: "es",
      header: { fullName: "Bruno", location: "" },
      summary: "Resumen.",
      sections: [{ kind: "experience", title: "EXPERIENCIA", items: [{ company: "Pagaluz SA", role: "Desarrollador", location: "", dateRange: "", bullets: ["Armé el pipeline."], note: "Me echaron por mal desempeño" }] }],
      coverage: { requirements: [], omitted: [] },
    });
  const bruno = (note: string) =>
    profileSchema.parse({ fullName: "Bruno", experience: [{ id: "a", company: "Pagaluz SA", role: "Desarrollador", start: "Octubre 2022", end: "Diciembre 2022", bullets: ["Armé el pipeline de builds."], tags: [], note }] });
  const noteOf = (cv: CVDocument) => cv.sections.flatMap((s) => (s.kind === "experience" ? s.items.map((i) => i.note) : []))[0];

  it("is the profile's, whatever the model wrote there", () => {
    const ask = { relevance: "direct" } as Parameters<typeof composeFromProfile>[2];
    expect(noteOf(composeFromProfile(generated(), bruno("Cierre del área de desarrollo"), ask).cv)).toBe("Cierre del área de desarrollo");
    expect(noteOf(composeFromProfile(generated(), bruno(""), ask).cv)).toBe("");
  });

  it("is printed under the job, in italics, and in the .docx", async () => {
    const cv = cvDocumentSchema.parse({ ...generated(), sections: [{ kind: "experience", title: "EXPERIENCIA", items: [{ company: "Pagaluz SA", role: "Dev", location: "", dateRange: "2022", bullets: ["Uno."], note: "Pausa por cuidado familiar" }] }] });
    const html = renderToStaticMarkup(createElement(CVDocumentView, { data: cv }));
    expect(html).toContain('<p class="cv-note">Pausa por cuidado familiar</p>');
    expect(html.indexOf("cv-dates")).toBeLessThan(html.indexOf("cv-note"));
    expect(html.indexOf("cv-note")).toBeLessThan(html.indexOf("cv-bullets"));
    expect((await cvToBlob(cv)).size).toBeGreaterThan(0);
  });

  it("is in the plain profile only when the person wrote one", () => {
    const stored = profileWith({ company: "A", role: "b", from: { year: 2025, month: 1 }, to: { year: 2025, month: 3 } });
    expect(toPlainProfile(stored).experience[0]!.note).toBe("");
    stored.experience[0]!.note = { value: "  Cierre del área ", status: "confirmed" };
    expect(toPlainProfile(stored).experience[0]!.note).toBe("Cierre del área");
    expect(toPlainProfile(emptyStoredProfile()).skillLevels).toEqual({});
  });
});

describe("the prompt's other asks of this stage", () => {
  const prompt = buildCVPrompt({ profile: backendProfile, analysis, inferredSkills: [], outputLanguage: "es" });

  it("PRM-6: a two-line summary that may name the kind of role, never as experience and never as an ambition", () => {
    expect(prompt).toContain("Summary: 2 lines (about 30–45 words)");
    expect(prompt).toContain("It may close on\n  the kind of job it is for");
    expect(prompt).toContain("leaves\n  that out when the first part already says it");
    expect(prompt).toContain("The posting's field describes\n  the job, never the candidate's past");
    expect(prompt).toContain('Never the employer\'s name, never an ambition ("Busco…"');
    expect(prompt).not.toContain("in this order and only from the profile");
  });

  it("PRM-8: the business priorities of the posting, when it says them, and never a result added to meet them", () => {
    expect(prompt).toContain("Business priorities:\n- Bajar los costos de infraestructura\n- Escalar el equipo de pagos");
    expect(prompt).toContain("Never add a result to make the connection.");
    expect(buildCVPrompt({ profile: backendProfile, analysis: { ...analysis, priorities: [] }, inferredSkills: [], outputLanguage: "es" })).not.toContain("Business priorities:");
    expect(ANALYZE_JOB_SYSTEM).toContain('- "priorities": what the business behind the posting wants improved');
    expect(jobAnalysisSchema.parse({ ...analysis, priorities: undefined }).priorities).toEqual([]);
  });

  it("PRM-9: more than one kind of strength, in a direct match", () => {
    expect(STRATEGIES.direct).toContain("let more than one kind of strength show");
    expect(STRATEGIES.adjacent).not.toContain("let more than one kind of strength show");
  });

  it("PRM-10: an old role gets its header and one bullet, unless it is the evidence for something", () => {
    expect(prompt).toContain("A role that ended more than 7 years ago gets its header and at most one");
    expect(prompt).toContain("Never drop it\n  when it is the evidence for one.");
  });

  it("PRM-11: the examples of a kept figure are placeholders, not numbers a model could copy", () => {
    const withFigures = profileSchema.parse({ ...backendProfile, experience: [{ ...backendProfile.experience[0], bullets: ["Optimicé 500 consultas SQL, reduciendo 400 ms la respuesta."] }] });
    const text = buildCVPrompt({ profile: withFigures, analysis, inferredSkills: [], outputLanguage: "es" });
    expect(text).toContain("<N> consultas SQL, reduciendo <X> ms el tiempo de respuesta");
    expect(text).not.toContain("Optimicé 500 consultas SQL, reduciendo 400 ms el tiempo");
    expect(BUILD_CV_SYSTEM).toContain("Optimicé <N> consultas SQL, reduciendo <X> ms");
    expect(BUILD_CV_SYSTEM).not.toContain("500 consultas");
  });
});
