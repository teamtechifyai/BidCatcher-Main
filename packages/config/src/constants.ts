/**
 * System-wide constants for Bid Catcher
 * These values are locked for the MVP and should not change without careful consideration
 */

/** Default scoring thresholds */
export const SCORING = {
  /** Minimum score required to auto-qualify a bid (0-100) */
  AUTO_QUALIFY_THRESHOLD: 75,

  /** Maximum score that triggers auto-disqualify (0-100) */
  AUTO_DISQUALIFY_THRESHOLD: 25,

  /** Default weight for unspecified scoring criteria */
  DEFAULT_WEIGHT: 1.0,
} as const;

/** Bid status values - locked enum for MVP */
export const BID_STATUS = {
  NEW: "new",
  IN_REVIEW: "in_review",
  QUALIFIED: "qualified",
  REJECTED: "rejected",
} as const;

/** Valid status transitions */
export const BID_STATUS_TRANSITIONS: Record<string, string[]> = {
  new: ["in_review", "rejected"],
  in_review: ["qualified", "rejected"],
  qualified: [], // Terminal state
  rejected: [], // Terminal state
} as const;

/** Intake source types */
export const INTAKE_SOURCE = {
  WEB: "web",
  EMAIL: "email",
} as const;

/** Document types for bid attachments */
export const DOCUMENT_TYPE = {
  BID_INVITATION: "bid_invitation",
  PLANS: "plans",
  SPECIFICATIONS: "specifications",
  ADDENDUM: "addendum",
  OTHER: "other",
} as const;

/** Standard PDF signals to extract (12-18 fields per client config) */
export const DEFAULT_PDF_SIGNALS = [
  "project_name",
  "project_location",
  "owner_name",
  "general_contractor",
  "bid_due_date",
  "bid_due_time",
  "pre_bid_meeting_date",
  "pre_bid_meeting_required",
  "project_value_estimate",
  "bond_required",
  "insurance_requirements",
  "scope_of_work",
  "trade_packages",
  "project_duration",
  "start_date",
  "completion_date",
] as const;

/** Go/No-Go decision outcomes */
export const DECISION_OUTCOME = {
  GO: "GO",
  MAYBE: "MAYBE",
  NO: "NO",
} as const;

/** Override reason categories */
export const OVERRIDE_REASON_CATEGORY = {
  RELATIONSHIP: "relationship",
  STRATEGIC: "strategic",
  CAPACITY: "capacity",
  TIMELINE: "timeline",
  FINANCIAL: "financial",
  SCOPE: "scope",
  OTHER: "other",
} as const;

