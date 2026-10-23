import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { operator } from "@/lib/legal/operator";

/**
 * El import por URL es un fetch puntual disparado por el usuario sobre una
 * URL que él mismo proveyó — no un crawler, no un proxy de propósito
 * general. Pero es exactamente la forma de un SSRF: sin nada de esto, un
 * usuario podría pedirle a nuestro servidor que le pegue a
 * `http://169.254.169.254/latest/meta-data` o a un servicio interno del
 * clúster y leer la respuesta. Esta capa es la que lo impide.
 */

export class UnsafeUrlError extends Error {}

const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 10_000;

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true; // incluye el metadata service de la nube
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80:")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local, fc00::/7
  if (lower.startsWith("::ffff:")) {
    const v4 = lower.split(":").pop();
    if (v4?.includes(".")) return isPrivateIPv4(v4);
  }
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateIPv4(ip);
  if (version === 6) return isPrivateIPv6(ip);
  return true; // no es una IP válida — no confiar
}

/** Valida el esquema, credenciales embebidas, y resuelve el DNS para
 *  comprobar que ninguna dirección resuelta es privada. No es inmune a un
 *  DNS rebinding perfectamente cronometrado entre esta resolución y el
 *  fetch real — mitigarlo del todo pide fijar la IP en la conexión, más
 *  esfuerzo del que pide una herramienta de uso personal — pero corta el
 *  99% de los casos: localhost, IPs privadas literales, el metadata service
 *  de cualquier nube. */
async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError("La URL no es válida.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("Sólo se admiten URLs http o https.");
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError("La URL no puede llevar usuario o contraseña.");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (hostname === "localhost") throw new UnsafeUrlError("No se admite localhost.");

  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new UnsafeUrlError("Esa dirección no es un destino válido.");
    return url;
  }

  const records = await lookup(hostname, { all: true }).catch(() => []);
  if (records.length === 0) throw new UnsafeUrlError("No pudimos resolver ese dominio.");
  if (records.some((r) => isPrivateAddress(r.address))) {
    throw new UnsafeUrlError("Ese dominio resuelve a una dirección privada.");
  }
  return url;
}

function userAgent(): string {
  const email = operator().email;
  const contact = email && !email.startsWith("[pendiente") ? `mailto:${email}` : "sin contacto configurado";
  return `cvexact-tracker-bot/1.0 (+${contact}; fetch puntual iniciado por un usuario, no un crawler)`;
}

/**
 * Descarga el HTML de un aviso. Timeout de 10 s, sin reintentos, hasta 3
 * redirecciones (cada una revalidada contra el mismo chequeo de SSRF), y un
 * tope de 3 MiB leído en streaming — una página de aviso normal no se
 * acerca, y esto es lo que evita que una URL maliciosa haga que el proceso
 * se quede leyendo un cuerpo interminable.
 */
export async function fetchJobPostingHtml(rawUrl: string): Promise<string> {
  let current = await assertPublicUrl(rawUrl);

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "user-agent": userAgent(), accept: "text/html" },
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("El sitio redirigió sin indicar destino.");
      current = await assertPublicUrl(new URL(location, current).toString());
      continue;
    }

    if (!response.ok) throw new Error(`El sitio respondió ${response.status}.`);

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("html")) throw new Error("Esa URL no devolvió una página HTML.");

    return await readCapped(response, MAX_BODY_BYTES);
  }

  throw new Error("Demasiadas redirecciones.");
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("La página es demasiado grande.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf-8");
}
