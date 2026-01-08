import { z } from "zod";
import {
  BID_STATUS,
  INTAKE_SOURCE,
  DOCUMENT_TYPE,
  DECISION_OUTCOME,
  OVERRIDE_REASON_CATEGORY,
} from "./constants.js";

/**
 * Core type definitions derived from constants
 * Using Zod for runtime validation and TypeScript inference
 */

// ----- Status & Enum Types -----

export const BidStatusSchema = z.enum([
  BID_STATUS.NEW,
  BID_STATUS.IN_REVIEW,
  BID_STATUS.QUALIFIED,
  BID_STATUS.REJECTED,
]);
export type BidStatus = z.infer<typeof BidStatusSchema>;

export const IntakeSourceSchema = z.enum([
  INTAKE_SOURCE.WEB,
  INTAKE_SOURCE.EMAIL,
]);
export type IntakeSource = z.infer<typeof IntakeSourceSchema>;

export const DocumentTypeSchema = z.enum([
  DOCUMENT_TYPE.BID_INVITATION,
  DOCUMENT_TYPE.PLANS,
  DOCUMENT_TYPE.SPECIFICATIONS,
  DOCUMENT_TYPE.ADDENDUM,
  DOCUMENT_TYPE.OTHER,
]);
export type DocumentType = z.infer<typeof DocumentTypeSchema>;

export const DecisionOutcomeSchema = z.enum([
  DECISION_OUTCOME.GO,
  DECISION_OUTCOME.MAYBE,
  DECISION_OUTCOME.NO,
]);
export type DecisionOutcome = z.infer<typeof DecisionOutcomeSchema>;

export const OverrideReasonCategorySchema = z.enum([
  OVERRIDE_REASON_CATEGORY.RELATIONSHIP,
  OVERRIDE_REASON_CATEGORY.STRATEGIC,
  OVERRIDE_REASON_CATEGORY.CAPACITY,
  OVERRIDE_REASON_CATEGORY.TIMELINE,
  OVERRIDE_REASON_CATEGORY.FINANCIAL,
  OVERRIDE_REASON_CATEGORY.SCOPE,
  OVERRIDE_REASON_CATEGORY.OTHER,
]);
export type OverrideReasonCategory = z.infer<typeof OverrideReasonCategorySchema>;

// ----- API Request/Response Types -----

/** Web intake request payload */
export const WebIntakeRequestSchema = z.object({
  clientId: z.string().uuid(),
  projectName: z.string().min(1).max(500),
  senderEmail: z.string().email(),
  senderName: z.string().optional(),
  senderCompany: z.string().optional(),
  notes: z.string().optional(),
  /** Base64 encoded files or file references */
  documents: z
    .array(
      z.object({
        filename: z.string(),
        contentType: z.string(),
        /** Base64 encoded content */
        content: z.string(),
      })
    )
    .optional(),
  /** Custom fields from dynamic intake forms / AI extraction */
  customFields: z.record(z.unknown()).optional(),
  /** Confidence scores for each field (0.0 to 1.0) */
  confidenceScores: z.record(z.unknown()).optional(),
  /** Extracted fields with confidence scores from AI/PDF extraction - very permissive to accept all data */
  extractedFields: z.array(z.object({
    fieldKey: z.string(),
    extractedValue: z.unknown(),
    confidence: z.unknown().optional(), // Accept any type, we'll normalize later
  }).passthrough()).optional(), // Allow extra properties
  /** Document metadata from extraction */
  documentMetadata: z.object({
    fileCount: z.number().optional(),
    filenames: z.array(z.string()).optional(),
    totalPages: z.number().optional(),
    extractionMethod: z.string().optional(),
  }).optional(),
});
export type WebIntakeRequest = z.infer<typeof WebIntakeRequestSchema>;

/** Email intake request payload (from email webhook) */
export const EmailIntakeRequestSchema = z.object({
  clientId: z.string().uuid(),
  fromEmail: z.string().email(),
  fromName: z.string().optional(),
  subject: z.string(),
  bodyText: z.string().optional(),
  bodyHtml: z.string().optional(),
  receivedAt: z.string().datetime(),
  /** Attachments from email */
  attachments: z
    .array(
      z.object({
        filename: z.string(),
        contentType: z.string(),
        size: z.number(),
        /** Base64 encoded content or storage URL */
        content: z.string(),
      })
    )
    .optional(),
  /** Raw email headers for traceability */
  headers: z.record(z.string()).optional(),
});
export type EmailIntakeRequest = z.infer<typeof EmailIntakeRequestSchema>;

/** Standard API response wrapper */
export const ApiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.boolean(),
    data: dataSchema.optional(),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        details: z.unknown().optional(),
      })
      .optional(),
    meta: z
      .object({
        requestId: z.string(),
        timestamp: z.string().datetime(),
      })
      .optional(),
  });

/** Bid list query parameters */
export const BidListQuerySchema = z.object({
  clientId: z.string().uuid().optional(),
  status: BidStatusSchema.optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});
export type BidListQuery = z.infer<typeof BidListQuerySchema>;

/** Decision override request payload */
export const DecisionOverrideRequestSchema = z.object({
  /** The decision ID to override */
  decisionId: z.string().uuid(),
  /** New outcome: GO, MAYBE, or NO */
  outcome: DecisionOutcomeSchema,
  /** Category of reason for override */
  reasonCategory: OverrideReasonCategorySchema,
  /** Free-text rationale explaining the override */
  rationale: z.string().min(10).max(2000),
  /** Who is making the override */
  overriddenBy: z.string().min(1).max(255),
  /** Optional additional metadata */
  metadata: z.record(z.unknown()).optional(),
});
export type DecisionOverrideRequest = z.infer<typeof DecisionOverrideRequestSchema>;

