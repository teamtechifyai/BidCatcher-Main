/**
 * Analytics Routes (Market Grasp Dashboard)
 *
 * Volume metrics, Gold Nugget alerts, history views, override metrics, CSV export.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { getDb, clients, bids, goNoGoDecisions, decisionOverrides, eq, desc, inArray } from "@bid-catcher/db";
import { ClientConfigSchema } from "@bid-catcher/config";
import { analyticsService } from "../services/analytics.js";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const AnalyticsFiltersSchema = z.object({
  sector: z.string().optional(),
  owner: z.string().optional(),
  locationRadius: z.string().optional(),
  sizeBandMin: z.coerce.number().optional(),
  sizeBandMax: z.coerce.number().optional(),
  timeRangeMonths: z.coerce.number().min(1).max(120).optional(),
  decision: z.enum(["GO", "MAYBE", "NO"]).optional(),
  reasonTags: z.string().optional(), // comma-separated
  limit: z.coerce.number().min(1).max(200).default(100),
  offset: z.coerce.number().min(0).default(0),
});

export async function analyticsRoutes(server: FastifyInstance): Promise<void> {
  /**
   * GET /clients/:clientId/analytics/metrics
   * Volume + override metrics for dashboard
   */
  server.get<{ Params: { clientId: string } }>(
    "/:clientId/analytics/metrics",
    async (request: FastifyRequest<{ Params: { clientId: string } }>, reply: FastifyReply) => {
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
        const clientRow = await db.select({ config: clients.config }).from(clients).where(eq(clients.id, clientId)).limit(1);
        const config = clientRow[0]?.config
          ? ClientConfigSchema.safeParse(clientRow[0].config).success
            ? (clientRow[0].config as z.infer<typeof ClientConfigSchema>)
            : null
          : null;

        const [volume, override] = await Promise.all([
          analyticsService.getVolumeMetrics(clientId, config),
          analyticsService.getOverrideMetrics(clientId),
        ]);

        return reply.status(200).send({
          success: true,
          data: { volume, override },
          meta: { requestId: request.id, timestamp: new Date().toISOString() },
        });
      } catch (error) {
        request.log.error(error, "Failed to get analytics metrics");
        return reply.status(500).send({
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to get metrics",
          },
          meta: { requestId: request.id, timestamp: new Date().toISOString() },
        });
      }
    }
  );

  /**
   * GET /clients/:clientId/analytics/gold-nuggets
   * Bids matching strategic tags
   */
  server.get<{ Params: { clientId: string }; Querystring: { limit?: string } }>(
    "/:clientId/analytics/gold-nuggets",
    async (request: FastifyRequest<{ Params: { clientId: string }; Querystring: { limit?: string } }>, reply: FastifyReply) => {
      const { clientId } = request.params;
      const limit = Math.min(parseInt(request.query?.limit || "20", 10) || 20, 50);
      if (!UUID_REGEX.test(clientId)) {
        return reply.status(400).send({
          success: false,
          error: { code: "INVALID_ID", message: "Invalid client ID" },
          meta: { requestId: request.id, timestamp: new Date().toISOString() },
        });
      }

      try {
        const db = getDb();
        const clientRow = await db.select({ config: clients.config }).from(clients).where(eq(clients.id, clientId)).limit(1);
        const config = clientRow[0]?.config
          ? ClientConfigSchema.safeParse(clientRow[0].config).success
            ? (clientRow[0].config as z.infer<typeof ClientConfigSchema>)
            : null
          : null;

        const goldNuggets = await analyticsService.getGoldNuggets(clientId, config, limit);
        return reply.status(200).send({
          success: true,
          data: { goldNuggets },
          meta: { requestId: request.id, timestamp: new Date().toISOString() },
        });
      } catch (error) {
        request.log.error(error, "Failed to get gold nuggets");
        return reply.status(500).send({
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to get gold nuggets",
          },
          meta: { requestId: request.id, timestamp: new Date().toISOString() },
        });
      }
    }
  );

  /**
   * GET /clients/:clientId/analytics/history
   * Filtered bid history (what we missed, etc.)
   */
  server.get<{ Params: { clientId: string }; Querystring: z.infer<typeof AnalyticsFiltersSchema> }>(
    "/:clientId/analytics/history",
    async (request: FastifyRequest<{ Params: { clientId: string }; Querystring: z.infer<typeof AnalyticsFiltersSchema> }>, reply: FastifyReply) => {
      const { clientId } = request.params;
      if (!UUID_REGEX.test(clientId)) {
        return reply.status(400).send({
          success: false,
          error: { code: "INVALID_ID", message: "Invalid client ID" },
          meta: { requestId: request.id, timestamp: new Date().toISOString() },
        });
      }

      const parseResult = AnalyticsFiltersSchema.safeParse(request.query);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid query parameters",
            details: parseResult.error.errors,
          },
          meta: { requestId: request.id, timestamp: new Date().toISOString() },
        });
      }

      const q = parseResult.data;
      const filters = {
        sector: q.sector,
        owner: q.owner,
        locationRadius: q.locationRadius,
        sizeBandMin: q.sizeBandMin,
        sizeBandMax: q.sizeBandMax,
        timeRangeMonths: q.timeRangeMonths,
        decision: q.decision,
        reasonTags: q.reasonTags ? q.reasonTags.split(",").map((s) => s.trim()) : undefined,
      };

      try {
        const result = await analyticsService.getFilteredBids(clientId, filters, q.limit, q.offset);
        return reply.status(200).send({
          success: true,
          data: result,
          meta: { requestId: request.id, timestamp: new Date().toISOString() },
        });
      } catch (error) {
        request.log.error(error, "Failed to get bid history");
        return reply.status(500).send({
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to get history",
          },
          meta: { requestId: request.id, timestamp: new Date().toISOString() },
        });
      }
    }
  );

  /**
   * GET /clients/:clientId/analytics/export
   * CSV export of bids + decisions
   */
  server.get<{ Params: { clientId: string }; Querystring: { type?: string; limit?: string } }>(
    "/:clientId/analytics/export",
    async (request: FastifyRequest<{ Params: { clientId: string }; Querystring: { type?: string; limit?: string } }>, reply: FastifyReply) => {
      const { clientId } = request.params;
      const type = request.query?.type || "bids";
      const limit = Math.min(parseInt(request.query?.limit || "1000", 10) || 1000, 5000);
      if (!UUID_REGEX.test(clientId)) {
        return reply.status(400).send({
          success: false,
          error: { code: "INVALID_ID", message: "Invalid client ID" },
          meta: { requestId: request.id, timestamp: new Date().toISOString() },
        });
      }

      try {
        const db = getDb();
        const bidsList = await db
          .select({
            id: bids.id,
            projectName: bids.projectName,
            senderCompany: bids.senderCompany,
            senderEmail: bids.senderEmail,
            status: bids.status,
            intakeSource: bids.intakeSource,
            receivedAt: bids.receivedAt,
          })
          .from(bids)
          .where(eq(bids.clientId, clientId))
          .orderBy(desc(bids.receivedAt))
          .limit(limit);

        const bidIds = bidsList.map((b) => b.id);
        const decisions =
          bidIds.length > 0
            ? await db
                .select({
                  bidId: goNoGoDecisions.bidId,
                  outcome: goNoGoDecisions.outcome,
                  scorePercentage: goNoGoDecisions.scorePercentage,
                  rationale: goNoGoDecisions.rationale,
                  createdAt: goNoGoDecisions.createdAt,
                })
                .from(goNoGoDecisions)
                .where(inArray(goNoGoDecisions.bidId, bidIds))
                .orderBy(desc(goNoGoDecisions.createdAt))
            : [];

        const latestByBid = new Map<string, (typeof decisions)[0]>();
        for (const d of decisions) {
          if (!latestByBid.has(d.bidId)) latestByBid.set(d.bidId, d);
        }

        const overrides =
          bidIds.length > 0
            ? await db
                .select({
                  bidId: decisionOverrides.bidId,
                  originalOutcome: decisionOverrides.originalOutcome,
                  overriddenOutcome: decisionOverrides.overriddenOutcome,
                  reasonCategory: decisionOverrides.reasonCategory,
                  overriddenBy: decisionOverrides.overriddenBy,
                  rationale: decisionOverrides.rationale,
                })
                .from(decisionOverrides)
                .where(inArray(decisionOverrides.bidId, bidIds))
            : [];

        const overridesByBid = new Map<string, (typeof overrides)[0][]>();
        for (const o of overrides) {
          if (!overridesByBid.has(o.bidId)) overridesByBid.set(o.bidId, []);
          overridesByBid.get(o.bidId)!.push(o);
        }

        const escapeCsv = (v: unknown) => {
          const s = String(v ?? "").replace(/"/g, '""');
          return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s}"` : s;
        };

        const rows: string[] = [];
        if (type === "bids") {
          rows.push("id,projectName,senderCompany,senderEmail,status,intakeSource,receivedAt,outcome,scorePercentage,overridden");
          for (const b of bidsList) {
            const dec = latestByBid.get(b.id);
            const ov = overridesByBid.get(b.id);
            rows.push(
              [
                b.id,
                b.projectName,
                b.senderCompany,
                b.senderEmail,
                b.status,
                b.intakeSource,
                b.receivedAt?.toISOString?.() ?? "",
                dec?.outcome ?? "",
                dec?.scorePercentage ?? "",
                ov && ov.length > 0 ? "yes" : "no",
              ].map(escapeCsv).join(",")
            );
          }
        } else {
          rows.push("bidId,outcome,scorePercentage,rationale,decidedAt,originalOutcome,overriddenOutcome,reasonCategory,overriddenBy");
          for (const b of bidsList) {
            const dec = latestByBid.get(b.id);
            const ov = overridesByBid.get(b.id)?.[0];
            if (dec) {
              rows.push(
                [
                  b.id,
                  dec.outcome,
                  dec.scorePercentage,
                  (dec.rationale ?? "").replace(/\n/g, " "),
                  dec.createdAt?.toISOString?.() ?? "",
                  ov?.originalOutcome ?? "",
                  ov?.overriddenOutcome ?? "",
                  ov?.reasonCategory ?? "",
                  ov?.overriddenBy ?? "",
                ].map(escapeCsv).join(",")
              );
            }
          }
        }

        const csv = rows.join("\n");
        reply.header("Content-Type", "text/csv");
        reply.header("Content-Disposition", `attachment; filename="bidcatcher-${type}-${clientId.slice(0, 8)}.csv"`);
        return reply.status(200).send(csv);
      } catch (error) {
        request.log.error(error, "Failed to export CSV");
        return reply.status(500).send({
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to export",
          },
          meta: { requestId: request.id, timestamp: new Date().toISOString() },
        });
      }
    }
  );
}
