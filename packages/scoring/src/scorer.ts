import type { ScoringCriterion, DecisionOutcome } from "@bid-catcher/config";
import { DECISION_OUTCOME } from "@bid-catcher/config";
import type {
  ScoringInput,
  ScoringResult,
  CriterionResult,
  ExtractedFieldData,
  AIEvaluationEmbedded,
} from "./types.js";
import { evaluateWithAI, mergeEvaluationResults } from "./ai-evaluator.js";

/** Options for bid scoring */
export interface ScoringOptions {
  /** Use AI for evaluation (default: false) */
  useAI?: boolean;
  /** Weight for AI in hybrid mode (0-1, default: 0.3) */
  aiWeight?: number;
  /** Project name for AI context */
  projectName?: string;
  /** Client name for AI context */
  clientName?: string;
  /** Additional client context for AI */
  clientContext?: {
    preferredProjectTypes?: string[];
    preferredRegions?: string[];
    minProjectValue?: number;
    maxProjectValue?: number;
    specializations?: string[];
  };
}

/**
 * Go/No-Go Scoring Engine
 *
 * Evaluates bids against client-defined criteria using deterministic rules.
 * No ML - all logic is explainable and traceable.
 */

/**
 * Score a bid against client criteria
 *
 * @param input - Scoring input with extracted fields and config
 * @param options - Optional settings for AI and hybrid evaluation
 * @returns Scoring result with outcome and breakdown
 */
export async function scoreBid(
  input: ScoringInput,
  options: ScoringOptions = {}
): Promise<ScoringResult> {
  const { bidId, clientId, extractedFields, scoringConfig } = input;
  const { useAI = false, aiWeight = 0.3, projectName, clientName, clientContext } = options;
  const warnings: string[] = [];

  // Evaluate each criterion using rules
  const criteriaResults: CriterionResult[] = scoringConfig.criteria.map(
    (criterion: ScoringCriterion) => {
      return evaluateCriterion(criterion, extractedFields, warnings);
    }
  );

  // Calculate totals from rule-based scoring
  let totalScore = criteriaResults.reduce((sum, r) => sum + r.weightedScore, 0);
  const maxScore = criteriaResults.reduce((sum, r) => sum + r.weightedMaxScore, 0);

  // Data completeness bonus: prevent 0 when all/most fields are filled
  const filledCount = Object.values(extractedFields).filter(
    (f) => f.value !== null && f.value !== undefined && String(f.value).trim() !== ""
  ).length;
  const COMPLETENESS_MAX_BONUS = 25; // Up to 25% from having rich data
  const completenessBonus =
    filledCount >= 3
      ? Math.min(COMPLETENESS_MAX_BONUS, (filledCount / 10) * COMPLETENESS_MAX_BONUS)
      : 0;
  if (completenessBonus > 0 && totalScore === 0) {
    totalScore = (completenessBonus / 100) * maxScore;
    warnings.push(
      `Data completeness bonus: +${completenessBonus.toFixed(0)}% (${filledCount} fields filled, criteria have no matching rules)`
    );
  }

  const scorePercentage = Math.min(
    100,
    maxScore > 0 ? (totalScore / maxScore) * 100 : completenessBonus
  );

  // Determine rule-based outcome
  const ruleOutcome = determineOutcome(
    scorePercentage,
    scoringConfig.autoQualifyThreshold,
    scoringConfig.autoDisqualifyThreshold,
    scoringConfig.alwaysRequireReview
  );

  let finalOutcome: DecisionOutcome = ruleOutcome;
  let aiEvaluation: AIEvaluationEmbedded | undefined;
  let evaluationMethod: "rules" | "ai" | "hybrid" = "rules";
  let explanation = generateExplanation(ruleOutcome, scorePercentage, criteriaResults);

  // Run AI evaluation if requested
  if (useAI) {
    const aiResult = await evaluateWithAI({
      bidId,
      clientId,
      clientName,
      projectName,
      extractedFields,
      scoringCriteria: scoringConfig.criteria,
      ruleBasedResults: criteriaResults,
      clientContext,
    });

    aiEvaluation = {
      success: aiResult.success,
      recommendation: aiResult.recommendation,
      confidence: Math.min(1, Math.max(0, aiResult.confidence / 100)),
      reasoning: aiResult.reasoning,
      keyFactors: aiResult.keyFactors,
      riskAssessment: aiResult.riskAssessment,
      suggestedQuestions: aiResult.suggestedQuestions,
      processingTimeMs: aiResult.processingInfo.processingTimeMs,
      error: aiResult.error,
    };

    if (aiResult.success) {
      // Merge results
      const merged = mergeEvaluationResults(
        ruleOutcome,
        scorePercentage,
        aiResult,
        aiWeight
      );
      finalOutcome = merged.finalOutcome as DecisionOutcome;
      explanation = merged.reasoning;
      evaluationMethod = "hybrid";
    } else {
      warnings.push(`AI evaluation failed: ${aiResult.error}`);
    }
  }

  return {
    bidId,
    clientId,
    outcome: finalOutcome,
    totalScore,
    maxScore,
    scorePercentage,
    criteriaResults,
    explanation,
    thresholds: {
      autoQualify: scoringConfig.autoQualifyThreshold,
      autoDisqualify: scoringConfig.autoDisqualifyThreshold,
    },
    aiEvaluation,
    evaluationMethod,
    metadata: {
      evaluatedAt: new Date().toISOString(),
      configVersion: "1.0",
      warnings,
    },
  };
}

