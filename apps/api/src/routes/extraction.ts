/**
 * Document Extraction Routes
 *
 * API endpoints for PDF document upload and AI-powered field extraction.
 * Part of PDF Assist (Lite) feature.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { getDb, clients, eq } from "@bid-catcher/db";
import { ClientConfigSchema, type IntakeField } from "@bid-catcher/config";
import { extractFromDocument } from "@bid-catcher/pdf-assist";

// ----- Request Schemas -----

const ExtractDocumentBodySchema = z.object({
  /** Base64 encoded PDF content */
  documentBase64: z.string().min(100),
  
  /** Original filename */
  filename: z.string().min(1).max(500),
  
  /** Client ID for context */
  clientId: z.string().uuid(),
  
  /** Whether to use AI extraction (default: true) */
  useAI: z.boolean().optional().default(true),
});

type ExtractDocumentBody = z.infer<typeof ExtractDocumentBodySchema>;

// ----- Routes -----

export async function extractionRoutes(server: FastifyInstance): Promise<void> {
  const db = getDb();

  /**
   * POST /extraction/document
   *
   * Extract fields from an uploaded PDF document.
   * Uses AI (OpenAI) when available, falls back to regex patterns.
   */
  server.post<{ Body: ExtractDocumentBody }>(
    "/document",
    async (request: FastifyRequest<{ Body: ExtractDocumentBody }>, reply: FastifyReply) => {
      // Validate request body
      const parseResult = ExtractDocumentBodySchema.safeParse(request.body);
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

      const { documentBase64, filename, clientId, useAI } = parseResult.data;

      try {
        // 1. Fetch client configuration
        const clientResults = await db
          .select({
            id: clients.id,
            name: clients.name,
            active: clients.active,
            config: clients.config,
          })
          .from(clients)
          .where(eq(clients.id, clientId))
          .limit(1);

        if (clientResults.length === 0) {
          return reply.status(404).send({
            success: false,
            error: {
              code: "CLIENT_NOT_FOUND",
              message: `Client with ID ${clientId} not found`,
            },
            meta: {
              requestId: request.id,
              timestamp: new Date().toISOString(),
            },
          });
        }

        const client = clientResults[0];

        if (!client.active) {
          return reply.status(403).send({
            success: false,
            error: {
              code: "CLIENT_INACTIVE",
              message: "This client is not active",
            },
            meta: {
              requestId: request.id,
              timestamp: new Date().toISOString(),
            },
          });
        }

        // Parse client config to get intake fields
        let clientIntakeFields: IntakeField[] = [];
        try {
          const parsedConfig = ClientConfigSchema.parse(client.config);
          clientIntakeFields = parsedConfig.intake.intakeFields;
        } catch {
          // Use empty array if config parsing fails
          request.log.warn("Failed to parse client config for intake fields");
        }

        // 2. Run extraction
        const result = await extractFromDocument({
          documentBase64,
          filename,
          clientId,
          clientIntakeFields,
          useAI,
        });

        if (!result.success) {
          return reply.status(422).send({
            success: false,
            error: {
              code: "EXTRACTION_FAILED",
              message: result.error || "Failed to extract fields from document",
            },
            data: {
              warnings: result.processingInfo.warnings,
            },
            meta: {
              requestId: request.id,
              timestamp: new Date().toISOString(),
            },
          });
        }

        // 3. Return extraction results
        return reply.status(200).send({
          success: true,
          data: {
            extractedFields: result.extractedFields,
            confidenceScores: result.confidenceScores,
            pdfInfo: result.pdfInfo,
            processingInfo: {
              method: result.processingInfo.method,
              processingTimeMs: result.processingInfo.processingTimeMs,
              warnings: result.processingInfo.warnings,
              fieldsRequested: result.processingInfo.fieldsRequested,
              fieldsExtracted: result.processingInfo.fieldsExtracted,
            },
            // Include field definitions for UI rendering - these are the client's configured fields
            fieldDefinitions: clientIntakeFields.length > 0 ? clientIntakeFields : getDefaultFieldDefinitions(),
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
            clientName: client.name,
            clientId: client.id,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to process document";
        request.log.error(error, "Failed to extract from document");
        
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
   * GET /extraction/supported-fields
   *
   * Returns the list of fields that can be extracted from documents.
   */
  server.get(
    "/supported-fields",
    async (request: FastifyRequest, reply: FastifyReply) => {
      return reply.status(200).send({
        success: true,
        data: {
          standardFields: getDefaultFieldDefinitions(),
          fieldCount: 16,
          description: "Standard construction bid document fields that can be extracted",
        },
        meta: {
          requestId: request.id,
          timestamp: new Date().toISOString(),
        },
      });
    }
  );
}

// ----- Helper Functions -----

function getDefaultFieldDefinitions(): IntakeField[] {
  return [
    { key: "project_name", label: "Project Name", type: "text", required: true },
    { key: "project_location", label: "Project Location", type: "text", required: false },
    { key: "project_number", label: "Project Number", type: "text", required: false },
    { key: "owner_name", label: "Owner Name", type: "text", required: false },
    { key: "general_contractor", label: "General Contractor", type: "text", required: false },
    { key: "architect_engineer", label: "Architect/Engineer", type: "text", required: false },
    { key: "bid_due_date", label: "Bid Due Date", type: "date", required: true },
    { key: "bid_due_time", label: "Bid Due Time", type: "text", required: false },
    { key: "pre_bid_meeting_date", label: "Pre-Bid Meeting Date", type: "date", required: false },
    { key: "pre_bid_meeting_required", label: "Pre-Bid Meeting Required", type: "boolean", required: false },
    { key: "start_date", label: "Project Start Date", type: "date", required: false },
    { key: "completion_date", label: "Completion Date", type: "date", required: false },
    { key: "project_value_estimate", label: "Estimated Value", type: "text", required: false },
    { key: "bond_required", label: "Bond Required", type: "boolean", required: false },
    { key: "insurance_requirements", label: "Insurance Requirements", type: "textarea", required: false },
    { key: "scope_of_work", label: "Scope of Work", type: "textarea", required: false },
  ];
}

