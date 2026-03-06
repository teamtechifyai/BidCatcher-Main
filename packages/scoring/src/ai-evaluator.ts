/**
 * AI-Powered Go/No-Go Evaluator
 *
 * Uses LLM to analyze bid data and provide intelligent recommendations.
 * Complements rule-based scoring with contextual understanding.
 */

import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { StructuredOutputParser } from "langchain/output_parsers";
import type { ScoringCriterion } from "@bid-catcher/config";
import type { ExtractedFieldData, CriterionResult } from "./types.js";

// ----- Types -----

export interface AIEvaluationInput {
  bidId: string;
  clientId: string;
  clientName?: string;
  projectName?: string;
  extractedFields: ExtractedFieldData;
  scoringCriteria: ScoringCriterion[];
  ruleBasedResults?: CriterionResult[];
  clientContext?: {
    preferredProjectTypes?: string[];
    preferredRegions?: string[];
    minProjectValue?: number;
    maxProjectValue?: number;
    specializations?: string[];
  };
}

export interface AIEvaluationResult {
  success: boolean;
  recommendation: "GO" | "MAYBE" | "NO";
  confidence: number; // 0-100
  reasoning: string;
  keyFactors: {
    positive: string[];
    negative: string[];
    neutral: string[];
  };
  riskAssessment: {
    level: "LOW" | "MEDIUM" | "HIGH";
    factors: string[];
  };
  suggestedQuestions: string[];
  processingInfo: {
    model: string;
    processingTimeMs: number;
    tokensUsed?: number;
  };
  error?: string;
}

// ----- AI Response Schema -----

const AIResponseSchema = z.object({
  recommendation: z.enum(["GO", "MAYBE", "NO"]),
  confidence: z.number().min(0).max(100),
  reasoning: z.string(),
  positiveFactors: z.array(z.string()),
  negativeFactors: z.array(z.string()),
  neutralFactors: z.array(z.string()),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]),
  riskFactors: z.array(z.string()),
  suggestedQuestions: z.array(z.string()),
});

// ----- AI Evaluator -----

/**
 * Evaluate a bid using AI for intelligent Go/No-Go recommendation
 */
