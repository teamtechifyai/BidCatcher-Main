/**
 * GHL Sync Helpers
 *
 * Orchestrates syncing clients and bids to/from GHL.
 * Checks ghl.enabled in client config before syncing.
 */

import { getDb, clients, bids, eq, and, desc } from "@bid-catcher/db";
import { ghlSyncState } from "@bid-catcher/db/schema";
import {
  isGhlConfigured,
  upsertContact,
  createOpportunity,
  updateOpportunity,
  deleteOpportunity,
  type ClientForGhl,
  type BidForGhl,
} from "./ghl.js";

function isGhlEnabledForClient(config: unknown): boolean {
  if (!isGhlConfigured()) return false;
  if (!config || typeof config !== "object") return true; // Sync by default when GHL configured
  const ghl = (config as { ghl?: { enabled?: boolean } }).ghl;
  return ghl?.enabled !== false; // Sync unless explicitly disabled
}

function getGhlPipelineFromConfig(config: unknown): { pipelineId?: string; pipelineStageId?: string } {
  // Env vars as fallback (required by GHL API for creating opportunities)
  const envPipelineId = process.env.GHL_PIPELINE_ID;
  const envStageId = process.env.GHL_PIPELINE_STAGE_ID;
  if (!config || typeof config !== "object") {
    return { pipelineId: envPipelineId, pipelineStageId: envStageId };
  }
  const ghl = (config as { ghl?: { pipelineId?: string; stageMapping?: Record<string, string> } }).ghl;
  return {
    pipelineId: ghl?.pipelineId || envPipelineId,
    pipelineStageId: ghl?.stageMapping?.["new"] || envStageId,
  };
}

/**
 * Sync a client to GHL (create/update Contact).
 * Returns updated ghlContactId if successful.
 */
export async function syncClientToGhl(client: {
  id: string;
  name: string;
  contactEmail: string;
  contactName: string | null;
  phone: string | null;
  ghlContactId?: string | null;
  config?: unknown;
}): Promise<string | null> {
  if (!isGhlConfigured()) return null;
  if (!isGhlEnabledForClient(client.config)) return null;

  const result = await upsertContact({
    id: client.id,
    name: client.name,
    contactEmail: client.contactEmail,
    contactName: client.contactName,
    phone: client.phone,
    ghlContactId: client.ghlContactId ?? undefined,
  });

  if (!result.success || !result.contactId) return null;

  const db = getDb();
  await db
    .update(clients)
    .set({ ghlContactId: result.contactId, updatedAt: new Date() })
    .where(eq(clients.id, client.id));

  await db.insert(ghlSyncState).values({
    entityType: "client",
    entityId: client.id,
    ghlId: result.contactId,
    lastSyncSource: "bidcatcher",
  });

  return result.contactId;
}

export interface SyncBidResult {
  opportunityId: string | null;
  error?: string;
}

/**
 * Sync a bid to GHL (create/update Opportunity).
 * Ensures client is synced first if needed.
 * Returns opportunityId on success, null on failure. Use syncBidToGhlWithResult for diagnostics.
 */
export async function syncBidToGhl(
  bid: BidForGhl,
  client: { id: string; name: string; contactEmail: string; contactName: string | null; phone: string | null; ghlContactId?: string | null; config?: unknown }
): Promise<string | null> {
  const result = await syncBidToGhlWithResult(bid, client);
  if (result.error) {
    console.warn(`[ghl-sync] Bid ${bid.id} sync failed: ${result.error}`);
  }
  return result.opportunityId;
}

/**
 * Sync a bid to GHL with full result (for diagnostics/manual sync).
 */
export async function syncBidToGhlWithResult(
  bid: BidForGhl,
  client: { id: string; name: string; contactEmail: string; contactName: string | null; phone: string | null; ghlContactId?: string | null; config?: unknown }
): Promise<SyncBidResult> {
  if (!isGhlConfigured()) {
    return { opportunityId: null, error: "GHL not configured (GHL_API_TOKEN or GHL_LOCATION_ID missing)" };
  }
  if (!isGhlEnabledForClient(client.config)) {
    return { opportunityId: null, error: "GHL sync disabled for this client (ghl.enabled: false in config)" };
  }

  // Ensure client has GHL contact before creating opportunity
  let contactId = client.ghlContactId;
  if (!contactId) {
    const synced = await syncClientToGhl(client);
    if (!synced) {
      return { opportunityId: null, error: "Failed to create/update GHL contact for client" };
    }
    contactId = synced;
  }

  const { pipelineId, pipelineStageId } = getGhlPipelineFromConfig(client.config);

  // GHL API requires pipelineId and pipelineStageId to create opportunities
  if (!bid.ghlOpportunityId && (!pipelineId || !pipelineStageId)) {
    return {
      opportunityId: null,
      error:
        "GHL requires pipelineId and pipelineStageId. Set GHL_PIPELINE_ID and GHL_PIPELINE_STAGE_ID in .env, or add ghl.pipelineId and ghl.stageMapping to client config.",
    };
  }

  if (bid.ghlOpportunityId) {
    const result = await updateOpportunity(bid.ghlOpportunityId, bid, pipelineId, pipelineStageId);
    return result.success ? { opportunityId: bid.ghlOpportunityId } : { opportunityId: null, error: result.error || "Update failed" };
  }

  const result = await createOpportunity(bid, contactId!, pipelineId, pipelineStageId);
  if (!result.success || !result.opportunityId) {
    return { opportunityId: null, error: result.error || "Create opportunity failed" };
  }

  const db = getDb();
  await db
    .update(bids)
    .set({ ghlOpportunityId: result.opportunityId, updatedAt: new Date() })
    .where(eq(bids.id, bid.id));

  await db.insert(ghlSyncState).values({
    entityType: "bid",
    entityId: bid.id,
    ghlId: result.opportunityId,
    lastSyncSource: "bidcatcher",
    lastSyncedAt: new Date(),
  });

  return { opportunityId: result.opportunityId };
}

/**
 * Remove a bid from GHL (delete Opportunity).
 */
export async function removeBidFromGhl(bid: { ghlOpportunityId?: string | null }): Promise<boolean> {
  if (!isGhlConfigured()) return false;
  if (!bid.ghlOpportunityId) return false;

  const result = await deleteOpportunity(bid.ghlOpportunityId);
  return result.success;
}

/**
 * Check if we should skip pushing to GHL (last change came from GHL webhook).
 */
export async function shouldSkipPushForBid(bidId: string): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ lastSyncSource: ghlSyncState.lastSyncSource })
    .from(ghlSyncState)
    .where(and(eq(ghlSyncState.entityType, "bid"), eq(ghlSyncState.entityId, bidId)))
    .orderBy(desc(ghlSyncState.lastSyncedAt))
    .limit(1);

  if (rows.length === 0) return false;
  return rows[0].lastSyncSource === "ghl";
}
