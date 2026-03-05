/**
 * Incoming Bid Emails Routes
 *
 * API endpoints for managing incoming bid emails via Resend.
 * Per-client intake: intake-{clientSlug}@{domain}
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { Webhook } from "svix";
import { z } from "zod";
import { getDb, incomingBidEmails, eq } from "@bid-catcher/db";
import { incomingEmailsService } from "../services/incoming-emails.js";
import {
  type ResendWebhookEvent,
  fetchAttachmentList,
  fetchAttachmentById,
} from "../services/resend-incoming.js";

// Request schemas
const ListQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
  processed: z.enum(["true", "false"]).optional().transform((v) => (v === "true" ? true : v === "false" ? false : undefined)),
  clientId: z.string().uuid().optional(),
});

const ProcessEmailSchema = z.object({
  clientId: z.string().uuid().optional(),
});

const SkipEmailSchema = z.object({
  reason: z.string().optional(),
});

const RESEND_WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET;

export async function incomingEmailsRoutes(server: FastifyInstance): Promise<void> {
  /**
   * GET /incoming-emails
   *
   * List incoming bid emails with pagination.
   */
  server.get(
    "/",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = ListQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid query parameters",
            details: parseResult.error.errors,
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }

      try {
        const result = await incomingEmailsService.listEmails(parseResult.data);

        return reply.status(200).send({
          success: true,
          data: result,
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (error) {
        request.log.error(error, "Failed to list incoming emails");
        return reply.status(500).send({
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to list incoming emails",
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }
    }
  );

  /**
   * GET /incoming-emails/stats
   *
   * Get statistics for incoming emails (for dashboard).
   */
  server.get(
    "/stats",
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const stats = await incomingEmailsService.getStats();
        const receivingDomain = process.env.RESEND_RECEIVING_DOMAIN || "";

        return reply.status(200).send({
          success: true,
          data: { ...stats, receivingDomain },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (error) {
        request.log.error(error, "Failed to get email stats");
        return reply.status(500).send({
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to get email stats",
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }
    }
  );

  /**
   * GET /incoming-emails/diagnose-attachments/:emailId
   *
   * Diagnostic endpoint: tests Resend API attachment list + download for an incoming email.
   * Returns detailed JSON so you can share what's failing. Use any incoming email ID.
   */
  server.get<{ Params: { emailId: string } }>(
    "/diagnose-attachments/:emailId",
    async (request: FastifyRequest<{ Params: { emailId: string } }>, reply: FastifyReply) => {
      const { emailId } = request.params;
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(emailId)) {
        return reply.status(400).send({
          success: false,
          error: { code: "INVALID_ID", message: "Invalid email ID format" },
          meta: { requestId: request.id, timestamp: new Date().toISOString() },
        });
      }

      try {
        const email = await incomingEmailsService.getEmailById(emailId);
        if (!email) {
          return reply.status(404).send({
            success: false,
            error: { code: "NOT_FOUND", message: "Incoming email not found" },
            meta: { requestId: request.id, timestamp: new Date().toISOString() },
          });
        }

        const resendEmailId = email.resendEmailId;
        if (!resendEmailId) {
          return reply.status(400).send({
            success: false,
            error: { code: "NO_RESEND_ID", message: "This email has no Resend email ID" },
            meta: { requestId: request.id, timestamp: new Date().toISOString() },
          });
        }

        const apiList = await fetchAttachmentList(resendEmailId);
        let firstWithUrl = apiList.find((a) => a.download_url);
        let retrieveByIdResult: { tried: boolean; attachmentId?: string; ok?: boolean; error?: string } = { tried: false };

        // When list returns empty, try Retrieve-by-ID using webhook attachment IDs
        let rawStructureDebug: Record<string, unknown> = {};
        if (!firstWithUrl && apiList.length === 0 && email.attachments?.length) {
          const db = getDb();
          const rawRows = await db
            .select({ attachments: incomingBidEmails.attachments, rawEmailData: incomingBidEmails.rawEmailData })
            .from(incomingBidEmails)
            .where(eq(incomingBidEmails.id, emailId))
            .limit(1);
          const raw = rawRows[0];
          const rawData = raw?.rawEmailData as Record<string, unknown> | null;
          rawStructureDebug = {
            rawEmailDataKeys: rawData ? Object.keys(rawData) : [],
            eventKeys: rawData?.event ? Object.keys(rawData.event as object) : [],
            dataKeys: rawData?.event && typeof rawData.event === "object" && "data" in rawData.event
              ? Object.keys((rawData.event as { data?: object }).data || {})
              : [],
          };
          // Try both event.data.attachments (our storage) and data.attachments (direct Resend format)
          const eventData = rawData?.event && typeof rawData.event === "object" && "data" in rawData.event
            ? (rawData.event as { data?: { attachments?: Array<{ id: string; filename?: string }> } }).data
            : null;
          const directData = rawData && "data" in rawData ? (rawData as { data?: { attachments?: Array<{ id: string; filename?: string }> } }).data : null;
          const webhookAtts = eventData?.attachments ?? directData?.attachments ?? [];
          rawStructureDebug.webhookAttsCount = webhookAtts.length;
          rawStructureDebug.webhookAttIds = webhookAtts.map((a) => ({ id: a.id, filename: a.filename }));
          const storedAtts = (raw?.attachments as Array<{ id?: string; filename: string }>) ?? [];
          for (const att of email.attachments) {
            const attId = storedAtts.find((s) => s.filename === att.filename)?.id ?? webhookAtts.find((w) => w.filename === att.filename)?.id;
            if (attId) {
              let byId = await fetchAttachmentById(resendEmailId, attId);
              let resendApiDebug: { status?: number; bodyPreview?: string } | undefined;
              if (!byId?.download_url) {
                try {
                  const r = await fetch(`https://api.resend.com/emails/receiving/${resendEmailId}/attachments/${attId}`, {
                    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "User-Agent": "BidCatcher/1.0" },
                  });
                  const body = await r.text();
                  resendApiDebug = { status: r.status, bodyPreview: body.slice(0, 400) };
                  if (r.ok) {
                    const parsed = JSON.parse(body) as { download_url?: string; filename?: string; content_type?: string };
                    if (parsed.download_url) byId = { id: attId, filename: parsed.filename ?? att.filename, content_type: parsed.content_type ?? "application/pdf", download_url: parsed.download_url };
                  }
                } catch (e) {
                  resendApiDebug = { bodyPreview: String(e) };
                }
              }
              retrieveByIdResult = {
                tried: true,
                attachmentId: attId,
                filename: att.filename,
                ok: !!byId?.download_url,
                error: byId ? undefined : "fetchAttachmentById returned null",
                resendApi: resendApiDebug,
              };
              if (byId?.download_url) {
                firstWithUrl = byId;
                break;
              }
            }
          }
        }

        let downloadResult: { ok: boolean; size?: number; error?: string; status?: number } = { ok: false };

        if (firstWithUrl?.download_url) {
          try {
            const res = await fetch(firstWithUrl.download_url, {
              headers: {
                "User-Agent": "BidCatcher/1.0",
                Accept: "*/*",
                ...(process.env.RESEND_API_KEY && {
                  Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
                }),
              },
              redirect: "follow",
            });
            const buf = await res.arrayBuffer();
            if (res.ok && buf.byteLength > 0) {
              downloadResult = { ok: true, size: buf.byteLength };
            } else {
              downloadResult = {
                ok: false,
                error: `HTTP ${res.status} ${res.statusText}, body size: ${buf.byteLength}`,
                status: res.status,
              };
            }
          } catch (err) {
            downloadResult = {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        } else {
          downloadResult = { ok: false, error: "No attachment with download_url in API response" };
        }

        const diagnostic = {
          incomingEmailId: emailId,
          resendEmailId,
          hasApiKey: !!process.env.RESEND_API_KEY,
          attachmentsFromApi: {
            count: apiList.length,
            items: apiList.map((a) => ({
              id: a.id,
              filename: a.filename,
              content_type: a.content_type,
              size: a.size,
              hasDownloadUrl: !!a.download_url,
              expires_at: a.expires_at,
            })),
          },
          rawStructureDebug: Object.keys(rawStructureDebug).length > 0 ? rawStructureDebug : undefined,
          retrieveByIdTest: retrieveByIdResult,
          downloadTest: {
            testedFilename: firstWithUrl?.filename ?? null,
            ...downloadResult,
          },
          storedAttachmentsCount: email.attachmentCount ?? 0,
        };

        return reply.status(200).send({
          success: true,
          data: diagnostic,
          meta: { requestId: request.id, timestamp: new Date().toISOString() },
        });
      } catch (error) {
        request.log.error(error, "Diagnose attachments failed");
        return reply.status(500).send({
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Diagnose failed",
          },
          meta: { requestId: request.id, timestamp: new Date().toISOString() },
        });
      }
    }
  );

  /**
   * POST /incoming-emails/:id/refetch-attachments
   *
   * Re-fetch attachments from Resend and update stored content.
   * Use when attachments show "No content" - fetches via Retrieve-by-ID and downloads.
   */
  server.post<{ Params: { id: string } }>(
    "/:id/refetch-attachments",
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) {
        return reply.status(400).send({ success: false, error: { code: "INVALID_ID", message: "Invalid email ID format" } });
      }
      try {
        const result = await incomingEmailsService.refetchAttachments(id);
        return reply.status(200).send({ success: true, data: result, meta: { requestId: request.id, timestamp: new Date().toISOString() } });
      } catch (error) {
        request.log.error(error, "Refetch attachments failed");
        return reply.status(500).send({
          success: false,
          error: { code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : "Refetch failed" },
          meta: { requestId: request.id, timestamp: new Date().toISOString() },
        });
      }
    }
  );

  /**
   * GET /incoming-emails/:id/download-attachment
   *
   * Download an attachment by filename. Query: ?filename=example.pdf
   * Returns the file if we have content stored in incoming_bid_emails.attachments.
   * Use this to verify content is stored before processing to bid.
   */
  server.get<{ Params: { id: string }; Querystring: { filename?: string } }>(
    "/:id/download-attachment",
    async (request: FastifyRequest<{ Params: { id: string }; Querystring: { filename?: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const filename = request.query.filename;
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) {
        return reply.status(400).send({ success: false, error: { code: "INVALID_ID", message: "Invalid email ID format" } });
      }
      if (!filename || typeof filename !== "string") {
        return reply.status(400).send({ success: false, error: { code: "MISSING_FILENAME", message: "Query param filename is required" } });
      }

      const db = getDb();
      const rows = await db
        .select({ attachments: incomingBidEmails.attachments })
        .from(incomingBidEmails)
        .where(eq(incomingBidEmails.id, id))
        .limit(1);
      const atts = (rows[0]?.attachments as Array<{ filename: string; contentType: string; contentBase64?: string }>) || [];
      const att = atts.find((a) => a.filename === filename || decodeURIComponent(filename) === a.filename);
      if (!att?.contentBase64) {
        return reply.status(404).send({
          success: false,
          error: {
            code: "NO_CONTENT",
            message: att ? "Attachment has no stored content (download may have failed)" : "Attachment not found",
          },
        });
      }

      const buffer = Buffer.from(att.contentBase64, "base64");
      reply.header("Content-Type", att.contentType);
      reply.header("Content-Disposition", `attachment; filename="${encodeURIComponent(att.filename)}"`);
      reply.header("Content-Length", buffer.length);
      return reply.send(buffer);
    }
  );

  /**
   * POST /incoming-emails/fix-all-routing
   *
   * Fix client routing for all emails with client_id null by re-parsing from to_email or raw_email_data.
   */
  server.post(
    "/fix-all-routing",
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = await incomingEmailsService.fixAllRouting();

        return reply.status(200).send({
          success: true,
          data: result,
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (error) {
        request.log.error(error, "Failed to fix routing");
        return reply.status(500).send({
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to fix routing",
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }
    }
  );

  /**
   * POST /incoming-emails/:id/fix-routing
   *
   * Fix client routing for a single email with client_id null.
   */
  server.post<{ Params: { id: string } }>(
    "/:id/fix-routing",
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) {
        return reply.status(400).send({
          success: false,
          error: {
            code: "INVALID_ID",
            message: "Invalid email ID format",
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }

      try {
        const result = await incomingEmailsService.fixRouting(id);

        if (!result.success) {
          return reply.status(400).send({
            success: false,
            error: {
              code: "ROUTING_FAILED",
              message: result.message,
            },
            meta: {
              requestId: request.id,
              timestamp: new Date().toISOString(),
            },
          });
        }

        return reply.status(200).send({
          success: true,
          data: { clientId: result.clientId },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (error) {
        request.log.error(error, "Failed to fix routing");
        return reply.status(500).send({
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to fix routing",
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }
    }
  );

  /**
   * GET /incoming-emails/:id
   *
   * Get a single incoming email by ID.
   */
  server.get<{ Params: { id: string } }>(
    "/:id",
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) {
        return reply.status(400).send({
          success: false,
          error: {
            code: "INVALID_ID",
            message: "Invalid email ID format",
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }

      try {
        const result = await incomingEmailsService.getEmailById(id);

        if (!result) {
          return reply.status(404).send({
            success: false,
            error: {
              code: "NOT_FOUND",
              message: `Email with ID ${id} not found`,
            },
            meta: {
              requestId: request.id,
              timestamp: new Date().toISOString(),
            },
          });
        }

        return reply.status(200).send({
          success: true,
          data: result,
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (error) {
        request.log.error(error, "Failed to get email");
        return reply.status(500).send({
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to get email",
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }
    }
  );

  /**
   * POST /incoming-emails/webhook/resend
   *
   * Webhook endpoint for Resend email.received events.
   * Verifies Svix signature, fetches full content via Resend API, stores email.
   */
  server.post(
    "/webhook/resend",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const rawBody = (request as { rawBody?: string }).rawBody;
      if (!rawBody) {
        return reply.status(400).send({
          success: false,
          error: {
            code: "BAD_REQUEST",
            message: "Raw body required for webhook verification",
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }

      if (RESEND_WEBHOOK_SECRET) {
        const svixId = request.headers["svix-id"] as string | undefined;
        const svixTimestamp = request.headers["svix-timestamp"] as string | undefined;
        const svixSignature = request.headers["svix-signature"] as string | undefined;

        if (!svixId || !svixTimestamp || !svixSignature) {
          return reply.status(401).send({
            success: false,
            error: {
              code: "UNAUTHORIZED",
              message: "Missing Svix webhook headers",
            },
            meta: {
              requestId: request.id,
              timestamp: new Date().toISOString(),
            },
          });
        }

        try {
          const wh = new Webhook(RESEND_WEBHOOK_SECRET);
          wh.verify(rawBody, {
            "svix-id": svixId,
            "svix-timestamp": svixTimestamp,
            "svix-signature": svixSignature,
          });
        } catch (err) {
          request.log.warn(err, "Webhook signature verification failed");
          return reply.status(401).send({
            success: false,
            error: {
              code: "UNAUTHORIZED",
              message: "Invalid webhook signature",
            },
            meta: {
              requestId: request.id,
              timestamp: new Date().toISOString(),
            },
          });
        }
      }

      const body = request.body as { type?: string; data?: unknown };
      if (body?.type !== "email.received" || !body?.data) {
        return reply.status(400).send({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid Resend webhook event - expected email.received",
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }

      try {
        const result = await incomingEmailsService.receiveEmailFromResend(body as unknown as ResendWebhookEvent);

        return reply.status(result.skipped ? 200 : 201).send({
          success: true,
          data: result,
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (error) {
        request.log.error(error, "Failed to process Resend webhook");
        return reply.status(500).send({
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to process webhook",
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }
    }
  );

  /**
   * POST /incoming-emails/:id/process
   *
   * Process an incoming email into a bid.
   * clientId optional if email was routed to a client address.
   */
  server.post<{ Params: { id: string } }>(
    "/:id/process",
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) {
        return reply.status(400).send({
          success: false,
          error: {
            code: "INVALID_ID",
            message: "Invalid email ID format",
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }

      const parseResult = ProcessEmailSchema.safeParse(request.body || {});
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid request body",
            details: parseResult.error.errors,
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }

      try {
        const result = await incomingEmailsService.processEmailToBid(id, parseResult.data.clientId);

        if (!result.success) {
          return reply.status(400).send({
            success: false,
            error: {
              code: "PROCESSING_ERROR",
              message: result.message,
            },
            meta: {
              requestId: request.id,
              timestamp: new Date().toISOString(),
            },
          });
        }

        return reply.status(200).send({
          success: true,
          data: result,
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (error) {
        request.log.error(error, "Failed to process email");
        return reply.status(500).send({
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to process email",
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }
    }
  );

  /**
   * POST /incoming-emails/:id/skip
   *
   * Skip an incoming email (mark as not a bid).
   */
  server.post<{ Params: { id: string } }>(
    "/:id/skip",
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) {
        return reply.status(400).send({
          success: false,
          error: {
            code: "INVALID_ID",
            message: "Invalid email ID format",
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }

      const parseResult = SkipEmailSchema.safeParse(request.body || {});
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid request body",
            details: parseResult.error.errors,
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }

      try {
        const result = await incomingEmailsService.skipEmail(id, parseResult.data.reason);

        if (!result.success) {
          return reply.status(400).send({
            success: false,
            error: {
              code: "SKIP_ERROR",
              message: result.message,
            },
            meta: {
              requestId: request.id,
              timestamp: new Date().toISOString(),
            },
          });
        }

        return reply.status(200).send({
          success: true,
          data: result,
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (error) {
        request.log.error(error, "Failed to skip email");
        return reply.status(500).send({
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to skip email",
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }
    }
  );
}
