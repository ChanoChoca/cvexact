import { describe, expect, it } from "vitest";
import { cvHasMetric, pickMetricsRole } from "@/lib/cv/metrics-role";
import { cvDocumentSchema, type CVDocument } from "@/lib/schemas/cv";
import { profileSchema, type Profile } from "@/lib/schemas/profile";

/**
 * Qué puesto elegir para preguntarle números, cuando el CV generado salió sin
 * ninguno.
 *
 * Ni "el que más pesó en el CV" ni "el más reciente" alcanzan solos: el primero
 * puede desenterrar un puesto de hace años y dejar afuera el actual —que es
 * justo lo primero que lee RRHH—, y el segundo puede interrumpir por un puesto
 * de dos meses con un solo logro mientras uno más rico espera su turno. Este
 * archivo fija el equilibrio elegido: el peso manda, pero se descuenta según la
 * antigüedad del puesto, así que un actual liviano sólo pierde contra uno viejo
 * bastante más pesado.
 */

/** Fecha de referencia fija, para que la antigüedad de cada caso no dependa de cuándo corre el test. */
const now = new Date(2030, 0, 1);

/** N bullets de relleno, cada uno único. */
function bullets(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `Logré la cosa ${i + 1}.`);
}

function role(overrides: {
  id: string;
  company: string;
  current?: boolean;
  end?: string;
  bullets?: string[];
}) {
  return {
    role: "Puesto",
    start: "",
    end: "",
    current: false,
    bullets: [],
    tags: [],
    ...overrides,
  };
}

function profileWith(experience: ReturnType<typeof role>[]): Profile {
  return profileSchema.parse({ fullName: "Test", experience });
}

/** Un CV de un solo bloque de experiencia, un ítem por empresa en `items`. */
function cv(items: Array<{ company: string; bullets: string[] }>): CVDocument {
  return cvDocumentSchema.parse({
    language: "es",
    header: { fullName: "Test", location: "Rosario, Argentina" },
    summary: "Resumen de prueba.",
    sections: [
      {
        kind: "experience",
        title: "EXPERIENCIA",
        items: items.map((item) => ({
          company: item.company,
          role: "Puesto",
          location: "Rosario, Argentina",
          dateRange: "2020 – 2024",
          bullets: item.bullets,
        })),
      },
    ],
    coverage: { requirements: [], omitted: [] },
  });
}

