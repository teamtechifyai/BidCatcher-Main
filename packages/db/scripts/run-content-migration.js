/**
 * Run migration to add content column to bid_documents.
 * Execute from repo root: pnpm --filter @bid-catcher/db migrate:content
 * Or: cd packages/db && pnpm exec dotenv -e ../../.env -- node scripts/run-content-migration.js
 */
import postgres from "postgres";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }

  const sql = postgres(url);
  const migrationPath = join(__dirname, "..", "migration-ai-evaluation.sql");
  const migration = readFileSync(migrationPath, "utf-8");

  console.log("Running migration-ai-evaluation.sql (adds content column to bid_documents)...");
  await sql.unsafe(migration);
  console.log("Migration completed.");
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
