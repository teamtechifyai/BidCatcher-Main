/**
 * GoHighLevel (GHL) Integration Routes
 *
 * Webhook receiver and manual sync endpoints.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getDb, clients, bids, eq } from "@bid-catcher/db";
import { ghlSyncState } from "@bid-catcher/db/schema";
import { syncClientToGhl, syncBidToGhlWithResult } from "../services/ghl-sync.js";
import { getGhlStatus, isGhlConfigured, getPipelines } from "../services/ghl.js";

const GHL_LOCATION_ID = () => process.env.GHL_LOCATION_ID;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function ghlRoutes(server: FastifyInstance): Promise<void> {
  /**
   * GET /ghl/status
   *
   * Health check: verify GHL token and location.
   */
  server.get("/status", async (request: FastifyRequest, reply: FastifyReply) => {
    const status = getGhlStatus();
    return reply.status(200).send({
      success: true,
      data: status,
      meta: { requestId: request.id, timestamp: new Date().toISOString() },
    });
  });

  /**
   * GET /ghl/pipelines
   *
   * List pipelines and stages (use to find GHL_PIPELINE_ID and GHL_PIPELINE_STAGE_ID).
   */
  server.get("/pipelines", async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await getPipelines();
    if (!result.success) {
      return reply.status(503).send({
        success: false,
        error: { code: "GHL_ERROR", message: result.error },
        meta: { requestId: request.id, timestamp: new Date().toISOString() },
      });
    }
    return reply.status(200).send({
      success: true,
      data: { pipelines: result.pipelines },
      meta: { requestId: request.id, timestamp: new Date().toISOString() },
    });
  });

  /**
   * POST /ghl/webhook
   *
   * Receive GHL webhooks (ContactCreate, ContactUpdate, ContactDelete, OpportunityUpdate, etc.).
   * Respond with 200 quickly; process async.
   */
  server.post("/webhook", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, unknown>;
    const locationId = body?.locationId as string | undefined;
    const expectedLocation = GHL_LOCATION_ID();

    if (expectedLocation && locationId && locationId !== expectedLocation) {
      request.log.warn({ locationId, expectedLocation }, "GHL webhook locationId mismatch");
      return reply.status(200).send({ received: true }); // Still 200 to avoid retries
    }

    const type = body?.type as string | undefined;
    if (!type) {
      return reply.status(400).send({ error: "Missing type in webhook payload" });
    }

    // Respond immediately, process async
    reply.status(200).send({ received: true });

    setImmediate(async () => {
      try {
        const db = getDb();

        if (type === "ContactCreate" || type === "ContactUpdate") {
          const contactId = body?.id as string | undefined;
          if (!contactId) return;

          const [client] = await db
            .select()
            .from(clients)
            .where(eq(clients.ghlContactId, contactId))
            .limit(1);

          if (client) {
            const name = (body?.companyName as string) || (body?.name as string) || client.name;
            const email = (body?.email as string) || client.contactEmail;
            const phone = (body?.phone as string) || client.phone;
            const contactName = (body?.firstName as string)
              ? `${body.firstName as string} ${(body?.lastName as string) || ""}`.trim()
              : client.contactName;

            await db
              .update(clients)
              .set({
                name,
                contactEmail: email,
                contactName: contactName || null,
                phone: phone || null,
                updatedAt: new Date(),
              })
              .where(eq(clients.id, client.id));

            await db.insert(ghlSyncState).values({
              entityType: "client",
              entityId: client.id,
              ghlId: contactId,
              lastSyncSource: "ghl",
            });

            request.log.info({ clientId: client.id, contactId }, "GHL Contact webhook: updated client");
          }
        } else if (type === "ContactDelete") {
          const contactId = body?.id as string | undefined;
          if (!contactId) return;

          await db
            .update(clients)
            .set({ ghlContactId: null, updatedAt: new Date() })
            .where(eq(clients.ghlContactId, contactId));

          request.log.info({ contactId }, "GHL ContactDelete: cleared ghl_contact_id");
        } else if (type === "OpportunityUpdate" || type === "OpportunityStageUpdate" || type === "OpportunityCreate") {
          const opportunityId = body?.id as string | undefined;
          if (!opportunityId) return;

          const [bid] = await db
            .select()
            .from(bids)
            .where(eq(bids.ghlOpportunityId, opportunityId))
            .limit(1);

          if (bid) {
            const name = body?.name as string | undefined;
            const status = body?.status as string | undefined;

            await db
              .update(bids)
              .set({
                projectName: name || bid.projectName,
                status: status || bid.status,
                updatedAt: new Date(),
              })
              .where(eq(bids.id, bid.id));

            await db.insert(ghlSyncState).values({
              entityType: "bid",
              entityId: bid.id,
              ghlId: opportunityId,
              lastSyncSource: "ghl",
            });

            request.log.info({ bidId: bid.id, opportunityId }, "GHL Opportunity webhook: updated bid");
          }
        } else if (type === "OpportunityDelete") {
          const opportunityId = body?.id as string | undefined;
          if (!opportunityId) return;

          const [bid] = await db
            .select({ id: bids.id })
            .from(bids)
            .where(eq(bids.ghlOpportunityId, opportunityId))
            .limit(1);

          if (bid) {
            await db
              .update(bids)
              .set({ ghlOpportunityId: null, updatedAt: new Date() })
              .where(eq(bids.id, bid.id));
            request.log.info({ bidId: bid.id, opportunityId }, "GHL OpportunityDelete: cleared ghl_opportunity_id");
          }
        }
      } catch (err) {
        request.log.error(err, "GHL webhook processing failed");
      }
    });
  });

  /**
   * POST /ghl/sync-client/:clientId
   *
   * Manual trigger: sync client to GHL.
   */
  server.post<{ Params: { clientId: string } }>(
    "/sync-client/:clientId",
    async (request: FastifyRequest<{ Params: { clientId: string } }>, reply: FastifyReply) => {
      const { clientId } = request.params;
      if (!UUID_REGEX.test(clientId)) {
        return reply.status(400).send({
          success: false,
          error: { code: "INVALID_ID", message: "Invalid client ID format" },
          meta: { requestId: request.id, timestamp: new Date().toISOString() },
        });
      }

      if (!isGhlConfigured()) {
        return reply.status(503).send({
          success: false,
          error: { code: "GHL_NOT_CONFIGURED", message: "GHL_API_TOKEN or GHL_LOCATION_ID not set" },
          meta: { requestId: request.id, timestamp: new Date().toISOString() },
        });
      }

      const db = getDb();
      const [client] = await db
        .select({
          id: clients.id,
          name: clients.name,
          contactEmail: clients.contactEmail,
          contactName: clients.contactName,
          phone: clients.phone,
          ghlContactId: clients.ghlContactId,
          config: clients.config,
        })
        .from(clients)
        .where(eq(clients.id, clientId))
        .limit(1);

      if (!client) {
        return reply.status(404).send({
          success: false,
          error: { code: "NOT_FOUND", message: "Client not found" },
          meta: { requestId: request.id, timestamp: new Date().toISOString() },
        });
      }

      const contactId = await syncClientToGhl(client);
      return reply.status(200).send({
        success: !!contactId,
        data: { contactId: contactId || null },
        meta: { requestId: request.id, timestamp: new Date().toISOString() },
      });
    }
  );

  /**
   * POST /ghl/sync-bid/:bidId
   *
   * Manual trigger: sync bid to GHL.
   */
  server.post<{ Params: { bidId: string } }>(
    "/sync-bid/:bidId",
    async (request: FastifyRequest<{ Params: { bidId: string } }>, reply: FastifyReply) => {
      const { bidId } = request.params;
      if (!UUID_REGEX.test(bidId)) {
        return reply.status(400).send({
          success: false,
          error: { code: "INVALID_ID", message: "Invalid bid ID format" },
          meta: { requestId: request.id, timestamp: new Date().toISOString() },
        });
      }

      if (!isGhlConfigured()) {
        return reply.status(503).send({
          success: false,
          error: { code: "GHL_NOT_CONFIGURED", message: "GHL_API_TOKEN or GHL_LOCATION_ID not set" },
          meta: { requestId: request.id, timestamp: new Date().toISOString() },
        });
      }

      const db = getDb();
      const [bid] = await db.select().from(bids).where(eq(bids.id, bidId)).limit(1);
      if (!bid) {
        return reply.status(404).send({
          success: false,
          error: { code: "NOT_FOUND", message: "Bid not found" },
          meta: { requestId: request.id, timestamp: new Date().toISOString() },
        });
      }

      const [client] = await db
        .select({
          id: clients.id,
          name: clients.name,
          contactEmail: clients.contactEmail,
          contactName: clients.contactName,
          phone: clients.phone,
          ghlContactId: clients.ghlContactId,
          config: clients.config,
        })
        .from(clients)
        .where(eq(clients.id, bid.clientId))
        .limit(1);

      if (!client) {
        return reply.status(404).send({
          success: false,
          error: { code: "CLIENT_NOT_FOUND", message: "Client not found" },
          meta: { requestId: request.id, timestamp: new Date().toISOString() },
        });
      }

      const result = await syncBidToGhlWithResult(
        {
          id: bid.id,
          clientId: bid.clientId,
          projectName: bid.projectName,
          status: bid.status,
          senderEmail: bid.senderEmail,
          senderName: bid.senderName,
          senderCompany: bid.senderCompany,
          ghlOpportunityId: bid.ghlOpportunityId,
        },
        client
      );

      return reply.status(200).send({
        success: !!result.opportunityId,
        data: {
          opportunityId: result.opportunityId || null,
          ...(result.error && { error: result.error }),
        },
        meta: { requestId: request.id, timestamp: new Date().toISOString() },
      });
    }
  );
}