export async function evaluateWithAI(
  input: AIEvaluationInput
): Promise<AIEvaluationResult> {
  const startTime = Date.now();

  // Check for API key
  if (!process.env.OPENAI_API_KEY) {
    return {
      success: false,
      recommendation: "MAYBE",
      confidence: 0,
      reasoning: "AI evaluation unavailable - OPENAI_API_KEY not configured",
      keyFactors: { positive: [], negative: [], neutral: [] },
      riskAssessment: { level: "MEDIUM", factors: ["AI evaluation not available"] },
      suggestedQuestions: ["Complete manual review required"],
      processingInfo: {
        model: "none",
        processingTimeMs: Date.now() - startTime,
      },
      error: "OPENAI_API_KEY not configured",
    };
  }

  try {
    const parser = StructuredOutputParser.fromZodSchema(AIResponseSchema);
    const formatInstructions = parser.getFormatInstructions();

    // Build the prompt with all available context
    const prompt = buildEvaluationPrompt(input, formatInstructions);

    const model = new ChatOpenAI({
      model: "gpt-4o-mini",
      temperature: 0.1, // Low temperature for consistent evaluations
      openAIApiKey: process.env.OPENAI_API_KEY,
    });

    const response = await model.invoke([
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(prompt),
    ]);

    const parsedResponse = await parser.parse(response.content.toString());

    // Clamp confidence to 0-100 (AI may occasionally return out-of-range values)
    const confidence = Math.min(100, Math.max(0, Number(parsedResponse.confidence) || 0));

    return {
      success: true,
      recommendation: parsedResponse.recommendation,
      confidence,
      reasoning: parsedResponse.reasoning,
      keyFactors: {
        positive: parsedResponse.positiveFactors,
        negative: parsedResponse.negativeFactors,
        neutral: parsedResponse.neutralFactors,
      },
      riskAssessment: {
        level: parsedResponse.riskLevel,
        factors: parsedResponse.riskFactors,
      },
      suggestedQuestions: parsedResponse.suggestedQuestions,
      processingInfo: {
        model: "gpt-4o-mini",
        processingTimeMs: Date.now() - startTime,
      },
    };
  } catch (error) {
    console.error("AI evaluation failed:", error);
    return {
      success: false,
      recommendation: "MAYBE",
      confidence: 0,
      reasoning: `AI evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
      keyFactors: { positive: [], negative: [], neutral: [] },
      riskAssessment: { level: "MEDIUM", factors: ["AI evaluation failed"] },
      suggestedQuestions: ["Complete manual review required due to AI error"],
      processingInfo: {
        model: "gpt-4o-mini",
        processingTimeMs: Date.now() - startTime,
      },
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ----- System Prompt -----

const SYSTEM_PROMPT = `You are an expert construction bid analyst helping contractors make Go/No-Go decisions on bid opportunities.

Your role is to:
1. Analyze bid information and extracted data
2. Evaluate fit with the contractor's capabilities and preferences
3. Identify risks and opportunities
4. Provide a clear recommendation with supporting rationale

Decision Guidelines:
- GO: Strong fit, manageable risks, aligns with company strengths
- MAYBE: Potential fit but needs more information or has notable concerns
- NO: Poor fit, high risks, or clear misalignment with capabilities

Be direct, specific, and actionable in your analysis. Focus on factors that matter most for bid/no-bid decisions in construction.`;

// ----- Prompt Builder -----

function buildEvaluationPrompt(
  input: AIEvaluationInput,
  formatInstructions: string
): string {
  const sections: string[] = [];

  // Header
  sections.push("# Bid Evaluation Request");
  sections.push("");

  // Project info
  sections.push("## Project Information");
  const now = new Date();
  sections.push(`- **Current Date/Time**: ${now.toISOString()} (use this to assess if bid dates are stale)`);
  if (input.projectName) {
    sections.push(`- **Project Name**: ${input.projectName}`);
  }
  sections.push(`- **Bid ID**: ${input.bidId}`);
  if (input.clientName) {
    sections.push(`- **Client**: ${input.clientName}`);
  }
  sections.push("");

  // Extracted fields (normalize confidence: support both 0-1 and 0-100 scales)
  sections.push("## Extracted Bid Data");
  const fields = input.extractedFields;
  if (Object.keys(fields).length > 0) {
    for (const [key, data] of Object.entries(fields)) {
      if (data.value !== null && data.value !== undefined) {
        const conf = data.confidence > 1 ? data.confidence / 100 : data.confidence;
        const confidenceLabel = conf >= 0.8 ? "✓ high" : conf >= 0.5 ? "~ medium" : "? low";
        const label = formatFieldLabel(key);
        sections.push(`- **${label}**: ${data.value} (${confidenceLabel})`);
      }
    }
  } else {
    sections.push("*No extracted data available*");
  }
  sections.push("");

  // Scoring criteria context (include descriptions for optimal AI evaluation)
  if (input.scoringCriteria && input.scoringCriteria.length > 0) {
    sections.push("## Evaluation Criteria (Client-Defined)");
    for (const criterion of input.scoringCriteria) {
      const desc = criterion.description ? ` — ${criterion.description}` : "";
      sections.push(`- **${criterion.name}** (weight: ${criterion.weight}, max: ${criterion.maxPoints} pts)${desc}`);
    }
    sections.push("");
  }

  // Rule-based results if available
  if (input.ruleBasedResults && input.ruleBasedResults.length > 0) {
    sections.push("## Rule-Based Scoring Results");
    let totalScore = 0;
    let maxScore = 0;
    for (const result of input.ruleBasedResults) {
      const status = result.evaluated ? `${result.score}/${result.maxScore}` : "Not evaluated";
      sections.push(`- **${result.name}**: ${status}`);
      if (result.evaluated) {
        totalScore += result.weightedScore;
        maxScore += result.weightedMaxScore;
      }
    }
    if (maxScore > 0) {
      const percentage = ((totalScore / maxScore) * 100).toFixed(1);
      sections.push(`- **Total**: ${percentage}% weighted score`);
    }
    sections.push("");
  }

  // Client context/preferences
  if (input.clientContext) {
    sections.push("## Client Preferences & Capabilities");
    const ctx = input.clientContext;
    if (ctx.preferredProjectTypes?.length) {
      sections.push(`- **Preferred Project Types**: ${ctx.preferredProjectTypes.join(", ")}`);
    }
    if (ctx.preferredRegions?.length) {
      sections.push(`- **Preferred Regions**: ${ctx.preferredRegions.join(", ")}`);
    }
    if (ctx.minProjectValue || ctx.maxProjectValue) {
      const min = ctx.minProjectValue ? `$${ctx.minProjectValue.toLocaleString()}` : "any";
      const max = ctx.maxProjectValue ? `$${ctx.maxProjectValue.toLocaleString()}` : "any";
      sections.push(`- **Project Value Range**: ${min} - ${max}`);
    }
    if (ctx.specializations?.length) {
      sections.push(`- **Specializations**: ${ctx.specializations.join(", ")}`);
    }
    sections.push("");
  }

  // Format instructions
  sections.push("## Response Format");
  sections.push(formatInstructions);
  sections.push("");

  // Request
  sections.push("## Your Task");
  sections.push("Analyze this bid opportunity and provide your Go/No-Go recommendation with detailed reasoning.");
  sections.push("");
  sections.push("**Critical constraints:**");
  sections.push("- ONLY base your recommendation on the evaluation criteria listed above. Do NOT reject or approve based on factors not in the config.");
  sections.push("- If a criterion is not in the config, do not use it as a reason. Stick strictly to the configured criteria.");
  sections.push("- Use the Current Date/Time to flag stale bid dates (e.g. bid due date in the past).");
  sections.push("- confidence MUST be a number between 0 and 100 (percentage). Use 0 for no confidence, 100 for full confidence.");
  sections.push("- Base your confidence on how much relevant data is available and how clear the fit/no-fit signals are for the configured criteria.");

  return sections.join("\n");
}

/**
 * Format a field key into a readable label
 */
function formatFieldLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([A-Z])/g, " $1")
    .replace(/\b\w/g, (l) => l.toUpperCase())
    .trim();
}

/**
 * Merge AI evaluation with rule-based scoring for a hybrid result
 */
export function mergeEvaluationResults(
  ruleBasedOutcome: "GO" | "MAYBE" | "NO",
  ruleBasedScore: number,
  aiResult: AIEvaluationResult,
  aiWeight: number = 0.3 // 30% weight to AI by default
): {
  finalOutcome: "GO" | "MAYBE" | "NO";
  combinedConfidence: number;
  reasoning: string;
} {
  if (!aiResult.success) {
    // AI failed - use rule-based only
    return {
      finalOutcome: ruleBasedOutcome,
      combinedConfidence: ruleBasedScore,
      reasoning: `Based on rule-based scoring (AI unavailable): ${ruleBasedOutcome}`,
    };
  }

  // Convert outcomes to numeric scores for weighted combination
  const outcomeToScore = { GO: 100, MAYBE: 50, NO: 0 };
  const ruleScore = outcomeToScore[ruleBasedOutcome];
  const aiScore = outcomeToScore[aiResult.recommendation];

  // Weighted combination (clamp confidence to 0-100)
  const combinedScore = ruleScore * (1 - aiWeight) + aiScore * aiWeight;
  const combinedConfidence = Math.min(
    100,
    Math.max(0, ruleBasedScore * (1 - aiWeight) + aiResult.confidence * aiWeight)
  );

  // Determine final outcome based on combined score
  let finalOutcome: "GO" | "MAYBE" | "NO";
  if (combinedScore >= 75) {
    finalOutcome = "GO";
  } else if (combinedScore <= 25) {
    finalOutcome = "NO";
  } else {
    finalOutcome = "MAYBE";
  }

  // If there's strong disagreement, default to MAYBE for human review
  if (
    (ruleBasedOutcome === "GO" && aiResult.recommendation === "NO") ||
    (ruleBasedOutcome === "NO" && aiResult.recommendation === "GO")
  ) {
    finalOutcome = "MAYBE";
  }

  const reasoning = buildMergedReasoning(ruleBasedOutcome, aiResult, finalOutcome);

  return {
    finalOutcome,
    combinedConfidence,
    reasoning,
  };
}

function buildMergedReasoning(
  ruleOutcome: string,
  aiResult: AIEvaluationResult,
  finalOutcome: string
): string {
  const lines: string[] = [];

  lines.push(`## Combined Analysis: ${finalOutcome}`);
  lines.push("");
  lines.push(`**Rule-Based Result**: ${ruleOutcome}`);
  lines.push(`**AI Recommendation**: ${aiResult.recommendation} (${aiResult.confidence}% confidence)`);
  lines.push("");

  lines.push("### AI Analysis");
  lines.push(aiResult.reasoning);
  lines.push("");

  if (aiResult.keyFactors.positive.length > 0) {
    lines.push("### Positive Factors");
    for (const factor of aiResult.keyFactors.positive) {
      lines.push(`✅ ${factor}`);
    }
    lines.push("");
  }

  if (aiResult.keyFactors.negative.length > 0) {
    lines.push("### Concerns");
    for (const factor of aiResult.keyFactors.negative) {
      lines.push(`⚠️ ${factor}`);
    }
    lines.push("");
  }

  lines.push(`### Risk Assessment: ${aiResult.riskAssessment.level}`);
  for (const risk of aiResult.riskAssessment.factors) {
    lines.push(`- ${risk}`);
  }
  lines.push("");

  if (aiResult.suggestedQuestions.length > 0) {
    lines.push("### Suggested Follow-up Questions");
    for (const q of aiResult.suggestedQuestions) {
      lines.push(`❓ ${q}`);
    }
  }

  return lines.join("\n");
}

