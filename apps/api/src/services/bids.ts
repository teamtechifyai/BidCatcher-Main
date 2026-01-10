/**
 * Bids Service
 *
 * Business logic for bid retrieval and status management.
 * Implements the bid queue API with proper filtering and status transitions.
 */

import type { BidListQuery, ClientConfig, BidStatus } from "@bid-catcher/config";
import { BID_STATUS_TRANSITIONS } from "@bid-catcher/config";
import { getDb, bids, bidDocuments, clients, extractedFields, goNoGoDecisions, decisionOverrides, eq, and, desc, sql, inArray } from "@bid-catcher/db";

// ----- Types -----

interface BidSummary {
  id: string;
  clientId: string;
  clientName: string | null;
  projectName: string | null;
  status: string;
  intakeSource: string;
  senderEmail: string | null;
  senderName: string | null;
  senderCompany: string | null;
  documentCount: number;
  validationWarnings: unknown[] | null;
  receivedAt: string;
  createdAt: string;
  extractedFields: Array<{ 
    fieldKey: string; 
    extractedValue: unknown; 
    confidence: number | null;
    citation: {
      documentId: string | null;
      documentFilename: string | null;
      pageNumber: number | null;
      text: string | null;
    } | null;
  }>;
  customFields: Record<string, unknown> | null;
  confidenceScores: Record<string, number> | null;
  latestDecision: {
    outcome: string;
    totalScore: number | null;
    scorePercentage: number | null;
    rationale: string | null;
    evaluatedBy: string | null;
    evaluationMethod: string | null;
    aiEvaluation: unknown;
    decidedAt: string;
  } | null;
}

interface BidDocument {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number | null;
  documentType: string;
  processingStatus: string;
  storagePath: string | null;
  createdAt: string;
}

interface BidDetail extends BidSummary {
  emailSubject: string | null;
  emailBody: string | null;
  rawPayload: unknown;
  documents: BidDocument[];
  extractedFields: Array<{
    id: string;
    signalId: string;
    extractedValue: string | null;
    confidence: number | null;
    extractionMethod: string | null;
    createdAt: string;
    // Citation fields
    citation: {
      documentId: string | null;
      documentFilename: string | null;
      pageNumber: number | null;
      text: string | null;
      context: string | null;
      boundingBox: unknown | null;
    } | null;
  }>;
  decision: {
    id: string;
    outcome: string;
    totalScore: number;
    maxScore: number;
    scorePercentage: number;
    rationale: string;
    evaluationMethod: string | null;
    aiEvaluation: unknown | null;
    createdAt: string;
  } | null;
  overrides: Array<{
    id: string;
    originalOutcome: string;
    overriddenOutcome: string;
    overriddenBy: string;
    reasonCategory: string;
    rationale: string;
    createdAt: string;
  }>;
  clientConfig: {
    requiredFields: string[];
    pdfSignals: string[];
  } | null;
}

interface BidListResult {
  bids: BidSummary[];
  total: number;
  limit: number;
  offset: number;
}

interface StatusUpdateResult {
  success: boolean;
  bidId: string;
  previousStatus: string;
  newStatus: string;
  message: string;
}

// ----- Bids Service -----

