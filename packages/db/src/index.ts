/**
 * @bid-catcher/db
 *
 * Database client and schema exports for the Bid Catcher system.
 * Uses Drizzle ORM with PostgreSQL (Supabase-compatible).
 */

// Re-export drizzle-orm utilities for convenience
export { eq, and, or, not, desc, asc, sql, inArray, isNull, isNotNull } from "drizzle-orm";

export * from "./client.js";
export * from "./schema/index.js";

