/**
 * Bids Routes
 *
 * Bid queue API endpoints for listing, viewing, and managing bids.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BidListQuerySchema, BidStatusSchema } from "@bid-catcher/config";
import { bidsService } from "../services/bids.js";

// Request body schema for status updates
const StatusUpdateSchema = z.object({
  status: BidStatusSchema,
  updatedBy: z.string().optional(),
});

export async function bidsRoutes(server: FastifyInstance): Promise<void> {
  /**
   * GET /bids
   *
   * List bids with optional filtering by client and status.
   * Supports pagination via limit/offset.
   */
  server.get(
    "/",
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Validate and parse query params
      const parseResult = BidListQuerySchema.safeParse(request.query);
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
        const result = await bidsService.listBids(parseResult.data);

        return reply.status(200).send({
          success: true,
          data: result,
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (error) {
        request.log.error(error, "Failed to list bids");
        return reply.status(500).send({
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to list bids",
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
   * GET /bids/:id
   *
   * Get a single bid by ID with all related data.
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
            message: "Invalid bid ID format",
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }

      try {
        const result = await bidsService.getBidById(id);

        if (!result) {
          return reply.status(404).send({
            success: false,
            error: {
              code: "NOT_FOUND",
              message: `Bid with ID ${id} not found`,
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
        request.log.error(error, "Failed to get bid");
        return reply.status(500).send({
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to get bid",
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
   * PATCH /bids/:id/status
   *
   * Update bid status with validation of allowed transitions.
   * Status transitions:
   *   - new -> in_review, rejected
   *   - in_review -> qualified, rejected
   *   - qualified -> (terminal)
   *   - rejected -> (terminal)
   */
  server.patch<{ Params: { id: string }; Body: { status: string; updatedBy?: string } }>(
    "/:id/status",
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: { status: string; updatedBy?: string } }>,
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
            message: "Invalid bid ID format",
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }

      // Validate request body
      const parseResult = StatusUpdateSchema.safeParse(request.body);
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
        const result = await bidsService.updateBidStatus(
          id,
          parseResult.data.status,
          parseResult.data.updatedBy
        );

        return reply.status(200).send({
          success: true,
          data: result,
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to update status";

        // Check for specific error types
        if (message.includes("not found")) {
          return reply.status(404).send({
            success: false,
            error: {
              code: "NOT_FOUND",
              message,
            },
            meta: {
              requestId: request.id,
              timestamp: new Date().toISOString(),
            },
          });
        }

        if (message.includes("Invalid status transition")) {
          return reply.status(400).send({
            success: false,
            error: {
              code: "INVALID_TRANSITION",
              message,
            },
            meta: {
              requestId: request.id,
              timestamp: new Date().toISOString(),
            },
          });
        }

        request.log.error(error, "Failed to update bid status");
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
   * DELETE /bids/:id
   *
   * Delete a bid and all related data (documents, decisions, etc.)
   * This is a permanent deletion.
   */
  server.delete<{ Params: { id: string } }>(
    "/:id",
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
            message: "Invalid bid ID format",
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }

      try {
        const result = await bidsService.deleteBid(id);

        if (!result.success) {
          return reply.status(404).send({
            success: false,
            error: {
              code: "NOT_FOUND",
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
        request.log.error(error, "Failed to delete bid");
        return reply.status(500).send({
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to delete bid",
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
