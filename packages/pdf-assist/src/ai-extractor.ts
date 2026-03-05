/**
 * PDF Assist - AI Extractor Service
 *
 * Uses LangChain + OpenAI to intelligently extract structured data from PDF bid documents.
 * Extraction is DYNAMIC based on client-configured intake fields.
 */

import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { IntakeField } from "@bid-catcher/config";

// ----- AI Extraction Configuration -----

const EXTRACTION_SYSTEM_PROMPT = `You are an expert construction bid document analyzer. Your job is to extract specific fields from bid invitation documents, RFPs, and construction specifications.

IMPORTANT RULES:
1. Only extract information that is EXPLICITLY stated in the document
2. If a field is not found or unclear, return null for that field
3. For dates, use ISO format (YYYY-MM-DD) when possible
4. For boolean fields, determine true/false based on context (e.g., "mandatory pre-bid meeting" = true for a "meeting required" field)
5. Be precise with monetary values - include the exact amount or range mentioned
6. For text fields, extract the relevant value concisely
7. For textarea/long text fields, you may include more detail (up to 500 chars)

Return your extraction as valid JSON matching the requested schema.`;

// ----- Types -----

export interface AIExtractionInput {
  /** Raw text extracted from PDF */
  rawText: string;
  
  /** Client-specific intake fields to extract - THIS IS THE PRIMARY CONFIGURATION */
  clientIntakeFields: IntakeField[];
  
  /** Document filename for context */
  filename?: string;
}

export interface AIExtractionResult {
  /** Whether extraction succeeded */
  success: boolean;
  
  /** Extracted data keyed by field key */
  extractedData: Record<string, string | number | boolean | null>;
  
  /** Confidence scores per field (0-1) */
  confidenceScores: Record<string, number>;
  
  /** Processing time in ms */
  processingTimeMs: number;
  
  /** Any warnings or notes */
  warnings: string[];
  
  /** Error message if failed */
  error?: string;
}

// ----- AI Extraction Functions -----

/**
 * Initialize the LangChain OpenAI client
 */
function getOpenAIClient(): ChatOpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is required for AI extraction");
  }
  
  return new ChatOpenAI({
    model: "gpt-4o-mini", // Cost-effective model with good extraction capabilities
    temperature: 0, // Deterministic output for consistent extraction
    apiKey,
  });
}

/**
 * Build the extraction prompt dynamically from client intake fields
 */
function buildDynamicExtractionPrompt(
  rawText: string,
  intakeFields: IntakeField[],
  filename?: string
): string {
  // Build field descriptions from client config
  const fieldDescriptions = intakeFields.map(field => {
    const typeHint = getTypeHint(field.type);
    const requiredTag = field.required ? " [REQUIRED]" : "";
    const optionsHint = field.options ? ` (options: ${field.options.join(", ")})` : "";
    const aiContext = field.aiDescription ? ` — ${field.aiDescription}` : "";
    
    return `- ${field.key} (${typeHint}): ${field.label}${requiredTag}${optionsHint}${aiContext}`;
  });

  const contextInfo = filename ? `\nDocument: ${filename}` : "";

  // Truncate document if too long (GPT-4o-mini context limit)
  const maxTextLength = 15000;
  const truncatedText = rawText.length > maxTextLength 
    ? rawText.substring(0, maxTextLength) + "\n\n... [Document truncated for processing]"
    : rawText;

  return `Extract the following fields from this construction bid document.
These fields are configured specifically for this client's intake form.

FIELDS TO EXTRACT:
${fieldDescriptions.join("\n")}
${contextInfo}

DOCUMENT TEXT:
---
${truncatedText}
---

Return a JSON object with the extracted values. Use null for any field not found.
Include a "_confidence" object with confidence scores (0.0-1.0) for each extracted field.
For boolean fields, return true/false based on whether the condition is indicated in the document.
For select fields with options, match the extracted value to the closest option if possible.

Example response format:
{
  "project_name": "Example Project",
  "bid_due_date": "2024-03-15",
  "bond_required": true,
  "project_type": "Commercial",
  "_confidence": {
    "project_name": 0.95,
    "bid_due_date": 0.85,
    "bond_required": 0.90,
    "project_type": 0.70
  }
}`;
}

/**
 * Get type hint for prompt based on field type
 */
function getTypeHint(type: string): string {
  switch (type) {
    case "boolean":
      return "true/false";
    case "number":
      return "number";
    case "date":
      return "date as YYYY-MM-DD";
    case "select":
      return "one of the options";
    case "textarea":
      return "text, can be longer";
    default:
      return "text";
  }
}

/**
 * Parse AI response and validate against expected fields
 */
