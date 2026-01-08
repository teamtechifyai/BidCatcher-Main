/**
 * JobTread Handoff Routes
 *
 * ⚠️ DRY-RUN ONLY - Never makes real HTTP calls to JobTread
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { jobtreadHandoffService } from "../services/jobtread-handoff.js";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function handoffRoutes(server: FastifyInstance): Promise<void> {
  /**
   * POST /bids/:id/handoff/jobtread
   *
   * Execute dry-run handoff to JobTread.
   * - Validates bid is eligible (effective outcome == GO)
   * - Builds exact payload that would be sent
   * - Returns mock JobTread response
   * - Logs attempt for audit
   */
  server.post<{
    Params: { id: string };
    Body: { initiatedBy?: string };
  }>(
    "/:id/handoff/jobtread",
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { initiatedBy?: string };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { initiatedBy } = request.body || {};

      // Validate UUID format
      if (!UUID_REGEX.test(id)) {
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
        const result = await jobtreadHandoffService.executeHandoff(id, initiatedBy);

        const statusCode = result.success ? 201 : result.status === "blocked" ? 422 : 500;

        return reply.status(statusCode).send({
          success: result.success,
          data: result,
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
            dryRun: true, // Always true - no real JobTread calls
          },
        });
      } catch (error) {
        request.log.error(error, "Handoff failed");
        return reply.status(500).send({
          success: false,
          error: {
            code: "HANDOFF_ERROR",
            message: error instanceof Error ? error.message : "Handoff failed",
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
   * GET /bids/:id/handoff/jobtread
   *
   * Get handoff history for a bid
   */
  server.get<{
    Params: { id: string };
    Querystring: { latest?: string };
  }>(
    "/:id/handoff/jobtread",
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Querystring: { latest?: string };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const latestOnly = request.query.latest === "true";

      // Validate UUID format
      if (!UUID_REGEX.test(id)) {
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
        if (latestOnly) {
          const handoff = await jobtreadHandoffService.getLatestHandoff(id);
          return reply.status(200).send({
            success: true,
            data: handoff,
            meta: {
              requestId: request.id,
              timestamp: new Date().toISOString(),
            },
          });
        }

        const history = await jobtreadHandoffService.getHandoffHistory(id);
        return reply.status(200).send({
          success: true,
          data: {
            bidId: id,
            totalHandoffs: history.length,
            handoffs: history,
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (error) {
        request.log.error(error, "Failed to get handoff history");
        return reply.status(500).send({
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to get handoff history",
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


