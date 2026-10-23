// Runs migrations via drizzle-orm's migrate() directly instead of the
// `drizzle-kit migrate` CLI, whose MigrateProgress renderer swallows the
// error message on failure and exits 1 with no output (fixed upstream in
// 1.0.0-beta.22, never backported to the 0.x line this project pins).
// See: https://github.com/drizzle-team/drizzle-orm/issues/5816
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

try {
  await migrate(db, { migrationsFolder: "./lib/db/migrations" });
  console.log("Migrations applied.");
} catch (err) {
  console.error("Migration failed:", err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