function parseAIResponse(
  response: string,
  intakeFields: IntakeField[]
): { data: Record<string, string | number | boolean | null>; confidenceScores: Record<string, number> } {
  // Extract JSON from response (handle markdown code blocks)
  let jsonStr = response;
  const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  }
  
  // Try to find JSON object
  const objectMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (!objectMatch) {
    throw new Error("No valid JSON object found in AI response");
  }
  
  const parsed = JSON.parse(objectMatch[0]);
  
  // Separate confidence scores
  const confidenceScores: Record<string, number> = parsed._confidence || {};
  delete parsed._confidence;
  
  // Validate and coerce field types
  const data: Record<string, string | number | boolean | null> = {};
  const expectedKeys = new Set(intakeFields.map(f => f.key));
  
  for (const field of intakeFields) {
    const value = parsed[field.key];
    
    if (value === null || value === undefined) {
      data[field.key] = null;
      continue;
    }
    
    // Coerce to expected type
    switch (field.type) {
      case "boolean":
        data[field.key] = Boolean(value);
        break;
      case "number":
        data[field.key] = typeof value === "number" ? value : parseFloat(String(value)) || null;
        break;
      case "select":
        // Try to match to options if available
        if (field.options && field.options.length > 0) {
          const strValue = String(value).toLowerCase();
          const match = field.options.find(opt => 
            opt.toLowerCase() === strValue || 
            opt.toLowerCase().includes(strValue) ||
            strValue.includes(opt.toLowerCase())
          );
          data[field.key] = match || String(value);
        } else {
          data[field.key] = String(value);
        }
        break;
      default:
        data[field.key] = String(value);
    }
  }
  
  // Include any extra fields the AI might have found (but with lower priority)
  for (const [key, value] of Object.entries(parsed)) {
    if (!expectedKeys.has(key) && value !== null && value !== undefined) {
      data[key] = value as string | number | boolean;
    }
  }
  
  return { data, confidenceScores };
}

/**
 * Main AI extraction function - DYNAMIC based on client intake fields
 */
