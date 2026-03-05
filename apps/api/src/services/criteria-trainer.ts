/**
 * Criteria Trainer Service
 *
 * Analyzes ore samples (reference bids) to propose qualification criteria.
 * Uses AI to extract patterns across GO/MAYBE/NO buckets.
 */

import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

export interface OreSampleForAnalysis {
  outcome: "GO" | "MAYBE" | "NO";
  reason: string;
  notes?: string | null;
  extractedFields: Record<string, string | number | boolean | null>;
  projectName?: string | null;
}

export interface ProposedCriteria {
  criteria: Array<{
    criterionId: string;
    name: string;
    description?: string;
    type: "boolean" | "range";
    weight: number;
    maxPoints: number;
    dependsOnSignals: string[];
    rules: Array<{
      signal: string;
      condition: string;
      value?: unknown;
      points: number;
    }>;
  }>;
  suggestedThresholds: {
    autoQualifyThreshold: number;
    autoDisqualifyThreshold: number;
  };
  summary: string;
}

export async function analyzeOreSamplesAndProposeCriteria(
  samples: OreSampleForAnalysis[],
  intakeFieldKeys: string[]
): Promise<ProposedCriteria> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for criteria analysis");
  }

  const client = new ChatOpenAI({
    model: "gpt-4o-mini",
    temperature: 0.3,
    apiKey,
  });

  const samplesJson = JSON.stringify(
    samples.map((s) => ({
      outcome: s.outcome,
      reason: s.reason,
      notes: s.notes,
      projectName: s.projectName,
      fields: s.extractedFields,
    })),
    null,
    2
  );

  const systemPrompt = `You are an expert at analyzing construction bid data to derive qualification criteria.
Given a set of "ore samples" - past bids classified as GO (Yes), MAYBE (Yes with caveats), or NO (with reasons) -
your job is to:
1. Identify recurring patterns in the extracted fields that distinguish GO from NO
2. Propose a scoring criteria set (field importance, thresholds, rules)
3. Suggest auto-qualify and auto-disqualify thresholds (0-100)
4. Output valid JSON matching the ScoringCriterion schema

Rules:
- Use only the field keys provided: ${intakeFieldKeys.join(", ")}
- Each criterion should have: criterionId (snake_case), name, type (boolean or range), weight (0-5), maxPoints (0-100)
- Rules use: signal, condition (exists, not_exists, equals, contains, gt, lt, gte, lte), value (optional), points
- Be conservative - propose 4-8 criteria based on clear patterns
- For MAYBE samples, look for caveats in reasons that suggest conditional logic`;

  const userPrompt = `Analyze these ore samples and propose qualification criteria:

${samplesJson}

Return a JSON object with this exact structure:
{
  "criteria": [
    {
      "criterionId": "string",
      "name": "string",
      "description": "optional",
      "type": "boolean" | "range",
      "weight": 1,
      "maxPoints": 10,
      "dependsOnSignals": ["field_key"],
      "rules": [
        { "signal": "field_key", "condition": "exists", "points": 10 }
      ]
    }
  ],
  "suggestedThresholds": {
    "autoQualifyThreshold": 75,
    "autoDisqualifyThreshold": 25
  },
  "summary": "Brief explanation of patterns found and criteria rationale"
}`;

  const response = await client.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(userPrompt),
  ]);

  const text = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("No JSON found in AI response");
  }

  const parsed = JSON.parse(jsonMatch[0]) as ProposedCriteria;

  if (!parsed.criteria || !Array.isArray(parsed.criteria)) {
    throw new Error("Invalid AI response: missing criteria array");
  }

  return parsed;
}
