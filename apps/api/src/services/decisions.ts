/**
 * Decision Service
 *
 * Orchestrates Go/No-Go evaluation, decision storage, and human overrides.
 * All decisions are append-only and fully auditable.
 */

import type { ClientConfig, DecisionOutcome } from "@bid-catcher/config";
import { DECISION_OUTCOME } from "@bid-catcher/config";
import {
  scoreBid,
  scoreBidWithAIOnly,
  type ScoringInput,
  type ExtractedFieldData,
  type ScoringOptions,
  type AIEvaluationEmbedded,
} from "@bid-catcher/scoring";
import {
  getDb,
  bids,
  clients,
  extractedFields,
  goNoGoDecisions,
  decisionOverrides,
  eq,
  desc,
  sql,
} from "@bid-catcher/db";

// ----- Types -----

interface EvaluationOptions {
  /** Use AI for evaluation */
  useAI?: boolean;
  /** Use AI only (no rule-based) */
  aiOnly?: boolean;
  /** Weight for AI in hybrid mode (0-1) */
  aiWeight?: number;
}

interface EvaluationResult {
  decisionId: string;
  bidId: string;
  outcome: DecisionOutcome;
  score: number;
  maxScore: number;
  scorePercentage: number;
  rationale: string;
  decisionVersion: number;
  createdAt: string;
  evaluationMethod?: "rules" | "ai" | "hybrid";
  aiEvaluation?: AIEvaluationEmbedded;
}

interface OverrideResult {
  overrideId: string;
  decisionId: string;
  bidId: string;
  originalOutcome: string;
  newOutcome: string;
  reasonCategory: string;
  rationale: string;
  overriddenBy: string;
  createdAt: string;
}

interface DecisionHistoryEntry {
  id: string;
  type: "evaluation" | "override";
  outcome: string;
  score?: number;
  scorePercentage?: number;
  rationale: string;
  reasonCategory?: string;
  overriddenBy?: string;
  createdAt: string;
  decisionVersion?: number;
  evaluationMethod?: string;
  aiEvaluation?: unknown;
  evaluatedBy?: string;
}

interface LatestDecisionInfo {
  id: string;
  outcome: string;
  overallScore: number | null;
  rationale: string | null;
  decidedAt: string;
  evaluatedBy: string | null;
  evaluationMethod: string | null;
  aiEvaluation: unknown;
}

interface DecisionHistory {
  bidId: string;
  currentOutcome: string;
  totalEvaluations: number;
  totalOverrides: number;
  latestDecision: LatestDecisionInfo | null;
  history: DecisionHistoryEntry[];
}

// ----- Helper Functions -----

/**
 * Build extracted field data map from database records
 */
function buildExtractedFieldData(
  fields: Array<{ signalId: string; extractedValue: string | null; confidence: number | null }>
): ExtractedFieldData {
  const data: ExtractedFieldData = {};
  for (const field of fields) {
    data[field.signalId] = {
      value: field.extractedValue,
      confidence: field.confidence ?? 0,
    };
  }
  return data;
}

/**
 * Generate detailed rationale from scoring result
 */
function generateRationale(
  outcome: DecisionOutcome,
  scorePercentage: number,
  criteriaResults: Array<{
    name: string;
    score: number;
    maxScore: number;
    evaluated: boolean;
    explanation: string;
  }>,
  thresholds: { goThreshold: number; noThreshold: number }
): string {
  const lines: string[] = [];

  // Overall outcome explanation
  lines.push(`## Decision: ${outcome}`);
  lines.push(`Score: ${scorePercentage.toFixed(1)}% (GO threshold: ${thresholds.goThreshold}%, NO threshold: ${thresholds.noThreshold}%)`);
  lines.push("");

  // Outcome reason
  if (outcome === DECISION_OUTCOME.GO) {
    lines.push(`✅ Score exceeds GO threshold of ${thresholds.goThreshold}%`);
  } else if (outcome === DECISION_OUTCOME.NO) {
    lines.push(`❌ Score below NO threshold of ${thresholds.noThreshold}%`);
  } else {
    lines.push(`⚠️ Score between thresholds - requires human review`);
  }
  lines.push("");

  // Criteria breakdown
  lines.push("## Criteria Breakdown");
  const evaluated = criteriaResults.filter((c) => c.evaluated);
  const notEvaluated = criteriaResults.filter((c) => !c.evaluated);

  if (evaluated.length > 0) {
    lines.push("### Evaluated Criteria");
    for (const criterion of evaluated) {
      const percentage = criterion.maxScore > 0 
        ? ((criterion.score / criterion.maxScore) * 100).toFixed(0) 
        : "0";
      lines.push(`- ${criterion.name}: ${criterion.score}/${criterion.maxScore} (${percentage}%)`);
    }
  }

  if (notEvaluated.length > 0) {
    lines.push("");
    lines.push("### Criteria Requiring Manual Review");
    for (const criterion of notEvaluated) {
      lines.push(`- ${criterion.name}: ${criterion.explanation}`);
    }
  }

  return lines.join("\n");
}

