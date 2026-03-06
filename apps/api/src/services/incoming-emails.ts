/**
 * Incoming Bid Emails Service
 *
 * Business logic for managing incoming bid emails via Resend.
 * Per-client intake addresses: intake-{clientSlug}@{domain}
 * Handles email ingestion, listing, and processing into bids.
 */

import { createHash } from "crypto";
import { getDb, incomingBidEmails, bids, bidDocuments, clients, eq, desc, sql, and, inArray } from "@bid-catcher/db";
import {
  parseIntakeAddressFromTo,
  parseClientSlugFromToAddress,
  fetchEmailContent,
  fetchAttachmentList,
  fetchAttachmentById,
  downloadAttachment,
  type ResendWebhookEvent,
  extractEmail,
} from "./resend-incoming.js";
import { syncBidToGhl } from "./ghl-sync.js";
import { pdfExtractionService } from "./pdf-extraction.js";

// ----- Types -----

interface IncomingEmailSummary {
  id: string;
  resendEmailId: string | null;
  clientId: string | null;
  clientName: string | null;
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
    size?: number;
    storageKey?: string;
  }> | null;
}

interface IncomingEmailListResult {
  emails: IncomingEmailSummary[];
  total: number;
  limit: number;
  offset: number;
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
    clientId?: string;
  }): Promise<IncomingEmailListResult> {
    const db = getDb();
    const limit = params.limit || 50;
    const offset = params.offset || 0;

    const conditions = [];
    if (params.processed !== undefined) {
      conditions.push(eq(incomingBidEmails.processed, params.processed));
    }
    if (params.clientId) {
      conditions.push(eq(incomingBidEmails.clientId, params.clientId));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : sql`true`;

    const countResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(incomingBidEmails)
      .where(whereClause);
    const total = countResult[0]?.count || 0;

    const selectFields = {
      id: incomingBidEmails.id,
      resendEmailId: incomingBidEmails.resendEmailId,
      clientId: incomingBidEmails.clientId,
      fromEmail: incomingBidEmails.fromEmail,
      fromName: incomingBidEmails.fromName,
      subject: incomingBidEmails.subject,
      emailReceivedAt: incomingBidEmails.emailReceivedAt,
      processed: incomingBidEmails.processed,
      processingStatus: incomingBidEmails.processingStatus,
      bidId: incomingBidEmails.bidId,
      attachments: incomingBidEmails.attachments,
      createdAt: incomingBidEmails.createdAt,
    };
    // Filter out undefined column refs (avoids Drizzle orderSelectedFields error if schema/DB mismatch)
    const filteredSelect = Object.fromEntries(
      Object.entries(selectFields).filter(([, v]) => v != null)
    ) as typeof selectFields;

    const results = await db
      .select(filteredSelect)
      .from(incomingBidEmails)
      .where(whereClause)
      .orderBy(desc(incomingBidEmails.emailReceivedAt))
      .limit(limit)
      .offset(offset);

    // Fetch client names for display
    const clientIds = [...new Set(results.map((r) => r.clientId).filter(Boolean))] as string[];
    const clientMap: Record<string, string> = {};
    if (clientIds.length > 0) {
      const clientRows = await db
        .select({ id: clients.id, name: clients.name })
        .from(clients)
        .where(inArray(clients.id, clientIds));
      for (const c of clientRows) {
        clientMap[c.id] = c.name;
      }
    }

    const emails: IncomingEmailSummary[] = results.map((r) => ({
      id: r.id,
      resendEmailId: r.resendEmailId,
      clientId: r.clientId,
      clientName: r.clientId ? clientMap[r.clientId] || null : null,
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

    if (results.length === 0) return null;

    const r = results[0];
    let clientName: string | null = null;
    if (r.clientId) {
      const clientRows = await db
        .select({ name: clients.name })
        .from(clients)
        .where(eq(clients.id, r.clientId))
        .limit(1);
      clientName = clientRows[0]?.name || null;
    }

    // Strip contentBase64 from attachments when returning to client (keeps response lean)
    // Include hasContent and size so you can verify content is stored before processing to bid
    const rawAttachments = (r.attachments as Array<{ id?: string; filename: string; contentType: string; size?: number; contentBase64?: string }>) || [];
    const attachmentsForClient = rawAttachments.map(({ contentBase64, ...rest }) => ({
      ...rest,
      hasContent: !!contentBase64,
      size: rest.size ?? (contentBase64 ? Math.round((contentBase64.length * 3) / 4) : undefined),
    }));

    return {
      id: r.id,
      resendEmailId: r.resendEmailId,
      clientId: r.clientId,
      clientName,
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
      attachments: attachmentsForClient.length > 0 ? attachmentsForClient : null,
      attachmentCount: rawAttachments.length,
      createdAt: r.createdAt.toISOString(),
    };
  },

  /**
   * Receive an email from Resend webhook
   * Fetches full content via Resend API, parses client from to-address
   */
  async receiveEmailFromResend(event: ResendWebhookEvent): Promise<{
    success: boolean;
    emailId?: string;
    skipped?: boolean;
    message: string;
  }> {
    const db = getDb();
    const { data } = event;
    const emailId = data.email_id;

    // Check if "Bid" is in the subject (case-insensitive)
    if (!data.subject.toLowerCase().includes("bid")) {
      console.log(`[incoming-emails] Skipping - no "Bid" in subject: "${data.subject}"`);
      return {
        success: true,
        skipped: true,
        message: "Email skipped - subject does not contain 'Bid'",
      };
    }

    // Deduplicate by Resend email ID
    const existing = await db
      .select({ id: incomingBidEmails.id })
      .from(incomingBidEmails)
      .where(eq(incomingBidEmails.resendEmailId, emailId))
      .limit(1);

    if (existing.length > 0) {
      console.log(`[incoming-emails] Duplicate - already exists: ${emailId}`);
      return {
        success: true,
        emailId: existing[0].id,
        skipped: true,
        message: "Email already processed",
      };
    }

    // Parse client from to-address (intake-{slug}@{domain})
    const toAddresses = Array.isArray(data.to) ? data.to : data.to ? [data.to] : [];
    const intakeParse = parseIntakeAddressFromTo(toAddresses);
    let clientId: string | null = null;
    let clientConfig: { intake?: { allowedEmailDomains?: string[] } } | null = null;
    // Always store recipient address: prefer parsed intake, else first to-address
    const toEmail =
      intakeParse?.intakeAddress ??
      (toAddresses[0] ? extractEmail(toAddresses[0]) : null);

    if (intakeParse) {
      // Case-insensitive slug lookup; also try slug with hyphens removed (e.g. "testing-company" -> "testingcompany")
      const slugLower = intakeParse.slug.toLowerCase();
      const slugNoHyphens = slugLower.replace(/-/g, "");
      const clientRows = await db
        .select({ id: clients.id, config: clients.config })
        .from(clients)
        .where(
          sql`(lower(${clients.slug}) = ${slugLower} OR lower(replace(${clients.slug}, '-', '')) = ${slugNoHyphens})`
        )
        .limit(1);
      if (clientRows[0]) {
        clientId = clientRows[0].id;
        clientConfig = (clientRows[0].config as { intake?: { allowedEmailDomains?: string[] } }) || null;
      } else {
        console.warn(`[incoming-emails] No client found for slug: "${intakeParse.slug}" (to: ${JSON.stringify(toAddresses)}) - ensure client exists with matching slug`);
      }
    } else if (toAddresses.length > 0) {
      console.warn(`[incoming-emails] Could not parse intake address from to: ${JSON.stringify(toAddresses)} - expected format: intake-{slug}@{domain}`);
    }

    // Parse from header (e.g. "Name <email@example.com>")
    let fromEmail = "";
    let fromName: string | null = null;
    const fromMatch = data.from.match(/^(.+?)\s*<([^>]+)>$/);
    if (fromMatch) {
      fromName = fromMatch[1].trim().replace(/^["']|["']$/g, "") || null;
      fromEmail = fromMatch[2].trim();
    } else {
      fromEmail = data.from.trim();
    }

    // Domain allowlist: only allow emails FROM certain domains (per client)
    const allowedDomains = clientConfig?.intake?.allowedEmailDomains;
    if (clientId && Array.isArray(allowedDomains) && allowedDomains.length > 0) {
      const senderDomain = fromEmail.split("@")[1]?.toLowerCase();
      if (!senderDomain) {
        console.log(`[incoming-emails] Skipping - no sender domain: ${fromEmail}`);
        return {
          success: true,
          skipped: true,
          message: "Email skipped - sender domain could not be determined",
        };
      }
      const allowed = allowedDomains.some((d) => d.toLowerCase().trim() === senderDomain);
      if (!allowed) {
        console.log(`[incoming-emails] Skipping - sender domain ${senderDomain} not in allowlist for client`);
        return {
          success: true,
          skipped: true,
          message: `Email skipped - sender domain (${senderDomain}) not in allowed list for this client`,
        };
      }
    }

    // Resend API endpoints we will hit (base: https://api.resend.com)
    const attCount = (data.attachments?.length ?? 0);
    console.log(`[incoming-emails] RESEND_API_KEY: ${process.env.RESEND_API_KEY ? "configured" : "NOT SET"}`);
    console.log(`[incoming-emails] Resend API calls for email_id=${emailId}:`);
    console.log(`[incoming-emails]   1. GET /emails/receiving/${emailId} (email content)`);
    console.log(`[incoming-emails]   2. GET /emails/receiving/${emailId}/attachments (list)`);
    if (attCount > 0) {
      for (const a of data.attachments ?? []) {
        console.log(`[incoming-emails]   3. GET /emails/receiving/${emailId}/attachments/${a.id} (Retrieve-by-ID)`);
      }
      console.log(`[incoming-emails]   4. GET <download_url> (per attachment, from Retrieve-by-ID response)`);
    }

    // Fetch full email content from Resend API
    const content = await fetchEmailContent(emailId);
    if (content.error) {
      console.error(`[incoming-emails] Failed to fetch content: ${content.error}`);
      // Store with metadata only - we can retry later
    }

    // Attachments: Resend API is the source of truth - webhook has metadata only, no content/size.
    // Must call Attachments API to get download_url and fetch content (per Resend docs).
    // When list returns empty, try Retrieve-by-ID for each webhook attachment (Resend list can be empty).
    const webhookAttachments = Array.isArray(data.attachments) ? data.attachments : [];
    console.log(`[incoming-emails] Webhook attachments: ${webhookAttachments.length} (ids: [${webhookAttachments.map((a: { id: string; filename?: string }) => `${a.id}:${a.filename ?? "?"}`).join(", ")}])`);

    console.log(`[incoming-emails] Step 1: GET https://api.resend.com/emails/receiving/${emailId}/attachments (List)`);
    let apiAttachmentList = await fetchAttachmentList(emailId);
    if (apiAttachmentList.length === 0 && webhookAttachments.length > 0) {
      console.log(`[incoming-emails] List returned 0, retrying in 1.5s...`);
      await new Promise((r) => setTimeout(r, 1500));
      apiAttachmentList = await fetchAttachmentList(emailId);
    }

    const webhookById = new Map(webhookAttachments.map((a: { id: string; filename?: string; content_type?: string }) => [a.id, a]));

    // If list empty, try Retrieve-by-ID for each webhook attachment (Resend list API sometimes returns empty)
    if (apiAttachmentList.length === 0 && webhookAttachments.length > 0) {
      console.warn(`[incoming-emails] Resend list API returned 0 - trying Retrieve-by-ID for ${webhookAttachments.length} webhook attachment(s)`);
      for (const w of webhookAttachments) {
        console.log(`[incoming-emails] Step 2: GET https://api.resend.com/emails/receiving/${emailId}/attachments/${w.id} (Retrieve-by-ID)`);
        const byId = await fetchAttachmentById(emailId, w.id);
        if (byId?.download_url) apiAttachmentList.push(byId);
        else console.warn(`[incoming-emails] Retrieve-by-ID for ${w.id} (${w.filename}) returned no download_url`);
      }
    }

    const attachmentList =
      apiAttachmentList.length > 0
        ? apiAttachmentList
        : webhookAttachments.map((a: { id: string; filename?: string; content_type?: string }) => ({
            id: a.id,
            filename: a.filename || "attachment",
            content_type: a.content_type || "application/octet-stream",
            size: undefined,
            download_url: undefined,
          }));
    if (apiAttachmentList.length === 0 && webhookAttachments.length > 0) {
      console.warn(`[incoming-emails] Resend API returned no attachments - using webhook metadata only (no content/size).`);
    }
    const attachments: Array<{ id?: string; filename: string; contentType: string; size?: number; contentBase64?: string }> = [];
    for (const att of attachmentList) {
      const webhookMeta = webhookById.get(att.id);
      const filename = att.filename || webhookMeta?.filename || "attachment";
      const contentType = att.content_type || webhookMeta?.content_type || "application/octet-stream";
      if (att.download_url) {
        const downloaded = await downloadAttachment(att.download_url);
        if (downloaded) {
          attachments.push({
            id: att.id,
            filename,
            contentType,
            size: downloaded.size,
            contentBase64: downloaded.base64,
          });
        } else {
          console.warn(`[incoming-emails] Failed to download attachment: ${filename}`);
          attachments.push({ id: att.id, filename, contentType, size: att.size });
        }
      } else {
        attachments.push({ id: att.id, filename, contentType, size: att.size });
      }
    }
    console.log(`[incoming-emails] Stored ${attachments.length} attachments for email ${emailId} (to: ${toEmail}, client: ${clientId || "none"})`);

    const receivedAt = new Date(data.created_at);

    const [inserted] = await db
      .insert(incomingBidEmails)
      .values({
        resendEmailId: emailId,
        clientId,
        toEmail,
        fromEmail: fromEmail || "unknown",
        fromName,
        subject: data.subject,
        bodyText: content.text || null,
        bodyHtml: content.html || null,
        emailReceivedAt: receivedAt,
        attachments, // Store full attachments including contentBase64 for bid_documents
        rawEmailData: { source: "resend_webhook", event: event as unknown as Record<string, unknown> },
        processed: false,
        processingStatus: "pending",
      })
      .returning({ id: incomingBidEmails.id });

    console.log(`[incoming-emails] Email received: ${inserted.id} from ${fromEmail} (client: ${clientId || "unknown"})`);

    return {
      success: true,
      emailId: inserted.id,
      message: "Email received successfully",
    };
  },

  /**
   * Re-fetch attachments from Resend and update incoming_bid_emails.attachments with content.
   * Use when attachments were stored without content (list API returned empty).
   */
  async refetchAttachments(emailId: string): Promise<{ success: boolean; updated: number; message: string }> {
    const db = getDb();
    const rows = await db
      .select({
        resendEmailId: incomingBidEmails.resendEmailId,
        attachments: incomingBidEmails.attachments,
        rawEmailData: incomingBidEmails.rawEmailData,
      })
      .from(incomingBidEmails)
      .where(eq(incomingBidEmails.id, emailId))
      .limit(1);
    if (rows.length === 0) return { success: false, updated: 0, message: "Email not found" };
    const { resendEmailId, attachments: rawAtts, rawEmailData } = rows[0];
    if (!resendEmailId) return { success: false, updated: 0, message: "No Resend email ID" };

    type RawWebhook = { event?: { data?: { attachments?: Array<{ id: string; filename?: string }> } } };
    const rawEvent = rawEmailData as RawWebhook | null;
    const webhookAtts = rawEvent?.event?.data?.attachments ?? [];
    const atts = (rawAtts as Array<{ id?: string; filename: string; contentType: string; contentBase64?: string }>) ?? [];
    const idByFilename = new Map(webhookAtts.map((a) => [a.filename ?? "", a.id]));

    let updated = 0;
    const newAttachments: Array<{ id?: string; filename: string; contentType: string; size?: number; contentBase64?: string }> = [];
    for (const att of atts) {
      if (att.contentBase64) {
        newAttachments.push(att);
        continue;
      }
      const attId = att.id ?? idByFilename.get(att.filename);
      if (!attId) {
        newAttachments.push(att);
        continue;
      }
      const byId = await fetchAttachmentById(resendEmailId, attId);
      if (!byId?.download_url) {
        newAttachments.push(att);
        continue;
      }
      const downloaded = await downloadAttachment(byId.download_url);
      if (downloaded) {
        newAttachments.push({
          id: attId,
          filename: att.filename,
          contentType: att.contentType,
          size: downloaded.size,
          contentBase64: downloaded.base64,
        });
        updated++;
      } else {
        newAttachments.push(att);
      }
    }

    await db
      .update(incomingBidEmails)
      .set({ attachments: newAttachments, updatedAt: new Date() })
      .where(eq(incomingBidEmails.id, emailId));

    return {
      success: true,
      updated,
      message: updated > 0 ? `Refetched ${updated} attachment(s) with content` : "No new content (download may have failed or URL expired)",
    };
  },

  /**
   * Process an incoming email into a bid
   * Uses clientId from email if set, otherwise requires clientId param
   */
  async processEmailToBid(
    emailId: string,
    clientIdParam?: string
  ): Promise<ProcessEmailResult> {
    const db = getDb();

    const email = await this.getEmailById(emailId);
    if (!email) {
      return { success: false, emailId, message: "Email not found" };
    }

    if (email.processed) {
      return {
        success: false,
        emailId,
        bidId: email.bidId || undefined,
        message: "Email already processed",
      };
    }

    const clientId = clientIdParam || email.clientId;
    if (!clientId) {
      return {
        success: false,
        emailId,
        message: "Client not found for this email. Please specify a client.",
      };
    }

    const clientResult = await db
      .select({
        id: clients.id,
        name: clients.name,
        contactEmail: clients.contactEmail,
        contactName: clients.contactName,
        phone: clients.phone,
        ghlContactId: clients.ghlContactId,
        config: clients.config,
      })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);

    if (clientResult.length === 0) {
      return { success: false, emailId, message: "Client not found" };
    }

    // Fetch attachments, rawEmailData, and resendEmailId for bid_documents
    const rawRows = await db
      .select({
        attachments: incomingBidEmails.attachments,
        resendEmailId: incomingBidEmails.resendEmailId,
        rawEmailData: incomingBidEmails.rawEmailData,
      })
      .from(incomingBidEmails)
      .where(eq(incomingBidEmails.id, emailId))
      .limit(1);
    const rawAttachments = (rawRows[0]?.attachments as Array<{ id?: string; filename: string; contentType: string; size?: number; contentBase64?: string }>) || [];
    const resendEmailId = rawRows[0]?.resendEmailId;
    const rawEmailData = rawRows[0]?.rawEmailData;

    // Get attachment IDs from webhook (for emails stored before we saved id)
    type RawWebhookProcess = { event?: { data?: { attachments?: Array<{ id: string; filename?: string }> } } };
    const rawEvent = rawEmailData as RawWebhookProcess | null;
    const webhookAtts = rawEvent?.event?.data?.attachments ?? [];
    const idByFilenameProcess = new Map(webhookAtts.map((a) => [a.filename ?? "", a.id]));

    // For attachments without content: fetch from Resend API (list or Retrieve-by-ID; download_url valid 1h)
    const attachmentsWithContent: Array<{ filename: string; contentType: string; size?: number; contentBase64?: string }> = [];
    for (const att of rawAttachments) {
      if (att.contentBase64) {
        attachmentsWithContent.push(att);
      } else if (resendEmailId) {
        const attId = att.id ?? idByFilenameProcess.get(att.filename);
        let match: { download_url?: string; size?: number } | null = null;
        const apiList = await fetchAttachmentList(resendEmailId);
        match = apiList.find((a) => (attId && a.id === attId) || a.filename === att.filename) ?? null;
        if (!match?.download_url && attId) {
          const byId = await fetchAttachmentById(resendEmailId, attId);
          if (byId?.download_url) match = byId;
        }
        if (match?.download_url) {
          const downloaded = await downloadAttachment(match.download_url);
          if (downloaded) {
            attachmentsWithContent.push({
              filename: att.filename,
              contentType: att.contentType,
              size: downloaded.size,
              contentBase64: downloaded.base64,
            });
          } else {
            attachmentsWithContent.push({ filename: att.filename, contentType: att.contentType, size: att.size });
          }
        } else {
          attachmentsWithContent.push({ filename: att.filename, contentType: att.contentType, size: att.size });
        }
      } else {
        attachmentsWithContent.push({ filename: att.filename, contentType: att.contentType, size: att.size });
      }
    }

    try {
      await db
        .update(incomingBidEmails)
        .set({ processingStatus: "processing", updatedAt: new Date() })
        .where(eq(incomingBidEmails.id, emailId));

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
            source: "resend_webhook",
            resendEmailId: email.resendEmailId,
            attachments: email.attachments,
          },
          externalRef: email.resendEmailId,
          receivedAt: new Date(email.emailReceivedAt),
        })
        .returning({ id: bids.id });

      // Create bid_documents from attachments (with content for PDF extraction when available)
      let documentCount = 0;
      for (const att of attachmentsWithContent) {
        const contentHash = att.contentBase64 ? createHash("sha256").update(att.contentBase64).digest("hex") : null;
        const sizeBytes = att.size ?? null;
        if (att.contentBase64 && sizeBytes) {
          console.log(`[incoming-emails] Storing document ${att.filename}: ${sizeBytes} bytes`);
        } else if (!att.contentBase64) {
          console.warn(`[incoming-emails] No content for ${att.filename} - document will be metadata only`);
        }
        await db.insert(bidDocuments).values({
          bidId: newBid.id,
          filename: att.filename,
          contentType: att.contentType,
          sizeBytes,
          documentType: "bid_invitation",
          processingStatus: att.contentBase64 ? "pending" : "skipped",
          content: att.contentBase64 ?? null,
          contentHash,
        });
        documentCount++;
      }
      if (documentCount > 0) {
        console.log(`[incoming-emails] Created ${documentCount} bid_documents for bid ${newBid.id}`);
      }

      // Run PDF extraction on pending documents (same as manual upload flow)
      const pendingCount = attachmentsWithContent.filter((a) => a.contentBase64).length;
      if (pendingCount > 0) {
        console.log(`[incoming-emails] Running extraction on ${pendingCount} document(s) for bid ${newBid.id}`);
        try {
          const extractResult = await pdfExtractionService.extractAllPendingDocuments(newBid.id);
          console.log(
            `[incoming-emails] Extraction complete for bid ${newBid.id}: ${extractResult.processed} processed, ${extractResult.failed} failed`
          );
        } catch (extractErr) {
          console.warn(`[incoming-emails] Extraction failed for bid ${newBid.id}:`, extractErr);
          // Don't fail the whole process - bid and documents are created; extraction can be retried
        }
      }

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

      // Sync bid to GHL (non-blocking)
      const client = clientResult[0];
      syncBidToGhl(
        {
          id: newBid.id,
          clientId,
          projectName: email.subject.replace(/^(re:|fwd:|fw:)\s*/gi, "").trim(),
          status: "new",
          senderEmail: email.fromEmail,
          senderName: email.fromName,
          senderCompany: null,
        },
        client
      ).catch((err) => console.warn("[incoming-emails] GHL sync failed:", err));

      return {
        success: true,
        emailId,
        bidId: newBid.id,
        message: "Email processed into bid successfully",
      };
    } catch (error) {
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
    if (!email) return { success: false, message: "Email not found" };
    if (email.processed) return { success: false, message: "Email already processed" };

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
   * Fix routing for an email with clientId null - use to_email or re-parse from rawEmailData
   */
  async fixRouting(emailId: string): Promise<{ success: boolean; clientId?: string; message: string }> {
    const db = getDb();

    const rows = await db
      .select({
        clientId: incomingBidEmails.clientId,
        toEmail: incomingBidEmails.toEmail,
        rawEmailData: incomingBidEmails.rawEmailData,
      })
      .from(incomingBidEmails)
      .where(eq(incomingBidEmails.id, emailId))
      .limit(1);

    if (rows.length === 0) return { success: false, message: "Email not found" };
    const row = rows[0];

    let intakeParse: { slug: string; intakeAddress: string } | null = null;

    // Prefer to_email if stored (e.g. intake-example@domain.com)
    if (row.toEmail && row.toEmail.includes("@")) {
      const [localPart] = row.toEmail.split("@");
      if (localPart?.toLowerCase().startsWith("intake-")) {
        const slug = localPart.slice(7);
        if (slug.length > 0) {
          intakeParse = { slug, intakeAddress: row.toEmail };
        }
      }
    }

    // Fallback: parse from raw_email_data
    if (!intakeParse) {
      const raw = row.rawEmailData as { event?: { data?: { to?: string[] } }; data?: { to?: string[] } } | null;
      const toAddresses = raw?.event?.data?.to ?? raw?.data?.to;
      if (Array.isArray(toAddresses) && toAddresses.length > 0) {
        intakeParse = parseIntakeAddressFromTo(toAddresses);
      }
    }

    if (!intakeParse) {
      return { success: false, message: "No intake address in to_email or raw email data" };
    }

    const slugLower = intakeParse!.slug.toLowerCase();
    const slugNoHyphens = slugLower.replace(/-/g, "");
    const clientRows = await db
      .select({ id: clients.id })
      .from(clients)
      .where(
        sql`(lower(${clients.slug}) = ${slugLower} OR lower(replace(${clients.slug}, '-', '')) = ${slugNoHyphens})`
      )
      .limit(1);

    if (clientRows.length === 0) {
      return { success: false, message: `No client found for slug: "${intakeParse!.slug}"` };
    }

    const clientId = clientRows[0].id;
    await db
      .update(incomingBidEmails)
      .set({
        clientId,
        toEmail: intakeParse!.intakeAddress,
        updatedAt: new Date(),
      })
      .where(eq(incomingBidEmails.id, emailId));

    console.log(`[incoming-emails] Fixed routing for email ${emailId} -> client ${clientId} (slug: ${intakeParse!.slug})`);
    return { success: true, clientId, message: `Assigned to client (slug: ${intakeParse!.slug})` };
  },

  /**
   * Fix routing for all emails with clientId null
   */
  async fixAllRouting(): Promise<{ fixed: number; failed: number; errors: string[] }> {
    const db = getDb();

    const unassigned = await db
      .select({ id: incomingBidEmails.id })
      .from(incomingBidEmails)
      .where(sql`${incomingBidEmails.clientId} IS NULL`);

    let fixed = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const row of unassigned) {
      const result = await this.fixRouting(row.id);
      if (result.success) {
        fixed++;
      } else {
        failed++;
        errors.push(`${row.id}: ${result.message}`);
      }
    }

    if (fixed > 0 || failed > 0) {
      console.log(`[incoming-emails] fixAllRouting: fixed=${fixed} failed=${failed}`);
    }
    return { fixed, failed, errors };
  },

  /**
   * Sync bid_documents from source email for a bid created from email.
   * Fetches attachments from Resend API when stored metadata has no content.
   * If documents exist but have no content, updates them with downloaded content.
   */
  async syncBidDocumentsFromEmail(bidId: string): Promise<{ success: boolean; created: number; updated: number; message: string }> {
    const db = getDb();

    const sourceRows = await db
      .select({
        resendEmailId: incomingBidEmails.resendEmailId,
        attachments: incomingBidEmails.attachments,
        rawEmailData: incomingBidEmails.rawEmailData,
      })
      .from(incomingBidEmails)
      .where(eq(incomingBidEmails.bidId, bidId))
      .limit(1);

    if (sourceRows.length === 0) {
      return { success: false, created: 0, updated: 0, message: "No source email found for this bid" };
    }

    const { resendEmailId, attachments: rawAttachments, rawEmailData } = sourceRows[0];
    const atts = (rawAttachments as Array<{ id?: string; filename: string; contentType: string; size?: number; contentBase64?: string }>) || [];

    // Get attachment IDs from webhook (for emails stored before we saved id)
    type RawWebhook = { event?: { data?: { attachments?: Array<{ id: string; filename?: string }> } } };
    const rawEvent = rawEmailData as RawWebhook | null;
    const webhookAtts = rawEvent?.event?.data?.attachments ?? [];
    const idByFilename = new Map(webhookAtts.map((a) => [a.filename ?? "", a.id]));

    if (atts.length === 0) {
      return { success: false, created: 0, updated: 0, message: "No attachments in source email" };
    }

    const existingDocs = await db
      .select({ id: bidDocuments.id, filename: bidDocuments.filename, content: bidDocuments.content })
      .from(bidDocuments)
      .where(eq(bidDocuments.bidId, bidId));

    const attachmentsWithContent: Array<{ filename: string; contentType: string; size?: number; contentBase64?: string }> = [];
    for (const att of atts) {
      if (att.contentBase64) {
        attachmentsWithContent.push(att);
      } else if (resendEmailId) {
        const attId = att.id ?? idByFilename.get(att.filename);
        let match: { download_url?: string; size?: number } | null = null;
        const apiList = await fetchAttachmentList(resendEmailId);
        match = apiList.find((a) => (attId && a.id === attId) || a.filename === att.filename) ?? null;
        if (!match?.download_url && attId) {
          const byId = await fetchAttachmentById(resendEmailId, attId);
          if (byId?.download_url) match = byId;
        }
        if (match?.download_url) {
          const downloaded = await downloadAttachment(match.download_url);
          if (downloaded) {
            attachmentsWithContent.push({
              filename: att.filename,
              contentType: att.contentType,
              size: downloaded.size,
              contentBase64: downloaded.base64,
            });
          } else {
            attachmentsWithContent.push({ filename: att.filename, contentType: att.contentType, size: att.size });
          }
        } else {
          attachmentsWithContent.push({ filename: att.filename, contentType: att.contentType, size: att.size });
        }
      } else {
        attachmentsWithContent.push({ filename: att.filename, contentType: att.contentType, size: att.size });
      }
    }

    let created = 0;
    let updated = 0;

    if (existingDocs.length === 0) {
      for (const att of attachmentsWithContent) {
        const contentHash = att.contentBase64 ? createHash("sha256").update(att.contentBase64).digest("hex") : null;
        await db.insert(bidDocuments).values({
          bidId,
          filename: att.filename,
          contentType: att.contentType,
          sizeBytes: att.size ?? null,
          documentType: "bid_invitation",
          processingStatus: att.contentBase64 ? "pending" : "skipped",
          content: att.contentBase64 ?? null,
          contentHash,
        });
        created++;
      }
    } else {
      for (const att of attachmentsWithContent) {
        const existing = existingDocs.find((d) => d.filename === att.filename);
        if (existing && !existing.content && att.contentBase64 && att.size) {
          const contentHash = createHash("sha256").update(att.contentBase64).digest("hex");
          await db
            .update(bidDocuments)
            .set({
              content: att.contentBase64,
              sizeBytes: att.size,
              contentHash,
              processingStatus: "pending",
              updatedAt: new Date(),
            })
            .where(eq(bidDocuments.id, existing.id));
          updated++;
          console.log(`[incoming-emails] Backfilled content for document ${existing.id} (${att.filename}): ${att.size} bytes`);
        } else if (!existing) {
          const contentHash = att.contentBase64 ? createHash("sha256").update(att.contentBase64).digest("hex") : null;
          await db.insert(bidDocuments).values({
            bidId,
            filename: att.filename,
            contentType: att.contentType,
            sizeBytes: att.size ?? null,
            documentType: "bid_invitation",
            processingStatus: att.contentBase64 ? "pending" : "skipped",
            content: att.contentBase64 ?? null,
            contentHash,
          });
          created++;
        }
      }
    }

    const msg = created > 0 || updated > 0
      ? `Created ${created}, updated ${updated} document(s)`
      : existingDocs.length > 0
        ? "Documents already have content"
        : "No content could be downloaded from Resend";
    console.log(`[incoming-emails] Sync for bid ${bidId}: ${msg}`);

    // Run extraction on any newly created/updated pending documents
    if (created > 0 || updated > 0) {
      try {
        const extractResult = await pdfExtractionService.extractAllPendingDocuments(bidId);
        if (extractResult.processed > 0) {
          console.log(`[incoming-emails] Extraction after sync: ${extractResult.processed} document(s) for bid ${bidId}`);
        }
      } catch (extractErr) {
        console.warn(`[incoming-emails] Extraction failed after sync for bid ${bidId}:`, extractErr);
      }
    }

    return { success: true, created, updated, message: msg };
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
