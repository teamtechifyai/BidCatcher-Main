import { z } from "zod";
import { DEFAULT_PDF_SIGNALS } from "./constants.js";

/**
 * Client Configuration Schema
 *
 * Each client has a JSON-based configuration that defines:
 * - Intake field customizations
 * - PDF signals to extract (12-18 fields)
 * - Go/No-Go scoring weights
 * - JobTread field mappings (future)
 *
 * This configuration enables 80% reusable logic with 20% client-specific behavior.
 */

// ----- PDF Signal Configuration -----

/** Single PDF signal extraction configuration */
export const PdfSignalConfigSchema = z.object({
  /** Signal identifier (must match DEFAULT_PDF_SIGNALS or be custom) */
  signalId: z.string(),

  /** Human-readable label for display */
  label: z.string(),

  /** Whether this signal is required for the client */
  required: z.boolean().default(false),

  /** Default value if extraction fails (optional) */
  defaultValue: z.string().optional(),

  /** Regex patterns to help locate this field in PDFs */
  extractionHints: z.array(z.string()).optional(),
});
export type PdfSignalConfig = z.infer<typeof PdfSignalConfigSchema>;

// ----- Scoring Configuration -----

/** Single scoring criterion configuration */
export const ScoringCriterionSchema = z.object({
  /** Unique identifier for this criterion */
  criterionId: z.string(),

  /** Human-readable name */
  name: z.string(),

  /** Description of what this criterion evaluates */
  description: z.string().optional(),

  /** Weight multiplier (0.0 to 5.0, default 1.0) */
  weight: z.number().min(0).max(5).default(1),

  /** Scoring type: boolean (yes/no) or range (0-100) */
  type: z.enum(["boolean", "range"]),

  /** For boolean: points if true. For range: max points */
  maxPoints: z.number().min(0).max(100),

  /** Which PDF signal(s) this criterion depends on */
  dependsOnSignals: z.array(z.string()).optional(),

  /**
   * Evaluation rules (deterministic, no ML)
   * Simple rule format: { condition: "equals|contains|gt|lt|gte|lte", value: any }
   */
  rules: z
    .array(
      z.object({
        condition: z.enum([
          "equals",
          "not_equals",
          "contains",
          "not_contains",
          "gt",
          "lt",
          "gte",
          "lte",
          "exists",
          "not_exists",
        ]),
        value: z.unknown().optional(),
        signal: z.string(),
        /** Points to award if condition is met */
        points: z.number(),
      })
    )
    .optional(),
});
export type ScoringCriterion = z.infer<typeof ScoringCriterionSchema>;

// ----- Intake Field Configuration -----

/** Single intake field definition */
export const IntakeFieldSchema = z.object({
  /** Unique field key (used in payload) */
  key: z.string(),

  /** Human-readable label for display */
  label: z.string(),

  /** Field type determines rendering */
  type: z.enum(["text", "number", "date", "select", "boolean", "textarea"]),

  /** Whether field is required */
  required: z.boolean().default(false),

  /** Options for select fields */
  options: z.array(z.string()).optional(),

  /** Placeholder text */
  placeholder: z.string().optional(),

  /** Help text shown below field */
  helpText: z.string().optional(),

  /**
   * Description for AI extraction: helps the AI understand what this field means
   * when processing documents. Use this to add context (e.g., "Look for the
   * project name in the subject line or first paragraph of RFPs").
   */
  aiDescription: z.string().optional(),

  /** Which sources this field applies to */
  sourceHints: z.array(z.enum(["web", "email", "pdf"])).optional(),

  /** Default value */
  defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional(),

  /** Validation pattern (regex for text fields) */
  validation: z.object({
    pattern: z.string().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    minLength: z.number().optional(),
    maxLength: z.number().optional(),
  }).optional(),
});
export type IntakeField = z.infer<typeof IntakeFieldSchema>;

// ----- JobTread Field Mapping (Future) -----

export const JobTreadFieldMappingSchema = z.object({
  /** Extracted signal ID */
  signalId: z.string(),

  /** Target JobTread field name */
  jobTreadField: z.string(),

  /** Transform function identifier (optional) */
  transform: z.enum(["none", "uppercase", "lowercase", "date_iso", "currency"]).default("none"),
});
export type JobTreadFieldMapping = z.infer<typeof JobTreadFieldMappingSchema>;

// ----- Full Client Configuration -----

