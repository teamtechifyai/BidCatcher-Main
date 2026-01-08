import { z } from "zod";

/**
 * PDF Assist Lite Types
 *
 * Strict Zod schemas for PDF extraction fields.
 * 16 core extraction fields aligned with construction bid documents.
 */

// ----- Extraction Field Schema (16 fields) -----

/**
 * Extracted fields schema - 16 standard signals for construction bids
 * All fields are nullable since extraction may not find all values
 */
export const ExtractedFieldsSchema = z.object({
  // ----- Project Identification -----
  /** Name of the construction project */
  project_name: z.string().nullable(),

  /** Physical location/address of the project */
  project_location: z.string().nullable(),

  /** Project number or reference ID from documents */
  project_number: z.string().nullable(),

  // ----- Key Parties -----
  /** Name of the project owner */
  owner_name: z.string().nullable(),

  /** Name of the general contractor */
  general_contractor: z.string().nullable(),

  /** Name of the architect/engineer of record */
  architect_engineer: z.string().nullable(),

  // ----- Timeline -----
  /** Date bids are due */
  bid_due_date: z.string().nullable(),

  /** Time bids are due */
  bid_due_time: z.string().nullable(),

  /** Date of pre-bid meeting if scheduled */
  pre_bid_meeting_date: z.string().nullable(),

  /** Whether pre-bid meeting is mandatory */
  pre_bid_meeting_required: z.boolean().nullable(),

  /** Expected project start date */
  start_date: z.string().nullable(),

  /** Expected project completion date */
  completion_date: z.string().nullable(),

  // ----- Project Details -----
  /** Estimated project value or budget range */
  project_value_estimate: z.string().nullable(),

  /** Whether bid/performance bond is required */
  bond_required: z.boolean().nullable(),

  /** Insurance requirements summary */
  insurance_requirements: z.string().nullable(),

  /** Description of work scope */
  scope_of_work: z.string().nullable(),
});

export type ExtractedFields = z.infer<typeof ExtractedFieldsSchema>;

/** All valid field names for extraction */
export const EXTRACTION_FIELD_NAMES = [
  "project_name",
  "project_location",
  "project_number",
  "owner_name",
  "general_contractor",
  "architect_engineer",
  "bid_due_date",
  "bid_due_time",
  "pre_bid_meeting_date",
  "pre_bid_meeting_required",
  "start_date",
  "completion_date",
  "project_value_estimate",
  "bond_required",
  "insurance_requirements",
  "scope_of_work",
] as const;

export type ExtractionFieldName = typeof EXTRACTION_FIELD_NAMES[number];

// ----- Extraction Input/Output Types -----

/** Input for PDF extraction */
export const ExtractionInputSchema = z.object({
  /** Document ID for reference */
  documentId: z.string().uuid(),

  /** Bid ID for reference */
  bidId: z.string().uuid(),

  /** PDF content as base64 or file path */
  content: z.string(),

  /** Content type indicator */
  contentType: z.enum(["base64", "file_path", "url"]),

  /** Optional: specific fields to extract (defaults to all) */
  fieldsToExtract: z.array(z.enum(EXTRACTION_FIELD_NAMES)).optional(),
});
export type ExtractionInput = z.infer<typeof ExtractionInputSchema>;

/** Single extracted field result with metadata */
export const ExtractedFieldResultSchema = z.object({
  /** Field identifier */
  fieldName: z.string(),

  /** Extracted value (null if not found) */
  value: z.union([z.string(), z.boolean(), z.null()]),

  /** Raw text snippet where value was found */
  rawSnippet: z.string().nullable(),

  /** Confidence score 0.0 - 1.0 */
  confidence: z.number().min(0).max(1),

  /** Page number where found (1-indexed, null if not applicable) */
  pageNumber: z.number().nullable(),

  /** Extraction method used */
  source: z.enum(["pdf_assist_lite", "regex", "llm_stub", "manual"]),
});
export type ExtractedFieldResult = z.infer<typeof ExtractedFieldResultSchema>;

/** Complete extraction result */
export const ExtractionResultSchema = z.object({
  /** Document ID */
  documentId: z.string().uuid(),

  /** Bid ID */
  bidId: z.string().uuid(),

  /** Whether extraction completed successfully */
  success: z.boolean(),

  /** Extracted fields with metadata */
  fields: z.array(ExtractedFieldResultSchema),

  /** Structured extracted data */
  extractedData: ExtractedFieldsSchema,

  /** Raw text extracted from PDF (for debugging) */
  rawText: z.string(),

  /** Extraction metadata */
  metadata: z.object({
    /** Total pages in document */
    totalPages: z.number().nullable(),

    /** Processing time in milliseconds */
    processingTimeMs: z.number(),

    /** Extraction version/attempt number */
    extractionVersion: z.number(),

    /** Any warnings during extraction */
    warnings: z.array(z.string()),

    /** Method used for extraction */
    method: z.enum(["stub", "regex", "llm"]),
  }),

  /** Error message if extraction failed */
  error: z.string().nullable(),
});
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;
