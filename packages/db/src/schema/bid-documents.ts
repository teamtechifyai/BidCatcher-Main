import { pgTable, uuid, varchar, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { bids } from "./bids.js";

/**
 * Bid Documents table
 *
 * Stores metadata about documents attached to bids.
 * Actual file content stored in object storage (future).
 */
export const bidDocuments = pgTable(
  "bid_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Reference to the parent bid */
    bidId: uuid("bid_id")
      .notNull()
      .references(() => bids.id, { onDelete: "cascade" }),

    /** Original filename */
    filename: varchar("filename", { length: 500 }).notNull(),

    /** MIME type */
    contentType: varchar("content_type", { length: 100 }).notNull(),

    /** File size in bytes */
    sizeBytes: integer("size_bytes"),

    /**
     * Document type classification
     * Values: bid_invitation, plans, specifications, addendum, other
     */
    documentType: varchar("document_type", { length: 50 }).notNull().default("other"),

    /**
     * Storage path or URL
     * For MVP: could be local path or base64 in DB (not recommended for prod)
     */
    storagePath: text("storage_path"),

    /**
     * Base64 encoded document content
     * For MVP only - should use object storage in production
     */
    content: text("content"),

    /** SHA-256 hash of file content for integrity/dedup */
    contentHash: varchar("content_hash", { length: 64 }),

    /**
     * Processing status for PDF extraction
     * Values: pending, processing, completed, failed, skipped
     */
    processingStatus: varchar("processing_status", { length: 50 }).notNull().default("pending"),

    /** Error message if processing failed */
    processingError: text("processing_error"),

    /** When processing started */
    processedAt: timestamp("processed_at", { withTimezone: true }),

    // ----- Timestamps -----
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    bidIdIdx: index("bid_documents_bid_id_idx").on(table.bidId),
    processingStatusIdx: index("bid_documents_processing_status_idx").on(table.processingStatus),
  })
);

export type BidDocument = typeof bidDocuments.$inferSelect;
export type NewBidDocument = typeof bidDocuments.$inferInsert;