export const ClientConfigSchema = z.object({
  /** Config version for migrations */
  version: z.literal("1.0"),

  /** Client identifier (matches clients table) */
  clientId: z.string().uuid(),

  /** Display name for the client */
  clientName: z.string(),

  /** Whether this client is active */
  active: z.boolean().default(true),

  // ----- Intake Configuration -----
  intake: z.object({
    /**
     * Dynamic intake form fields
     * These define what fields appear on the intake form
     */
    intakeFields: z.array(IntakeFieldSchema).default([
      { key: "projectName", label: "Project Name", type: "text", required: true },
      { key: "senderEmail", label: "Your Email", type: "text", required: true },
      { key: "senderName", label: "Your Name", type: "text", required: false },
      { key: "senderCompany", label: "Company", type: "text", required: false },
    ]),

    /**
     * Legacy: Required fields for intake validation
     * @deprecated Use intakeFields[].required instead
     */
    requiredFields: z.array(z.string()).default(["projectName", "senderEmail"]),

    /** Email addresses that can submit bids for this client */
    allowedEmailDomains: z.array(z.string()).default([]),

    /** Auto-acknowledge receipt */
    sendAcknowledgement: z.boolean().default(true),
  }),

  // ----- PDF Extraction Configuration -----
  pdfExtraction: z.object({
    /** Signals to extract (12-18 recommended) */
    signals: z.array(PdfSignalConfigSchema).min(1).max(30),

    /** OCR fallback if text extraction fails */
    enableOcr: z.boolean().default(true),

    /** Max pages to process per document */
    maxPages: z.number().min(1).max(500).default(100),
  }),

  // ----- Go/No-Go Scoring Configuration -----
  scoring: z.object({
    /** Scoring criteria with weights */
    criteria: z.array(ScoringCriterionSchema).min(1),

    /** Threshold to auto-qualify (0-100) */
    autoQualifyThreshold: z.number().min(0).max(100).default(75),

    /** Threshold to auto-disqualify (0-100) */
    autoDisqualifyThreshold: z.number().min(0).max(100).default(25),

    /** Always require human review regardless of score */
    alwaysRequireReview: z.boolean().default(false),
  }),

  // ----- JobTread Integration (Future) -----
  jobTread: z
    .object({
      /** Whether JobTread integration is enabled */
      enabled: z.boolean().default(false),

      /** Field mappings from extracted signals to JobTread fields */
      fieldMappings: z.array(JobTreadFieldMappingSchema).default([]),

      /** Auto-push qualified bids */
      autoPush: z.boolean().default(false),
    })
    .optional(),

  // ----- GoHighLevel Integration -----
  ghl: z
    .object({
      /** Whether GHL sync is enabled for this client */
      enabled: z.boolean().default(false),

      /** GHL pipeline ID for opportunities (optional) */
      pipelineId: z.string().optional(),

      /** BidCatcher status → GHL pipeline stage ID mapping */
      stageMapping: z.record(z.string(), z.string()).optional(),
    })
    .optional(),

  // ----- Notification Settings -----
  notifications: z
    .object({
      /** Email addresses to notify on new bids */
      newBidEmails: z.array(z.string().email()).default([]),

      /** Email addresses to notify when review is needed */
      reviewNeededEmails: z.array(z.string().email()).default([]),
    })
    .optional(),

  // ----- Market Grasp / Gold Nugget Alerts -----
  /** Strategic tags to highlight bids (e.g. hospital, rail, repeat owner, specific geos) */
  strategicTags: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        /** Match type: contains (keyword), regex, or value_band (for numeric ranges) */
        matchType: z.enum(["contains", "regex", "value_band"]),
        /** Field to match: scope_of_work, owner_name, project_location, project_value_estimate, project_name, sender_company, etc. */
        field: z.string(),
        /** For contains/regex: the pattern. For value_band: "min:X,max:Y" */
        value: z.string(),
      })
    )
    .default([])
    .optional(),

  /** Hours of reading time saved per bid (for ROI estimate, e.g. 1.5) */
  hoursSavedPerBid: z.number().min(0).max(10).default(1.5).optional(),

  // ----- Criteria Trainer (Ore Samples) -----
  criteriaTrainer: z
    .object({
      /** Target samples per bucket (10-20 recommended) */
      targetPerBucket: z
        .object({
          yes: z.number().min(5).max(50).default(15),
          maybe: z.number().min(5).max(50).default(15),
          no: z.number().min(5).max(50).default(15),
        })
        .optional(),
      /** Minimum samples before AI can propose criteria (e.g. 5 per bucket) */
      minSamplesToAnalyze: z.number().min(3).max(20).default(5),
    })
    .optional(),
});

