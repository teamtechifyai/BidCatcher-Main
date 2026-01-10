import { pgTable, uuid, varchar, text, real, integer, timestamp, index, unique, jsonb } from "drizzle-orm/pg-core";
import { bidDocuments } from "./bid-documents.js";
import { bids } from "./bids.js";

/**
 * Extracted Fields table
 *
 * IMPORTANT: Extracted data is NEVER overwritten. Each extraction creates a new record.
 * This ensures full audit trail and allows comparison across extraction attempts.
 *
 * Fields are extracted from PDF documents by the pdf-assist service.
 */
export const extractedFields = pgTable(
  "extracted_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Reference to the source document */
    documentId: uuid("document_id")
      .notNull()
      .references(() => bidDocuments.id, { onDelete: "cascade" }),

    /** Denormalized reference to bid for easier querying */
    bidId: uuid("bid_id")
      .notNull()
      .references(() => bids.id, { onDelete: "cascade" }),

    /**
     * Signal identifier (matches client config signals)
     * e.g., 'project_name', 'bid_due_date', 'bond_required'
     */
    signalId: varchar("signal_id", { length: 100 }).notNull(),

    /** Extracted value as string (normalized) */
    extractedValue: text("extracted_value"),

    /** Raw value before normalization (for debugging) */
    rawValue: text("raw_value"),

    /**
     * Confidence score from extraction (0.0 to 1.0)
     * Higher = more confident in accuracy
     */
    confidence: real("confidence"),

    /**
     * Extraction method used
     * Values: text_match, regex, llm, ocr, manual
     */
    extractionMethod: varchar("extraction_method", { length: 50 }),

    /** Page number where field was found (1-indexed) */
    pageNumber: integer("page_number"),

    /**
     * Extraction version/attempt number
     * Increments if document is re-processed (never overwrites)
     */
    extractionVersion: integer("extraction_version").notNull().default(1),

    /** Source location in document (for highlighting) - legacy */
    sourceLocation: text("source_location"),

    /** The exact quoted text from the document */
    citationText: text("citation_text"),

    /** Surrounding context (paragraph or sentence) */
    citationContext: text("citation_context"),

    /** PDF bounding box coordinates: {x, y, width, height, page} */
    boundingBox: jsonb("bounding_box"),

    // ----- Timestamps -----
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    documentIdIdx: index("extracted_fields_document_id_idx").on(table.documentId),
    bidIdIdx: index("extracted_fields_bid_id_idx").on(table.bidId),
    signalIdIdx: index("extracted_fields_signal_id_idx").on(table.signalId),
    // Unique constraint per document + signal + version
    uniqueExtraction: unique("extracted_fields_unique").on(
      table.documentId,
      table.signalId,
      table.extractionVersion
    ),
  })
);

export type ExtractedField = typeof extractedFields.$inferSelect;
export type NewExtractedField = typeof extractedFields.$inferInsert;

