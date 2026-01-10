/**
 * Incoming Bid Emails Service
 *
 * Business logic for managing incoming bid emails from Gmail.
 * Handles email ingestion, listing, and processing into bids.
 */

import { getDb, incomingBidEmails, bids, clients, eq, desc, sql, and } from "@bid-catcher/db";

// ----- Types -----

interface IncomingEmailSummary {
  id: string;
  gmailMessageId: string | null;
  fromEmail: string;
  fromName: string | null;
  subject: string;
  emailReceivedAt: string;
  processed: boolean;
  processingStatus: string;
  bidId: string | null;
  attachmentCount: number;
  createdAt: string;
}

interface IncomingEmailDetail extends IncomingEmailSummary {
  bodyText: string | null;
  bodyHtml: string | null;
  processingError: string | null;
  processedAt: string | null;
  attachments: Array<{
    filename: string;
    contentType: string;
    size: number;
    storageKey?: string;
  }> | null;
}

interface IncomingEmailListResult {
  emails: IncomingEmailSummary[];
  total: number;
  limit: number;
  offset: number;
}

interface WebhookEmailPayload {
  gmailMessageId: string;
  fromEmail: string;
  fromName?: string;
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  receivedAt: string;
  attachments?: Array<{
    filename: string;
    contentType: string;
    size: number;
    storageKey?: string;
  }>;
  rawEmailData?: Record<string, unknown>;
}

interface ProcessEmailResult {
  success: boolean;
  emailId: string;
  bidId?: string;
  message: string;
}

// ----- Incoming Emails Service -----

