/**
 * PDF Assist Lite - Extractor Service
 *
 * Extracts structured data from PDF bid documents using:
 * 1. pdf-parse for text extraction
 * 2. LangChain + OpenAI for AI-powered field extraction
 * 3. Dynamic regex patterns as fallback
 *
 * IMPORTANT: Extraction is DYNAMIC based on client's configured intake fields.
 */

import type {
  ExtractionInput,
  ExtractionResult,
  ExtractedFieldResult,
  ExtractedFields,
  ExtractionFieldName,
} from "./types.js";
import { EXTRACTION_FIELD_NAMES } from "./types.js";
import type { IntakeField } from "@bid-catcher/config";
import { parsePDFFromBase64, validatePDFContent, type ParsedPDF } from "./pdf-parser.js";
import { extractWithAIAndFallback, extractWithDynamicRegex } from "./ai-extractor.js";

// ----- Document Upload Extraction -----

/**
 * Input for document upload extraction
 */
export interface DocumentExtractionInput {
  /** Base64 encoded PDF content */
  documentBase64: string;
  
  /** Original filename */
  filename: string;
  
  /** Client ID for context */
  clientId: string;
  
  /** Client-specific intake fields - THIS IS THE PRIMARY CONFIGURATION */
  clientIntakeFields?: IntakeField[];
  
  /** Whether to use AI extraction (requires OPENAI_API_KEY) */
  useAI?: boolean;
}

/**
 * Result from document extraction
 */
export interface DocumentExtractionResult {
  /** Whether extraction succeeded */
  success: boolean;
  
  /** Extracted field values - keyed by field.key from client config */
  extractedFields: Record<string, string | number | boolean | null>;
  
  /** Confidence scores per field */
  confidenceScores: Record<string, number>;
  
  /** Raw text from PDF */
  rawText: string;
  
  /** PDF metadata */
  pdfInfo: {
    numPages: number;
    title?: string;
  };
  
  /** Processing details */
  processingInfo: {
    method: "ai" | "regex" | "hybrid";
    processingTimeMs: number;
    warnings: string[];
    fieldsRequested: number;
    fieldsExtracted: number;
  };
  
  /** Error if failed */
  error?: string;
}

/**
 * Get default intake fields if none provided
 */
function getDefaultIntakeFields(): IntakeField[] {
  return [
    { key: "project_name", label: "Project Name", type: "text", required: true },
    { key: "project_location", label: "Project Location", type: "text", required: false },
    { key: "project_number", label: "Project Number", type: "text", required: false },
    { key: "owner_name", label: "Owner Name", type: "text", required: false },
    { key: "general_contractor", label: "General Contractor", type: "text", required: false },
    { key: "architect_engineer", label: "Architect/Engineer", type: "text", required: false },
    { key: "bid_due_date", label: "Bid Due Date", type: "date", required: true },
    { key: "bid_due_time", label: "Bid Due Time", type: "text", required: false },
    { key: "pre_bid_meeting_date", label: "Pre-Bid Meeting Date", type: "date", required: false },
    { key: "pre_bid_meeting_required", label: "Pre-Bid Meeting Required", type: "boolean", required: false },
    { key: "start_date", label: "Project Start Date", type: "date", required: false },
    { key: "completion_date", label: "Completion Date", type: "date", required: false },
    { key: "project_value_estimate", label: "Estimated Value", type: "text", required: false },
    { key: "bond_required", label: "Bond Required", type: "boolean", required: false },
    { key: "insurance_requirements", label: "Insurance Requirements", type: "textarea", required: false },
    { key: "scope_of_work", label: "Scope of Work", type: "textarea", required: false },
  ];
}

/**
 * Extract fields from uploaded document
 * This is the main function for the document upload flow
 * 
 * EXTRACTION IS DYNAMIC - based on clientIntakeFields configuration
 */
