/**
 * Intake Routes
 *
 * Unified intake endpoints for web and email bid submissions.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  WebIntakeRequestSchema,
  EmailIntakeRequestSchema,
  type WebIntakeRequest,
  type EmailIntakeRequest,
} from "@bid-catcher/config";
import { intakeService } from "../services/intake.js";

export async function intakeRoutes(server: FastifyInstance): Promise<void> {
  /**
   * POST /intake/web
   *
   * Receives bid submissions from web forms.
   * Creates a new bid record and stores document metadata.
   */
  server.post<{ Body: WebIntakeRequest }>(
    "/web",
    async (request: FastifyRequest<{ Body: WebIntakeRequest }>, reply: FastifyReply) => {
      const rawBody = request.body as Record<string, unknown>;
      
      // Debug log BEFORE validation to see what's coming in
      console.log(`\n========== [intake/${request.id}] PRE-VALIDATION DEBUG ==========`);
      console.log(`[intake/${request.id}] Raw body keys:`, Object.keys(rawBody || {}));
      console.log(`[intake/${request.id}] Has extractedFields:`, !!rawBody?.extractedFields);
      if (rawBody?.extractedFields && Array.isArray(rawBody.extractedFields)) {
        console.log(`[intake/${request.id}] extractedFields count:`, rawBody.extractedFields.length);
        if (rawBody.extractedFields.length > 0) {
          console.log(`[intake/${request.id}] First 2 raw extracted fields:`, JSON.stringify(rawBody.extractedFields.slice(0, 2), null, 2));
        }
      }
      console.log(`=================================================\n`);
      
      // Validate request body
      const parseResult = WebIntakeRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        console.error(`[intake/${request.id}] ✗ VALIDATION FAILED:`, parseResult.error.errors);
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
        // Log incoming data for debugging - THIS IS CRITICAL
        console.log(`\n========== [intake/${request.id}] RAW BODY RECEIVED ==========`);
        console.log(`[intake/${request.id}] Body keys:`, Object.keys(request.body || {}));
        console.log(`[intake/${request.id}] Parsed data keys:`, Object.keys(parseResult.data || {}));
        console.log(`[intake/${request.id}] extractedFields in raw body:`, !!(request.body as Record<string, unknown>)?.extractedFields);
        console.log(`[intake/${request.id}] extractedFields in parsed:`, !!parseResult.data.extractedFields);
        console.log(`[intake/${request.id}] extractedFields count:`, parseResult.data.extractedFields?.length || 'NONE');
        
        if (parseResult.data.extractedFields && parseResult.data.extractedFields.length > 0) {
          console.log(`[intake/${request.id}] First extracted field:`, parseResult.data.extractedFields[0]);
        }
        
        console.log(`[intake/${request.id}] documentMetadata:`, JSON.stringify(parseResult.data.documentMetadata));
        console.log(`================================================\n`);

        const result = await intakeService.processWebIntake(parseResult.data, request.id);
        
        console.log(`[intake/${request.id}] Intake result:`, result);

        return reply.status(201).send({
          success: true,
          data: result,
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to process intake";

        // Check for client not found error
        if (message.includes("not found")) {
          return reply.status(404).send({
            success: false,
            error: {
              code: "CLIENT_NOT_FOUND",
              message,
            },
            meta: {
              requestId: request.id,
              timestamp: new Date().toISOString(),
            },
          });
        }

        request.log.error(error, "Failed to process web intake");
        return reply.status(500).send({
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message,
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
   * POST /intake/email
   *
   * Receives bid submissions from email webhooks.
   * Parses email content and creates bid records.
   */
  server.post<{ Body: EmailIntakeRequest }>(
    "/email",
    async (request: FastifyRequest<{ Body: EmailIntakeRequest }>, reply: FastifyReply) => {
      // Validate request body
      const parseResult = EmailIntakeRequestSchema.safeParse(request.body);
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
        const result = await intakeService.processEmailIntake(parseResult.data, request.id);

        return reply.status(201).send({
          success: true,
          data: result,
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to process intake";

        // Check for client not found error
        if (message.includes("not found")) {
          return reply.status(404).send({
            success: false,
            error: {
              code: "CLIENT_NOT_FOUND",
              message,
            },
            meta: {
              requestId: request.id,
              timestamp: new Date().toISOString(),
            },
          });
        }

        request.log.error(error, "Failed to process email intake");
        return reply.status(500).send({
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message,
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