export type ClientConfig = z.infer<typeof ClientConfigSchema>;

// ----- Helper Functions -----

/**
 * Creates a default client configuration template
 * Clients can customize from this baseline
 */
export function createDefaultClientConfig(
  clientId: string,
  clientName: string
): ClientConfig {
  return {
    version: "1.0",
    clientId,
    clientName,
    active: true,
    intake: {
      intakeFields: [
        { key: "projectName", label: "Project Name", type: "text", required: true, placeholder: "Enter project name" },
        { key: "senderEmail", label: "Your Email", type: "text", required: true, placeholder: "your@email.com" },
        { key: "senderName", label: "Your Name", type: "text", required: false, placeholder: "Full name" },
        { key: "senderCompany", label: "Company", type: "text", required: false, placeholder: "Company name" },
        { key: "projectLocation", label: "Project Location", type: "text", required: false, placeholder: "City, State" },
        { key: "estimatedValue", label: "Estimated Value ($)", type: "number", required: false, placeholder: "0" },
        { key: "bidDueDate", label: "Bid Due Date", type: "date", required: false },
        { key: "projectType", label: "Project Type", type: "select", required: false, options: ["Commercial", "Residential", "Industrial", "Government", "Healthcare", "Education", "Other"] },
        { key: "notes", label: "Additional Notes", type: "textarea", required: false, placeholder: "Any additional information..." },
      ],
      requiredFields: ["projectName", "senderEmail"],
      allowedEmailDomains: [],
      sendAcknowledgement: true,
    },
    pdfExtraction: {
      signals: DEFAULT_PDF_SIGNALS.map((signalId: string) => ({
        signalId,
        label: signalId
          .split("_")
          .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" "),
        required: false,
      })),
      enableOcr: true,
      maxPages: 100,
    },
    scoring: {
      criteria: [
        {
          criterionId: "project_in_service_area",
          name: "Project in Service Area",
          description: "Project location is within the contractor's service area",
          type: "boolean",
          weight: 2,
          maxPoints: 20,
          dependsOnSignals: ["project_location"],
          rules: [{ signal: "project_location", condition: "exists", points: 20 }],
        },
        {
          criterionId: "timeline_feasible",
          name: "Timeline Feasible",
          description: "Bid due date and project timeline are achievable",
          type: "boolean",
          weight: 1.5,
          maxPoints: 15,
          dependsOnSignals: ["bid_due_date", "start_date", "completion_date"],
          rules: [
            { signal: "bid_due_date", condition: "exists", points: 5 },
            { signal: "start_date", condition: "exists", points: 5 },
            { signal: "completion_date", condition: "exists", points: 5 },
          ],
        },
        {
          criterionId: "project_size_fit",
          name: "Project Size Fit",
          description: "Project value aligns with contractor's typical project size",
          type: "range",
          weight: 1,
          maxPoints: 20,
          dependsOnSignals: ["project_value_estimate"],
          rules: [{ signal: "project_value_estimate", condition: "exists", points: 20 }],
        },
        {
          criterionId: "bonding_capacity",
          name: "Bonding Capacity Available",
          description: "Bond requirements are within contractor's bonding capacity",
          type: "boolean",
          weight: 2,
          maxPoints: 25,
          dependsOnSignals: ["bond_required"],
          rules: [{ signal: "bond_required", condition: "exists", points: 25 }],
        },
        {
          criterionId: "relationship_score",
          name: "GC/Owner Relationship",
          description: "Existing relationship with GC or owner",
          type: "range",
          weight: 1,
          maxPoints: 20,
          dependsOnSignals: ["general_contractor", "owner_name"],
          rules: [
            { signal: "general_contractor", condition: "exists", points: 10 },
            { signal: "owner_name", condition: "exists", points: 10 },
          ],
        },
      ],
      autoQualifyThreshold: 75,
      autoDisqualifyThreshold: 25,
      alwaysRequireReview: false,
    },
    jobTread: {
      enabled: false,
      fieldMappings: [],
      autoPush: false,
    },
    ghl: {
      enabled: true, // Sync to GHL by default when GHL is configured
    },
    notifications: {
      newBidEmails: [],
      reviewNeededEmails: [],
    },
  };
}

/**
 * Validates a client configuration object
 * Returns parsed config or throws ZodError
 */
export function validateClientConfig(config: unknown): ClientConfig {
  return ClientConfigSchema.parse(config);
}

