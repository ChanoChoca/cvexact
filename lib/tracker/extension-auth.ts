import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getSessionUser, type SessionUser } from "@/lib/auth";

/**
 * El token de la extensión de navegador (Fase 4) — ver el comentario de
 * `extensionToken` en `lib/db/schema.ts` para por qué no reutiliza la
 * cookie de sesión.
 */

const TOKEN_PREFIX = "cvt_";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Genera uno nuevo y pisa el anterior si existía — un token por cuenta,
 *  generar de nuevo es la forma de rotarlo. Devuelve el valor crudo, la
 *  única vez que existe fuera de este proceso. */
export async function generateExtensionToken(userId: string): Promise<string> {
  const raw = `${TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`;
  await getDb()
    .insert(schema.extensionToken)
    .values({ id: randomUUID(), userId, tokenHash: hashToken(raw) })
    .onConflictDoUpdate({
      target: schema.extensionToken.userId,
      set: { tokenHash: hashToken(raw), createdAt: new Date(), lastUsedAt: null },
    });
  return raw;
}

export async function revokeExtensionToken(userId: string): Promise<void> {
  await getDb().delete(schema.extensionToken).where(eq(schema.extensionToken.userId, userId));
}

export async function hasExtensionToken(userId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: schema.extensionToken.id })
    .from(schema.extensionToken)
    .where(eq(schema.extensionToken.userId, userId))
    .limit(1);
  return Boolean(row);
}

/** Verifica un token y trae el usuario dueño, con la misma forma que
 *  `SessionUser` — así `getApiUser` (más abajo) es intercambiable con
 *  `getSessionUser` para cualquier route que ya haga
 *  `requireVerifiedEmail(user)` sobre el resultado. */
async function verifyExtensionToken(token: string): Promise<SessionUser | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;

  const db = getDb();
  const [row] = await db
    .select({ userId: schema.extensionToken.userId })
    .from(schema.extensionToken)
    .where(eq(schema.extensionToken.tokenHash, hashToken(token)))
    .limit(1);
  if (!row) return null;

  const [user] = await db
    .select({ id: schema.user.id, email: schema.user.email, name: schema.user.name, emailVerified: schema.user.emailVerified })
    .from(schema.user)
    .where(eq(schema.user.id, row.userId))
    .limit(1);
  if (!user) return null;

  // Best-effort — no bloquea la request si falla, y no hace falta esperarla.
  void db
    .update(schema.extensionToken)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.extensionToken.userId, row.userId))
    .catch(() => {});

  return user;
}

/**
 * Sesión web o token de extensión, lo que haya — probar la cookie primero
 * porque es el camino de todo el resto de la app y no vale la pena el
 * viaje a la base por el token si ya hay sesión. Las routes que la
 * extensión necesita usar (`applications`, `applications/lookup`,
 * `parse-html`) llaman a esto en vez de `getSessionUser` directo; el resto
 * del tracker no cambia.
 */
export async function getApiUser(headers: Headers): Promise<SessionUser | null> {
  const sessionUser = await getSessionUser(headers);
  if (sessionUser) return sessionUser;

  const auth = headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return verifyExtensionToken(auth.slice("Bearer ".length).trim());
}
