/**
 * Analytics Service
 *
 * Market Grasp dashboard: volume metrics, Gold Nugget alerts,
 * history views, override/alignment metrics.
 */

import { getDb, bids, goNoGoDecisions, decisionOverrides, extractedFields, eq, and, desc, sql, gte, inArray } from "@bid-catcher/db";
import type { ClientConfig } from "@bid-catcher/config";

// ----- Types -----

export interface VolumeMetrics {
  bidsThisWeek: number;
  bidsThisMonth: number;
  bidsThisYear: number;
  totalBids: number;
  totalValueAll: number;
  totalValueYesMaybe: number;
  processedCount: number;
  backlogCount: number;
  processedPercent: number;
  hoursSavedEstimate: number;
}

export interface OverrideMetrics {
  totalDecisions: number;
  overriddenCount: number;
  overridePercent: number;
  alignmentTrend: Array<{ period: string; alignmentPercent: number; decisionCount: number }>;
}

export interface GoldNuggetBid {
  bidId: string;
  projectName: string | null;
  senderCompany: string | null;
  outcome: string;
  matchedTags: string[];
  receivedAt: string;
  projectValue: number | null;
}

export interface AnalyticsFilters {
  sector?: string;
  owner?: string;
  locationRadius?: string; // e.g. "Toronto" - simple contains for now
  sizeBandMin?: number;
  sizeBandMax?: number;
  timeRangeMonths?: number;
  decision?: "GO" | "MAYBE" | "NO";
  reasonTags?: string[]; // override reason categories
}

// ----- Helpers -----

