import { pgTable, uuid, varchar, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { clients } from "./clients.js";

/**
 * Bids table
 *
 * Core entity representing a bid invitation received through any intake channel.
 * Each bid is associated with a client and tracks its lifecycle status.
 */
export const bids = pgTable(
  "bids",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Reference to the client this bid belongs to */
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),

    /**
     * Intake source: 'web' or 'email'
     * Used for traceability and analytics
     */
    intakeSource: varchar("intake_source", { length: 20 }).notNull(),

    /**
     * Current status in the workflow
     * Values: new, in_review, qualified, rejected
     */
    status: varchar("status", { length: 50 }).notNull().default("new"),

    /** Project name (from intake or extraction) */
    projectName: varchar("project_name", { length: 500 }),

    /** Sender email address */
    senderEmail: varchar("sender_email", { length: 255 }),

    /** Sender name */
    senderName: varchar("sender_name", { length: 255 }),

    /** Sender company */
    senderCompany: varchar("sender_company", { length: 255 }),

    /** Subject line (for email intake) */
    emailSubject: varchar("email_subject", { length: 1000 }),

    /** Email body text (for email intake) */
    emailBody: text("email_body"),

    /** Raw intake payload - stored exactly as received for traceability */
    rawPayload: jsonb("raw_payload"),

    /** Unique external reference (e.g., email message ID) for deduplication */
    externalRef: varchar("external_ref", { length: 500 }).unique(),

    /**
     * Validation warnings from intake
     * Stores missing required fields and other non-fatal issues
     */
    validationWarnings: jsonb("validation_warnings"),

    /** When the bid was received by the system */
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),

    /** GHL opportunity ID for sync (GoHighLevel) */
    ghlOpportunityId: varchar("ghl_opportunity_id", { length: 100 }),

    // ----- Timestamps -----
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Indexes for common queries
    clientIdIdx: index("bids_client_id_idx").on(table.clientId),
    statusIdx: index("bids_status_idx").on(table.status),
    receivedAtIdx: index("bids_received_at_idx").on(table.receivedAt),
  })
);

export type Bid = typeof bids.$inferSelect;
export type NewBid = typeof bids.$inferInsert;

