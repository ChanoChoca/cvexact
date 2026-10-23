import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acceptedCvPdf } from "@/lib/export/pdf-check";
import { projectLinkLabel } from "@/lib/schemas/cv";
import { renderDocumentPdf } from "@/lib/export/pdf";

/**
 * The real thing: Chromium prints the real page, with the real stylesheet and
 * the real fonts, and the §6.7 checks read the bytes back.
 *
 * Off by default, because it needs what a unit test must not: `npm run dev`
 * serving :3000 and a browser on the machine. It skips itself when either is
 * missing, so the suite stays green anywhere, and it is the one test that can
 * catch a reader that disagrees with the printer — the first version of
 * `inspectPdfFonts` called every real PDF a substitution, because Chromium
 * writes these WOFF2 faces as Type 3 with no `/FontFile` and puts `/FontName`
 * before the `/Type` that closes the dictionary.
 *
 * Measured here (Chromium 141, local, screen media): one sheet and
 * `pdfFonts: "ok"` for a normal CV, for one carrying a 200-character token and
 * for a page-filling one; three sheets for a CV of eighty bullets — which
 * `pdfinfo` confirms.
 */

const CHROME_CANDIDATES = [
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

const chromePath = CHROME_CANDIDATES.find((path) => existsSync(path));
const serverUp = await fetch("http://localhost:3000/", { signal: AbortSignal.timeout(2_000) })
  .then((response) => response.ok)
  .catch(() => false);
const canRun = Boolean(chromePath) && serverUp;

const TOKEN = "https://example.com/una-url-larguisima-sin-espacios-".repeat(4);

function cv(bullets: number, token = false, { italic = true, extra = "" } = {}) {
  const lines = [
    "Consultas SQL y tableros para el equipo comercial.",
    "Preparo los informes mensuales de ventas para dirección.",
    ...Array.from(
      { length: bullets },
      (_, index) => `Viñeta de relleno número ${index} con bastante texto para ocupar su lugar en la hoja impresa.`,
    ),
  ];
  if (token) lines.push(`Referencia: ${TOKEN}`);
  if (extra) lines.push(extra);

  return {
    language: "es",
    header: {
      fullName: "Ana Pérez",
      location: "Rosario, Argentina",
      phone: "+54 341 555 1234",
      email: "ana@example.com",
      links: [{ label: "linkedin.com/in/perfil-ejemplo", url: "https://linkedin.com/in/perfil-ejemplo" }],
    },
    summary: italic ? "Analista de datos con seis años de experiencia en retail. Trabajé con equipos comerciales." : "",
    sections: [
      {
        kind: "experience",
        title: "EXPERIENCIA PROFESIONAL",
        items: [
          {
            company: "Nubia Retail",
            role: "Analista de datos",
            location: "Rosario, Argentina",
            dateRange: italic ? "marzo 2021 – actualidad" : "",
            bullets: lines,
          },
          {
            company: "Grupo Lumen",
            role: "Asistente administrativa",
            location: "Rosario, Argentina",
            dateRange: italic ? "septiembre 2018 – febrero 2021" : "",
            bullets: ["Control de stock y reposición de mercadería."],
          },
        ],
      },
      {
        kind: "education",
        title: "EDUCACIÓN",
        items: [
          {
            institution: "Universidad Nacional de Rosario",
            degree: "Licenciada en Administración",
            location: "Rosario, Argentina",
            date: italic ? "2020" : "",
            honors: "Promedio 8,5",
          },
        ],
      },
      {
        kind: "bullets",
        title: "SKILLS ADICIONALES",
        bullets: ["SQL, Power BI y Excel avanzado.", "Gestión de 20 proveedores locales."],
      },
      {
        kind: "pairs",
        title: "IDIOMAS Y LICENCIAS",
        items: [
          { label: "Inglés", value: "B2" },
          { label: "Licencia de conducir", value: "B1 vigente" },
        ],
      },
    ],
    coverage: { requirements: [], omitted: [] },
  };
}

describe.skipIf(!canRun)("the real printer", () => {
  it("prints one sheet, with the expected typography in use and in the file", async () => {
    process.env.CHROME_PATH = chromePath;
    delete process.env.BROWSER_WS_URL;

    for (const [name, document] of [
      ["ok", cv(0)],
      ["token", cv(0, true)],
      ["full", cv(12)],
    ] as const) {
      const { pdf, checks } = await renderDocumentPdf("cv", document, "http://localhost:3000");
      writeFileSync(join(tmpdir(), `smoke-${name}.pdf`), pdf);

      expect(checks?.pages, `${name}: sheets`).toBe(1);
      expect(checks?.overflowX, `${name}: sideways`).toBe(false);
      expect(checks?.fontsLoaded, `${name}: faces at print time`).toBe(true);
      // The one that matters: the file carries STIX, read back from the bytes.
      expect(checks?.pdfFonts, `${name}: fonts in the file`).toBe("ok");
      expect(checks && acceptedCvPdf(checks), `${name}: accepted`).toBe(true);
    }
  }, 180_000);

  it("loads the faces itself: a CV that never draws italic still prints in STIX", async () => {
    process.env.CHROME_PATH = chromePath;
    delete process.env.BROWSER_WS_URL;

    // The summary and the dates are the only italic text there is, so without
    // them the italic faces are never requested by the page — `check` alone says
    // false for them.
    const document = cv(0, false, { italic: false });

    const { checks } = await renderDocumentPdf("cv", document, "http://localhost:3000");
    expect(checks?.fontsLoaded, "faces at print time").toBe(true);
    expect(checks?.pdfFonts, "fonts in the file").toBe("ok");
  }, 180_000);

  it("prints a symbol the faces lack with its plain equivalent, all in STIX", async () => {
    process.env.CHROME_PATH = chromePath;
    delete process.env.BROWSER_WS_URL;

    // U+2192 sits outside the self-hosted faces: drawn as is, a system font
    // would carry the arrow and the file would not be all STIX.
    const document = cv(0, false, { extra: "Migré el reporte → tablero ✓ ﬁnal." });

    const { checks } = await renderDocumentPdf("cv", document, "http://localhost:3000");
    expect(checks?.fontsLoaded, "faces at print time").toBe(true);
    expect(checks?.pdfFonts, "fonts in the file").toBe("ok");
  }, 180_000);

  it("prints what imports and pastes bring — decomposed accents, square bullets, emoji, odd hyphens — all in STIX", async () => {
    process.env.CHROME_PATH = chromePath;
    delete process.env.BROWSER_WS_URL;

    // "Gestio\u0301n" is the NFD spelling of "Gestión": U+0301 is in the font but outside its unicode-range.
    const extra = "Gestio\u0301n de n\u0303andú \u25AA turnos \u2011 \u2010 \uF0B7 📞 ► ■ ✔️ ★";
    const { checks } = await renderDocumentPdf("cv", cv(0, false, { extra }), "http://localhost:3000");
    expect(checks?.missing).toBeUndefined();
    expect(checks?.pdfFonts, "fonts in the file").toBe("ok");
    expect(checks && acceptedCvPdf(checks)).toBe(true);
  }, 180_000);

  it("still refuses a glyph no fallback covers", async () => {
    process.env.CHROME_PATH = chromePath;
    delete process.env.BROWSER_WS_URL;

    const { checks } = await renderDocumentPdf("cv", cv(0, false, { extra: "Equipo 日本 ↑ ñ" }), "http://localhost:3000");
    expect(checks?.pdfFonts, "fonts in the file").toBe("substituted");
    expect(checks && acceptedCvPdf(checks)).toBe(false);
    // And the printer says which ones, so the person is told what to take out.
    expect(checks?.missing?.sort()).toEqual(["↑", "日", "本"]);
  }, 180_000);

  it("prints a project with its link: the text in the file, and an annotation that points at the whole address", async () => {
    process.env.CHROME_PATH = chromePath;
    delete process.env.BROWSER_WS_URL;

    const base = cv(0);
    const url = "https://github.com/perfil-ejemplo/tablero-de-ventas-con-un-nombre-bastante-largo-para-la-hoja";
    const document = {
      ...base,
      sections: [
        ...base.sections.slice(0, -1),
        {
          kind: "projects",
          title: "PROYECTOS",
          items: [
            { ref: "P1", name: "Tablero de ventas", description: "Tablero en Power BI para el equipo comercial.", url },
            { ref: "P2", name: "Planilla de gastos", description: "", url: "" },
          ],
        },
        base.sections.at(-1)!,
      ],
    };

    const { pdf, checks } = await renderDocumentPdf("cv", document, "http://localhost:3000");
    const file = join(tmpdir(), "smoke-projects.pdf");
    writeFileSync(file, pdf);

    expect(checks?.pages, "sheets").toBe(1);
    expect(checks?.pdfFonts, "fonts in the file").toBe("ok");
    expect(checks && acceptedCvPdf(checks)).toBe(true);

    // The text layer keeps its spaces (REN-4): the variable font printed as Type 3, and `pdftotext -raw`
    // read it back as «Tableroaventas».
    const raw = execFileSync("pdftotext", ["-raw", file, "-"], { encoding: "utf8" });
    const text = raw.replace(/\s+/g, " ");
    expect(text).toContain("PROYECTOS");
    expect(text).toContain("Tablero de ventas: Tablero en Power BI para el equipo comercial. •");
    expect(text).toContain("Planilla de gastos");
    // The label has no spaces of its own, but wraps at the column's edge: compared across the break.
    expect(raw.replace(/\s+/g, "")).toContain(projectLinkLabel(url));
    // And the faces are the static TrueType instances, not Type 3.
    const faces = execFileSync("pdffonts", [file], { encoding: "utf8" });
    expect(faces).not.toContain("Type 3");
    expect(faces).toMatch(/STIXTwoText-Regular\s+CID TrueType/);
    // The text on the sheet is cut to a line; the link behind it is not.
    expect(Buffer.from(pdf).toString("latin1")).toContain(`/URI (${url})`);
  }, 180_000);

  it("counts the sheets of a CV that really does not fit", async () => {
    process.env.CHROME_PATH = chromePath;
    const { checks } = await renderDocumentPdf("cv", cv(80), "http://localhost:3000");

    expect(checks?.pages).toBeGreaterThan(1);
    // Which is exactly what the client refuses to hand over.
    expect(checks && acceptedCvPdf(checks)).toBe(false);
  }, 180_000);

  it("prints a CV of two sheets as two, with the first one's margin at the top of the second", async () => {
    process.env.CHROME_PATH = chromePath;
    const { pdf, checks } = await renderDocumentPdf("cv", cv(30), "http://localhost:3000");

    expect(checks?.pages).toBe(2);
    // Refused as one sheet, accepted once the person allowed two.
    expect(checks && acceptedCvPdf(checks)).toBe(false);
    expect(checks && acceptedCvPdf(checks, 2)).toBe(true);

    const file = join(tmpdir(), `cv-two-sheets-${process.pid}.pdf`);
    writeFileSync(file, pdf);
    // The first word of the second sheet is a margin below its top edge (28.4pt of padding), not on it.
    const boxes = execFileSync("pdftotext", ["-f", "2", "-l", "2", "-bbox", file, "-"], { encoding: "utf8" });
    const top = Math.min(...[...boxes.matchAll(/yMin="([\d.]+)"/g)].map((match) => Number(match[1])));
    expect(top).toBeGreaterThan(20);
  }, 180_000);
});
