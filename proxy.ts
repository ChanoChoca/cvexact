import { NextResponse, type NextRequest } from "next/server";

/**
 * El control primario del origen.
 *
 * Todo lo que limita por IP —el rate limiter de Better Auth, `enforceRateLimit`,
 * la cuota anónima— termina creyendo en `cf-connecting-ip` (ver CLIENT_IP_HEADERS
 * en frontend.yaml). Ese header es confiable sólo mientras el origen no sea
 * alcanzable salteando Cloudflare, y la allow-list del Ingress sigue pendiente de
 * esa verificación de topología (comentario en el mismo archivo). Quien llegue a
 * la IP del nodo puede escribir `cf-connecting-ip` a gusto y obtener una IP
 * distinta por request: cada límite se vuelve papel.
 *
 * Este chequeo no depende de la red: Cloudflare añade `X-Origin-Auth` con un
 * secreto compartido a través de una Transform Rule, y todo pedido que llegue
 * sin él —o sea, todo lo que no pasó por Cloudflare— responde 403. Rotar IPs ya
 * no ayuda, porque ningún request forjado entra siquiera a contar.
 *
 * Gated por entorno: sin ORIGIN_AUTH_SECRET definido el archivo deja pasar todo,
 * así que desarrollo, los tests y compose siguen igual. El orden de puesta en
 * marcha importa y está escrito dos veces más (.env.example, el Secret):
 * desplegar con la variable vacía → crear la Transform Rule → recién entonces
 * poblar el secreto.
 *
 * `/api/health` queda exento a propósito: las probes del kubelet pegan al pod
 * directo, nunca pasan por el Ingress, y sin esta excepción el readiness saca
 * el pod del Service.
 *
 * Nota de convención: en Next 16 el archivo se llama `proxy.ts` y exporta
 * `proxy` (antes era `middleware.ts`/`middleware`). Corre en el Edge runtime por
 * defecto, donde no existe `crypto.timingSafeEqual` de Node, así que la
 * comparación en tiempo constante va escrita a mano — misma garantía, sin
 * atar este archivo a un runtime.
 *
 * CORS para la extensión de navegador (Fase 4): sin `host_permissions` en el
 * manifiesto (a propósito, ver `extension/wxt.config.ts`), el `fetch` del
 * popup sólo evita el bloqueo de CORS cuando la pestaña activa ya cae dentro
 * de un permiso vigente — en la práctica, sólo si esa pestaña es
 * `cvexact.com`. En cualquier otro sitio el pedido es cross-origin normal y,
 * sin `Access-Control-Allow-Origin`, el navegador lo bloquea antes de que el
 * JS del popup vea la respuesta — confirmado contra producción, ni el
 * preflight `OPTIONS` ni el `GET` real traían ese header. `*` es seguro
 * específicamente en estas tres rutas porque las tres autentican por el
 * token Bearer de la extensión (`getApiUser`), nunca por la cookie de
 * sesión — sin `Access-Control-Allow-Credentials`, el navegador no manda
 * cookies cross-origin, así que abrir el origen no expone la sesión de
 * nadie. El resto de la API (incluida la propia `GET /applications`, que sí
 * usa la cookie) no se toca.
 */

const SECRET_HEADER = "x-origin-auth";
const HEALTH_PATH = "/api/health";

const EXTENSION_CORS_PATHS = new Set([
  "/api/tracker/applications/lookup",
  "/api/tracker/parse-html",
  "/api/tracker/applications",
]);

const EXTENSION_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

/**
 * Compara dos strings en tiempo proporcional al largo del más largo, sin cortar
 * en el primer byte distinto. Un diff temprano le daría a un atacante un oráculo
 * de prefijos para reconstruir el secreto byte a byte midiendo respuestas.
 */
function matchesSecret(provided: string, expected: string): boolean {
  const lengthDiff = provided.length ^ expected.length;
  let diff = lengthDiff;
  const longest = Math.max(provided.length, expected.length);
  for (let i = 0; i < longest; i += 1) {
    diff |= (provided.charCodeAt(i) ?? 0) ^ (expected.charCodeAt(i) ?? 0);
  }
  return diff === 0;
}

export function proxy(request: NextRequest): NextResponse {
  const expected = process.env.ORIGIN_AUTH_SECRET;

  // Sin secreto configurado no hay nada que validar: así funciona dev, así
  // corren los tests, y así arranca el despliegue antes de crear la Transform
  // Rule. No es un modo "inseguro opcional" sino el estado previo documented.
  // El chequeo de CORS de más abajo sigue corriendo igual — no depende de
  // esto, tiene que andar en dev tanto como en producción.
  if (expected && request.nextUrl.pathname !== HEALTH_PATH) {
    const provided = request.headers.get(SECRET_HEADER) ?? "";
    if (!provided || !matchesSecret(provided, expected)) {
      // El cuerpo de la respuesta es mínimo a propósito (nada que describa
      // cómo se valida), pero el log sí importa: sin esto, todo pedido que
      // no pasó por la Transform Rule de Cloudflare se rechaza sin dejar
      // rastro alguno.
      console.warn(`[proxy] rechazado sin X-Origin-Auth: ${request.method} ${request.nextUrl.pathname}`);
      return new NextResponse("Forbidden", { status: 403 });
    }
  }

  if (EXTENSION_CORS_PATHS.has(request.nextUrl.pathname)) {
    // El preflight nunca llega al route handler — el auto-OPTIONS de Next no
    // trae headers de CORS (confirmado por curl), así que corta acá mismo.
    if (request.method === "OPTIONS") {
      return new NextResponse(null, { status: 204, headers: EXTENSION_CORS_HEADERS });
    }
    const response = NextResponse.next();
    for (const [key, value] of Object.entries(EXTENSION_CORS_HEADERS)) {
      response.headers.set(key, value);
    }
    return response;
  }

  return NextResponse.next();
}

export const config = {
  // Los assets estáticos no necesitan pasar por acá: los sirve el propio pod o
  // Cloudflare, y saltárselos ahorra una comparación por chunk.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