// ----- Decision Service -----

export const decisionsService = {
  /**
   * Evaluate a bid and create a new decision record
   * Never overwrites previous decisions - always appends
   *
   * @param bidId - The bid to evaluate
   * @param options - Evaluation options (useAI, aiOnly, aiWeight)
   */
  async evaluateBid(
    bidId: string,
    options: EvaluationOptions = {}
  ): Promise<EvaluationResult> {
    const db = getDb();
    const { useAI = false, aiOnly = false, aiWeight = 0.3 } = options;

    // 1. Fetch bid with client info
    const bidResults = await db
      .select({
        id: bids.id,
        clientId: bids.clientId,
        projectName: bids.projectName,
        senderEmail: bids.senderEmail,
        senderName: bids.senderName,
        senderCompany: bids.senderCompany,
        intakeSource: bids.intakeSource,
        rawPayload: bids.rawPayload,
        clientConfig: clients.config,
        clientName: clients.name,
      })
      .from(bids)
      .leftJoin(clients, eq(bids.clientId, clients.id))
      .where(eq(bids.id, bidId))
      .limit(1);

    if (bidResults.length === 0) {
      throw new Error(`Bid with ID ${bidId} not found`);
    }

    const bid = bidResults[0];
    const clientConfig = bid.clientConfig as ClientConfig | null;

    if (!clientConfig) {
      throw new Error(`Client configuration not found for bid ${bidId}`);
    }

    // 2. Fetch latest extracted fields for this bid
    const fields = await db
      .select({
        signalId: extractedFields.signalId,
        extractedValue: extractedFields.extractedValue,
        confidence: extractedFields.confidence,
      })
      .from(extractedFields)
      .where(eq(extractedFields.bidId, bidId));

    // Also include custom fields from rawPayload if available
    const rawPayload = bid.rawPayload as Record<string, unknown> | null;
    const customFields = rawPayload?.customFields as Record<string, unknown> | undefined;

    // 3. Get current decision version
    const existingDecisions = await db
      .select({ maxVersion: sql<number>`COALESCE(MAX(decision_version), 0)::int` })
      .from(goNoGoDecisions)
      .where(eq(goNoGoDecisions.bidId, bidId));

    const newVersion = (existingDecisions[0]?.maxVersion || 0) + 1;

    // 4. Build scoring input with extracted and custom fields
    let extractedFieldData = buildExtractedFieldData(fields);

    // Merge in custom fields from intake as extracted fields
    if (customFields) {
      for (const [key, value] of Object.entries(customFields)) {
        if (value !== null && value !== undefined && !extractedFieldData[key]) {
          extractedFieldData[key] = {
            value: String(value),
            confidence: 1.0, // Direct input has full confidence
          };
        }
      }
    }

    const scoringInput: ScoringInput = {
      bidId,
      clientId: bid.clientId,
      extractedFields: extractedFieldData,
      scoringConfig: {
        criteria: clientConfig.scoring.criteria,
        autoQualifyThreshold: clientConfig.scoring.autoQualifyThreshold,
        autoDisqualifyThreshold: clientConfig.scoring.autoDisqualifyThreshold,
        alwaysRequireReview: clientConfig.scoring.alwaysRequireReview,
      },
    };

    // 5. Build scoring options for AI
    const scoringOptions: ScoringOptions = {
      useAI: useAI || aiOnly,
      aiWeight,
      projectName: bid.projectName || undefined,
      clientName: bid.clientName || undefined,
    };

    // 6. Run scoring engine (rules, AI, or hybrid)
    const scoringResult = aiOnly
      ? await scoreBidWithAIOnly(scoringInput, scoringOptions)
      : await scoreBid(scoringInput, scoringOptions);

    // 6. Build inputs snapshot for full auditability
    const inputsSnapshot = {
      intakeFields: {
        projectName: bid.projectName,
        senderEmail: bid.senderEmail,
        senderName: bid.senderName,
        senderCompany: bid.senderCompany,
        intakeSource: bid.intakeSource,
      },
      extractedFields: extractedFieldData,
      scoringCriteria: clientConfig.scoring.criteria,
      configVersion: clientConfig.version,
    };

    // 7. Build thresholds used
    const thresholdsUsed = {
      goThreshold: clientConfig.scoring.autoQualifyThreshold,
      noThreshold: clientConfig.scoring.autoDisqualifyThreshold,
      alwaysRequireReview: clientConfig.scoring.alwaysRequireReview,
    };

    // 8. Generate detailed rationale
    const rationale = generateRationale(
      scoringResult.outcome,
      scoringResult.scorePercentage,
      scoringResult.criteriaResults,
      thresholdsUsed
    );

    // 9. Persist decision (append-only)
    console.log(`[decisions] Inserting decision for bid ${bidId}:`, {
      outcome: scoringResult.outcome,
      totalScore: scoringResult.totalScore,
      maxScore: scoringResult.maxScore,
      scorePercentage: scoringResult.scorePercentage,
      evaluationMethod: scoringResult.evaluationMethod || "rules",
      decisionVersion: newVersion,
    });
    
    let newDecision;
    try {
      const [result] = await db
        .insert(goNoGoDecisions)
        .values({
          bidId,
          outcome: scoringResult.outcome,
          totalScore: scoringResult.totalScore,
          maxScore: scoringResult.maxScore,
          scorePercentage: scoringResult.scorePercentage,
          inputsSnapshot,
          thresholdsUsed,
          scoreBreakdown: scoringResult.criteriaResults,
          rationale,
          evaluationMethod: scoringResult.evaluationMethod || "rules",
          aiEvaluation: scoringResult.aiEvaluation || null,
          configVersion: clientConfig.version,
          decisionVersion: newVersion,
        })
        .returning({
          id: goNoGoDecisions.id,
          createdAt: goNoGoDecisions.createdAt,
        });
      newDecision = result;
    } catch (insertErr) {
      console.error(`[decisions] Failed to insert decision for bid ${bidId}:`, insertErr);
      throw new Error(`Failed to save decision: ${insertErr instanceof Error ? insertErr.message : 'Unknown error'}`);
    }

    const method = scoringResult.evaluationMethod || "rules";
    console.log(`[decisions] Created decision ${newDecision.id} for bid ${bidId} (version ${newVersion}, method: ${method}): ${scoringResult.outcome}`);

    return {
      decisionId: newDecision.id,
      bidId,
      outcome: scoringResult.outcome,
      score: scoringResult.totalScore,
      maxScore: scoringResult.maxScore,
      scorePercentage: scoringResult.scorePercentage,
      rationale,
      decisionVersion: newVersion,
      createdAt: newDecision.createdAt.toISOString(),
      evaluationMethod: method,
      aiEvaluation: scoringResult.aiEvaluation,
    };
  },

  /**
   * Override a decision with human judgment
   * Original decision remains immutable
   * If decisionId is not provided, overrides the latest decision for the bid
   */
  async overrideDecision(
    bidId: string,
    override: {
      decisionId?: string;
      outcome: string;
      reasonCategory: string;
      rationale: string;
      overriddenBy: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<OverrideResult> {
    const db = getDb();

    let decisionId = override.decisionId;
    let originalOutcome: string;

    // If no decisionId provided, find the latest decision for this bid
    if (!decisionId) {
      const latestDecision = await db
        .select({
          id: goNoGoDecisions.id,
          outcome: goNoGoDecisions.outcome,
        })
        .from(goNoGoDecisions)
        .where(eq(goNoGoDecisions.bidId, bidId))
        .orderBy(desc(goNoGoDecisions.createdAt))
        .limit(1);

      if (latestDecision.length === 0) {
        throw new Error(`No decisions found for bid ${bidId}. Run an evaluation first.`);
      }

      decisionId = latestDecision[0].id;
      originalOutcome = latestDecision[0].outcome;
    } else {
      // Verify the specified decision exists
      const decision = await db
        .select({
          id: goNoGoDecisions.id,
          bidId: goNoGoDecisions.bidId,
          outcome: goNoGoDecisions.outcome,
        })
        .from(goNoGoDecisions)
        .where(eq(goNoGoDecisions.id, decisionId))
        .limit(1);

      if (decision.length === 0) {
        throw new Error(`Decision with ID ${decisionId} not found`);
      }

      if (decision[0].bidId !== bidId) {
        throw new Error(`Decision ${decisionId} does not belong to bid ${bidId}`);
      }

      originalOutcome = decision[0].outcome;
    }

    // 2. Prevent overriding to the same outcome
    if (originalOutcome === override.outcome) {
      throw new Error(`Cannot override to the same outcome (${originalOutcome})`);
    }

    // 3. Create override record
    console.log(`[override] Creating override for decision ${decisionId}: ${originalOutcome} → ${override.outcome}`);
    
    const [newOverride] = await db
      .insert(decisionOverrides)
      .values({
        decisionId: decisionId,
        bidId,
        originalOutcome,
        overriddenOutcome: override.outcome,
        reasonCategory: override.reasonCategory,
        overriddenBy: override.overriddenBy,
        rationale: override.rationale,
        metadata: override.metadata || null,
      })
      .returning({
        id: decisionOverrides.id,
        createdAt: decisionOverrides.createdAt,
      });

    console.log(
      `[override] Created override ${newOverride.id} for decision ${decisionId}: ${originalOutcome} → ${override.outcome}`
    );

    return {
      overrideId: newOverride.id,
      decisionId: decisionId as string,
      bidId,
      originalOutcome,
      newOutcome: override.outcome,
      reasonCategory: override.reasonCategory,
      rationale: override.rationale,
      overriddenBy: override.overriddenBy,
      createdAt: newOverride.createdAt.toISOString(),
    };
  },

  /**
   * Get full decision history for a bid
   * Includes all evaluations and overrides in chronological order
   */
  async getDecisionHistory(bidId: string): Promise<DecisionHistory> {
    const db = getDb();
    console.log(`[decisions] Fetching decision history for bid ${bidId}`);

    // 1. Get all decisions
    const decisions = await db
      .select({
        id: goNoGoDecisions.id,
        outcome: goNoGoDecisions.outcome,
        totalScore: goNoGoDecisions.totalScore,
        scorePercentage: goNoGoDecisions.scorePercentage,
        rationale: goNoGoDecisions.rationale,
        decisionVersion: goNoGoDecisions.decisionVersion,
        evaluationMethod: goNoGoDecisions.evaluationMethod,
        aiEvaluation: goNoGoDecisions.aiEvaluation,
        createdAt: goNoGoDecisions.createdAt,
      })
      .from(goNoGoDecisions)
      .where(eq(goNoGoDecisions.bidId, bidId))
      .orderBy(desc(goNoGoDecisions.createdAt));
    
    console.log(`[decisions] Found ${decisions.length} decisions for bid ${bidId}`);

    // 2. Get all overrides
    const overrides = await db
      .select({
        id: decisionOverrides.id,
        decisionId: decisionOverrides.decisionId,
        originalOutcome: decisionOverrides.originalOutcome,
        overriddenOutcome: decisionOverrides.overriddenOutcome,
        reasonCategory: decisionOverrides.reasonCategory,
        rationale: decisionOverrides.rationale,
        overriddenBy: decisionOverrides.overriddenBy,
        createdAt: decisionOverrides.createdAt,
      })
      .from(decisionOverrides)
      .where(eq(decisionOverrides.bidId, bidId))
      .orderBy(desc(decisionOverrides.createdAt));

    // 3. Build unified history
    const history: DecisionHistoryEntry[] = [];

    for (const decision of decisions) {
      history.push({
        id: decision.id,
        type: "evaluation",
        outcome: decision.outcome,
        score: decision.totalScore,
        scorePercentage: decision.scorePercentage,
        rationale: decision.rationale,
        createdAt: decision.createdAt.toISOString(),
        decisionVersion: decision.decisionVersion,
        evaluationMethod: decision.evaluationMethod,
        evaluatedBy: undefined, // Column not in schema yet
        aiEvaluation: decision.aiEvaluation,
      });
    }

    for (const override of overrides) {
      history.push({
        id: override.id,
        type: "override",
        outcome: override.overriddenOutcome,
        rationale: override.rationale,
        reasonCategory: override.reasonCategory,
        overriddenBy: override.overriddenBy,
        createdAt: override.createdAt.toISOString(),
      });
    }

    // Sort by createdAt descending (newest first)
    history.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // 4. Determine current outcome (most recent decision or override)
    let currentOutcome = "NONE";
    if (history.length > 0) {
      currentOutcome = history[0].outcome;
    }

    // 5. Build latest decision info
    let latestDecision: LatestDecisionInfo | null = null;
    if (decisions.length > 0) {
      const latest = decisions[0];
      latestDecision = {
        id: latest.id,
        outcome: latest.outcome,
        overallScore: latest.scorePercentage,
        rationale: latest.rationale,
        decidedAt: latest.createdAt.toISOString(),
        evaluatedBy: null, // Column not in schema yet
        evaluationMethod: latest.evaluationMethod,
        aiEvaluation: latest.aiEvaluation,
      };
    }

    return {
      bidId,
      currentOutcome,
      totalEvaluations: decisions.length,
      totalOverrides: overrides.length,
      latestDecision,
      history,
    };
  },

  /**
   * Get the latest decision for a bid
   */
  async getLatestDecision(bidId: string): Promise<{
    decision: EvaluationResult;
    override: OverrideResult | null;
    effectiveOutcome: string;
  } | null> {
    const db = getDb();

    // Get latest decision
    const decisions = await db
      .select({
        id: goNoGoDecisions.id,
        bidId: goNoGoDecisions.bidId,
        outcome: goNoGoDecisions.outcome,
        totalScore: goNoGoDecisions.totalScore,
        maxScore: goNoGoDecisions.maxScore,
        scorePercentage: goNoGoDecisions.scorePercentage,
        rationale: goNoGoDecisions.rationale,
        decisionVersion: goNoGoDecisions.decisionVersion,
        createdAt: goNoGoDecisions.createdAt,
      })
      .from(goNoGoDecisions)
      .where(eq(goNoGoDecisions.bidId, bidId))
      .orderBy(desc(goNoGoDecisions.decisionVersion))
      .limit(1);

    if (decisions.length === 0) {
      return null;
    }

    const latestDecision = decisions[0];

    // Get latest override for this decision
    const overrideResults = await db
      .select({
        id: decisionOverrides.id,
        decisionId: decisionOverrides.decisionId,
        bidId: decisionOverrides.bidId,
        originalOutcome: decisionOverrides.originalOutcome,
        overriddenOutcome: decisionOverrides.overriddenOutcome,
        reasonCategory: decisionOverrides.reasonCategory,
        rationale: decisionOverrides.rationale,
        overriddenBy: decisionOverrides.overriddenBy,
        createdAt: decisionOverrides.createdAt,
      })
      .from(decisionOverrides)
      .where(eq(decisionOverrides.decisionId, latestDecision.id))
      .orderBy(desc(decisionOverrides.createdAt))
      .limit(1);

    const latestOverride = overrideResults.length > 0 ? overrideResults[0] : null;

    return {
      decision: {
        decisionId: latestDecision.id,
        bidId: latestDecision.bidId,
        outcome: latestDecision.outcome as DecisionOutcome,
        score: latestDecision.totalScore,
        maxScore: latestDecision.maxScore,
        scorePercentage: latestDecision.scorePercentage,
        rationale: latestDecision.rationale,
        decisionVersion: latestDecision.decisionVersion,
        createdAt: latestDecision.createdAt.toISOString(),
      },
      override: latestOverride
        ? {
            overrideId: latestOverride.id,
            decisionId: latestOverride.decisionId,
            bidId: latestOverride.bidId,
            originalOutcome: latestOverride.originalOutcome,
            newOutcome: latestOverride.overriddenOutcome,
            reasonCategory: latestOverride.reasonCategory,
            rationale: latestOverride.rationale,
            overriddenBy: latestOverride.overriddenBy,
            createdAt: latestOverride.createdAt.toISOString(),
          }
        : null,
      effectiveOutcome: latestOverride
        ? latestOverride.overriddenOutcome
        : latestDecision.outcome,
    };
  },
};

