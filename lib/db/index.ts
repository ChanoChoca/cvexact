import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * The database is optional in development. Without DATABASE_URL the app still
 * runs: BYOK generation needs no server state, and the quota counter falls back
 * to an in-memory store (see lib/quota.ts). In production DATABASE_URL is set
 * by docker-compose and this is the only path.
 */

export const databaseConfigured = Boolean(process.env.DATABASE_URL);

declare global {
  // Reused across hot reloads so dev does not exhaust Postgres connections.
  var __cvexactPool: Pool | undefined;
}

function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Guard with `databaseConfigured` first.");
  }
  globalThis.__cvexactPool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
  });
  return globalThis.__cvexactPool;
}

let cached: ReturnType<typeof drizzle<typeof schema>> | null = null;

/** Throws when DATABASE_URL is unset — check `databaseConfigured` first. */
export function getDb() {
  cached ??= drizzle(getPool(), { schema });
  return cached;
}

export { schema };
