/**
 * JobTread Handoff Service (DRY-RUN ONLY)
 *
 * ⚠️ CRITICAL: This service NEVER makes real HTTP calls to JobTread.
 * All JobTread behavior is mocked for pilot readiness.
 *
 * Responsibilities:
 * - Validate bid eligibility (effective outcome must be GO)
 * - Build exact payload that WOULD be sent to JobTread
 * - Simulate document attachments
 * - Return mock response
 * - Log all attempts for audit
 */

import { randomUUID } from "crypto";
import type { ClientConfig } from "@bid-catcher/config";
import {
  getDb,
  bids,
  clients,
  bidDocuments,
  extractedFields,
  goNoGoDecisions,
  decisionOverrides,
  jobtreadHandoffs,
  eq,
  desc,
} from "@bid-catcher/db";

// ----- Types -----

interface HandoffResult {
  success: boolean;
  handoffId: string;
  bidId: string;
  status: "mocked_success" | "blocked" | "error";
  mockJobtreadResponse?: {
    jobtread_project_id: string;
    status: "mocked";
    created_at: string;
  };
  payload?: JobTreadPayload;
  errorMessage?: string;
  createdAt: string;
}

interface JobTreadPayload {
  /** Project information */
  project: {
    name: string;
    description?: string;
    location?: string;
    estimatedValue?: string;
    dueDate?: string;
  };
  /** Contact information */
  contact: {
    name?: string;
    email: string;
    company?: string;
    phone?: string;
  };
  /** General contractor info */
  generalContractor?: {
    name?: string;
    contact?: string;
  };
  /** Document references */
  documents: Array<{
    filename: string;
    contentType: string;
    storagePath: string;
    sizeBytes?: number;
  }>;
  /** Extracted field values */
  extractedData: Record<string, string | null>;
  /** Bid metadata */
  metadata: {
    bidId: string;
    clientId: string;
    intakeSource: string;
    receivedAt: string;
    decisionOutcome: string;
    decisionScore: number;
    decisionRationale: string;
  };
}

interface LatestHandoff {
  id: string;
  status: string;
  mockJobtreadId: string | null;
  payloadSnapshot: unknown;
  documentAttachments: unknown;
  createdAt: Date;
}

// ----- Helper Functions -----

/**
 * Get effective outcome for a bid (considering overrides)
 */
async function getEffectiveOutcome(
  bidId: string
): Promise<{ outcome: string; score: number; rationale: string } | null> {
  const db = getDb();

  // Get latest decision
  const decisions = await db
    .select({
      id: goNoGoDecisions.id,
      outcome: goNoGoDecisions.outcome,
      totalScore: goNoGoDecisions.totalScore,
      scorePercentage: goNoGoDecisions.scorePercentage,
      rationale: goNoGoDecisions.rationale,
    })
    .from(goNoGoDecisions)
    .where(eq(goNoGoDecisions.bidId, bidId))
    .orderBy(desc(goNoGoDecisions.createdAt))
    .limit(1);

  if (decisions.length === 0) {
    return null;
  }

  const latestDecision = decisions[0];

  // Check for override
  const overrides = await db
    .select({
      overriddenOutcome: decisionOverrides.overriddenOutcome,
    })
    .from(decisionOverrides)
    .where(eq(decisionOverrides.decisionId, latestDecision.id))
    .orderBy(desc(decisionOverrides.createdAt))
    .limit(1);

  const effectiveOutcome =
    overrides.length > 0 ? overrides[0].overriddenOutcome : latestDecision.outcome;

  return {
    outcome: effectiveOutcome,
    score: latestDecision.scorePercentage,
    rationale: latestDecision.rationale,
  };
}

/**
 * Build JobTread payload from bid data
 */
