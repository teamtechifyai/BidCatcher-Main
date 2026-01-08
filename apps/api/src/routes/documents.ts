/**
 * Document Routes
 *
 * API endpoints for document retrieval and download.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getDb, bidDocuments, eq } from "@bid-catcher/db";

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function documentsRoutes(server: FastifyInstance): Promise<void> {
  /**
   * GET /documents/:id/download
   *
   * Download a document by ID.
   * Returns the file content with appropriate headers.
   */
  server.get<{ Params: { id: string } }>(
    "/:id/download",
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;

      // Validate UUID format
      if (!UUID_REGEX.test(id)) {
        return reply.status(400).send({
          success: false,
          error: {
            code: "INVALID_ID",
            message: "Invalid document ID format",
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }

      try {
        const db = getDb();

        // Fetch document with content
        const documents = await db
          .select({
            id: bidDocuments.id,
            filename: bidDocuments.filename,
            contentType: bidDocuments.contentType,
            content: bidDocuments.content,
            sizeBytes: bidDocuments.sizeBytes,
          })
          .from(bidDocuments)
          .where(eq(bidDocuments.id, id))
          .limit(1);

        if (documents.length === 0) {
          return reply.status(404).send({
            success: false,
            error: {
              code: "NOT_FOUND",
              message: `Document with ID ${id} not found`,
            },
            meta: {
              requestId: request.id,
              timestamp: new Date().toISOString(),
            },
          });
        }

        const doc = documents[0];

        if (!doc.content) {
          return reply.status(404).send({
            success: false,
            error: {
              code: "NO_CONTENT",
              message: "Document content not available",
            },
            meta: {
              requestId: request.id,
              timestamp: new Date().toISOString(),
            },
          });
        }

        // Decode base64 content
        const buffer = Buffer.from(doc.content, "base64");

        // Set response headers
        reply.header("Content-Type", doc.contentType);
        reply.header(
          "Content-Disposition",
          `attachment; filename="${encodeURIComponent(doc.filename)}"`
        );
        reply.header("Content-Length", buffer.length);

        return reply.send(buffer);
      } catch (error) {
        request.log.error(error, "Failed to download document");
        return reply.status(500).send({
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to download document",
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
   * GET /documents/:id
   *
   * Get document metadata (without content).
   */
  server.get<{ Params: { id: string } }>(
    "/:id",
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;

      // Validate UUID format
      if (!UUID_REGEX.test(id)) {
        return reply.status(400).send({
          success: false,
          error: {
            code: "INVALID_ID",
            message: "Invalid document ID format",
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }

      try {
        const db = getDb();

        // Fetch document metadata (without content for performance)
        const documents = await db
          .select({
            id: bidDocuments.id,
            bidId: bidDocuments.bidId,
            filename: bidDocuments.filename,
            contentType: bidDocuments.contentType,
            sizeBytes: bidDocuments.sizeBytes,
            documentType: bidDocuments.documentType,
            processingStatus: bidDocuments.processingStatus,
            storagePath: bidDocuments.storagePath,
            createdAt: bidDocuments.createdAt,
          })
          .from(bidDocuments)
          .where(eq(bidDocuments.id, id))
          .limit(1);

        if (documents.length === 0) {
          return reply.status(404).send({
            success: false,
            error: {
              code: "NOT_FOUND",
              message: `Document with ID ${id} not found`,
            },
            meta: {
              requestId: request.id,
              timestamp: new Date().toISOString(),
            },
          });
        }

        const doc = documents[0];

        return reply.status(200).send({
          success: true,
          data: {
            id: doc.id,
            bidId: doc.bidId,
            filename: doc.filename,
            contentType: doc.contentType,
            sizeBytes: doc.sizeBytes,
            documentType: doc.documentType,
            processingStatus: doc.processingStatus,
            storagePath: doc.storagePath,
            hasContent: !!doc.storagePath,
            downloadUrl: `/api/documents/${doc.id}/download`,
            createdAt: doc.createdAt.toISOString(),
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (error) {
        request.log.error(error, "Failed to get document");
        return reply.status(500).send({
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to get document",
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
