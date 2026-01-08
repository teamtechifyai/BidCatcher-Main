import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

/**
 * Creates a database client instance
 * Uses postgres.js driver for best performance with Supabase
 */
export function createDbClient(connectionString: string) {
  const queryClient = postgres(connectionString, {
    max: 10, // Connection pool size
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return drizzle(queryClient, { schema });
}

export type DbClient = ReturnType<typeof createDbClient>;

// Singleton for app-wide usage (initialized by API)
let _db: DbClient | null = null;

export function initializeDb(connectionString: string): DbClient {
  if (_db) {
    console.warn("Database already initialized, returning existing instance");
    return _db;
  }
  _db = createDbClient(connectionString);
  return _db;
}

export function getDb(): DbClient {
  if (!_db) {
    throw new Error("Database not initialized. Call initializeDb() first.");
  }
  return _db;
}