/**
 * Score a bid using AI only (no rule-based scoring)
 */
export async function scoreBidWithAIOnly(
  input: ScoringInput,
  options: Omit<ScoringOptions, 'useAI' | 'aiWeight'> = {}
): Promise<ScoringResult> {
  const { bidId, clientId, extractedFields, scoringConfig } = input;
  const { projectName, clientName, clientContext } = options;
  const warnings: string[] = [];

  // Still run rule-based for reference
  const criteriaResults: CriterionResult[] = scoringConfig.criteria.map(
    (criterion: ScoringCriterion) => {
      return evaluateCriterion(criterion, extractedFields, warnings);
    }
  );

  const totalScore = criteriaResults.reduce((sum, r) => sum + r.weightedScore, 0);
  const maxScore = criteriaResults.reduce((sum, r) => sum + r.weightedMaxScore, 0);
  const scorePercentage = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;

  // Run AI evaluation
  const aiResult = await evaluateWithAI({
    bidId,
    clientId,
    clientName,
    projectName,
    extractedFields,
    scoringCriteria: scoringConfig.criteria,
    ruleBasedResults: criteriaResults,
    clientContext,
  });

  const aiEvaluation: AIEvaluationEmbedded = {
    success: aiResult.success,
    recommendation: aiResult.recommendation,
    confidence: Math.min(1, Math.max(0, aiResult.confidence / 100)),
    reasoning: aiResult.reasoning,
    keyFactors: aiResult.keyFactors,
    riskAssessment: aiResult.riskAssessment,
    suggestedQuestions: aiResult.suggestedQuestions,
    processingTimeMs: aiResult.processingInfo.processingTimeMs,
    error: aiResult.error,
  };

  // AI-only uses AI recommendation directly
  const finalOutcome = aiResult.success ? aiResult.recommendation : DECISION_OUTCOME.MAYBE;

  if (!aiResult.success) {
    warnings.push(`AI evaluation failed: ${aiResult.error}. Defaulting to MAYBE.`);
  }

  return {
    bidId,
    clientId,
    outcome: finalOutcome as DecisionOutcome,
    totalScore,
    maxScore,
    scorePercentage,
    criteriaResults,
    explanation: aiResult.reasoning,
    thresholds: {
      autoQualify: scoringConfig.autoQualifyThreshold,
      autoDisqualify: scoringConfig.autoDisqualifyThreshold,
    },
    aiEvaluation,
    evaluationMethod: "ai",
    metadata: {
      evaluatedAt: new Date().toISOString(),
      configVersion: "1.0",
      warnings,
    },
  };
}

/** Maps criterion IDs to likely signal IDs when criteria lack explicit dependsOnSignals */
const CRITERION_TO_SIGNALS: Record<string, string[]> = {
  project_in_service_area: ["project_location"],
  timeline_feasible: ["bid_due_date", "start_date", "completion_date", "project_duration"],
  project_size_fit: ["project_value_estimate"],
  bonding_capacity: ["bond_required"],
  relationship_score: ["general_contractor", "owner_name"],
};

/**
 * Evaluate a single criterion against extracted fields
 */
