import { pgTable, uuid, varchar, text, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * Clients table
 *
 * Each client represents a construction company using Bid Catcher.
 * Client configuration is stored as JSONB for flexibility.
 */
export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),

  /** Company name */
  name: varchar("name", { length: 255 }).notNull(),

  /** Unique slug for URLs and references */
  slug: varchar("slug", { length: 100 }).notNull().unique(),

  /** Primary contact email */
  contactEmail: varchar("contact_email", { length: 255 }).notNull(),

  /** Primary contact name */
  contactName: varchar("contact_name", { length: 255 }),

  /** Company phone */
  phone: varchar("phone", { length: 50 }),

  /** Whether client is active */
  active: boolean("active").notNull().default(true),

  /**
   * Client configuration (ClientConfig type from @bid-catcher/config)
   * Stores intake fields, PDF signals, scoring weights, JobTread mappings
   */
  config: jsonb("config"),

  /** Internal notes about this client */
  notes: text("notes"),

  /** GHL contact ID for sync (GoHighLevel) */
  ghlContactId: varchar("ghl_contact_id", { length: 100 }),

  // ----- Timestamps -----
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Client = typeof clients.$inferSelect;
export type NewClient = typeof clients.$inferInsert;


