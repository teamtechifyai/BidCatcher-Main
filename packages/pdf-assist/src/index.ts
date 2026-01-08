/**
 * PDF Assist Lite Package
 *
 * Provides PDF parsing and AI-powered field extraction for construction bid documents.
 * EXTRACTION IS DYNAMIC - based on client's configured intake fields.
 */

// Types
export * from "./types.js";

// Extractor functions
export {
  extractFieldsFromPdf,
  extractFromDocument,
  validatePdf,
  getPdfPageCount,
  type DocumentExtractionInput,
  type DocumentExtractionResult,
} from "./extractor.js";

// PDF Parser
export {
  parsePDFFromBase64,
  parsePDFFromBuffer,
  validatePDFContent,
  getPDFInfo,
  type ParsedPDF,
  type ParseOptions,
} from "./pdf-parser.js";

// AI Extractor
export {
  extractWithAI,
  extractWithAIAndFallback,
  extractWithDynamicRegex,
  type AIExtractionInput,
  type AIExtractionResult,
} from "./ai-extractor.js";