function buildJobTreadPayload(
  bid: {
    id: string;
    clientId: string;
    projectName: string | null;
    senderEmail: string | null;
    senderName: string | null;
    senderCompany: string | null;
    intakeSource: string;
    receivedAt: Date;
  },
  documents: Array<{
    id: string;
    filename: string;
    contentType: string;
    storagePath: string | null;
    sizeBytes: number | null;
  }>,
  fields: Array<{
    signalId: string;
    extractedValue: string | null;
  }>,
  decision: { outcome: string; score: number; rationale: string },
  _clientConfig: ClientConfig
): JobTreadPayload {
  // Build extracted data map
  const extractedData: Record<string, string | null> = {};
  for (const field of fields) {
    extractedData[field.signalId] = field.extractedValue;
  }

  return {
    project: {
      name: bid.projectName || "Untitled Project",
      description: extractedData["scope_of_work"] || undefined,
      location: extractedData["project_location"] || undefined,
      estimatedValue: extractedData["project_value_estimate"] || undefined,
      dueDate: extractedData["bid_due_date"] || undefined,
    },
    contact: {
      name: bid.senderName || undefined,
      email: bid.senderEmail || "unknown@unknown.com",
      company: bid.senderCompany || undefined,
    },
    generalContractor: extractedData["general_contractor"]
      ? { name: extractedData["general_contractor"] }
      : undefined,
    documents: documents.map((doc) => ({
      filename: doc.filename,
      contentType: doc.contentType,
      storagePath: doc.storagePath || `s3://bid-catcher/${bid.id}/${doc.filename}`,
      sizeBytes: doc.sizeBytes || undefined,
    })),
    extractedData,
    metadata: {
      bidId: bid.id,
      clientId: bid.clientId,
      intakeSource: bid.intakeSource,
      receivedAt: bid.receivedAt.toISOString(),
      decisionOutcome: decision.outcome,
      decisionScore: decision.score,
      decisionRationale: decision.rationale,
    },
  };
}

/**
 * Generate mock JobTread response
 */
function generateMockJobTreadResponse(): {
  jobtread_project_id: string;
  status: "mocked";
  created_at: string;
} {
  return {
    jobtread_project_id: `mock-${randomUUID()}`,
    status: "mocked",
    created_at: new Date().toISOString(),
  };
}

// ----- Main Service -----

