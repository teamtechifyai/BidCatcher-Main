import { pgTable, uuid, varchar, text, timestamp, jsonb, index, boolean } from "drizzle-orm/pg-core";
import { bids } from "./bids";

/**
 * Incoming Bid Emails table
 *
 * Tracks emails received at the bid intake Gmail address.
 * Only emails with "Bid" in the subject line are processed.
 * Each email can be linked to a bid once processed.
 */
export const incomingBidEmails = pgTable(
  "incoming_bid_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Gmail message ID for deduplication */
    gmailMessageId: varchar("gmail_message_id", { length: 255 }).unique(),

    /** Email sender address */
    fromEmail: varchar("from_email", { length: 255 }).notNull(),

    /** Email sender name */
    fromName: varchar("from_name", { length: 255 }),

    /** Email subject line */
    subject: varchar("subject", { length: 1000 }).notNull(),

    /** Email body (plain text) */
    bodyText: text("body_text"),

    /** Email body (HTML) */
    bodyHtml: text("body_html"),

    /** When the email was received by Gmail */
    emailReceivedAt: timestamp("email_received_at", { withTimezone: true }).notNull(),

    /** Whether this email has been processed into a bid */
    processed: boolean("processed").notNull().default(false),

    /** Reference to the bid created from this email (if processed) */
    bidId: uuid("bid_id").references(() => bids.id, { onDelete: "set null" }),

    /** Processing status: pending, processing, completed, failed, skipped */
    processingStatus: varchar("processing_status", { length: 50 }).notNull().default("pending"),

    /** Error message if processing failed */
    processingError: text("processing_error"),

    /** When the email was processed */
    processedAt: timestamp("processed_at", { withTimezone: true }),

    /**
     * Attachment metadata
     * Array of: { filename, contentType, size, storageKey }
     */
    attachments: jsonb("attachments"),

    /** Raw email data from Gmail API for debugging */
    rawEmailData: jsonb("raw_email_data"),

    // ----- Timestamps -----
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Indexes for common queries
    fromEmailIdx: index("incoming_bid_emails_from_email_idx").on(table.fromEmail),
    processedIdx: index("incoming_bid_emails_processed_idx").on(table.processed),
    emailReceivedAtIdx: index("incoming_bid_emails_received_at_idx").on(table.emailReceivedAt),
    processingStatusIdx: index("incoming_bid_emails_processing_status_idx").on(table.processingStatus),
    bidIdIdx: index("incoming_bid_emails_bid_id_idx").on(table.bidId),
  })
);

export type IncomingBidEmail = typeof incomingBidEmails.$inferSelect;
export type NewIncomingBidEmail = typeof incomingBidEmails.$inferInsert;