describe("pickMetricsRole", () => {
  it("un actual liviano gana si la diferencia de peso es chica", () => {
    // 3 × 1.00 (actual) > 5 × 0.50 (terminó hace más de 5 años).
    const profile = profileWith([
      role({ id: "a", company: "Actual Inc", current: true, bullets: bullets(3) }),
      role({ id: "b", company: "Vieja SA", end: "Enero 2023", bullets: bullets(5) }),
    ]);
    const doc = cv([
      { company: "Actual Inc", bullets: bullets(3) },
      { company: "Vieja SA", bullets: bullets(5) },
    ]);
    expect(pickMetricsRole(doc, profile, now)).toBe(0);
  });

  it("un viejo con mucho más peso le gana al actual", () => {
    // 2 × 1.00 (actual) < 6 × 0.50 (terminó hace más de 5 años).
    const profile = profileWith([
      role({ id: "a", company: "Actual Inc", current: true, bullets: bullets(2) }),
      role({ id: "b", company: "Vieja SA", end: "Enero 2023", bullets: bullets(6) }),
    ]);
    const doc = cv([
      { company: "Actual Inc", bullets: bullets(2) },
      { company: "Vieja SA", bullets: bullets(6) },
    ]);
    expect(pickMetricsRole(doc, profile, now)).toBe(1);
  });

  it("compara el nombre de la empresa sin acentos ni mayúsculas", () => {
    const profile = profileWith([
      role({ id: "a", company: "Compañía Andina", current: true, bullets: bullets(2) }),
    ]);
    const doc = cv([{ company: "COMPANIA ANDINA", bullets: bullets(2) }]);
    expect(pickMetricsRole(doc, profile, now)).toBe(0);
  });

  it("un puesto que el CV no usó no es candidato, aunque sea el actual", () => {
    const profile = profileWith([
      role({ id: "a", company: "Actual Inc", current: true, bullets: bullets(3) }),
      role({ id: "b", company: "Vieja SA", end: "Enero 2023", bullets: bullets(3) }),
    ]);
    // El CV sólo se apoyó en el puesto viejo.
    const doc = cv([{ company: "Vieja SA", bullets: bullets(3) }]);
    expect(pickMetricsRole(doc, profile, now)).toBe(1);
  });

  it("no descarta un puesto ya preguntado: eso lo decide el motor de faltantes, no esta función", () => {
    // Ganaría por score de cualquier forma: es el actual y pesa más. Si ya no
    // le queda nada por preguntar, es `eligibleGaps` (con `only`) quien lo
    // sabe — el llamador filtra por eso después de recibir este índice.
    const done = bullets(5);
    const profile = profileWith([
      role({ id: "a", company: "Actual Inc", current: true, bullets: done }),
      role({ id: "b", company: "Vieja SA", end: "Enero 2023", bullets: bullets(2) }),
    ]);
    const doc = cv([
      { company: "Actual Inc", bullets: done },
      { company: "Vieja SA", bullets: bullets(2) },
    ]);
    expect(pickMetricsRole(doc, profile, now)).toBe(0);
  });

  it("sin fecha legible el puesto no pierde contra uno viejo, pero tampoco le gana a uno actual", () => {
    const undatedVsOld = profileWith([
      role({ id: "u", company: "Sin Fecha SRL", end: "", bullets: bullets(3) }),
      role({ id: "o", company: "Vieja SA", end: "Enero 2023", bullets: bullets(3) }),
    ]);
    const docVsOld = cv([
      { company: "Sin Fecha SRL", bullets: bullets(3) },
      { company: "Vieja SA", bullets: bullets(3) },
    ]);
    expect(pickMetricsRole(docVsOld, undatedVsOld, now)).toBe(0);

    const undatedVsCurrent = profileWith([
      role({ id: "u", company: "Sin Fecha SRL", end: "", bullets: bullets(3) }),
      role({ id: "c", company: "Actual Inc", current: true, bullets: bullets(3) }),
    ]);
    const docVsCurrent = cv([
      { company: "Sin Fecha SRL", bullets: bullets(3) },
      { company: "Actual Inc", bullets: bullets(3) },
    ]);
    expect(pickMetricsRole(docVsCurrent, undatedVsCurrent, now)).toBe(1);
  });

  it("perfil de un solo puesto: sale igual aunque el modelo haya traducido la empresa", () => {
    // El modelo tradujo el nombre, así que no hay coincidencia por peso — pero
    // con un solo puesto en el perfil, la pregunta no puede ir a ningún otro lado.
    const profile = profileWith([
      role({ id: "a", company: "Talleres Digitales SRL", bullets: ["Único bullet."] }),
    ]);
    const doc = cv([{ company: "Digital Workshops LLC", bullets: bullets(2) }]);
    expect(pickMetricsRole(doc, profile, now)).toBe(0);
  });

  it("el mismo caso con dos puestos en el perfil no tiene a quién asignárselo", () => {
    const profile = profileWith([
      role({ id: "a", company: "Talleres Digitales SRL", bullets: ["Único bullet."] }),
      role({ id: "b", company: "Otro Trabajo", bullets: ["Otro bullet."] }),
    ]);
    const doc = cv([{ company: "Digital Workshops LLC", bullets: bullets(2) }]);
    expect(pickMetricsRole(doc, profile, now)).toBeNull();
  });
});

describe("cvHasMetric", () => {
  it("un porcentaje cuenta como cifra", () => {
    const doc = cv([{ company: "X", bullets: ["Mejoré el rendimiento un 35%."] }]);
    expect(cvHasMetric(doc)).toBe(true);
  });

  it("un número de dos o más dígitos cuenta como cifra", () => {
    const doc = cv([{ company: "X", bullets: ["Atendí a 120 clientes por semana."] }]);
    expect(cvHasMetric(doc)).toBe(true);
  });

  it("un dígito suelto no cuenta como cifra", () => {
    const doc = cv([{ company: "X", bullets: ["Trabajé 8 horas por turno."] }]);
    expect(cvHasMetric(doc)).toBe(false);
  });

  it("prosa sin números no tiene cifra", () => {
    const doc = cv([{ company: "X", bullets: ["Atendí al público y manejé la caja."] }]);
    expect(cvHasMetric(doc)).toBe(false);
  });
});