export async function extractFromDocument(
  input: DocumentExtractionInput
): Promise<DocumentExtractionResult> {
  const startTime = Date.now();
  const warnings: string[] = [];
  
  // Use client's intake fields, or fall back to defaults
  const intakeFields = input.clientIntakeFields && input.clientIntakeFields.length > 0
    ? input.clientIntakeFields
    : getDefaultIntakeFields();
  
  if (!input.clientIntakeFields || input.clientIntakeFields.length === 0) {
    warnings.push("No client intake fields configured - using default construction bid fields");
  } else {
    warnings.push(`Using ${intakeFields.length} client-configured intake fields`);
  }
  
  // 1. Validate PDF
  if (!validatePDFContent(input.documentBase64)) {
    return {
      success: false,
      extractedFields: {},
      confidenceScores: {},
      rawText: "",
      pdfInfo: { numPages: 0 },
      processingInfo: {
        method: "regex",
        processingTimeMs: Date.now() - startTime,
        warnings: ["Invalid PDF content"],
        fieldsRequested: intakeFields.length,
        fieldsExtracted: 0,
      },
      error: "The uploaded file does not appear to be a valid PDF",
    };
  }
  
  // 2. Parse PDF to extract text
  let parsedPdf: ParsedPDF;
  try {
    parsedPdf = await parsePDFFromBase64(input.documentBase64, {
      maxPages: 100,
      includePageMarkers: true,
    });
  } catch (error) {
    return {
      success: false,
      extractedFields: {},
      confidenceScores: {},
      rawText: "",
      pdfInfo: { numPages: 0 },
      processingInfo: {
        method: "regex",
        processingTimeMs: Date.now() - startTime,
        warnings: [],
        fieldsRequested: intakeFields.length,
        fieldsExtracted: 0,
      },
      error: error instanceof Error ? error.message : "Failed to parse PDF",
    };
  }
  
  if (parsedPdf.text.length < 50) {
    warnings.push("Document contains very little text - extraction may be limited");
  }
  
  // 3. Determine if we should use AI
  const shouldUseAI = input.useAI !== false && !!process.env.OPENAI_API_KEY;
  
  let extractedFields: Record<string, string | number | boolean | null> = {};
  let confidenceScores: Record<string, number> = {};
  let method: "ai" | "regex" | "hybrid" = "regex";
  
  if (shouldUseAI) {
    // 4. Run AI extraction with dynamic client fields
    const aiResult = await extractWithAIAndFallback({
      rawText: parsedPdf.text,
      clientIntakeFields: intakeFields,
      filename: input.filename,
    });
    
    if (aiResult.success) {
      extractedFields = aiResult.extractedData;
      confidenceScores = aiResult.confidenceScores;
      method = aiResult.warnings.some(w => w.includes("fallback")) ? "hybrid" : "ai";
      warnings.push(...aiResult.warnings);
    } else {
      // AI failed, fall back to regex only
      warnings.push(`AI extraction failed: ${aiResult.error}`);
      method = "regex";
      
      const regexResults = extractWithDynamicRegex(parsedPdf.text, intakeFields);
      for (const [field, result] of regexResults) {
        extractedFields[field] = result.value;
        confidenceScores[field] = result.confidence;
      }
    }
  } else {
    // Use dynamic regex only
    if (!process.env.OPENAI_API_KEY && input.useAI !== false) {
      warnings.push("AI extraction unavailable - OPENAI_API_KEY not configured");
    }
    
    const regexResults = extractWithDynamicRegex(parsedPdf.text, intakeFields);
    for (const [field, result] of regexResults) {
      extractedFields[field] = result.value;
      confidenceScores[field] = result.confidence;
    }
  }
  
  // Count extracted fields
  const fieldsExtracted = Object.values(extractedFields).filter(v => v !== null).length;
  
  return {
    success: true,
    extractedFields,
    confidenceScores,
    rawText: parsedPdf.text,
    pdfInfo: {
      numPages: parsedPdf.numPages,
      title: parsedPdf.metadata?.title,
    },
    processingInfo: {
      method,
      processingTimeMs: Date.now() - startTime,
      warnings,
      fieldsRequested: intakeFields.length,
      fieldsExtracted,
    },
  };
}

// ----- Legacy Functions (for backward compatibility with existing code) -----

/**
 * Static regex patterns for legacy extraction
 */
