import { z } from "zod";

/**
 * Types for Go/No-Go scoring service
 */

/** Extracted field data for scoring */
export const ExtractedFieldDataSchema = z.record(
  z.string(), // signalId
  z.object({
    value: z.string().nullable(),
    confidence: z.number(),
  })
);
export type ExtractedFieldData = z.infer<typeof ExtractedFieldDataSchema>;

/** Input for scoring a bid */
export const ScoringInputSchema = z.object({
  bidId: z.string().uuid(),
  clientId: z.string().uuid(),

  /** Extracted fields from PDF (key: signalId, value: extracted data) */
  extractedFields: ExtractedFieldDataSchema,

  /** Client's scoring configuration */
  scoringConfig: z.object({
    criteria: z.array(z.any()), // ScoringCriterion[]
    autoQualifyThreshold: z.number(),
    autoDisqualifyThreshold: z.number(),
    alwaysRequireReview: z.boolean(),
  }),
});
export type ScoringInput = z.infer<typeof ScoringInputSchema>;

/** Result for a single criterion */
export const CriterionResultSchema = z.object({
  criterionId: z.string(),
  name: z.string(),
  weight: z.number(),
  score: z.number(),
  maxScore: z.number(),
  weightedScore: z.number(),
  weightedMaxScore: z.number(),
  explanation: z.string(),
  /** Which signals were used */
  signalsUsed: z.array(z.string()),
  /** Whether this criterion could be evaluated */
  evaluated: z.boolean(),
});
export type CriterionResult = z.infer<typeof CriterionResultSchema>;

/** AI evaluation result embedded in scoring */
export const AIEvaluationEmbeddedSchema = z.object({
  success: z.boolean(),
  recommendation: z.enum(["GO", "MAYBE", "NO"]),
  confidence: z.number(),
  reasoning: z.string(),
  keyFactors: z.object({
    positive: z.array(z.string()),
    negative: z.array(z.string()),
    neutral: z.array(z.string()),
  }),
  riskAssessment: z.object({
    level: z.enum(["LOW", "MEDIUM", "HIGH"]),
    factors: z.array(z.string()),
  }),
  suggestedQuestions: z.array(z.string()),
  processingTimeMs: z.number(),
  error: z.string().optional(),
});
export type AIEvaluationEmbedded = z.infer<typeof AIEvaluationEmbeddedSchema>;

/** Complete scoring result */
export const ScoringResultSchema = z.object({
  bidId: z.string().uuid(),
  clientId: z.string().uuid(),

  /** Final decision outcome: GO, MAYBE, NO */
  outcome: z.enum(["GO", "MAYBE", "NO"]),

  /** Total weighted score */
  totalScore: z.number(),

  /** Maximum possible weighted score */
  maxScore: z.number(),

  /** Score as percentage */
  scorePercentage: z.number(),

  /** Breakdown by criterion */
  criteriaResults: z.array(CriterionResultSchema),

  /** Human-readable explanation */
  explanation: z.string(),

  /** Thresholds used */
  thresholds: z.object({
    autoQualify: z.number(),
    autoDisqualify: z.number(),
  }),

  /** AI evaluation result (if AI was used) */
  aiEvaluation: AIEvaluationEmbeddedSchema.optional(),

  /** Evaluation method used */
  evaluationMethod: z.enum(["rules", "ai", "hybrid"]).optional(),

  /** Metadata */
  metadata: z.object({
    evaluatedAt: z.string().datetime(),
    configVersion: z.string(),
    warnings: z.array(z.string()),
  }),
});
export type ScoringResult = z.infer<typeof ScoringResultSchema>;

