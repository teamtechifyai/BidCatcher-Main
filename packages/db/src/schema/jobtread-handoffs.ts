import { pgTable, uuid, varchar, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { bids } from "./bids";

/**
 * JobTread Handoff Status
 * - mocked_success: Dry-run completed successfully
 * - blocked: Bid not eligible (not GO status)
 * - error: Something went wrong during handoff prep
 */
export const HANDOFF_STATUS = {
  MOCKED_SUCCESS: "mocked_success",
  BLOCKED: "blocked",
  ERROR: "error",
} as const;

/**
 * JobTread Handoffs table
 *
 * Records every handoff attempt (dry-run) to JobTread.
 * Never overwrites - append only for full audit trail.
 */
export const jobtreadHandoffs = pgTable(
  "jobtread_handoffs",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Reference to the bid being handed off */
    bidId: uuid("bid_id")
      .notNull()
      .references(() => bids.id, { onDelete: "cascade" }),

    /**
     * Handoff status
     * Values: mocked_success, blocked, error
     */
    status: varchar("status", { length: 50 }).notNull(),

    /**
     * Complete payload that WOULD be sent to JobTread
     * Includes all mapped fields and document references
     */
    payloadSnapshot: jsonb("payload_snapshot").notNull(),

    /**
     * Mock JobTread project ID (format: mock-<uuid>)
     * Only populated on successful dry-run
     */
    mockJobtreadId: varchar("mock_jobtread_id", { length: 100 }),

    /**
     * Simulated document attachments
     * Array of { filename, storagePath, contentType }
     */
    documentAttachments: jsonb("document_attachments"),

    /**
     * Error message if handoff failed
     */
    errorMessage: text("error_message"),

    /**
     * Who initiated the handoff (for audit)
     */
    initiatedBy: varchar("initiated_by", { length: 255 }),

    /** Version for re-handoff attempts */
    handoffVersion: varchar("handoff_version", { length: 20 }).default("1"),

    // ----- Timestamps -----
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    bidIdIdx: index("jobtread_handoffs_bid_id_idx").on(table.bidId),
    statusIdx: index("jobtread_handoffs_status_idx").on(table.status),
    mockJobtreadIdIdx: index("jobtread_handoffs_mock_jobtread_id_idx").on(table.mockJobtreadId),
  })
);

export type JobtreadHandoff = typeof jobtreadHandoffs.$inferSelect;
export type NewJobtreadHandoff = typeof jobtreadHandoffs.$inferInsert;


