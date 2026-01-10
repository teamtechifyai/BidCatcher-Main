/**
 * Go/No-Go Scoring Service
 *
 * Implements deterministic scoring engine for bid evaluation.
 * Every decision is explainable, traceable, and immutable.
 */

import type { ClientConfig, ScoringCriterion, DecisionOutcome, OverrideReasonCategory } from "@bid-catcher/config";
import { DECISION_OUTCOME } from "@bid-catcher/config";
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

interface InputsSnapshot {
  bid: {
    id: string;
    projectName: string | null;
    senderEmail: string | null;
    senderCompany: string | null;
    intakeSource: string;
    receivedAt: string;
  };
  extractedFields: Record<string, {
    value: string | null;
    confidence: number | null;
    source: string | null;
  }>;
  clientConfig: {
    scoringCriteria: ScoringCriterion[];
    thresholds: {
      goThreshold: number;
      noThreshold: number;
    };
  };
}

interface CriterionScore {
  criterionId: string;
  name: string;
  weight: number;
  rawScore: number;
  maxRawScore: number;
  weightedScore: number;
  weightedMaxScore: number;
  explanation: string;
  inputsUsed: string[];
  passed: boolean;
}

interface EvaluationResult {
  decisionId: string;
  bidId: string;
  outcome: DecisionOutcome;
  totalScore: number;
  maxScore: number;
  scorePercentage: number;
  rationale: string;
  scoreBreakdown: CriterionScore[];
  thresholdsUsed: {
    goThreshold: number;
    noThreshold: number;
  };
  inputsSnapshot: InputsSnapshot;
  decisionVersion: number;
  createdAt: string;
}