export const jobtreadHandoffService = {
  /**
   * Execute dry-run handoff to JobTread
   *
   * ⚠️ NEVER makes real HTTP calls - all behavior is mocked
   */
  async executeHandoff(bidId: string, initiatedBy?: string): Promise<HandoffResult> {
    const db = getDb();
    const now = new Date();

    try {
      // 1. Fetch bid with client info
      const bidResults = await db
        .select({
          id: bids.id,
          clientId: bids.clientId,
          projectName: bids.projectName,
          senderEmail: bids.senderEmail,
          senderName: bids.senderName,
          senderCompany: bids.senderCompany,
          intakeSource: bids.intakeSource,
          receivedAt: bids.receivedAt,
          clientConfig: clients.config,
        })
        .from(bids)
        .leftJoin(clients, eq(bids.clientId, clients.id))
        .where(eq(bids.id, bidId))
        .limit(1);

      if (bidResults.length === 0) {
        // Log blocked attempt
        const [handoff] = await db
          .insert(jobtreadHandoffs)
          .values({
            bidId,
            status: "error",
            payloadSnapshot: {},
            errorMessage: `Bid with ID ${bidId} not found`,
            initiatedBy,
          })
          .returning({ id: jobtreadHandoffs.id });

        return {
          success: false,
          handoffId: handoff.id,
          bidId,
          status: "error",
          errorMessage: `Bid with ID ${bidId} not found`,
          createdAt: now.toISOString(),
        };
      }

      const bid = bidResults[0];
      const clientConfig = bid.clientConfig as ClientConfig | null;

      // 2. Check effective outcome
      const decision = await getEffectiveOutcome(bidId);

      if (!decision) {
        const [handoff] = await db
          .insert(jobtreadHandoffs)
          .values({
            bidId,
            status: "blocked",
            payloadSnapshot: {},
            errorMessage: "No decision found for this bid. Run evaluation first.",
            initiatedBy,
          })
          .returning({ id: jobtreadHandoffs.id });

        return {
          success: false,
          handoffId: handoff.id,
          bidId,
          status: "blocked",
          errorMessage: "No decision found for this bid. Run evaluation first.",
          createdAt: now.toISOString(),
        };
      }

      if (decision.outcome !== "GO") {
        const [handoff] = await db
          .insert(jobtreadHandoffs)
          .values({
            bidId,
            status: "blocked",
            payloadSnapshot: { decision },
            errorMessage: `Bid is not eligible for JobTread handoff. Effective outcome is "${decision.outcome}", must be "GO".`,
            initiatedBy,
          })
          .returning({ id: jobtreadHandoffs.id });

        return {
          success: false,
          handoffId: handoff.id,
          bidId,
          status: "blocked",
          errorMessage: `Bid is not eligible for JobTread handoff. Effective outcome is "${decision.outcome}", must be "GO".`,
          createdAt: now.toISOString(),
        };
      }

      // 3. Fetch documents
      const documents = await db
        .select({
          id: bidDocuments.id,
          filename: bidDocuments.filename,
          contentType: bidDocuments.contentType,
          storagePath: bidDocuments.storagePath,
          sizeBytes: bidDocuments.sizeBytes,
        })
        .from(bidDocuments)
        .where(eq(bidDocuments.bidId, bidId));

      // 4. Fetch extracted fields
      const fields = await db
        .select({
          signalId: extractedFields.signalId,
          extractedValue: extractedFields.extractedValue,
        })
        .from(extractedFields)
        .where(eq(extractedFields.bidId, bidId));

      // 5. Build payload
      const payload = buildJobTreadPayload(
        {
          id: bid.id,
          clientId: bid.clientId,
          projectName: bid.projectName,
          senderEmail: bid.senderEmail,
          senderName: bid.senderName,
          senderCompany: bid.senderCompany,
          intakeSource: bid.intakeSource,
          receivedAt: bid.receivedAt,
        },
        documents,
        fields,
        decision,
        clientConfig || ({} as ClientConfig)
      );

      // 6. Generate mock response
      const mockResponse = generateMockJobTreadResponse();

      // 7. Log successful handoff
      const [handoff] = await db
        .insert(jobtreadHandoffs)
        .values({
          bidId,
          status: "mocked_success",
          payloadSnapshot: payload,
          mockJobtreadId: mockResponse.jobtread_project_id,
          documentAttachments: payload.documents,
          initiatedBy,
        })
        .returning({ id: jobtreadHandoffs.id, createdAt: jobtreadHandoffs.createdAt });

      console.log(
        `[JobTread DRY-RUN] Handoff ${handoff.id} for bid ${bidId} → ${mockResponse.jobtread_project_id}`
      );

      return {
        success: true,
        handoffId: handoff.id,
        bidId,
        status: "mocked_success",
        mockJobtreadResponse: mockResponse,
        payload,
        createdAt: handoff.createdAt.toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      // Log error
      const [handoff] = await db
        .insert(jobtreadHandoffs)
        .values({
          bidId,
          status: "error",
          payloadSnapshot: {},
          errorMessage,
          initiatedBy,
        })
        .returning({ id: jobtreadHandoffs.id });

      console.error(`[JobTread DRY-RUN] Error for bid ${bidId}:`, errorMessage);

      return {
        success: false,
        handoffId: handoff.id,
        bidId,
        status: "error",
        errorMessage,
        createdAt: now.toISOString(),
      };
    }
  },

  /**
   * Get handoff history for a bid
   */
  async getHandoffHistory(bidId: string): Promise<LatestHandoff[]> {
    const db = getDb();

    const handoffs = await db
      .select({
        id: jobtreadHandoffs.id,
        status: jobtreadHandoffs.status,
        mockJobtreadId: jobtreadHandoffs.mockJobtreadId,
        payloadSnapshot: jobtreadHandoffs.payloadSnapshot,
        documentAttachments: jobtreadHandoffs.documentAttachments,
        errorMessage: jobtreadHandoffs.errorMessage,
        initiatedBy: jobtreadHandoffs.initiatedBy,
        createdAt: jobtreadHandoffs.createdAt,
      })
      .from(jobtreadHandoffs)
      .where(eq(jobtreadHandoffs.bidId, bidId))
      .orderBy(desc(jobtreadHandoffs.createdAt));

    return handoffs;
  },

  /**
   * Get latest successful handoff for a bid
   */
  async getLatestHandoff(bidId: string): Promise<LatestHandoff | null> {
    const db = getDb();

    const handoffs = await db
      .select({
        id: jobtreadHandoffs.id,
        status: jobtreadHandoffs.status,
        mockJobtreadId: jobtreadHandoffs.mockJobtreadId,
        payloadSnapshot: jobtreadHandoffs.payloadSnapshot,
        documentAttachments: jobtreadHandoffs.documentAttachments,
        createdAt: jobtreadHandoffs.createdAt,
      })
      .from(jobtreadHandoffs)
      .where(eq(jobtreadHandoffs.bidId, bidId))
      .orderBy(desc(jobtreadHandoffs.createdAt))
      .limit(1);

    return handoffs.length > 0 ? handoffs[0] : null;
  },
};


