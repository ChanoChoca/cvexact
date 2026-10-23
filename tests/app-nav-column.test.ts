import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * La barra de arriba vive en una columna, no en el ancho de la pantalla: la marca a la izquierda y las secciones a la derecha tienen que caer sobre los
 * mismos márgenes que el contenido, no sobre las esquinas del monitor. Estuvo abierta a todo el ancho mientras una sección estaba activa, y en un monitor
 * de 1920 px eso dejaba el logo y los links en extremos opuestos de la pantalla — dos piezas de chrome que no parecían del mismo encabezado.
 */

const shell = () => readFileSync("app/(app)/AppShell.tsx", "utf8");

/** La primera `<nav>` del archivo: la de arriba, no la fija de abajo (`MobileTabBar`). */
const bar = (source: string) => source.match(/<nav\b[\s\S]*?>/)?.[0] ?? "";

describe("la barra de arriba", () => {
  it("no se abre a todo el ancho: se queda en la columna de la app", () => {
    expect(bar(shell())).toContain("max-w-[1180px]");
    expect(bar(shell())).not.toContain("max-w-none");
  });

  it("mide lo mismo que las páginas anchas, para que sus extremos caigan sobre los márgenes del contenido", () => {
    const source = shell();
    const wide = source.match(/has-data-\[panel=wide\]:max-w-\[(\d+)px\]/)?.[1];
    expect(wide).toBe("1180");
    expect(bar(source)).toContain(`max-w-[${wide}px]`);
  });
});
