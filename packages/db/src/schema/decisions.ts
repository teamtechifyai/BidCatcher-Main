import { pgTable, uuid, varchar, text, real, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { bids } from "./bids.js";

/**
 * Go/No-Go Decisions table
 *
 * Stores the automated scoring results for each bid.
 * Decisions are deterministic and explainable.
 */
export const goNoGoDecisions = pgTable(
  "go_no_go_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Reference to the bid being scored */
    bidId: uuid("bid_id")
      .notNull()
      .references(() => bids.id, { onDelete: "cascade" }),

    /**
     * Decision outcome
     * Values: GO, MAYBE, NO
     */
    outcome: varchar("outcome", { length: 20 }).notNull(),

    /** Overall score (0-100) */
    totalScore: real("total_score").notNull(),

    /** Maximum possible score */
    maxScore: real("max_score").notNull(),

    /** Score as percentage (totalScore / maxScore * 100) */
    scorePercentage: real("score_percentage").notNull(),

    /**
     * Snapshot of all inputs used for this decision
     * Includes: intake fields, extracted fields, client config snapshot
     * Enables full reproducibility and audit
     */
    inputsSnapshot: jsonb("inputs_snapshot").notNull(),

    /**
     * Thresholds used for this decision
     * { goThreshold: number, noThreshold: number }
     */
    thresholdsUsed: jsonb("thresholds_used").notNull(),

    /**
     * Detailed breakdown of scoring criteria
     * JSON array of: { criterionId, name, weight, score, maxScore, explanation }
     */
    scoreBreakdown: jsonb("score_breakdown").notNull(),

    /**
     * Human-readable rationale explaining the decision
     * Generated from deterministic rules
     */
    rationale: text("rationale").notNull(),

    /**
     * Evaluation method used
     * Values: rules, ai, hybrid
     */
    evaluationMethod: varchar("evaluation_method", { length: 20 }),

    /**
     * AI evaluation result (if AI was used)
     * Contains: recommendation, confidence, keyFactors, riskAssessment, etc.
     */
    aiEvaluation: jsonb("ai_evaluation"),

    /**
     * Config version used for this decision
     * Allows tracking when client config changes affect scoring
     */
    configVersion: varchar("config_version", { length: 20 }),

    /** Version number for re-scoring (doesn't overwrite, creates new record) */
    decisionVersion: integer("decision_version").notNull().default(1),

    // ----- Timestamps -----
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    bidIdIdx: index("go_no_go_decisions_bid_id_idx").on(table.bidId),
    outcomeIdx: index("go_no_go_decisions_outcome_idx").on(table.outcome),
  })
);

/**
 * Decision Overrides table
 *
 * Records when humans override automated decisions.
 * Full audit trail - never deleted.
 */
export const decisionOverrides = pgTable(
  "decision_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Reference to the original decision */
    decisionId: uuid("decision_id")
      .notNull()
      .references(() => goNoGoDecisions.id, { onDelete: "cascade" }),

    /** Reference to the bid (denormalized for easier querying) */
    bidId: uuid("bid_id")
      .notNull()
      .references(() => bids.id, { onDelete: "cascade" }),

    /** Original automated outcome */
    originalOutcome: varchar("original_outcome", { length: 20 }).notNull(),

    /** New outcome after override */
    overriddenOutcome: varchar("overridden_outcome", { length: 20 }).notNull(),

    /**
     * Reason category for the override
     * Values: relationship, strategic, capacity, timeline, financial, scope, other
     */
    reasonCategory: varchar("reason_category", { length: 50 }).notNull(),

    /** Who made the override (user ID or email) */
    overriddenBy: varchar("overridden_by", { length: 255 }).notNull(),

    /** Required free-text rationale for the override */
    rationale: text("rationale").notNull(),

    /**
     * Optional structured metadata about the override
     * e.g., { gcName: 'ABC Construction', relationshipYears: 5 }
     */
    metadata: jsonb("metadata"),

    // ----- Timestamps -----
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    decisionIdIdx: index("decision_overrides_decision_id_idx").on(table.decisionId),
    bidIdIdx: index("decision_overrides_bid_id_idx").on(table.bidId),
    overriddenByIdx: index("decision_overrides_overridden_by_idx").on(table.overriddenBy),
  })
);

export type GoNoGoDecision = typeof goNoGoDecisions.$inferSelect;
export type NewGoNoGoDecision = typeof goNoGoDecisions.$inferInsert;

export type DecisionOverride = typeof decisionOverrides.$inferSelect;
export type NewDecisionOverride = typeof decisionOverrides.$inferInsert;

