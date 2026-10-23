import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * La app cambia de teléfono a computadora en un solo lugar. El número lo fija la barra de arriba: con la marca, «Empleos», «Postulaciones», el saldo,
 * «Postular» y «Cuenta» en una fila, por debajo de 736 px (46rem) ya no entran — y ahí manda la barra de pestañas de abajo. Si la barra se mudara sola,
 * todo lo que flota sobre las pestañas (avisos, hojas, el botón de anotar) seguiría midiendo el teléfono de antes y taparía la barra; por eso el umbral es
 * un token de `@theme` y estas pruebas lo atan.
 */

const read = (path: string) => readFileSync(path, "utf8");

/** El valor del breakpoint, tal como está escrito en `globals.css`. */
const BREAKPOINT = /--breakpoint-chrome:\s*([\d.]+rem);/.exec(read("app/globals.css"))?.[1] ?? "";

describe("el cambio de teléfono a computadora", () => {
  it("es uno solo, y está en 46rem (736 px): lo que la barra de arriba necesita para entrar en una fila", () => {
    expect(BREAKPOINT).toBe("46rem");
  });

  it("gobierna la barra de arriba: los links y «Cuenta» aparecen ahí, y la barra de pestañas se va", () => {
    const shell = read("app/(app)/AppShell.tsx");
    expect(shell).toContain("chrome:inline");
    expect(shell.match(/hidden chrome:block/g)?.length).toBe(2);
    expect(shell).toContain("chrome:hidden");
    expect(shell).toContain("chrome:pb-24");
    // La barra no se muda en `sm`: eso queda para el contenido de las páginas, que no depende de ella.
    expect(shell).not.toContain("sm:inline");
    expect(shell).not.toContain("sm:hidden");
  });

  it("gobierna lo que flota sobre la barra de pestañas, para que no la tape en el ancho donde todavía existe", () => {
    const pieces = {
      "components/ui/toast.tsx": "chrome:[body:has([data-tab-bar])_&]:bottom-4",
      "components/ui/BottomSheet.tsx": "chrome:bottom-0",
      "components/wizard/PostularGuide.tsx": "chrome:bottom-6",
      "components/profile/hub/removal.tsx": "chrome:bottom-6",
      "components/notes/NoteCapture.tsx": "chrome:bottom-8",
    };
    for (const [path, marker] of Object.entries(pieces)) expect(read(path), path).toContain(marker);
  });

  it("es el mismo número en la cuenta que decide si el botón de anotar se aparta: si uno cambia, el otro también", () => {
    expect(read("components/notes/NoteCapture.tsx")).toContain(`window.matchMedia("(width < ${BREAKPOINT})")`);
  });
});