export const bidsService = {
  /**
   * List bids with optional filtering by status and client_id
   * Supports pagination via limit/offset
   */
  async listBids(query: BidListQuery): Promise<BidListResult> {
    const db = getDb();

    // Build where conditions
    const conditions = [];
    if (query.clientId) {
      conditions.push(eq(bids.clientId, query.clientId));
    }
    if (query.status) {
      conditions.push(eq(bids.status, query.status));
    }

    // Get total count
    const countResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(bids)
      .where(conditions.length > 0 ? and(...conditions) : undefined);
    const total = countResult[0]?.count || 0;

    // Get paginated results with client name
    const results = await db
      .select({
        id: bids.id,
        clientId: bids.clientId,
        clientName: clients.name,
        projectName: bids.projectName,
        status: bids.status,
        intakeSource: bids.intakeSource,
        senderEmail: bids.senderEmail,
        senderName: bids.senderName,
        senderCompany: bids.senderCompany,
        validationWarnings: bids.validationWarnings,
        rawPayload: bids.rawPayload,
        receivedAt: bids.receivedAt,
        createdAt: bids.createdAt,
      })
      .from(bids)
      .leftJoin(clients, eq(bids.clientId, clients.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(bids.receivedAt))
      .limit(query.limit)
      .offset(query.offset);

    // Get document counts for each bid
    const bidIds = results.map((r) => r.id);
    const docCounts = bidIds.length > 0
      ? await db
          .select({
            bidId: bidDocuments.bidId,
            count: sql<number>`count(*)::int`,
          })
          .from(bidDocuments)
          .where(inArray(bidDocuments.bidId, bidIds))
          .groupBy(bidDocuments.bidId)
      : [];

    const docCountMap = new Map(docCounts.map((d) => [d.bidId, d.count]));

    // Get extracted fields for each bid with citation data
    const extractedFieldsResults = bidIds.length > 0
      ? await db
          .select({
            bidId: extractedFields.bidId,
            signalId: extractedFields.signalId,
            extractedValue: extractedFields.extractedValue,
            confidence: extractedFields.confidence,
            pageNumber: extractedFields.pageNumber,
            rawValue: extractedFields.rawValue,
            citationText: extractedFields.citationText,
            documentId: extractedFields.documentId,
            documentFilename: bidDocuments.filename,
          })
          .from(extractedFields)
          .leftJoin(bidDocuments, eq(extractedFields.documentId, bidDocuments.id))
          .where(inArray(extractedFields.bidId, bidIds))
      : [];

    // Group extracted fields by bid ID with citation info
    const extractedFieldsMap = new Map<string, Array<{ 
      fieldKey: string; 
      extractedValue: unknown; 
      confidence: number | null;
      citation: {
        documentId: string | null;
        documentFilename: string | null;
        pageNumber: number | null;
        text: string | null;
      } | null;
    }>>();
    for (const field of extractedFieldsResults) {
      if (!extractedFieldsMap.has(field.bidId)) {
        extractedFieldsMap.set(field.bidId, []);
      }
      extractedFieldsMap.get(field.bidId)!.push({
        fieldKey: field.signalId,
        extractedValue: field.extractedValue,
        confidence: field.confidence,
        citation: field.documentId ? {
          documentId: field.documentId,
          documentFilename: field.documentFilename,
          pageNumber: field.pageNumber,
          text: field.citationText || field.rawValue,
        } : null,
      });
    }

    // Get latest decisions for each bid
    const decisionsResults = bidIds.length > 0
      ? await db
          .select({
            bidId: goNoGoDecisions.bidId,
            outcome: goNoGoDecisions.outcome,
            totalScore: goNoGoDecisions.totalScore,
            scorePercentage: goNoGoDecisions.scorePercentage,
            rationale: goNoGoDecisions.rationale,
            evaluationMethod: goNoGoDecisions.evaluationMethod,
            aiEvaluation: goNoGoDecisions.aiEvaluation,
            createdAt: goNoGoDecisions.createdAt,
          })
          .from(goNoGoDecisions)
          .where(inArray(goNoGoDecisions.bidId, bidIds))
          .orderBy(desc(goNoGoDecisions.createdAt))
      : [];

    // Get latest decision per bid (first occurrence since ordered by createdAt desc)
    const latestDecisionMap = new Map<string, {
      outcome: string;
      totalScore: number | null;
      scorePercentage: number | null;
      rationale: string | null;
      evaluatedBy: string | null;
      evaluationMethod: string | null;
      aiEvaluation: unknown;
      decidedAt: string;
    }>();
    for (const decision of decisionsResults) {
      if (!latestDecisionMap.has(decision.bidId)) {
        latestDecisionMap.set(decision.bidId, {
          outcome: decision.outcome,
          totalScore: decision.totalScore,
          scorePercentage: decision.scorePercentage,
          rationale: decision.rationale,
          evaluatedBy: null, // Column not in schema yet
          evaluationMethod: decision.evaluationMethod,
          aiEvaluation: decision.aiEvaluation,
          decidedAt: decision.createdAt.toISOString(),
        });
      }
    }

    const bidSummaries: BidSummary[] = results.map((r) => {
      // Extract customFields from rawPayload
      const rawPayload = r.rawPayload as Record<string, unknown> | null;
      const customFields = (rawPayload?.customFields as Record<string, unknown>) || null;
      const confidenceScores = (rawPayload?.confidenceScores as Record<string, number>) || null;
      
      return {
        id: r.id,
        clientId: r.clientId,
        clientName: r.clientName,
        projectName: r.projectName,
        status: r.status,
        intakeSource: r.intakeSource,
        senderEmail: r.senderEmail,
        senderName: r.senderName,
        senderCompany: r.senderCompany,
        documentCount: docCountMap.get(r.id) || 0,
        validationWarnings: r.validationWarnings as unknown[] | null,
        receivedAt: r.receivedAt.toISOString(),
        createdAt: r.createdAt.toISOString(),
        extractedFields: extractedFieldsMap.get(r.id) || [],
        customFields,
        confidenceScores,
        latestDecision: latestDecisionMap.get(r.id) || null,
      };
    });

    return {
      bids: bidSummaries,
      total,
      limit: query.limit,
      offset: query.offset,
    };
  },

  /**
   * Get a single bid by ID with all related data
   */
  async getBidById(id: string): Promise<BidDetail | null> {
    const db = getDb();

    // Get bid with client info
    const bidResults = await db
      .select({
        id: bids.id,
        clientId: bids.clientId,
        clientName: clients.name,
        clientConfig: clients.config,
        projectName: bids.projectName,
        status: bids.status,
        intakeSource: bids.intakeSource,
        senderEmail: bids.senderEmail,
        senderName: bids.senderName,
        senderCompany: bids.senderCompany,
        emailSubject: bids.emailSubject,
        emailBody: bids.emailBody,
        rawPayload: bids.rawPayload,
        validationWarnings: bids.validationWarnings,
        receivedAt: bids.receivedAt,
        createdAt: bids.createdAt,
      })
      .from(bids)
      .leftJoin(clients, eq(bids.clientId, clients.id))
      .where(eq(bids.id, id))
      .limit(1);

    if (bidResults.length === 0) {
      return null;
    }

    const bid = bidResults[0];

    // Get documents
    const documents = await db
      .select({
        id: bidDocuments.id,
        filename: bidDocuments.filename,
        contentType: bidDocuments.contentType,
        sizeBytes: bidDocuments.sizeBytes,
        documentType: bidDocuments.documentType,
        processingStatus: bidDocuments.processingStatus,
        storagePath: bidDocuments.storagePath,
        createdAt: bidDocuments.createdAt,
      })
      .from(bidDocuments)
      .where(eq(bidDocuments.bidId, id))
      .orderBy(bidDocuments.createdAt);

    // Get extracted fields with citation data and document info
    const fields = await db
      .select({
        id: extractedFields.id,
        signalId: extractedFields.signalId,
        extractedValue: extractedFields.extractedValue,
        confidence: extractedFields.confidence,
        extractionMethod: extractedFields.extractionMethod,
        pageNumber: extractedFields.pageNumber,
        rawValue: extractedFields.rawValue,
        citationText: extractedFields.citationText,
        citationContext: extractedFields.citationContext,
        boundingBox: extractedFields.boundingBox,
        documentId: extractedFields.documentId,
        documentFilename: bidDocuments.filename,
        createdAt: extractedFields.createdAt,
      })
      .from(extractedFields)
      .leftJoin(bidDocuments, eq(extractedFields.documentId, bidDocuments.id))
      .where(eq(extractedFields.bidId, id))
      .orderBy(extractedFields.createdAt);

    // Get latest decision
    const decisions = await db
      .select({
        id: goNoGoDecisions.id,
        outcome: goNoGoDecisions.outcome,
        totalScore: goNoGoDecisions.totalScore,
        maxScore: goNoGoDecisions.maxScore,
        scorePercentage: goNoGoDecisions.scorePercentage,
        rationale: goNoGoDecisions.rationale,
        evaluationMethod: goNoGoDecisions.evaluationMethod,
        aiEvaluation: goNoGoDecisions.aiEvaluation,
        createdAt: goNoGoDecisions.createdAt,
      })
      .from(goNoGoDecisions)
      .where(eq(goNoGoDecisions.bidId, id))
      .orderBy(desc(goNoGoDecisions.createdAt))
      .limit(1);

    // Get overrides
    const overrideResults = await db
      .select({
        id: decisionOverrides.id,
        originalOutcome: decisionOverrides.originalOutcome,
        overriddenOutcome: decisionOverrides.overriddenOutcome,
        overriddenBy: decisionOverrides.overriddenBy,
        reasonCategory: decisionOverrides.reasonCategory,
        rationale: decisionOverrides.rationale,
        createdAt: decisionOverrides.createdAt,
      })
      .from(decisionOverrides)
      .where(eq(decisionOverrides.bidId, id))
      .orderBy(desc(decisionOverrides.createdAt));

    // Extract client config info
    const config = bid.clientConfig as ClientConfig | null;
    const clientConfigInfo = config
      ? {
          requiredFields: config.intake?.requiredFields || [],
          pdfSignals: config.pdfExtraction?.signals?.map((s) => s.signalId) || [],
        }
      : null;

    return {
      id: bid.id,
      clientId: bid.clientId,
      clientName: bid.clientName,
      projectName: bid.projectName,
      status: bid.status,
      intakeSource: bid.intakeSource,
      senderEmail: bid.senderEmail,
      senderName: bid.senderName,
      senderCompany: bid.senderCompany,
      emailSubject: bid.emailSubject,
      emailBody: bid.emailBody,
      rawPayload: bid.rawPayload,
      documentCount: documents.length,
      validationWarnings: bid.validationWarnings as unknown[] | null,
      receivedAt: bid.receivedAt.toISOString(),
      createdAt: bid.createdAt.toISOString(),
      documents: documents.map((d) => ({
        id: d.id,
        filename: d.filename,
        contentType: d.contentType,
        sizeBytes: d.sizeBytes,
        documentType: d.documentType,
        processingStatus: d.processingStatus,
        storagePath: d.storagePath,
        createdAt: d.createdAt.toISOString(),
      })),
      extractedFields: fields.map((f) => ({
        id: f.id,
        signalId: f.signalId,
        extractedValue: f.extractedValue,
        confidence: f.confidence,
        extractionMethod: f.extractionMethod,
        createdAt: f.createdAt.toISOString(),
        citation: f.documentId ? {
          documentId: f.documentId,
          documentFilename: f.documentFilename,
          pageNumber: f.pageNumber,
          text: f.citationText || f.rawValue,
          context: f.citationContext,
          boundingBox: f.boundingBox,
        } : null,
      })),
      decision: decisions.length > 0
        ? {
            id: decisions[0].id,
            outcome: decisions[0].outcome,
            totalScore: decisions[0].totalScore,
            maxScore: decisions[0].maxScore,
            scorePercentage: decisions[0].scorePercentage,
            rationale: decisions[0].rationale,
            evaluationMethod: decisions[0].evaluationMethod,
            aiEvaluation: decisions[0].aiEvaluation,
            createdAt: decisions[0].createdAt.toISOString(),
          }
        : null,
      overrides: overrideResults.map((o) => ({
        id: o.id,
        originalOutcome: o.originalOutcome,
        overriddenOutcome: o.overriddenOutcome,
        overriddenBy: o.overriddenBy,
        reasonCategory: o.reasonCategory,
        rationale: o.rationale,
        createdAt: o.createdAt.toISOString(),
      })),
      clientConfig: clientConfigInfo,
    };
  },

  /**
   * Update bid status with validation of allowed transitions
   */
  async updateBidStatus(
    id: string,
    newStatus: BidStatus,
    updatedBy?: string
  ): Promise<StatusUpdateResult> {
    const db = getDb();

    // Get current bid status
    const currentBid = await db
      .select({ status: bids.status })
      .from(bids)
      .where(eq(bids.id, id))
      .limit(1);

    if (currentBid.length === 0) {
      throw new Error(`Bid with ID ${id} not found`);
    }

    const currentStatus = currentBid[0].status;

    // Validate status transition
    const allowedTransitions = BID_STATUS_TRANSITIONS[currentStatus] || [];
    if (!allowedTransitions.includes(newStatus)) {
      throw new Error(
        `Invalid status transition from '${currentStatus}' to '${newStatus}'. ` +
        `Allowed transitions: ${allowedTransitions.join(", ") || "none (terminal state)"}`
      );
    }

    // Update the status
    await db
      .update(bids)
      .set({
        status: newStatus,
        updatedAt: new Date(),
      })
      .where(eq(bids.id, id));

    console.log(
      `[${updatedBy || "system"}] Updated bid ${id} status: ${currentStatus} -> ${newStatus}`
    );

    return {
      success: true,
      bidId: id,
      previousStatus: currentStatus,
      newStatus,
      message: `Status updated from '${currentStatus}' to '${newStatus}'`,
    };
  },

  /**
   * Delete a bid and all related data
   * Cascading deletes handle documents, decisions, overrides, etc.
   */
  async deleteBid(id: string): Promise<{ success: boolean; bidId: string; message: string }> {
    const db = getDb();

    // Check if bid exists
    const existing = await db
      .select({ id: bids.id, projectName: bids.projectName })
      .from(bids)
      .where(eq(bids.id, id))
      .limit(1);

    if (existing.length === 0) {
      return {
        success: false,
        bidId: id,
        message: `Bid with ID ${id} not found`,
      };
    }

    const projectName = existing[0].projectName || "Untitled";

    // Delete the bid (cascading deletes handle related data)
    await db.delete(bids).where(eq(bids.id, id));

    console.log(`Deleted bid ${id} (${projectName})`);

    return {
      success: true,
      bidId: id,
      message: `Bid '${projectName}' and all related data deleted successfully`,
    };
  },
};