const LEGACY_EXTRACTION_PATTERNS: Record<string, RegExp[]> = {
  project_name: [
    /project\s*(?:name|title)?[:\s]+([^\n]{5,100})/i,
    /re:\s*([^\n]{5,100})/i,
  ],
  project_location: [
    /(?:project\s+)?location[:\s]+([^\n]{5,200})/i,
    /(?:site\s+)?address[:\s]+([^\n]{5,200})/i,
  ],
  bid_due_date: [
    /(?:bid|proposal)\s*(?:due|deadline)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /due\s*date[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
  ],
  owner_name: [
    /owner[:\s]+([^\n]{3,100})/i,
  ],
  general_contractor: [
    /general\s*contractor[:\s]+([^\n]{3,100})/i,
    /gc[:\s]+([^\n]{3,100})/i,
  ],
  bond_required: [
    /(bid\s*bond|performance\s*bond|payment\s*bond)/i,
  ],
  scope_of_work: [
    /scope\s*(?:of\s*work)?[:\s]+([^\n]{20,500})/i,
  ],
};

/**
 * Legacy extraction for the old 16-field schema
 */
function extractWithLegacyPatterns(
  rawText: string,
  fieldsToExtract: readonly ExtractionFieldName[]
): Map<string, { value: string | boolean | null; snippet: string | null; confidence: number }> {
  const results = new Map<string, { value: string | boolean | null; snippet: string | null; confidence: number }>();

  for (const fieldName of fieldsToExtract) {
    const patterns = LEGACY_EXTRACTION_PATTERNS[fieldName];
    if (!patterns) {
      results.set(fieldName, { value: null, snippet: null, confidence: 0 });
      continue;
    }

    let found = false;
    for (const pattern of patterns) {
      const match = rawText.match(pattern);
      if (match) {
        if (fieldName === "pre_bid_meeting_required" || fieldName === "bond_required") {
          results.set(fieldName, {
            value: true,
            snippet: match[0].substring(0, 100),
            confidence: 0.7,
          });
        } else {
          results.set(fieldName, {
            value: match[1]?.trim() || match[0].trim(),
            snippet: match[0].substring(0, 100),
            confidence: 0.6,
          });
        }
        found = true;
        break;
      }
    }

    if (!found) {
      results.set(fieldName, { value: null, snippet: null, confidence: 0 });
    }
  }

  return results;
}

/**
 * Main extraction function (legacy - for backward compatibility)
 */
export async function extractFieldsFromPdf(
  input: ExtractionInput
): Promise<ExtractionResult> {
  const startTime = Date.now();
  const warnings: string[] = [];
  const fieldsToExtract = input.fieldsToExtract || EXTRACTION_FIELD_NAMES;

  // 1. Parse PDF content
  let rawText = "";
  let numPages: number | null = null;
  
  if (input.contentType === "base64") {
    try {
      const parsed = await parsePDFFromBase64(input.content);
      rawText = parsed.text;
      numPages = parsed.numPages;
    } catch (error) {
      warnings.push(`PDF parsing failed: ${error instanceof Error ? error.message : "unknown error"}`);
      rawText = "[PDF parsing failed]";
    }
  } else {
    warnings.push(`Content type '${input.contentType}' not fully supported`);
    rawText = "[Content type not supported]";
  }

  // 2. Use legacy pattern extraction
  const patternResults = extractWithLegacyPatterns(rawText, fieldsToExtract);

  // 3. Build final extracted fields
  const fields: ExtractedFieldResult[] = [];
  const extractedData: Partial<ExtractedFields> = {};

  for (const fieldName of fieldsToExtract) {
    const patternResult = patternResults.get(fieldName);

    if (patternResult && patternResult.value !== null && patternResult.confidence > 0.4) {
      fields.push({
        fieldName,
        value: patternResult.value,
        rawSnippet: patternResult.snippet,
        confidence: patternResult.confidence,
        pageNumber: null,
        source: "regex",
      });
      (extractedData as Record<string, unknown>)[fieldName] = patternResult.value;
    } else {
      fields.push({
        fieldName,
        value: null,
        rawSnippet: null,
        confidence: 0,
        pageNumber: null,
        source: "regex",
      });
      (extractedData as Record<string, unknown>)[fieldName] = null;
    }
  }

  const processingTimeMs = Date.now() - startTime;

  return {
    documentId: input.documentId,
    bidId: input.bidId,
    success: true,
    fields,
    extractedData: extractedData as ExtractedFields,
    rawText,
    metadata: {
      totalPages: numPages,
      processingTimeMs,
      extractionVersion: 2,
      warnings,
      method: "regex",
    },
    error: null,
  };
}

/**
 * Validate that a file is a PDF
 */
export async function validatePdf(content: string, contentType: string): Promise<boolean> {
  if (contentType === "base64") {
    return validatePDFContent(content);
  }
  return true;
}

/**
 * Get estimated page count from PDF
 */
export async function getPdfPageCount(content: string): Promise<number | null> {
  try {
    const parsed = await parsePDFFromBase64(content, { maxPages: 1 });
    return parsed.numPages;
  } catch {
    return null;
  }
}