export async function extractWithAI(input: AIExtractionInput): Promise<AIExtractionResult> {
  const startTime = Date.now();
  const warnings: string[] = [];
  
  // Check for API key
  if (!process.env.OPENAI_API_KEY) {
    return {
      success: false,
      extractedData: {},
      confidenceScores: {},
      processingTimeMs: Date.now() - startTime,
      warnings: ["OPENAI_API_KEY not configured"],
      error: "AI extraction requires OPENAI_API_KEY environment variable",
    };
  }
  
  // Validate we have fields to extract
  if (!input.clientIntakeFields || input.clientIntakeFields.length === 0) {
    return {
      success: false,
      extractedData: {},
      confidenceScores: {},
      processingTimeMs: Date.now() - startTime,
      warnings: ["No intake fields configured for this client"],
      error: "Client has no intake fields configured",
    };
  }
  
  // Validate input text
  if (!input.rawText || input.rawText.trim().length < 50) {
    return {
      success: false,
      extractedData: {},
      confidenceScores: {},
      processingTimeMs: Date.now() - startTime,
      warnings: ["Document text too short or empty"],
      error: "Insufficient text content for extraction",
    };
  }
  
  try {
    const client = getOpenAIClient();
    
    // Build the extraction prompt dynamically from client fields
    const extractionPrompt = buildDynamicExtractionPrompt(
      input.rawText,
      input.clientIntakeFields,
      input.filename
    );
    
    // Log field count for debugging
    warnings.push(`Extracting ${input.clientIntakeFields.length} client-configured fields`);
    
    // Call OpenAI via LangChain
    const response = await client.invoke([
      new SystemMessage(EXTRACTION_SYSTEM_PROMPT),
      new HumanMessage(extractionPrompt),
    ]);
    
    const responseText = typeof response.content === "string" 
      ? response.content 
      : JSON.stringify(response.content);
    
    // Parse and validate the response
    const { data, confidenceScores } = parseAIResponse(responseText, input.clientIntakeFields);
    
    // Check for low-confidence extractions
    for (const [field, confidence] of Object.entries(confidenceScores)) {
      if (confidence < 0.5 && data[field] !== null) {
        warnings.push(`Low confidence (${(confidence * 100).toFixed(0)}%) for field: ${field}`);
      }
    }
    
    // Truncation warning
    if (input.rawText.length > 15000) {
      warnings.push("Document was truncated for processing - some fields may be missed");
    }
    
    // Count extracted fields
    const extractedCount = Object.values(data).filter(v => v !== null).length;
    warnings.push(`Successfully extracted ${extractedCount} of ${input.clientIntakeFields.length} fields`);
    
    return {
      success: true,
      extractedData: data,
      confidenceScores,
      processingTimeMs: Date.now() - startTime,
      warnings,
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown extraction error";
    
    return {
      success: false,
      extractedData: {},
      confidenceScores: {},
      processingTimeMs: Date.now() - startTime,
      warnings,
      error: errorMessage,
    };
  }
}

/**
 * Build regex patterns dynamically for a field based on its key and label
 */
function buildDynamicRegexPatterns(field: IntakeField): RegExp[] {
  const patterns: RegExp[] = [];
  const key = field.key.toLowerCase();
  const label = field.label.toLowerCase();
  
  // Common pattern: "Label: Value" or "Label Value"
  const labelPattern = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  patterns.push(new RegExp(`${labelPattern}[:\\s]+([^\\n]{3,200})`, 'i'));
  
  // Key-based patterns for common fields
  if (key.includes('project') && key.includes('name')) {
    patterns.push(/project\s*(?:name|title)?[:\s]+([^\n]{5,100})/i);
    patterns.push(/re:\s*([^\n]{5,100})/i);
  }
  if (key.includes('location') || key.includes('address')) {
    patterns.push(/(?:project\s+)?location[:\s]+([^\n]{5,200})/i);
    patterns.push(/(?:site\s+)?address[:\s]+([^\n]{5,200})/i);
  }
  if (key.includes('due') && key.includes('date')) {
    patterns.push(/(?:bid|proposal)\s*(?:due|deadline)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
    patterns.push(/due\s*date[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
  }
  if (key.includes('owner')) {
    patterns.push(/owner[:\s]+([^\n]{3,100})/i);
    patterns.push(/(?:for|client)[:\s]+([^\n]{3,100})/i);
  }
  if (key.includes('contractor') || key === 'gc') {
    patterns.push(/general\s*contractor[:\s]+([^\n]{3,100})/i);
    patterns.push(/gc[:\s]+([^\n]{3,100})/i);
  }
  if (key.includes('bond')) {
    patterns.push(/(bid\s*bond|performance\s*bond|payment\s*bond)/i);
    patterns.push(/bond[^\n]*(required|mandatory)/i);
  }
  if (key.includes('value') || key.includes('budget') || key.includes('estimate')) {
    patterns.push(/(?:estimated|budget|value)[^\n]*\$\s*([\d,]+(?:\.\d{2})?)/i);
  }
  
  return patterns;
}

/**
 * Extract using regex patterns dynamically built from client fields
 */
export function extractWithDynamicRegex(
  rawText: string,
  intakeFields: IntakeField[]
): Map<string, { value: string | boolean | null; confidence: number }> {
  const results = new Map<string, { value: string | boolean | null; confidence: number }>();
  
  for (const field of intakeFields) {
    const patterns = buildDynamicRegexPatterns(field);
    let found = false;
    
    for (const pattern of patterns) {
      const match = rawText.match(pattern);
      if (match) {
        // Handle boolean fields
        if (field.type === "boolean") {
          results.set(field.key, {
            value: true,
            confidence: 0.7,
          });
        } else {
          results.set(field.key, {
            value: match[1]?.trim() || match[0].trim(),
            confidence: 0.6,
          });
        }
        found = true;
        break;
      }
    }
    
    if (!found) {
      results.set(field.key, { value: null, confidence: 0 });
    }
  }
  
  return results;
}

/**
 * Extract fields using AI with fallback to dynamic regex patterns
 */
export async function extractWithAIAndFallback(
  input: AIExtractionInput
): Promise<AIExtractionResult> {
  // Build regex results first (fast)
  const regexResults = extractWithDynamicRegex(input.rawText, input.clientIntakeFields);
  
  // Try AI extraction
  const aiResult = await extractWithAI(input);
  
  // If AI failed, use regex results
  if (!aiResult.success) {
    const fallbackData: Record<string, string | number | boolean | null> = {};
    const confidenceScores: Record<string, number> = {};
    
    for (const [field, result] of regexResults) {
      fallbackData[field] = result.value;
      confidenceScores[field] = result.confidence;
    }
    
    return {
      success: true,
      extractedData: fallbackData,
      confidenceScores,
      processingTimeMs: aiResult.processingTimeMs,
      warnings: [...aiResult.warnings, `AI extraction failed: ${aiResult.error}`, "Using regex fallback"],
    };
  }
  
  // If AI succeeded, fill in missing fields from regex
  const enhancedData = { ...aiResult.extractedData };
  const enhancedConfidence = { ...aiResult.confidenceScores };
  
  for (const [field, result] of regexResults) {
    if ((enhancedData[field] === null || enhancedData[field] === undefined) && result.value !== null) {
      enhancedData[field] = result.value;
      enhancedConfidence[field] = result.confidence * 0.8; // Lower confidence for fallback
      aiResult.warnings.push(`Field '${field}' filled from regex fallback`);
    }
  }
  
  return {
    ...aiResult,
    extractedData: enhancedData,
    confidenceScores: enhancedConfidence,
  };
}