export const incomingEmailsService = {
  /**
   * List incoming bid emails with pagination
   */
  async listEmails(params: {
    limit?: number;
    offset?: number;
    processed?: boolean;
  }): Promise<IncomingEmailListResult> {
    const db = getDb();
    const limit = params.limit || 50;
    const offset = params.offset || 0;

    // Build conditions
    const conditions = [];
    if (params.processed !== undefined) {
      conditions.push(eq(incomingBidEmails.processed, params.processed));
    }

    // Get total count
    const countResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(incomingBidEmails)
      .where(conditions.length > 0 ? and(...conditions) : undefined);
    const total = countResult[0]?.count || 0;

    // Get paginated results
    const results = await db
      .select({
        id: incomingBidEmails.id,
        gmailMessageId: incomingBidEmails.gmailMessageId,
        fromEmail: incomingBidEmails.fromEmail,
        fromName: incomingBidEmails.fromName,
        subject: incomingBidEmails.subject,
        emailReceivedAt: incomingBidEmails.emailReceivedAt,
        processed: incomingBidEmails.processed,
        processingStatus: incomingBidEmails.processingStatus,
        bidId: incomingBidEmails.bidId,
        attachments: incomingBidEmails.attachments,
        createdAt: incomingBidEmails.createdAt,
      })
      .from(incomingBidEmails)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(incomingBidEmails.emailReceivedAt))
      .limit(limit)
      .offset(offset);

    const emails: IncomingEmailSummary[] = results.map((r: typeof results[0]) => ({
      id: r.id,
      gmailMessageId: r.gmailMessageId,
      fromEmail: r.fromEmail,
      fromName: r.fromName,
      subject: r.subject,
      emailReceivedAt: r.emailReceivedAt.toISOString(),
      processed: r.processed,
      processingStatus: r.processingStatus,
      bidId: r.bidId,
      attachmentCount: Array.isArray(r.attachments) ? r.attachments.length : 0,
      createdAt: r.createdAt.toISOString(),
    }));

    return { emails, total, limit, offset };
  },

  /**
   * Get a single incoming email by ID
   */
  async getEmailById(id: string): Promise<IncomingEmailDetail | null> {
    const db = getDb();

    const results = await db
      .select()
      .from(incomingBidEmails)
      .where(eq(incomingBidEmails.id, id))
      .limit(1);

    if (results.length === 0) {
      return null;
    }

    const r = results[0];
    return {
      id: r.id,
      gmailMessageId: r.gmailMessageId,
      fromEmail: r.fromEmail,
      fromName: r.fromName,
      subject: r.subject,
      bodyText: r.bodyText,
      bodyHtml: r.bodyHtml,
      emailReceivedAt: r.emailReceivedAt.toISOString(),
      processed: r.processed,
      processingStatus: r.processingStatus,
      processingError: r.processingError,
      processedAt: r.processedAt?.toISOString() || null,
      bidId: r.bidId,
      attachments: r.attachments as IncomingEmailDetail["attachments"],
      attachmentCount: Array.isArray(r.attachments) ? r.attachments.length : 0,
      createdAt: r.createdAt.toISOString(),
    };
  },

  /**
   * Receive an email from Gmail webhook
   * Validates that "Bid" is in the subject line
   */
  async receiveEmail(payload: WebhookEmailPayload): Promise<{
    success: boolean;
    emailId?: string;
    skipped?: boolean;
    message: string;
  }> {
    const db = getDb();

    // Check if "Bid" is in the subject (case-insensitive)
    if (!payload.subject.toLowerCase().includes("bid")) {
      console.log(`[incoming-emails] Skipping email - no "Bid" in subject: "${payload.subject}"`);
      return {
        success: true,
        skipped: true,
        message: "Email skipped - subject does not contain 'Bid'",
      };
    }

    // Check for duplicate by Gmail message ID
    if (payload.gmailMessageId) {
      const existing = await db
        .select({ id: incomingBidEmails.id })
        .from(incomingBidEmails)
        .where(eq(incomingBidEmails.gmailMessageId, payload.gmailMessageId))
        .limit(1);

      if (existing.length > 0) {
        console.log(`[incoming-emails] Duplicate email - already exists: ${payload.gmailMessageId}`);
        return {
          success: true,
          emailId: existing[0].id,
          skipped: true,
          message: "Email already processed",
        };
      }
    }

    // Insert the email
    const [inserted] = await db
      .insert(incomingBidEmails)
      .values({
        gmailMessageId: payload.gmailMessageId,
        fromEmail: payload.fromEmail,
        fromName: payload.fromName || null,
        subject: payload.subject,
        bodyText: payload.bodyText || null,
        bodyHtml: payload.bodyHtml || null,
        emailReceivedAt: new Date(payload.receivedAt),
        attachments: payload.attachments || null,
        rawEmailData: payload.rawEmailData || null,
        processed: false,
        processingStatus: "pending",
      })
      .returning({ id: incomingBidEmails.id });

    console.log(`[incoming-emails] Email received and stored: ${inserted.id} from ${payload.fromEmail}`);

    return {
      success: true,
      emailId: inserted.id,
      message: "Email received successfully",
    };
  },

  /**
   * Process an incoming email into a bid
   * Creates a new bid with the email data
   */
  async processEmailToBid(
    emailId: string,
    clientId: string
  ): Promise<ProcessEmailResult> {
    const db = getDb();

    // Get the email
    const email = await this.getEmailById(emailId);
    if (!email) {
      return {
        success: false,
        emailId,
        message: "Email not found",
      };
    }

    if (email.processed) {
      return {
        success: false,
        emailId,
        bidId: email.bidId || undefined,
        message: "Email already processed",
      };
    }

    // Verify client exists
    const clientResult = await db
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);

    if (clientResult.length === 0) {
      return {
        success: false,
        emailId,
        message: "Client not found",
      };
    }

    try {
      // Update email status to processing
      await db
        .update(incomingBidEmails)
        .set({ processingStatus: "processing", updatedAt: new Date() })
        .where(eq(incomingBidEmails.id, emailId));

      // Create the bid
      const [newBid] = await db
        .insert(bids)
        .values({
          clientId,
          intakeSource: "email",
          status: "new",
          projectName: email.subject.replace(/^(re:|fwd:|fw:)\s*/gi, "").trim(),
          senderEmail: email.fromEmail,
          senderName: email.fromName,
          emailSubject: email.subject,
          emailBody: email.bodyText,
          rawPayload: {
            source: "gmail_webhook",
            gmailMessageId: email.gmailMessageId,
            attachments: email.attachments,
          },
          externalRef: email.gmailMessageId,
          receivedAt: new Date(email.emailReceivedAt),
        })
        .returning({ id: bids.id });

      // Update email as processed
      await db
        .update(incomingBidEmails)
        .set({
          processed: true,
          processingStatus: "completed",
          bidId: newBid.id,
          processedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(incomingBidEmails.id, emailId));

      console.log(`[incoming-emails] Email ${emailId} processed into bid ${newBid.id}`);

      return {
        success: true,
        emailId,
        bidId: newBid.id,
        message: "Email processed into bid successfully",
      };
    } catch (error) {
      // Update email with error
      await db
        .update(incomingBidEmails)
        .set({
          processingStatus: "failed",
          processingError: error instanceof Error ? error.message : "Unknown error",
          updatedAt: new Date(),
        })
        .where(eq(incomingBidEmails.id, emailId));

      console.error(`[incoming-emails] Failed to process email ${emailId}:`, error);

      return {
        success: false,
        emailId,
        message: error instanceof Error ? error.message : "Failed to process email",
      };
    }
  },

  /**
   * Skip an incoming email (mark as not a bid)
   */
  async skipEmail(emailId: string, reason?: string): Promise<{ success: boolean; message: string }> {
    const db = getDb();

    const email = await this.getEmailById(emailId);
    if (!email) {
      return { success: false, message: "Email not found" };
    }

    if (email.processed) {
      return { success: false, message: "Email already processed" };
    }

    await db
      .update(incomingBidEmails)
      .set({
        processingStatus: "skipped",
        processingError: reason || "Manually skipped",
        updatedAt: new Date(),
      })
      .where(eq(incomingBidEmails.id, emailId));

    console.log(`[incoming-emails] Email ${emailId} skipped: ${reason || "manual"}`);

    return { success: true, message: "Email skipped" };
  },

  /**
   * Get counts for dashboard stats
   */
  async getStats(): Promise<{
    total: number;
    pending: number;
    processed: number;
    failed: number;
  }> {
    const db = getDb();

    const result = await db
      .select({
        total: sql<number>`count(*)::int`,
        pending: sql<number>`count(*) filter (where ${incomingBidEmails.processingStatus} = 'pending')::int`,
        processed: sql<number>`count(*) filter (where ${incomingBidEmails.processed} = true)::int`,
        failed: sql<number>`count(*) filter (where ${incomingBidEmails.processingStatus} = 'failed')::int`,
      })
      .from(incomingBidEmails);

    return result[0] || { total: 0, pending: 0, processed: 0, failed: 0 };
  },
};
