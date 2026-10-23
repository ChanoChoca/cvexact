/**
 * Helpers de extracción por regex compartidos entre las reglas de sitio (y
 * la capa de microdata) — balancean tags para poder recortar un elemento
 * completo con hijos anidados, sin sumar un parser de DOM.
 */

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Desde el índice de un tag de apertura, cuenta aperturas/cierres del mismo
 * tag hasta balancear, y devuelve el HTML completo del elemento. Hace falta
 * para elementos con HTML anidado (una descripción, un contenedor) — una
 * regex sola no sabe dónde termina.
 */
export function sliceElement(html: string, startIndex: number, tagName: string): string {
  const tokenRe = new RegExp(`<${tagName}(?:\\s[^>]*)?>|</${tagName}>`, "gi");
  tokenRe.lastIndex = startIndex;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(html))) {
    if (match[0].startsWith("</")) {
      depth--;
      if (depth === 0) return html.slice(startIndex, match.index + match[0].length);
    } else {
      depth++;
    }
  }
  return html.slice(startIndex);
}

/** El primer elemento cuya etiqueta de apertura tiene `attr="value"` exacto. */
export function extractElementByAttr(html: string, attr: string, value: string): string | null {
  const re = new RegExp(`<(\\w+)[^>]*\\b${attr}="${escapeRegExp(value)}"[^>]*>`, "i");
  const match = re.exec(html);
  if (!match) return null;
  return sliceElement(html, match.index, match[1]);
}

/**
 * Como `extractElementByAttr`, pero de prefijo — para valores con un sufijo
 * que cambia (un id con el id numérico del aviso pegado atrás, p. ej.
 * `jd-job-title-1005696021315` en Glassdoor).
 */
export function extractElementByAttrPrefix(html: string, attr: string, valuePrefix: string): string | null {
  const re = new RegExp(`<(\\w+)[^>]*\\b${attr}="${escapeRegExp(valuePrefix)}[^"]*"[^>]*>`, "i");
  const match = re.exec(html);
  if (!match) return null;
  return sliceElement(html, match.index, match[1]);
}

export function extractElementById(html: string, id: string): string | null {
  return extractElementByAttr(html, "id", id);
}

/** El primer elemento cuyo atributo `class` incluye ese token exacto. */
export function extractElementByClass(html: string, className: string): string | null {
  const re = new RegExp(`<(\\w+)[^>]*\\bclass="[^"]*\\b${escapeRegExp(className)}\\b[^"]*"[^>]*>`, "i");
  const match = re.exec(html);
  if (!match) return null;
  return sliceElement(html, match.index, match[1]);
}

/**
 * Como `extractElementByClass`, pero de prefijo — para CSS-modules con hash
 * de build pegado al nombre de la clase (`JobDetails_jobDescription__uW_fK`
 * en Glassdoor, donde el sufijo cambia en cada deploy de ellos).
 */
export function extractElementByClassPrefix(html: string, classPrefix: string): string | null {
  const re = new RegExp(`<(\\w+)[^>]*\\bclass="[^"]*\\b${escapeRegExp(classPrefix)}[^\\s"]*[^"]*"[^>]*>`, "i");
  const match = re.exec(html);
  if (!match) return null;
  return sliceElement(html, match.index, match[1]);
}
