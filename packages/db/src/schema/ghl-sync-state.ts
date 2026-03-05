import { pgTable, uuid, varchar, timestamp, index } from "drizzle-orm/pg-core";

/**
 * GHL Sync State table
 *
 * Tracks last sync timestamps to avoid webhook-triggered push loops.
 * When last_sync_source is 'ghl', we skip pushing to GHL on the next change.
 */
export const ghlSyncState = pgTable(
  "ghl_sync_state",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Entity type: client or bid */
    entityType: varchar("entity_type", { length: 20 }).notNull(),

    /** BidCatcher entity UUID */
    entityId: uuid("entity_id").notNull(),

    /** GHL contact or opportunity ID */
    ghlId: varchar("ghl_id", { length: 100 }).notNull(),

    /** When last synced */
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull().defaultNow(),

    /** Source of last change: bidcatcher or ghl */
    lastSyncSource: varchar("last_sync_source", { length: 20 }).notNull(),

    // ----- Timestamps -----
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    entityIdx: index("ghl_sync_state_entity_idx").on(table.entityType, table.entityId),
    ghlIdIdx: index("ghl_sync_state_ghl_id_idx").on(table.ghlId),
  })
);

export type GhlSyncState = typeof ghlSyncState.$inferSelect;
export type NewGhlSyncState = typeof ghlSyncState.$inferInsert;
