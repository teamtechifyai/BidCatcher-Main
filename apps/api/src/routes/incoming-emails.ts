/**
 * Incoming Bid Emails Routes
 *
 * API endpoints for managing incoming bid emails from Gmail.
 * Includes webhook endpoint for Gmail integration.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { incomingEmailsService } from "../services/incoming-emails.js";

// Request schemas
const ListQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
  processed: z.enum(["true", "false"]).optional().transform(v => v === "true" ? true : v === "false" ? false : undefined),
});

const WebhookPayloadSchema = z.object({
  gmailMessageId: z.string(),
  fromEmail: z.string().email(),
  fromName: z.string().optional(),
  subject: z.string(),
  bodyText: z.string().optional(),
  bodyHtml: z.string().optional(),
  receivedAt: z.string(),
  attachments: z.array(z.object({
    filename: z.string(),
    contentType: z.string(),
    size: z.number(),
    storageKey: z.string().optional(),
  })).optional(),
  rawEmailData: z.record(z.unknown()).optional(),
});

const ProcessEmailSchema = z.object({
  clientId: z.string().uuid(),
});

const SkipEmailSchema = z.object({
  reason: z.string().optional(),
});

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

        return reply.status(200).send({
          success: true,
          data: stats,
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
   * GET /incoming-emails/:id
   *
   * Get a single incoming email by ID.
   */
  server.get<{ Params: { id: string } }>(
    "/:id",
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;

      // Basic UUID validation
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
   * POST /incoming-emails/webhook
   *
   * Webhook endpoint for Gmail to push new emails.
   * This is called by Google Apps Script or Zapier/Make.
   */
  server.post(
    "/webhook",
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Optional: Verify webhook secret
      const webhookSecret = request.headers["x-webhook-secret"];
      const expectedSecret = process.env.GMAIL_WEBHOOK_SECRET;
      
      if (expectedSecret && webhookSecret !== expectedSecret) {
        return reply.status(401).send({
          success: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Invalid webhook secret",
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }

      const parseResult = WebhookPayloadSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid webhook payload",
            details: parseResult.error.errors,
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }

      try {
        const result = await incomingEmailsService.receiveEmail(parseResult.data);

        return reply.status(result.skipped ? 200 : 201).send({
          success: true,
          data: result,
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (error) {
        request.log.error(error, "Failed to process webhook");
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
   */
  server.post<{ Params: { id: string } }>(
    "/:id/process",
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;

      // Validate ID format
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

      const parseResult = ProcessEmailSchema.safeParse(request.body);
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
        const result = await incomingEmailsService.processEmailToBid(
          id,
          parseResult.data.clientId
        );

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
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;

      // Validate ID format
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
