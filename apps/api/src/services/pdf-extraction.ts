/**
 * PDF Extraction Service
 *
 * Orchestrates PDF extraction and stores results in the database.
 * Uses extractFromDocument with client config (same as direct upload) - NOT the legacy extractFieldsFromPdf.
 * IMPORTANT: Extracted data is NEVER overwritten - always appended.
 */

import { extractFromDocument } from "@bid-catcher/pdf-assist";
import { ClientConfigSchema } from "@bid-catcher/config";
import { getDb, bidDocuments, extractedFields, bids, clients, eq, and, sql } from "@bid-catcher/db";

// ----- Types -----

interface ExtractDocumentInput {
  documentId: string;
  bidId: string;
}

interface ExtractDocumentResult {
  success: boolean;
  documentId: string;
  bidId: string;
  fieldsExtracted: number;
  extractionVersion: number;
  warnings: string[];
  error: string | null;
}

// ----- Service Functions -----

export const pdfExtractionService = {
  /**
   * Extract fields from a document and store results
   * Uses extractFromDocument with client config (same as direct upload) - client's intake fields only.
   * Creates new extracted_fields records (never overwrites)
   */
  async extractDocument(input: ExtractDocumentInput): Promise<ExtractDocumentResult> {
    const db = getDb();

    // 1. Get document record (include content for extraction)
    const documents = await db
      .select({
        id: bidDocuments.id,
        bidId: bidDocuments.bidId,
        filename: bidDocuments.filename,
        contentType: bidDocuments.contentType,
        processingStatus: bidDocuments.processingStatus,
        content: bidDocuments.content,
      })
      .from(bidDocuments)
      .where(eq(bidDocuments.id, input.documentId))
      .limit(1);

    if (documents.length === 0) {
      throw new Error(`Document with ID ${input.documentId} not found`);
    }

    const doc = documents[0];
    const bidId = input.bidId || doc.bidId;

    // 2. Get client config for extraction (same fields as direct upload)
    const [bidRow] = await db
      .select({ clientId: bids.clientId })
      .from(bids)
      .where(eq(bids.id, bidId))
      .limit(1);

    if (!bidRow) {
      throw new Error(`Bid ${bidId} not found`);
    }

    const [clientRow] = await db
      .select({ config: clients.config })
      .from(clients)
      .where(eq(clients.id, bidRow.clientId))
      .limit(1);

    let clientIntakeFields: Parameters<typeof extractFromDocument>[0]["clientIntakeFields"] = [];
    if (clientRow?.config) {
      try {
        const parsed = ClientConfigSchema.parse(clientRow.config);
        clientIntakeFields = parsed.intake?.intakeFields ?? [];
      } catch {
        console.warn(`[pdf-extraction] Failed to parse client config for bid ${bidId}, using defaults`);
      }
    }

    // 3. Check if already processed (we'll create a new version)
    const existingExtractions = await db
      .select({ maxVersion: sql<number>`COALESCE(MAX(extraction_version), 0)::int` })
      .from(extractedFields)
      .where(eq(extractedFields.documentId, input.documentId));

    const newVersion = (existingExtractions[0]?.maxVersion || 0) + 1;

    // 4. Update document status to processing
    await db
      .update(bidDocuments)
      .set({
        processingStatus: "processing",
        updatedAt: new Date(),
      })
      .where(eq(bidDocuments.id, input.documentId));

    try {
      // 5. Call extractFromDocument (same as direct upload - uses client config)
      const result = await extractFromDocument({
        documentBase64: doc.content || "",
        filename: doc.filename || "document.pdf",
        clientId: bidRow.clientId,
        clientIntakeFields,
        useAI: true,
      });

      if (!result.success) {
        throw new Error(result.error || "Extraction failed");
      }

      // 6. Store extracted fields (append-only, never overwrite)
      const fieldsToInsert = Object.entries(result.extractedFields)
        .filter(([, value]) => value !== null && value !== undefined && value !== "")
        .map(([signalId, value]) => ({
          documentId: input.documentId,
          bidId,
          signalId,
          extractedValue: value === null || value === undefined ? null : String(value),
          rawValue: null,
          confidence: result.confidenceScores[signalId] ?? 0.8,
          extractionMethod: result.processingInfo.method,
          pageNumber: null,
          extractionVersion: newVersion,
          sourceLocation: null,
        }));

      if (fieldsToInsert.length > 0) {
        await db.insert(extractedFields).values(fieldsToInsert);
      }

      // 7. Update document status to completed
      await db
        .update(bidDocuments)
        .set({
          processingStatus: "completed",
          processedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(bidDocuments.id, input.documentId));

      console.log(
        `[pdf-extraction] Extracted ${fieldsToInsert.length} fields from document ${input.documentId} (version ${newVersion}, client config: ${clientIntakeFields.length} fields)`
      );

      return {
        success: true,
        documentId: input.documentId,
        bidId,
        fieldsExtracted: fieldsToInsert.length,
        extractionVersion: newVersion,
        warnings: result.processingInfo.warnings,
        error: null,
      };
    } catch (error) {
      // Update document status to failed
      await db
        .update(bidDocuments)
        .set({
          processingStatus: "failed",
          processingError: error instanceof Error ? error.message : "Unknown error",
          updatedAt: new Date(),
        })
        .where(eq(bidDocuments.id, input.documentId));

      throw error;
    }
  },

  /**
   * Get all extracted fields for a bid
   * Returns latest version of each field by default
   */
  async getExtractedFields(
    bidId: string,
    options: { includeAllVersions?: boolean } = {}
  ): Promise<Array<{
    signalId: string;
    extractedValue: string | null;
    confidence: number | null;
    extractionMethod: string | null;
    extractionVersion: number;
    documentId: string;
    createdAt: string;
  }>> {
    const db = getDb();

    if (options.includeAllVersions) {
      // Return all versions
      const results = await db
        .select({
          signalId: extractedFields.signalId,
          extractedValue: extractedFields.extractedValue,
          confidence: extractedFields.confidence,
          extractionMethod: extractedFields.extractionMethod,
          extractionVersion: extractedFields.extractionVersion,
          documentId: extractedFields.documentId,
          createdAt: extractedFields.createdAt,
        })
        .from(extractedFields)
        .where(eq(extractedFields.bidId, bidId))
        .orderBy(extractedFields.signalId, extractedFields.extractionVersion);

      return results.map((r: typeof results[0]) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      }));
    }

    // Return only latest version of each field
    // Using a subquery to get max version per signal
    const results = await db
      .select({
        signalId: extractedFields.signalId,
        extractedValue: extractedFields.extractedValue,
        confidence: extractedFields.confidence,
        extractionMethod: extractedFields.extractionMethod,
        extractionVersion: extractedFields.extractionVersion,
        documentId: extractedFields.documentId,
        createdAt: extractedFields.createdAt,
      })
      .from(extractedFields)
      .where(
        and(
          eq(extractedFields.bidId, bidId),
          sql`(${extractedFields.documentId}, ${extractedFields.signalId}, ${extractedFields.extractionVersion}) IN (
            SELECT document_id, signal_id, MAX(extraction_version)
            FROM extracted_fields
            WHERE bid_id = ${bidId}
            GROUP BY document_id, signal_id
          )`
        )
      )
      .orderBy(extractedFields.signalId);

    return results.map((r: typeof results[0]) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    }));
  },

  /**
   * Queue all pending documents for a bid for extraction
   * MVP: Processes immediately (no background queue)
   */
  async extractAllPendingDocuments(bidId: string): Promise<{
    processed: number;
    failed: number;
    results: ExtractDocumentResult[];
  }> {
    const db = getDb();

    // Get all pending documents for this bid
    const pendingDocs = await db
      .select({
        id: bidDocuments.id,
        bidId: bidDocuments.bidId,
      })
      .from(bidDocuments)
      .where(
        and(
          eq(bidDocuments.bidId, bidId),
          eq(bidDocuments.processingStatus, "pending")
        )
      );

    const results: ExtractDocumentResult[] = [];
    let processed = 0;
    let failed = 0;

    for (const doc of pendingDocs) {
      try {
        const result = await this.extractDocument({
          documentId: doc.id,
          bidId: doc.bidId,
        });
        results.push(result);
        processed++;
      } catch (error) {
        results.push({
          success: false,
          documentId: doc.id,
          bidId: doc.bidId,
          fieldsExtracted: 0,
          extractionVersion: 0,
          warnings: [],
          error: error instanceof Error ? error.message : "Unknown error",
        });
        failed++;
      }
    }

    return { processed, failed, results };
  },
};

