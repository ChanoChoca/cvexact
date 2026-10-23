/**
 * Fuente de color de las escenas.
 *
 * Espeja los tokens Solar del bloque `@theme` de `app/globals.css`, que sigue
 * siendo la fuente de verdad: si un token cambia allá, cambia acá. Son strings
 * planos y no `var(--color-solar-*)` porque las escenas pintan por estilos
 * inline, atributos SVG y primitivas de filtro (`feDropShadow floodColor`),
 * donde `var()` no es confiable.
 *
 * Existe porque las nueve escenas se portaron de una maqueta sobre fondo claro,
 * cada una con su paleta hardcodeada en su cabecera, y ninguna estaba atada a la
 * web. Un solo módulo evita que vuelvan a derivar.
 *
 * Sobre superficie clara vs. oscura: varias escenas dibujan papel blanco sobre
 * `bg`. Un mismo acento no sirve en las dos — `g1` sobre blanco da 1.6:1. Para
 * esos casos está `oro`, el mismo matiz en la variante que sí lee sobre papel.
 */
export const SOLAR = {
  bg: "#01020c",
  ink: "#ffffff",
  link: "#cfc9dd",
  muted: "#a49eb6",
  muted2: "#7f7994",
  label: "#5f5a74",
  g1: "#e9b57e",
  g3: "#b166d8",
  g4: "#7f66f0",
  /** `--color-oro`: la variante de `g1` que sí lee sobre papel blanco (5.3:1). */
  oro: "#8a5d17",
} as const;

/**
 * Un solo verde para "verificado / cubierto / completado".
 *
 * Las tres escenas de «Verificado contra tu perfil» traían tres verdes casi
 * iguales (`#1f9d63`, `#2E9E6B`, `#16a06a`) que las hacían ver como de productos
 * distintos. El verde se conserva en vez de entrar a la paleta porque acá es
 * semántico: significa el ✓, que es de lo que trata la sección.
 */
export const OK = "#1f9d63";

/** `"#rrggbb"` + alfa → `"rgba(...)"`. */
export const hexA = (h: string, a: number) => {
  const n = parseInt(h.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};
