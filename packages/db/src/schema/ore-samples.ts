import { pgTable, uuid, varchar, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { clients } from "./clients.js";
import { bids } from "./bids.js";

/**
 * Ore Samples table (Criteria Trainer)
 *
 * Reference bids used to train/calibrate qualification criteria.
 * Clients upload past bids into three buckets: No, Maybe, Yes.
 * AI analyzes patterns across samples to propose scoring rules.
 */
export const oreSamples = pgTable(
  "ore_samples",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Client this sample belongs to */
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),

    /** Reference to the bid (must belong to same client) */
    bidId: uuid("bid_id")
      .notNull()
      .references(() => bids.id, { onDelete: "cascade" }),

    /**
     * Classification outcome
     * Values: GO (Yes), MAYBE (Yes with caveats), NO
     */
    outcome: varchar("outcome", { length: 20 }).notNull(),

    /** Reason for this classification (required for training) */
    reason: text("reason").notNull(),

    /** Optional notes or caveats (e.g. for MAYBE) */
    notes: text("notes"),

    /** Who added this sample (user/email) */
    addedBy: varchar("added_by", { length: 255 }),

    // ----- Timestamps -----
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clientIdIdx: index("ore_samples_client_id_idx").on(table.clientId),
    outcomeIdx: index("ore_samples_outcome_idx").on(table.outcome),
    /** One bid can only be in one bucket per client */
    clientBidUnique: uniqueIndex("ore_samples_client_bid_unique").on(table.clientId, table.bidId),
  })
);

export type OreSample = typeof oreSamples.$inferSelect;
export type NewOreSample = typeof oreSamples.$inferInsert;
