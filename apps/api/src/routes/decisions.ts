/**
 * Decision Routes
 *
 * API endpoints for Go/No-Go evaluation, overrides, and decision history.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { decisionsService } from "../services/decisions.js";

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function decisionsRoutes(server: FastifyInstance): Promise<void> {
  /**
   * POST /bids/:id/evaluate
   *
   * Evaluate a bid and create a new Go/No-Go decision.
   * Never overwrites previous decisions - always creates a new version.
   *
   * Query params:
   * - useAI: boolean - Include AI in hybrid evaluation
   * - aiOnly: boolean - Use AI only (no rule-based)
   * - aiWeight: number - Weight for AI in hybrid mode (0-1, default 0.3)
   */
  server.post<{
    Params: { id: string };
    Querystring: { useAI?: string; aiOnly?: string; aiWeight?: string };
  }>(
    "/:id/evaluate",
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Querystring: { useAI?: string; aiOnly?: string; aiWeight?: string };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { useAI, aiOnly, aiWeight } = request.query;

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

      // Parse evaluation options
      const options = {
        useAI: useAI === "true",
        aiOnly: aiOnly === "true",
        aiWeight: aiWeight ? parseFloat(aiWeight) : 0.3,
      };

      try {
        console.log(`\n========== EVALUATION START ==========`);
        console.log(`[eval/${request.id}] Bid ID: ${id}`);
        console.log(`[eval/${request.id}] Options:`, options);
        
        const result = await decisionsService.evaluateBid(id, options);
        
        console.log(`[eval/${request.id}] ✓ Decision created: ${result.decisionId}`);
        console.log(`[eval/${request.id}] Outcome: ${result.outcome}`);
        console.log(`[eval/${request.id}] Score: ${result.scorePercentage}%`);
        console.log(`========== EVALUATION COMPLETE ==========\n`);

        return reply.status(201).send({
          success: true,
          data: result,
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (error) {
        console.error(`[eval/${request.id}] ✗ Evaluation failed:`, error);
        const message = error instanceof Error ? error.message : "Evaluation failed";

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

        request.log.error(error, "Evaluation failed");
        return reply.status(500).send({
          success: false,
          error: {
            code: "EVALUATION_ERROR",
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
   * POST /bids/:id/override
   *
   * Override a decision with human judgment.
   * If decisionId is not provided, overrides the latest decision for the bid.
   * Original decision remains immutable.
   */
  server.post<{
    Params: { id: string };
    Body: {
      decisionId?: string;
      outcome: string;
      reasonCategory?: string;
      rationale: string;
      overriddenBy?: string;
      metadata?: Record<string, unknown>;
    };
  }>(
    "/:id/override",
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: {
          decisionId?: string;
          outcome: string;
          reasonCategory?: string;
          rationale: string;
          overriddenBy?: string;
          metadata?: Record<string, unknown>;
        };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const body = request.body;

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

      // Basic validation - outcome and rationale are required
      if (!body.outcome || !body.rationale) {
        return reply.status(400).send({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "outcome and rationale are required",
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }

      try {
        // Build override request with defaults
        const overrideData = {
          decisionId: body.decisionId, // May be undefined - service will find latest
          outcome: body.outcome as "GO" | "MAYBE" | "NO",
          reasonCategory: body.reasonCategory || "other",
          rationale: body.rationale,
          overriddenBy: body.overriddenBy || "system",
          metadata: body.metadata,
        };
        
        const result = await decisionsService.overrideDecision(id, overrideData);

        return reply.status(201).send({
          success: true,
          data: result,
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Override failed";

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

        if (message.includes("does not belong") || message.includes("Cannot override")) {
          return reply.status(400).send({
            success: false,
            error: {
              code: "INVALID_OVERRIDE",
              message,
            },
            meta: {
              requestId: request.id,
              timestamp: new Date().toISOString(),
            },
          });
        }

        request.log.error(error, "Override failed");
        return reply.status(500).send({
          success: false,
          error: {
            code: "OVERRIDE_ERROR",
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
   * GET /bids/:id/decisions
   *
   * Get full decision history for a bid.
   * Includes all evaluations and overrides in chronological order.
   */
  server.get<{ Params: { id: string }; Querystring: { latest?: string } }>(
    "/:id/decisions",
    async (
      request: FastifyRequest<{ Params: { id: string }; Querystring: { latest?: string } }>,
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
          const result = await decisionsService.getLatestDecision(id);

          if (!result) {
            return reply.status(404).send({
              success: false,
              error: {
                code: "NO_DECISIONS",
                message: `No decisions found for bid ${id}`,
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
        }

        const result = await decisionsService.getDecisionHistory(id);

        return reply.status(200).send({
          success: true,
          data: result,
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (error) {
        request.log.error(error, "Failed to get decisions");
        return reply.status(500).send({
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to get decisions",
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
