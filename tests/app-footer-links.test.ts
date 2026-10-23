import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppFooter } from "@/components/legal/parts";

/**
 * Términos, Privacidad, «Apoyar el proyecto» y la línea del operador salen en el pie del servidor (`AppFooter`) y se
 * esconden por CSS fuera de la pestaña principal (Postular): `AppFooter` no sabe de rutas, `AppShell` sí. Que el selector
 * llegue a esos y a nada más es de la prueba de navegador; acá, el contrato entre los dos archivos y lo que el pie marca.
 */
afterEach(() => vi.unstubAllEnvs());

const footer = () => renderToStaticMarkup(createElement(AppFooter));
/** Los elementos que llevan la marca, por la etiqueta que abre cada uno. */
const marked = (html: string) => [...html.matchAll(/<(\w+)[^>]*data-main-tab-only[^>]*>/g)].map((m) => m[1]);

describe("the footer of the app, off the main tab", () => {
  it("marks the three links and the operator's line, and nothing that is not them", () => {
    vi.stubEnv("GA_MEASUREMENT_ID", "G-ABCDEF1234");
    const html = footer();
    // Con la analítica prendida el pie queda con su botón: ahí no se marca el pie entero.
    expect(marked(html)).toEqual(["a", "a", "a", "p"]);
    expect(html).toContain("Preferencias de analítica");
    expect(html).not.toMatch(/<button[^>]*data-main-tab-only/);
  });

  it("marks the whole footer when there is nothing else in it (no analytics, no sales), so no rule is left alone", () => {
    vi.stubEnv("GA_MEASUREMENT_ID", "");
    expect(marked(footer())).toEqual(["footer", "a", "a", "a", "p"]);
  });

  it("leaves the footer whole when something has to stay in it: the analytics choice or the withdrawal of a sale", () => {
    const source = readFileSync("components/legal/parts.tsx", "utf8");
    expect(source).toContain("const nothingElse = !gaMeasurementId() && !salesEnabled && !source;");
    // «Dar de baja» y «Botón de arrepentimiento» son obligaciones que nacen de vender: no se esconden nunca.
    expect(source).not.toMatch(/href="\/(?:baja|arrepentimiento)"[^>]*data-main-tab-only/);
  });

  it("shows the source link only when NEXT_PUBLIC_SOURCE_URL is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_SOURCE_URL", "https://example.com/cvexact-source");
    expect(footer()).toContain('href="https://example.com/cvexact-source"');
    expect(footer()).toContain("Código fuente");

    vi.stubEnv("NEXT_PUBLIC_SOURCE_URL", "");
    expect(footer()).not.toContain("Código fuente");
  });

  it("hides invalid source URLs and normalizes trailing slashes", () => {
    for (const invalid of ["not-a-url", "javascript:alert(1)", "ftp://example.com/source"]) {
      vi.stubEnv("NEXT_PUBLIC_SOURCE_URL", invalid);
      expect(footer(), invalid).not.toContain("Código fuente");
    }

    vi.stubEnv("NEXT_PUBLIC_SOURCE_URL", "https://example.com/source///");
    expect(footer()).toContain('href="https://example.com/source"');
    expect(footer()).not.toContain('href="https://example.com/source/"');
  });

  it("is hidden by the shell in every tab but Postular, and kept where there is no tab (the sign-in, the password reset)", () => {
    const shell = readFileSync("app/(app)/AppShell.tsx", "utf8");
    expect(shell).toMatch(/const active = sectionOf\(usePathname\(\)\)/);
    expect(shell).toContain('data-off-main-tab={active && active !== "/postular" ? "" : undefined}');
    expect(shell).toContain("data-off-main-tab:**:data-main-tab-only:hidden");
  });
});
