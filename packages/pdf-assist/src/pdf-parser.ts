/**
 * PDF Parser Service
 *
 * Extracts raw text from PDF documents using pdf-parse.
 * Handles base64, Buffer, and file path inputs.
 */

import pdfParse from "pdf-parse";

// ----- Types -----

export interface ParsedPDF {
  /** Extracted text content */
  text: string;
  
  /** Number of pages in the document */
  numPages: number;
  
  /** PDF metadata if available */
  metadata?: {
    title?: string;
    author?: string;
    subject?: string;
    creator?: string;
    producer?: string;
    creationDate?: string;
    modificationDate?: string;
  };
  
  /** PDF info */
  info?: Record<string, unknown>;
  
  /** Processing stats */
  stats: {
    textLength: number;
    processingTimeMs: number;
  };
}

export interface ParseOptions {
  /** Maximum pages to process (default: 100) */
  maxPages?: number;
  
  /** Whether to include page markers in text */
  includePageMarkers?: boolean;
}

// ----- PDF Parsing Functions -----

/**
 * Parse PDF from base64 string
 */
export async function parsePDFFromBase64(
  base64Content: string,
  options: ParseOptions = {}
): Promise<ParsedPDF> {
  const startTime = Date.now();
  const maxPages = options.maxPages || 100;
  
  // Decode base64 to buffer
  const buffer = Buffer.from(base64Content, "base64");
  
  return parsePDFFromBuffer(buffer, { ...options, maxPages }, startTime);
}

/**
 * Parse PDF from Buffer
 */
export async function parsePDFFromBuffer(
  buffer: Buffer,
  options: ParseOptions = {},
  startTime?: number
): Promise<ParsedPDF> {
  const start = startTime || Date.now();
  const maxPages = options.maxPages || 100;
  const includePageMarkers = options.includePageMarkers ?? true;
  
  try {
    // Custom page render to handle page markers
    const renderPage = includePageMarkers
      ? (pageData: { getTextContent: () => Promise<{ items: Array<{ str: string }> }> }) => {
          return pageData.getTextContent().then((textContent: { items: Array<{ str: string }> }) => {
            return textContent.items.map((item: { str: string }) => item.str).join(" ");
          });
        }
      : undefined;

    const data = await pdfParse(buffer, {
      max: maxPages,
      pagerender: renderPage,
    });
    
    // Extract text with page markers if requested
    let text = data.text;
    if (includePageMarkers && data.numpages > 1) {
      // pdf-parse already concatenates pages, but we can add markers if needed
      // For now, use the raw text
    }
    
    // Clean up text - remove excessive whitespace
    text = text
      .replace(/\r\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
    
    // Extract metadata
    const metadata: ParsedPDF["metadata"] = {};
    if (data.info) {
      if (data.info.Title) metadata.title = String(data.info.Title);
      if (data.info.Author) metadata.author = String(data.info.Author);
      if (data.info.Subject) metadata.subject = String(data.info.Subject);
      if (data.info.Creator) metadata.creator = String(data.info.Creator);
      if (data.info.Producer) metadata.producer = String(data.info.Producer);
      if (data.info.CreationDate) metadata.creationDate = String(data.info.CreationDate);
      if (data.info.ModDate) metadata.modificationDate = String(data.info.ModDate);
    }
    
    return {
      text,
      numPages: data.numpages,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      info: data.info,
      stats: {
        textLength: text.length,
        processingTimeMs: Date.now() - start,
      },
    };
    
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown PDF parsing error";
    throw new Error(`Failed to parse PDF: ${message}`);
  }
}

/**
 * Validate that content is a valid PDF
 */
export function validatePDFContent(content: Buffer | string): boolean {
  // Check for PDF magic bytes
  if (Buffer.isBuffer(content)) {
    // PDF files start with %PDF-
    return content.slice(0, 5).toString("ascii") === "%PDF-";
  }
  
  // For base64, check if it decodes to PDF magic bytes
  if (typeof content === "string") {
    try {
      // %PDF- in base64 starts with "JVBERi0"
      return content.startsWith("JVBERi0");
    } catch {
      return false;
    }
  }
  
  return false;
}

/**
 * Get basic PDF info without full text extraction
 */
export async function getPDFInfo(
  content: Buffer | string
): Promise<{ numPages: number; metadata?: ParsedPDF["metadata"] }> {
  const buffer = Buffer.isBuffer(content) 
    ? content 
    : Buffer.from(content, "base64");
  
  const data = await pdfParse(buffer, { max: 1 }); // Only parse first page for speed
  
  const metadata: ParsedPDF["metadata"] = {};
  if (data.info) {
    if (data.info.Title) metadata.title = String(data.info.Title);
    if (data.info.Author) metadata.author = String(data.info.Author);
  }
  
  return {
    numPages: data.numpages,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}


