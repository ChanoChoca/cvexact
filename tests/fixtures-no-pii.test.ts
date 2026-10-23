import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guardián de los datos de demostración que se publican con el repositorio.
 *
 * Los fixtures de portales de empleo, las escenas de la landing y los tests usan
 * nombres, correos y teléfonos ficticios. Antes de publicar se reemplazaron las
 * direcciones que podían coincidir con personas o empresas reales por dominios
 * reservados (`example.com`, `example.org`, `example.net`, `ejemplo.com`). Este
 * test revisa `tests/**`, `components/**` y los fixtures propios del CV; si
 * alguien vuelve a pegar una captura o un dato de demostración sin sanear, falla
 * acá en vez de publicarlo.
 *
 * Sí se permiten las direcciones que son parte real del producto o de un
 * servicio externo conocido: el dominio de CVExact, los remitentes de ATS que
 * el tracker reconoce y los alias de los tests. No se revisan teléfonos ni
 * perfiles: no tienen un formato regular para distinguirlos sin falsos
 * positivos, y la regla de correos cubre el caso que motivó el saneamiento.
 */

const ROOTS = ["tests", "components", "lib/fixtures"];
const EXTRA_FILES = ["public/plantilla-cv.html"];
const TEXT_FILE = /\.(?:html?|json|tsx?|css)$/i;
const EMAIL = /[A-Za-z0-9\u00C0-\u024F._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const ALLOWED_DOMAIN =
  /(?:^|\.)(?:example\.(?:com|org|net)|ejemplo\.com|cvexact\.(?:com|app|test)|test|myworkday\.com|greenhouse\.io|us\.greenhouse-mail\.io|hire\.lever\.co|ashbyhq\.com|workablemail\.com|smartrecruiters\.com|getonbrd\.com|computrabajo\.com)$/i;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function domainOf(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1);
}

describe("datos de demostración", () => {
  it("no contienen correos de personas reales", () => {
    const files = [
      ...ROOTS.flatMap((root) => walk(root)),
      ...EXTRA_FILES,
    ].filter((path) => TEXT_FILE.test(path));
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      for (const [email] of readFileSync(file, "utf8").matchAll(EMAIL)) {
        if (!ALLOWED_DOMAIN.test(domainOf(email))) offenders.push(`${file}: ${email}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
