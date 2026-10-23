import type { ImportedJobFields } from "../jsonld";
import { extractComputrabajo } from "./computrabajo";
import { extractGlassdoor } from "./glassdoor";
import { extractIndeed } from "./indeed";
import { extractLinkedIn } from "./linkedin";

/**
 * Tercera capa de `extractJobPosting` (después de JSON-LD y microdata),
 * antes del fallback genérico — para sitios que no traen datos
 * estructurados pero sí un DOM predecible. Un sitio nuevo se suma acá, no en
 * `jsonld.ts`.
 */
export function extractWithSiteRule(html: string, url: string): ImportedJobFields | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return null;
  }

  if (hostname.endsWith("linkedin.com")) return extractLinkedIn(html, url);
  if (hostname.endsWith("indeed.com")) return extractIndeed(html);
  if (hostname.includes("glassdoor.")) return extractGlassdoor(html);
  if (hostname.includes("computrabajo.")) return extractComputrabajo(html, url);
  return null;
}