function evaluateCriterion(
  criterion: ScoringCriterion,
  extractedFields: ExtractedFieldData,
  warnings: string[]
): CriterionResult {
  const signalsUsed: string[] = [];
  let evaluated = false;
  let score = 0;

  // Use explicit dependsOnSignals, or infer from criterion ID when absent
  let dependentSignals = criterion.dependsOnSignals || [];
  if (dependentSignals.length === 0 && CRITERION_TO_SIGNALS[criterion.criterionId]) {
    dependentSignals = CRITERION_TO_SIGNALS[criterion.criterionId];
  }

  if (dependentSignals.length > 0) {
    // Check which signals we have
    for (const signalId of dependentSignals) {
      const field = extractedFields[signalId];
      if (field && field.value !== null) {
        signalsUsed.push(signalId);
      }
    }

    // If we have signals, try to evaluate rules
    if (signalsUsed.length > 0 && criterion.rules && criterion.rules.length > 0) {
      for (const rule of criterion.rules) {
        const field = extractedFields[rule.signal];
        if (field && field.value !== null) {
          const ruleResult = evaluateRule(rule, field.value);
          if (ruleResult) {
            score += rule.points;
            evaluated = true;
          }
        }
      }
    } else if (signalsUsed.length > 0 && (!criterion.rules || criterion.rules.length === 0)) {
      // No explicit rules: award partial points when relevant data exists
      const pointsPerSignal = criterion.maxPoints / Math.max(1, dependentSignals.length);
      for (const signalId of dependentSignals) {
        const field = extractedFields[signalId];
        if (field && field.value !== null && String(field.value).trim() !== "") {
          score += pointsPerSignal;
          evaluated = true;
        }
      }
      score = Math.min(score, criterion.maxPoints);
    } else if (signalsUsed.length === 0) {
      // No signals available - can't evaluate
      warnings.push(
        `Criterion '${criterion.criterionId}' could not be evaluated: missing required signals`
      );
    }
  } else {
    // No dependent signals - this criterion needs manual scoring
    // For MVP, mark as not evaluated
    warnings.push(
      `Criterion '${criterion.criterionId}' has no dependent signals - requires manual evaluation`
    );
  }

  // Cap score at maxPoints
  score = Math.min(score, criterion.maxPoints);

  const weightedScore = score * criterion.weight;
  const weightedMaxScore = criterion.maxPoints * criterion.weight;

  return {
    criterionId: criterion.criterionId,
    name: criterion.name,
    weight: criterion.weight,
    score,
    maxScore: criterion.maxPoints,
    weightedScore,
    weightedMaxScore,
    explanation: evaluated
      ? `Scored ${score}/${criterion.maxPoints} points`
      : "Could not be automatically evaluated",
    signalsUsed,
    evaluated,
  };
}

/**
 * Evaluate a single rule against a value
 */
function evaluateRule(
  rule: { condition: string; value?: unknown; signal: string; points: number },
  actualValue: string
): boolean {
  const { condition, value: expectedValue } = rule;

  switch (condition) {
    case "exists":
      return actualValue !== null && actualValue !== "";

    case "not_exists":
      return actualValue === null || actualValue === "";

    case "equals":
      return String(actualValue).toLowerCase() === String(expectedValue).toLowerCase();

    case "not_equals":
      return String(actualValue).toLowerCase() !== String(expectedValue).toLowerCase();

    case "contains":
      return String(actualValue).toLowerCase().includes(String(expectedValue).toLowerCase());

    case "not_contains":
      return !String(actualValue).toLowerCase().includes(String(expectedValue).toLowerCase());

    case "gt":
      return parseFloat(actualValue) > Number(expectedValue);

    case "lt":
      return parseFloat(actualValue) < Number(expectedValue);

    case "gte":
      return parseFloat(actualValue) >= Number(expectedValue);

    case "lte":
      return parseFloat(actualValue) <= Number(expectedValue);

    default:
      return false;
  }
}

/**
 * Determine the outcome based on score and thresholds
 */
function determineOutcome(
  scorePercentage: number,
  autoQualifyThreshold: number,
  autoDisqualifyThreshold: number,
  alwaysRequireReview: boolean
): DecisionOutcome {
  if (alwaysRequireReview) {
    return DECISION_OUTCOME.MAYBE;
  }

  if (scorePercentage >= autoQualifyThreshold) {
    return DECISION_OUTCOME.GO;
  }

  if (scorePercentage <= autoDisqualifyThreshold) {
    return DECISION_OUTCOME.NO;
  }

  return DECISION_OUTCOME.MAYBE;
}

/**
 * Generate a human-readable explanation
 */
function generateExplanation(
  outcome: DecisionOutcome,
  scorePercentage: number,
  criteriaResults: CriterionResult[]
): string {
  const evaluated = criteriaResults.filter((r) => r.evaluated);
  const notEvaluated = criteriaResults.filter((r) => !r.evaluated);

  let explanation = `Score: ${scorePercentage.toFixed(1)}%. `;

  switch (outcome) {
    case DECISION_OUTCOME.GO:
      explanation += "Automatically qualified based on score threshold. ";
      break;
    case DECISION_OUTCOME.NO:
      explanation += "Automatically disqualified based on score threshold. ";
      break;
    case DECISION_OUTCOME.MAYBE:
      explanation += "Requires human review. ";
      break;
  }

  if (evaluated.length > 0) {
    explanation += `${evaluated.length} criteria evaluated automatically. `;
  }

  if (notEvaluated.length > 0) {
    explanation += `${notEvaluated.length} criteria require manual evaluation.`;
  }

  return explanation.trim();
}

/**
 * Validate scoring configuration
 */
export function validateScoringConfig(config: unknown): boolean {
  // Basic validation - could be expanded
  if (!config || typeof config !== "object") return false;

  const c = config as Record<string, unknown>;
  if (!Array.isArray(c.criteria)) return false;
  if (typeof c.autoQualifyThreshold !== "number") return false;
  if (typeof c.autoDisqualifyThreshold !== "number") return false;

  return true;
}