function parseProjectValue(val: unknown): number | null {
  if (val == null) return null;
  if (typeof val === "number" && !isNaN(val)) return val;
  const s = String(val).replace(/[^0-9.-]/g, "");
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function matchesStrategicTag(
  tag: { id: string; label: string; matchType: string; field: string; value: string },
  fieldMap: Record<string, string | number | null>
): boolean {
  const val = fieldMap[tag.field];
  if (val == null || val === "") return false;

  const strVal = String(val).toLowerCase();
  const pattern = tag.value.toLowerCase();

  switch (tag.matchType) {
    case "contains":
      return strVal.includes(pattern);
    case "regex":
      try {
        return new RegExp(pattern, "i").test(strVal);
      } catch {
        return false;
      }
    case "value_band": {
      const num = typeof val === "number" ? val : parseFloat(String(val));
      if (isNaN(num)) return false;
      const parts = tag.value.split(",").reduce((acc, p) => {
        const [k, v] = p.split(":").map((x) => x.trim());
        if (k === "min") acc.min = parseFloat(v);
        if (k === "max") acc.max = parseFloat(v);
        return acc;
      }, { min: -Infinity, max: Infinity } as { min: number; max: number });
      return num >= parts.min && num <= parts.max;
    }
    default:
      return false;
  }
}

// ----- Analytics Service -----

export const analyticsService = {
  /**
   * Get volume and hopper metrics for a client
   */
  async getVolumeMetrics(clientId: string, config: ClientConfig | null): Promise<VolumeMetrics> {
    const db = getDb();
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 7);
    const monthStart = new Date(now);
    monthStart.setMonth(monthStart.getMonth() - 1);
    const yearStart = new Date(now);
    yearStart.setFullYear(yearStart.getFullYear() - 1);

    const conditions = [eq(bids.clientId, clientId)];

    const [totalRes, weekRes, monthRes, yearRes, statusRes] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(bids).where(and(...conditions)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(bids)
        .where(and(...conditions, gte(bids.receivedAt, weekStart))),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(bids)
        .where(and(...conditions, gte(bids.receivedAt, monthStart))),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(bids)
        .where(and(...conditions, gte(bids.receivedAt, yearStart))),
      db
        .select({ status: bids.status, count: sql<number>`count(*)::int` })
        .from(bids)
        .where(and(...conditions))
        .groupBy(bids.status),
    ]);

    const totalBids = totalRes[0]?.count ?? 0;
    const bidsThisWeek = weekRes[0]?.count ?? 0;
    const bidsThisMonth = monthRes[0]?.count ?? 0;
    const bidsThisYear = yearRes[0]?.count ?? 0;

    let processedCount = 0;
    let backlogCount = 0;
    for (const row of statusRes) {
      if (["qualified", "rejected"].includes(row.status)) processedCount += row.count;
      else backlogCount += row.count;
    }

    const processedPercent = totalBids > 0 ? Math.round((processedCount / totalBids) * 100) : 0;

    // Get $ value from extracted fields (project_value_estimate) and decisions
    const allBidsForClient = await db.select({ id: bids.id }).from(bids).where(eq(bids.clientId, clientId));
    const allBidIds = allBidsForClient.map((b) => b.id);

    const bidValues = new Map<string, number>();
    let totalValueAll = 0;
    let totalValueYesMaybe = 0;

    if (allBidIds.length > 0) {
      const valueQuery = await db
        .select({
          bidId: extractedFields.bidId,
          signalId: extractedFields.signalId,
          extractedValue: extractedFields.extractedValue,
        })
        .from(extractedFields)
        .where(
          and(
            inArray(extractedFields.bidId, allBidIds),
            eq(extractedFields.signalId, "project_value_estimate")
          )
        );

      for (const row of valueQuery) {
        const v = parseProjectValue(row.extractedValue);
        if (v != null && v > 0) {
          const current = bidValues.get(row.bidId) ?? 0;
          bidValues.set(row.bidId, Math.max(current, v));
        }
      }

      for (const [, val] of bidValues) totalValueAll += val;

      const bidIdsWithValue = Array.from(bidValues.keys());
      if (bidIdsWithValue.length > 0) {
        const allDecisions = await db
          .select({ bidId: goNoGoDecisions.bidId, outcome: goNoGoDecisions.outcome })
          .from(goNoGoDecisions)
          .where(inArray(goNoGoDecisions.bidId, bidIdsWithValue))
          .orderBy(desc(goNoGoDecisions.createdAt));

        const latestByBid = new Map<string, string>();
        for (const d of allDecisions) {
          if (!latestByBid.has(d.bidId)) latestByBid.set(d.bidId, d.outcome);
        }

        for (const [bidId, val] of bidValues) {
          const outcome = latestByBid.get(bidId);
          if (outcome === "GO" || outcome === "MAYBE") totalValueYesMaybe += val;
        }
      }
    }

    const hoursSavedPerBid = config?.hoursSavedPerBid ?? 1.5;
    const hoursSavedEstimate = Math.round(totalBids * hoursSavedPerBid * 10) / 10;

    return {
      bidsThisWeek,
      bidsThisMonth,
      bidsThisYear,
      totalBids,
      totalValueAll,
      totalValueYesMaybe,
      processedCount,
      backlogCount,
      processedPercent,
      hoursSavedEstimate,
    };
  },

  /**
   * Get override and alignment metrics
   */
  async getOverrideMetrics(clientId: string): Promise<OverrideMetrics> {
    const db = getDb();

    const decisionsWithBids = await db
      .select({
        id: goNoGoDecisions.id,
        bidId: goNoGoDecisions.bidId,
        outcome: goNoGoDecisions.outcome,
        createdAt: goNoGoDecisions.createdAt,
      })
      .from(goNoGoDecisions)
      .innerJoin(bids, eq(goNoGoDecisions.bidId, bids.id))
      .where(eq(bids.clientId, clientId))
      .orderBy(desc(goNoGoDecisions.createdAt));

    const latestByBid = new Map<string, { decisionId: string; outcome: string; createdAt: Date }>();
    for (const d of decisionsWithBids) {
      if (!latestByBid.has(d.bidId)) {
        latestByBid.set(d.bidId, { decisionId: d.id, outcome: d.outcome, createdAt: d.createdAt });
      }
    }

    const overrides = await db
      .select({
        decisionId: decisionOverrides.decisionId,
        originalOutcome: decisionOverrides.originalOutcome,
        overriddenOutcome: decisionOverrides.overriddenOutcome,
      })
      .from(decisionOverrides)
      .innerJoin(bids, eq(decisionOverrides.bidId, bids.id))
      .where(eq(bids.clientId, clientId));

    const overriddenDecisionIds = new Set(overrides.map((o) => o.decisionId));
    const totalDecisions = latestByBid.size;
    let overriddenCount = 0;
    for (const [, v] of latestByBid) {
      if (overriddenDecisionIds.has(v.decisionId)) overriddenCount++;
    }

    const overridePercent = totalDecisions > 0 ? Math.round((overriddenCount / totalDecisions) * 100) : 0;

    // Alignment trend: last 6 months by month
    const trend: Array<{ period: string; alignmentPercent: number; decisionCount: number }> = [];
    for (let i = 0; i < 6; i++) {
      const monthEnd = new Date();
      monthEnd.setMonth(monthEnd.getMonth() - i);
      const monthStart = new Date(monthEnd);
      monthStart.setMonth(monthStart.getMonth() - 1);

      const inPeriod = [...latestByBid.values()].filter(
        (v) => v.createdAt >= monthStart && v.createdAt < monthEnd
      );
      const overriddenInPeriod = inPeriod.filter((v) => overriddenDecisionIds.has(v.decisionId));
      const alignmentPercent = inPeriod.length > 0 ? Math.round(((inPeriod.length - overriddenInPeriod.length) / inPeriod.length) * 100) : 100;

      trend.push({
        period: monthStart.toISOString().slice(0, 7),
        alignmentPercent,
        decisionCount: inPeriod.length,
      });
    }
    trend.reverse();

    return {
      totalDecisions,
      overriddenCount,
      overridePercent,
      alignmentTrend: trend,
    };
  },

  /**
   * Get Gold Nugget bids (match strategic tags)
   */
  async getGoldNuggets(clientId: string, config: ClientConfig | null, limit = 20): Promise<GoldNuggetBid[]> {
    const tags = config?.strategicTags ?? [];
    if (tags.length === 0) return [];

    const db = getDb();
    const bidsList = await db
      .select({
        id: bids.id,
        projectName: bids.projectName,
        senderCompany: bids.senderCompany,
        receivedAt: bids.receivedAt,
      })
      .from(bids)
      .where(eq(bids.clientId, clientId))
      .orderBy(desc(bids.receivedAt))
      .limit(500);

    const bidIds = bidsList.map((b) => b.id);
    const extracted =
      bidIds.length > 0
        ? await db
            .select({
              bidId: extractedFields.bidId,
              signalId: extractedFields.signalId,
              extractedValue: extractedFields.extractedValue,
            })
            .from(extractedFields)
            .where(inArray(extractedFields.bidId, bidIds))
        : [];

    const fieldsByBid = new Map<string, Array<{ fieldKey: string; extractedValue: unknown }>>();
    for (const e of extracted) {
      if (!fieldsByBid.has(e.bidId)) fieldsByBid.set(e.bidId, []);
      fieldsByBid.get(e.bidId)!.push({ fieldKey: e.signalId, extractedValue: e.extractedValue });
    }

    const decisions =
      bidIds.length > 0
        ? await db
            .select({ bidId: goNoGoDecisions.bidId, outcome: goNoGoDecisions.outcome })
            .from(goNoGoDecisions)
            .where(inArray(goNoGoDecisions.bidId, bidIds))
            .orderBy(desc(goNoGoDecisions.createdAt))
        : [];

    const latestOutcome = new Map<string, string>();
    for (const d of decisions) {
      if (!latestOutcome.has(d.bidId)) latestOutcome.set(d.bidId, d.outcome);
    }

    const results: GoldNuggetBid[] = [];
    for (const bid of bidsList) {
      const fields = fieldsByBid.get(bid.id) ?? [];
      const fieldMap: Record<string, string | number | null> = {};
      for (const f of fields) {
        const v = f.extractedValue;
        fieldMap[f.fieldKey] = v == null ? null : typeof v === "number" ? v : String(v);
      }
      fieldMap.project_name = bid.projectName;
      fieldMap.sender_company = bid.senderCompany;

      const matchedTags: string[] = [];
      for (const tag of tags) {
        if (matchesStrategicTag(tag, fieldMap)) matchedTags.push(tag.label);
      }
      if (matchedTags.length === 0) continue;

      const projectValue = parseProjectValue(fieldMap.project_value_estimate ?? fieldMap.estimatedValue);
      results.push({
        bidId: bid.id,
        projectName: bid.projectName,
        senderCompany: bid.senderCompany,
        outcome: latestOutcome.get(bid.id) ?? "NONE",
        matchedTags,
        receivedAt: bid.receivedAt.toISOString(),
        projectValue,
      });
      if (results.length >= limit) break;
    }
    return results;
  },

  /**
   * Get filtered bid history (what we missed, etc.)
   */
  async getFilteredBids(
    clientId: string,
    filters: AnalyticsFilters,
    limit = 100,
    offset = 0
  ): Promise<{ bids: Array<Record<string, unknown>>; total: number }> {
    const db = getDb();

    let conditions = [eq(bids.clientId, clientId)];

    if (filters.timeRangeMonths) {
      const since = new Date();
      since.setMonth(since.getMonth() - filters.timeRangeMonths);
      conditions.push(gte(bids.receivedAt, since));
    }

    const bidsList = await db
      .select({
        id: bids.id,
        projectName: bids.projectName,
        senderCompany: bids.senderCompany,
        status: bids.status,
        receivedAt: bids.receivedAt,
        rawPayload: bids.rawPayload,
      })
      .from(bids)
      .where(and(...conditions))
      .orderBy(desc(bids.receivedAt))
      .limit(limit * 3); // Fetch extra for filtering

    const bidIds = bidsList.map((b) => b.id);
    const extracted =
      bidIds.length > 0
        ? await db
            .select({
              bidId: extractedFields.bidId,
              signalId: extractedFields.signalId,
              extractedValue: extractedFields.extractedValue,
            })
            .from(extractedFields)
            .where(inArray(extractedFields.bidId, bidIds))
        : [];

    const decisions =
      bidIds.length > 0
        ? await db
            .select({
              bidId: goNoGoDecisions.bidId,
              outcome: goNoGoDecisions.outcome,
              createdAt: goNoGoDecisions.createdAt,
            })
            .from(goNoGoDecisions)
            .where(inArray(goNoGoDecisions.bidId, bidIds))
            .orderBy(desc(goNoGoDecisions.createdAt))
        : [];

    const latestOutcome = new Map<string, string>();
    for (const d of decisions) {
      if (!latestOutcome.has(d.bidId)) latestOutcome.set(d.bidId, d.outcome);
    }

    const fieldsByBid = new Map<string, Array<{ fieldKey: string; extractedValue: unknown }>>();
    for (const e of extracted) {
      if (!fieldsByBid.has(e.bidId)) fieldsByBid.set(e.bidId, []);
      fieldsByBid.get(e.bidId)!.push({ fieldKey: e.signalId, extractedValue: e.extractedValue });
    }

    let filtered = bidsList.map((b) => {
      const fields = fieldsByBid.get(b.id) ?? [];
      const getVal = (k: string): unknown => {
        const f = fields.find((x) => x.fieldKey === k);
        const payload = b.rawPayload as Record<string, unknown> | null;
        const customFields = payload?.customFields as Record<string, unknown> | undefined;
        return f?.extractedValue ?? customFields?.[k];
      };
      const outcome = latestOutcome.get(b.id) ?? "NONE";
      const projectValue = parseProjectValue(getVal("project_value_estimate") ?? getVal("estimatedValue"));
      const sector = String(getVal("scope_of_work") ?? getVal("projectType") ?? "").toLowerCase();
      const owner = String(getVal("owner_name") ?? "").toLowerCase();
      const location = String(getVal("project_location") ?? "").toLowerCase();

      return {
        bid: b,
        outcome,
        projectValue,
        sector,
        owner,
        location,
      };
    });

    if (filters.decision) {
      filtered = filtered.filter((x) => x.outcome === filters.decision);
    }
    if (filters.sector) {
      const s = filters.sector.toLowerCase();
      filtered = filtered.filter((x) => x.sector.includes(s));
    }
    if (filters.owner) {
      const o = filters.owner.toLowerCase();
      filtered = filtered.filter((x) => x.owner.includes(o));
    }
    if (filters.locationRadius) {
      const loc = filters.locationRadius.toLowerCase();
      filtered = filtered.filter((x) => x.location.includes(loc));
    }
    if (filters.sizeBandMin != null || filters.sizeBandMax != null) {
      filtered = filtered.filter((x) => {
        const v = x.projectValue;
        if (v == null) return false;
        if (filters.sizeBandMin != null && v < filters.sizeBandMin) return false;
        if (filters.sizeBandMax != null && v > filters.sizeBandMax) return false;
        return true;
      });
    }

    const total = filtered.length;
    const paginated = filtered.slice(offset, offset + limit);

    const results = paginated.map((x) => ({
      id: x.bid.id,
      projectName: x.bid.projectName,
      senderCompany: x.bid.senderCompany,
      status: x.bid.status,
      outcome: x.outcome,
      projectValue: x.projectValue,
      receivedAt: x.bid.receivedAt.toISOString(),
    }));

    return { bids: results, total };
  },
};
