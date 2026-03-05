/**
 * Ore Samples (Criteria Trainer) Routes
 *
 * API for managing reference bids used to train qualification criteria.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb, oreSamples, bids, extractedFields, clients, eq, and, desc, inArray } from "@bid-catcher/db";
import { analyzeOreSamplesAndProposeCriteria } from "../services/criteria-trainer.js";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const AddSampleSchema = z.object({
  bidId: z.string().uuid(),
  outcome: z.enum(["GO", "MAYBE", "NO"]),
  reason: z.string().min(1).max(2000),
  notes: z.string().max(1000).optional(),
});

export async function oreSamplesRoutes(server: FastifyInstance): Promise<void> {
  /**
   * GET /clients/:clientId/ore-samples
   * List ore samples for a client, optionally filtered by outcome
   */
  server.get<{ Params: { clientId: string }; Querystring: { outcome?: string } }>(
    "/:clientId/ore-samples",
    async (request, reply) => {
      const { clientId } = request.params;
      const { outcome } = request.query as { outcome?: string };

      if (!UUID_REGEX.test(clientId)) {
        return reply.status(400).send({
          success: false,
          error: { code: "INVALID_ID", message: "Invalid client ID" },
          meta: { requestId: request.id, timestamp: new Date().toISOString() },
        });
      }

      try {
        const db = getDb();
        const conditions = [eq(oreSamples.clientId, clientId)];
        if (outcome && ["GO", "MAYBE", "NO"].includes(outcome)) {
          conditions.push(eq(oreSamples.outcome, outcome));
        }

        const samples = await db
          .select({
            id: oreSamples.id,
            bidId: oreSamples.bidId,
            outcome: oreSamples.outcome,
            reason: oreSamples.reason,
            notes: oreSamples.notes,
            addedBy: oreSamples.addedBy,
            createdAt: oreSamples.createdAt,
            projectName: bids.projectName,
            senderCompany: bids.senderCompany,
          })
          .from(oreSamples)
          .innerJoin(bids, eq(oreSamples.bidId, bids.id))
          .where(and(...conditions))
          .orderBy(desc(oreSamples.createdAt));

        const counts = { GO: 0, MAYBE: 0, NO: 0 };
        for (const s of samples) {
          counts[s.outcome as keyof typeof counts]++;
        }

        return reply.status(200).send({
          success: true,
          data: {
            samples,
            counts,
          },
          meta: { requestId: request.id, timestamp: new Date().toISOString() },
        });
      } catch (error) {
        request.log.error(error, "Failed to list ore samples");
        return reply.status(500).send({
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to list ore samples",
          },
          meta: { requestId: request.id, timestamp: new Date().toISOString() },
        });
      }
    }
  );

  /**
   * POST /clients/:clientId/ore-samples/analyze
   * Analyze ore samples with AI and propose qualification criteria
   * Must be registered before /:clientId/ore-samples to match correctly
   */
  server.post<{ Params: { clientId: string } }>(
    "/:clientId/ore-samples/analyze",
    async (request, reply) => {
      const { clientId } = request.params;

      if (!UUID_REGEX.test(clientId)) {
        return reply.status(400).send({
          success: false,
          error: { code: "INVALID_ID", message: "Invalid client ID" },
          meta: { requestId: request.id, timestamp: new Date().toISOString() },
        });
      }

      try {
        const db = getDb();

        const samples = await db
          .select({
            id: oreSamples.id,
            bidId: oreSamples.bidId,
            outcome: oreSamples.outcome,
            reason: oreSamples.reason,
            notes: oreSamples.notes,
            projectName: bids.projectName,
            rawPayload: bids.rawPayload,
          })
          .from(oreSamples)
          .innerJoin(bids, eq(oreSamples.bidId, bids.id))
          .where(eq(oreSamples.clientId, clientId));

        if (samples.length < 5) {
          return reply.status(400).send({
            success: false,
            error: {
              code: "INSUFFICIENT_SAMPLES",
              message: "Need at least 5 ore samples to analyze (recommend 10-20 per bucket)",
            },
            meta: { requestId: request.id, timestamp: new Date().toISOString() },
          });
        }

        const bidIds = samples.map((s) => s.bidId);
        const extracted = await db
          .select({
            bidId: extractedFields.bidId,
            signalId: extractedFields.signalId,
            extractedValue: extractedFields.extractedValue,
          })
          .from(extractedFields)
          .where(inArray(extractedFields.bidId, bidIds));

        const extractedByBid = new Map<string, Record<string, string | number | boolean | null>>();
        for (const e of extracted) {
          if (!extractedByBid.has(e.bidId)) {
            extractedByBid.set(e.bidId, {});
          }
          const val = e.extractedValue;
          const parsed =
            val === null || val === undefined
              ? null
              : val === "true"
                ? true
                : val === "false"
                  ? false
                  : /^\d+(\.\d+)?$/.test(String(val))
                    ? parseFloat(String(val))
                    : val;
          (extractedByBid.get(e.bidId) as Record<string, unknown>)[e.signalId] = parsed;
        }

        const clientRow = await db
          .select({ config: clients.config })
          .from(clients)
          .where(eq(clients.id, clientId))
          .limit(1);

        const config = clientRow[0]?.config as { intake?: { intakeFields?: Array<{ key: string }> } } | null;
        const intakeFieldKeys =
          config?.intake?.intakeFields?.map((f) => f.key) ||
          Array.from(
            new Set(extracted.flatMap((e) => (e.signalId ? [e.signalId] : [])))
          );

        const samplesForAnalysis = samples.map((s) => {
          const fields = extractedByBid.get(s.bidId) || {};
          const customFields = (s.rawPayload as { customFields?: Record<string, unknown> })?.customFields || {};
          const merged = { ...customFields, ...fields } as Record<string, string | number | boolean | null>;
          return {
            outcome: s.outcome as "GO" | "MAYBE" | "NO",
            reason: s.reason,
            notes: s.notes,
            extractedFields: merged,
            projectName: s.projectName,
          };
        });

        const proposed = await analyzeOreSamplesAndProposeCriteria(
          samplesForAnalysis,
          intakeFieldKeys.length > 0 ? intakeFieldKeys : Object.keys(samplesForAnalysis[0]?.extractedFields || {})
        );

        return reply.status(200).send({
          success: true,
          data: proposed,
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
            sampleCount: samples.length,
          },
        });
      } catch (error) {
        request.log.error(error, "Failed to analyze ore samples");
        return reply.status(500).send({
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to analyze ore samples",
          },
          meta: { requestId: request.id, timestamp: new Date().toISOString() },
        });
      }
    }
  );

  /**
   * POST /clients/:clientId/ore-samples
   * Add a bid as an ore sample
   */
  server.post<{ Params: { clientId: string }; Body: z.infer<typeof AddSampleSchema> }>(
    "/:clientId/ore-samples",
    async (request, reply) => {
      const { clientId } = request.params;
      const parseResult = AddSampleSchema.safeParse(request.body);

      if (!UUID_REGEX.test(clientId)) {
        return reply.status(400).send({
          success: false,
          error: { code: "INVALID_ID", message: "Invalid client ID" },
          meta: { requestId: request.id, timestamp: new Date().toISOString() },
        });
      }

      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid request body",
            details: parseResult.error.errors,
          },
          meta: { requestId: request.id, timestamp: new Date().toISOString() },
        });
      }

      const { bidId, outcome, reason, notes } = parseResult.data;

      try {
        const db = getDb();

        const bidCheck = await db
          .select({ id: bids.id, clientId: bids.clientId })
          .from(bids)
          .where(eq(bids.id, bidId))
          .limit(1);

        if (bidCheck.length === 0) {
          return reply.status(404).send({
            success: false,
            error: { code: "NOT_FOUND", message: "Bid not found" },
            meta: { requestId: request.id, timestamp: new Date().toISOString() },
          });
        }

        if (bidCheck[0].clientId !== clientId) {
          return reply.status(400).send({
            success: false,
            error: { code: "BAD_REQUEST", message: "Bid does not belong to this client" },
            meta: { requestId: request.id, timestamp: new Date().toISOString() },
          });
        }

        const [inserted] = await db
          .insert(oreSamples)
          .values({
            clientId,
            bidId,
            outcome,
            reason,
            notes: notes || null,
            addedBy: (request as { user?: { email?: string } }).user?.email || null,
          })
          .returning({
            id: oreSamples.id,
            bidId: oreSamples.bidId,
            outcome: oreSamples.outcome,
            reason: oreSamples.reason,
            notes: oreSamples.notes,
            createdAt: oreSamples.createdAt,
          });

        return reply.status(201).send({
          success: true,
          data: inserted,
          meta: { requestId: request.id, timestamp: new Date().toISOString() },
        });
      } catch (error: unknown) {
        const err = error as { code?: string };
        if (err.code === "23505") {
          return reply.status(409).send({
            success: false,
            error: { code: "DUPLICATE", message: "This bid is already in an ore sample bucket" },
            meta: { requestId: request.id, timestamp: new Date().toISOString() },
          });
        }
        request.log.error(error, "Failed to add ore sample");
        return reply.status(500).send({
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? (error as Error).message : "Failed to add ore sample",
          },
          meta: { requestId: request.id, timestamp: new Date().toISOString() },
        });
      }
    }
  );

  /**
   * DELETE /clients/:clientId/ore-samples/:sampleId
   * Remove an ore sample
   */
  server.delete<{ Params: { clientId: string; sampleId: string } }>(
    "/:clientId/ore-samples/:sampleId",
    async (request, reply) => {
      const { clientId, sampleId } = request.params;

      if (!UUID_REGEX.test(clientId) || !UUID_REGEX.test(sampleId)) {
        return reply.status(400).send({
          success: false,
          error: { code: "INVALID_ID", message: "Invalid ID format" },
          meta: { requestId: request.id, timestamp: new Date().toISOString() },
        });
      }

      try {
        const db = getDb();
        const deleted = await db
          .delete(oreSamples)
          .where(and(eq(oreSamples.id, sampleId), eq(oreSamples.clientId, clientId)))
          .returning({ id: oreSamples.id });

        if (deleted.length === 0) {
          return reply.status(404).send({
            success: false,
            error: { code: "NOT_FOUND", message: "Ore sample not found" },
            meta: { requestId: request.id, timestamp: new Date().toISOString() },
          });
        }

        return reply.status(200).send({
          success: true,
          data: { deletedId: sampleId },
          meta: { requestId: request.id, timestamp: new Date().toISOString() },
        });
      } catch (error) {
        request.log.error(error, "Failed to delete ore sample");
        return reply.status(500).send({
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to delete ore sample",
          },
          meta: { requestId: request.id, timestamp: new Date().toISOString() },
        });
      }
    }
  );

}