interface OverrideInput {
  decisionId: string;
  bidId: string;
  reasonCategory: OverrideReasonCategory;
  rationale: string;
  newOutcome: DecisionOutcome;
  overriddenBy: string;
  metadata?: Record<string, unknown>;
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

interface DecisionHistory {
  decisions: Array<{
    id: string;
    outcome: string;
    totalScore: number;
    scorePercentage: number;
    rationale: string;
    decisionVersion: number;
    createdAt: string;
    override: {
      id: string;
      newOutcome: string;
      reasonCategory: string;
      rationale: string;
      overriddenBy: string;
      createdAt: string;
    } | null;
  }>;
  currentOutcome: string;
  hasOverride: boolean;
}

// ----- Helper Functions -----

/**
 * Evaluate a single criterion against inputs
 */
function evaluateCriterion(
  criterion: ScoringCriterion,
  extractedData: Record<string, { value: string | null; confidence: number | null }>
): CriterionScore {
  const inputsUsed: string[] = [];
  let rawScore = 0;
  let explanation = "";
  let passed = false;

  const dependentSignals = criterion.dependsOnSignals || [];
  const rules = criterion.rules || [];

  // Check if we have the required signals
  const availableSignals: string[] = [];
  for (const signalId of dependentSignals) {
    const field = extractedData[signalId];
    if (field && field.value !== null) {
      availableSignals.push(signalId);
      inputsUsed.push(signalId);
    }
  }

  if (availableSignals.length === 0 && dependentSignals.length > 0) {
    explanation = `Could not evaluate: missing required data (${dependentSignals.join(", ")})`;
    return {
      criterionId: criterion.criterionId,
      name: criterion.name,
      weight: criterion.weight,
      rawScore: 0,
      maxRawScore: criterion.maxPoints,
      weightedScore: 0,
      weightedMaxScore: criterion.maxPoints * criterion.weight,
      explanation,
      inputsUsed,
      passed: false,
    };
  }

  // Apply rules
  const ruleResults: string[] = [];
  for (const rule of rules) {
    const field = extractedData[rule.signal];
    if (!field || field.value === null) continue;

    const actualValue = field.value;
    let ruleMatched = false;

    switch (rule.condition) {
      case "exists":
        ruleMatched = actualValue !== null && actualValue !== "";
        break;
      case "not_exists":
        ruleMatched = actualValue === null || actualValue === "";
        break;
      case "equals":
        ruleMatched = String(actualValue).toLowerCase() === String(rule.value).toLowerCase();
        break;
      case "not_equals":
        ruleMatched = String(actualValue).toLowerCase() !== String(rule.value).toLowerCase();
        break;
      case "contains":
        ruleMatched = String(actualValue).toLowerCase().includes(String(rule.value).toLowerCase());
        break;
      case "not_contains":
        ruleMatched = !String(actualValue).toLowerCase().includes(String(rule.value).toLowerCase());
        break;
      case "gt":
        ruleMatched = parseFloat(actualValue) > Number(rule.value);
        break;
      case "lt":
        ruleMatched = parseFloat(actualValue) < Number(rule.value);
        break;
      case "gte":
        ruleMatched = parseFloat(actualValue) >= Number(rule.value);
        break;
      case "lte":
        ruleMatched = parseFloat(actualValue) <= Number(rule.value);
        break;
    }

    if (ruleMatched) {
      rawScore += rule.points;
      ruleResults.push(`+${rule.points} points: ${rule.signal} ${rule.condition} ${rule.value ?? ""}`);
    }
  }

  // Handle boolean criteria without explicit rules
  if (criterion.type === "boolean" && rules.length === 0 && availableSignals.length > 0) {
    // Default: award full points if signal exists and is truthy
    const primarySignal = availableSignals[0];
    const value = extractedData[primarySignal]?.value;
    if (value && value.toLowerCase() !== "false" && value !== "0" && value.toLowerCase() !== "no") {
      rawScore = criterion.maxPoints;
      ruleResults.push(`+${criterion.maxPoints} points: ${primarySignal} is present and truthy`);
    }
  }

  // Cap score at maxPoints
  rawScore = Math.min(rawScore, criterion.maxPoints);
  passed = rawScore >= criterion.maxPoints * 0.5; // Consider passed if >= 50% of max

  if (ruleResults.length > 0) {
    explanation = ruleResults.join("; ");
  } else if (availableSignals.length > 0) {
    explanation = `Evaluated using ${availableSignals.join(", ")}, scored ${rawScore}/${criterion.maxPoints}`;
  } else {
    explanation = `No matching rules applied`;
  }

  return {
    criterionId: criterion.criterionId,
    name: criterion.name,
    weight: criterion.weight,
    rawScore,
    maxRawScore: criterion.maxPoints,
    weightedScore: rawScore * criterion.weight,
    weightedMaxScore: criterion.maxPoints * criterion.weight,
    explanation,
    inputsUsed,
    passed,
  };
}

/**
 * Determine outcome based on score and thresholds
 */
function determineOutcome(
  scorePercentage: number,
  goThreshold: number,
  noThreshold: number
): DecisionOutcome {
  if (scorePercentage >= goThreshold) {
    return DECISION_OUTCOME.GO;
  }
  if (scorePercentage <= noThreshold) {
    return DECISION_OUTCOME.NO;
  }
  return DECISION_OUTCOME.MAYBE;
}

/**
 * Generate human-readable rationale for the decision
 */
function generateRationale(
  outcome: DecisionOutcome,
  scorePercentage: number,
  breakdown: CriterionScore[],
  thresholds: { goThreshold: number; noThreshold: number }
): string {
  const parts: string[] = [];

  // Overall summary
  parts.push(`**Decision: ${outcome}** (Score: ${scorePercentage.toFixed(1)}%)`);
  parts.push("");

  // Threshold explanation
  if (outcome === DECISION_OUTCOME.GO) {
    parts.push(`Score of ${scorePercentage.toFixed(1)}% meets or exceeds the GO threshold of ${thresholds.goThreshold}%.`);
  } else if (outcome === DECISION_OUTCOME.NO) {
    parts.push(`Score of ${scorePercentage.toFixed(1)}% is at or below the NO threshold of ${thresholds.noThreshold}%.`);
  } else {
    parts.push(`Score of ${scorePercentage.toFixed(1)}% falls between thresholds (GO: ${thresholds.goThreshold}%, NO: ${thresholds.noThreshold}%). Manual review recommended.`);
  }
  parts.push("");

  // Key factors
  const passedCriteria = breakdown.filter((c) => c.passed);
  const failedCriteria = breakdown.filter((c) => !c.passed && c.inputsUsed.length > 0);
  const unevaluated = breakdown.filter((c) => c.inputsUsed.length === 0);

  if (passedCriteria.length > 0) {
    parts.push("**Positive factors:**");
    for (const c of passedCriteria) {
      parts.push(`- ${c.name}: ${c.explanation}`);
    }
    parts.push("");
  }

  if (failedCriteria.length > 0) {
    parts.push("**Areas of concern:**");
    for (const c of failedCriteria) {
      parts.push(`- ${c.name}: ${c.explanation}`);
    }
    parts.push("");
  }

  if (unevaluated.length > 0) {
    parts.push("**Could not evaluate:**");
    for (const c of unevaluated) {
      parts.push(`- ${c.name}: ${c.explanation}`);
    }
  }

  return parts.join("\n");
}

// ----- Scoring Service -----

export const scoringService = {
  /**
   * Evaluate a bid and create a decision record
   * Never overwrites - creates new version if bid was previously evaluated
   */
  async evaluateBid(bidId: string): Promise<EvaluationResult> {
    const db = getDb();

    // 1. Fetch bid with client info
    const bidResults = await db
      .select({
        id: bids.id,
        clientId: bids.clientId,
        projectName: bids.projectName,
        senderEmail: bids.senderEmail,
        senderCompany: bids.senderCompany,
        intakeSource: bids.intakeSource,
        receivedAt: bids.receivedAt,
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
    const config = bid.clientConfig as ClientConfig | null;

    if (!config) {
      throw new Error(`Client configuration not found for bid ${bidId}`);
    }

    // 2. Fetch latest extracted fields for this bid
    const fields = await db
      .select({
        signalId: extractedFields.signalId,
        extractedValue: extractedFields.extractedValue,
        confidence: extractedFields.confidence,
        extractionMethod: extractedFields.extractionMethod,
      })
      .from(extractedFields)
      .where(eq(extractedFields.bidId, bidId));

    // Convert to lookup map (use latest value per signal)
    const extractedData: Record<string, { value: string | null; confidence: number | null; source: string | null }> = {};
    for (const field of fields) {
      extractedData[field.signalId] = {
        value: field.extractedValue,
        confidence: field.confidence,
        source: field.extractionMethod,
      };
    }

    // 3. Get scoring criteria and thresholds
    const criteria = config.scoring?.criteria || [];
    const goThreshold = config.scoring?.autoQualifyThreshold || 75;
    const noThreshold = config.scoring?.autoDisqualifyThreshold || 25;

    // 4. Evaluate each criterion
    const scoreBreakdown: CriterionScore[] = criteria.map((criterion: ScoringCriterion) =>
      evaluateCriterion(criterion, extractedData)
    );

    // 5. Calculate totals
    const totalScore = scoreBreakdown.reduce((sum, c) => sum + c.weightedScore, 0);
    const maxScore = scoreBreakdown.reduce((sum, c) => sum + c.weightedMaxScore, 0);
    const scorePercentage = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;

    // 6. Determine outcome
    const outcome = determineOutcome(scorePercentage, goThreshold, noThreshold);

    // 7. Build inputs snapshot for audit
    const inputsSnapshot: InputsSnapshot = {
      bid: {
        id: bid.id,
        projectName: bid.projectName,
        senderEmail: bid.senderEmail,
        senderCompany: bid.senderCompany,
        intakeSource: bid.intakeSource,
        receivedAt: bid.receivedAt.toISOString(),
      },
      extractedFields: extractedData,
      clientConfig: {
        scoringCriteria: criteria,
        thresholds: { goThreshold, noThreshold },
      },
    };

    // 8. Generate rationale
    const rationale = generateRationale(outcome, scorePercentage, scoreBreakdown, { goThreshold, noThreshold });

    // 9. Get next decision version
    const existingDecisions = await db
      .select({ maxVersion: sql<number>`COALESCE(MAX(decision_version), 0)::int` })
      .from(goNoGoDecisions)
      .where(eq(goNoGoDecisions.bidId, bidId));
    const decisionVersion = (existingDecisions[0]?.maxVersion || 0) + 1;

    // 10. Store decision (append-only, never overwrite)
    const [newDecision] = await db
      .insert(goNoGoDecisions)
      .values({
        bidId,
        outcome,
        totalScore,
        maxScore,
        scorePercentage,
        inputsSnapshot: inputsSnapshot as unknown as Record<string, unknown>,
        thresholdsUsed: { goThreshold, noThreshold },
        scoreBreakdown: scoreBreakdown as unknown as Record<string, unknown>[],
        rationale,
        configVersion: config.version,
        decisionVersion,
      })
      .returning({ id: goNoGoDecisions.id, createdAt: goNoGoDecisions.createdAt });

    console.log(`[Scoring] Evaluated bid ${bidId}: ${outcome} (${scorePercentage.toFixed(1)}%) - Decision v${decisionVersion}`);

    return {
      decisionId: newDecision.id,
      bidId,
      outcome,
      totalScore,
      maxScore,
      scorePercentage,
      rationale,
      scoreBreakdown,
      thresholdsUsed: { goThreshold, noThreshold },
      inputsSnapshot,
      decisionVersion,
      createdAt: newDecision.createdAt.toISOString(),
    };
  },

  /**
   * Override a decision
   * Original decision remains immutable, override is stored separately
   */
  async overrideDecision(input: OverrideInput): Promise<OverrideResult> {
    const db = getDb();

    // 1. Verify decision exists
    const decisions = await db
      .select({
        id: goNoGoDecisions.id,
        bidId: goNoGoDecisions.bidId,
        outcome: goNoGoDecisions.outcome,
      })
      .from(goNoGoDecisions)
      .where(eq(goNoGoDecisions.id, input.decisionId))
      .limit(1);

    if (decisions.length === 0) {
      throw new Error(`Decision with ID ${input.decisionId} not found`);
    }

    const decision = decisions[0];

    // Verify bid ID matches
    if (decision.bidId !== input.bidId) {
      throw new Error(`Decision ${input.decisionId} does not belong to bid ${input.bidId}`);
    }

    // 2. Check if override already exists for this decision
    const existingOverride = await db
      .select({ id: decisionOverrides.id })
      .from(decisionOverrides)
      .where(eq(decisionOverrides.decisionId, input.decisionId))
      .limit(1);

    if (existingOverride.length > 0) {
      throw new Error(`Decision ${input.decisionId} has already been overridden. Create a new evaluation first.`);
    }

    // 3. Store override
    const [newOverride] = await db
      .insert(decisionOverrides)
      .values({
        decisionId: input.decisionId,
        bidId: input.bidId,
        originalOutcome: decision.outcome,
        overriddenOutcome: input.newOutcome,
        reasonCategory: input.reasonCategory,
        overriddenBy: input.overriddenBy,
        rationale: input.rationale,
        metadata: input.metadata || null,
      })
      .returning({
        id: decisionOverrides.id,
        createdAt: decisionOverrides.createdAt,
      });

    console.log(
      `[Override] Decision ${input.decisionId} overridden: ${decision.outcome} -> ${input.newOutcome} by ${input.overriddenBy}`
    );

    return {
      overrideId: newOverride.id,
      decisionId: input.decisionId,
      bidId: input.bidId,
      originalOutcome: decision.outcome,
      newOutcome: input.newOutcome,
      reasonCategory: input.reasonCategory,
      rationale: input.rationale,
      overriddenBy: input.overriddenBy,
      createdAt: newOverride.createdAt.toISOString(),
    };
  },

  /**
   * Get full decision history for a bid
   * Includes all decisions and their overrides
   */
  async getDecisionHistory(bidId: string): Promise<DecisionHistory> {
    const db = getDb();

    // Get all decisions for this bid
    const decisions = await db
      .select({
        id: goNoGoDecisions.id,
        outcome: goNoGoDecisions.outcome,
        totalScore: goNoGoDecisions.totalScore,
        scorePercentage: goNoGoDecisions.scorePercentage,
        rationale: goNoGoDecisions.rationale,
        decisionVersion: goNoGoDecisions.decisionVersion,
        createdAt: goNoGoDecisions.createdAt,
      })
      .from(goNoGoDecisions)
      .where(eq(goNoGoDecisions.bidId, bidId))
      .orderBy(desc(goNoGoDecisions.decisionVersion));

    if (decisions.length === 0) {
      return {
        decisions: [],
        currentOutcome: "NOT_EVALUATED",
        hasOverride: false,
      };
    }

    // Get all overrides for these decisions
    const decisionIds = decisions.map((d: typeof decisions[0]) => d.id);
    const overrides = await db
      .select({
        id: decisionOverrides.id,
        decisionId: decisionOverrides.decisionId,
        overriddenOutcome: decisionOverrides.overriddenOutcome,
        reasonCategory: decisionOverrides.reasonCategory,
        rationale: decisionOverrides.rationale,
        overriddenBy: decisionOverrides.overriddenBy,
        createdAt: decisionOverrides.createdAt,
      })
      .from(decisionOverrides)
      .where(sql`${decisionOverrides.decisionId} = ANY(${decisionIds})`);

    // Map overrides to decisions
    const overrideMap = new Map(overrides.map((o: typeof overrides[0]) => [o.decisionId, o]));

    // Build response
    const decisionHistory = decisions.map((d: typeof decisions[0]) => {
      const override = overrideMap.get(d.id);
      return {
        id: d.id,
        outcome: d.outcome,
        totalScore: d.totalScore,
        scorePercentage: d.scorePercentage,
        rationale: d.rationale,
        decisionVersion: d.decisionVersion,
        createdAt: d.createdAt.toISOString(),
        override: override
          ? {
              id: override.id,
              newOutcome: override.overriddenOutcome,
              reasonCategory: override.reasonCategory,
              rationale: override.rationale,
              overriddenBy: override.overriddenBy,
              createdAt: override.createdAt.toISOString(),
            }
          : null,
      };
    });

    // Current outcome is latest decision's outcome, or its override if present
    const latestDecision = decisionHistory[0];
    const currentOutcome = latestDecision.override
      ? latestDecision.override.newOutcome
      : latestDecision.outcome;
    const hasOverride = latestDecision.override !== null;

    return {
      decisions: decisionHistory,
      currentOutcome,
      hasOverride,
    };
  },

  /**
   * Get a single decision with full details
   */
  async getDecisionById(decisionId: string): Promise<{
    decision: EvaluationResult;
    override: OverrideResult | null;
  } | null> {
    const db = getDb();

    const decisions = await db
      .select()
      .from(goNoGoDecisions)
      .where(eq(goNoGoDecisions.id, decisionId))
      .limit(1);

    if (decisions.length === 0) {
      return null;
    }

    const d = decisions[0];

    // Check for override
    const overrides = await db
      .select()
      .from(decisionOverrides)
      .where(eq(decisionOverrides.decisionId, decisionId))
      .limit(1);

    const override = overrides.length > 0 ? overrides[0] : null;

    return {
      decision: {
        decisionId: d.id,
        bidId: d.bidId,
        outcome: d.outcome as DecisionOutcome,
        totalScore: d.totalScore,
        maxScore: d.maxScore,
        scorePercentage: d.scorePercentage,
        rationale: d.rationale,
        scoreBreakdown: d.scoreBreakdown as unknown as CriterionScore[],
        thresholdsUsed: d.thresholdsUsed as { goThreshold: number; noThreshold: number },
        inputsSnapshot: d.inputsSnapshot as unknown as InputsSnapshot,
        decisionVersion: d.decisionVersion,
        createdAt: d.createdAt.toISOString(),
      },
      override: override
        ? {
            overrideId: override.id,
            decisionId: override.decisionId,
            bidId: override.bidId,
            originalOutcome: override.originalOutcome,
            newOutcome: override.overriddenOutcome,
            reasonCategory: override.reasonCategory,
            rationale: override.rationale,
            overriddenBy: override.overriddenBy,
            createdAt: override.createdAt.toISOString(),
          }
        : null,
    };
  },
};

