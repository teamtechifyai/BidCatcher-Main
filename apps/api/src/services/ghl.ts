/**
 * GoHighLevel (GHL) Integration Service
 *
 * Syncs BidCatcher clients to GHL Contacts and bids to GHL Opportunities.
 * Uses Private Integration Token (no OAuth).
 * Base URL: https://services.leadconnectorhq.com
 */

const GHL_API_BASE = "https://services.leadconnectorhq.com";

const getGhlToken = () => process.env.GHL_API_TOKEN;
const getGhlLocationId = () => process.env.GHL_LOCATION_ID;

const ghlHeaders = (): Record<string, string> => {
  const token = getGhlToken();
  const locationId = getGhlLocationId();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Version: "2021-07-28",
  };
  if (locationId) headers["Location-Id"] = locationId;
  return headers;
};

export function isGhlConfigured(): boolean {
  return !!(getGhlToken() && getGhlLocationId());
}

export function getGhlStatus(): { configured: boolean; locationId: string | null } {
  return {
    configured: isGhlConfigured(),
    locationId: getGhlLocationId() || null,
  };
}

/**
 * List pipelines and stages (for finding GHL_PIPELINE_ID and GHL_PIPELINE_STAGE_ID).
 * GET /opportunities/pipelines
 */
export async function getPipelines(): Promise<{
  success: boolean;
  pipelines?: Array<{ id: string; name: string; stages: Array<{ id: string; name: string }> }>;
  error?: string;
}> {
  const token = getGhlToken();
  const locationId = getGhlLocationId();
  if (!token || !locationId) {
    return { success: false, error: "GHL_API_TOKEN or GHL_LOCATION_ID not configured" };
  }

  try {
    const url = `${GHL_API_BASE}/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: ghlHeaders(),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { message?: string };
      return { success: false, error: data?.message || res.statusText };
    }

    const data = (await res.json()) as { pipelines?: Array<{ id?: string; name?: string; stages?: Array<{ id?: string; name?: string }> }> };
    const pipelines = (data?.pipelines ?? []).map((p) => ({
      id: p.id ?? "",
      name: p.name ?? "Unnamed",
      stages: (p.stages ?? []).map((s) => ({ id: s.id ?? "", name: s.name ?? "Unnamed" })),
    }));
    return { success: true, pipelines };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: msg };
  }
}

/** Client type from clients table */
export interface ClientForGhl {
  id: string;
  name: string;
  contactEmail: string;
  contactName: string | null;
  phone: string | null;
  ghlContactId?: string | null;
}

/** Bid type from bids table */
export interface BidForGhl {
  id: string;
  clientId: string;
  projectName: string | null;
  status: string;
  senderEmail: string | null;
  senderName: string | null;
  senderCompany: string | null;
  ghlOpportunityId?: string | null;
}

/** Result of upsert contact */
export interface UpsertContactResult {
  success: boolean;
  contactId?: string;
  error?: string;
}

/** Result of create/update opportunity */
export interface OpportunityResult {
  success: boolean;
  opportunityId?: string;
  error?: string;
}

/**
 * Upsert a contact to GHL from a BidCatcher client.
 * POST /contacts/upsert
 */
export async function upsertContact(client: ClientForGhl): Promise<UpsertContactResult> {
  const token = getGhlToken();
  const locationId = getGhlLocationId();
  if (!token || !locationId) {
    return { success: false, error: "GHL_API_TOKEN or GHL_LOCATION_ID not configured" };
  }

  const [firstName, ...rest] = (client.contactName || "").trim().split(/\s+/);
  const lastName = rest.join(" ") || "";

  const body = {
    locationId,
    ...(client.ghlContactId && { contactId: client.ghlContactId }),
    firstName: firstName || client.name,
    lastName: lastName || undefined,
    name: client.name,
    email: client.contactEmail,
    phone: client.phone || undefined,
    companyName: client.name,
    ...(process.env.GHL_CUSTOM_FIELD_CLIENT_ID && {
      customFields: [{ id: process.env.GHL_CUSTOM_FIELD_CLIENT_ID, value: client.id }],
    }),
  };

  try {
    const res = await fetch(`${GHL_API_BASE}/contacts/upsert`, {
      method: "POST",
      headers: ghlHeaders(),
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({})) as { contact?: { id?: string }; message?: string };

    if (!res.ok) {
      const msg = data?.message || res.statusText;
      console.warn(`[ghl] Upsert contact failed ${res.status}: ${msg}`);
      return { success: false, error: msg };
    }

    const contactId = data?.contact?.id ?? data?.contactId;
    if (!contactId) {
      console.warn("[ghl] Upsert contact: no contact ID in response");
      return { success: false, error: "No contact ID in response" };
    }

    return { success: true, contactId };

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.warn("[ghl] Upsert contact error:", msg);
    return { success: false, error: msg };
  }
}

/**
 * Get a contact by ID.
 * GET /contacts/:contactId
 */
export async function getContact(contactId: string): Promise<{ success: boolean; contact?: unknown; error?: string }> {
  const token = getGhlToken();
  const locationId = getGhlLocationId();
  if (!token || !locationId) {
    return { success: false, error: "GHL_API_TOKEN or GHL_LOCATION_ID not configured" };
  }

  try {
    const res = await fetch(`${GHL_API_BASE}/contacts/${contactId}`, {
      method: "GET",
      headers: ghlHeaders(),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { message?: string };
      return { success: false, error: data?.message || res.statusText };
    }

    const contact = await res.json();
    return { success: true, contact };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: msg };
  }
}

/**
 * Create an opportunity in GHL from a BidCatcher bid.
 * POST /opportunities/
 * Requires pipelineId and pipelineStageId - uses defaults if not in client config.
 */
export async function createOpportunity(
  bid: BidForGhl,
  contactId: string,
  pipelineId?: string,
  pipelineStageId?: string
): Promise<OpportunityResult> {
  const token = getGhlToken();
  const locationId = getGhlLocationId();
  if (!token || !locationId) {
    return { success: false, error: "GHL_API_TOKEN or GHL_LOCATION_ID not configured" };
  }

  const body = {
    locationId,
    contactId,
    name: bid.projectName || "Untitled Bid",
    pipelineId: pipelineId || undefined,
    pipelineStageId: pipelineStageId || undefined,
    status: "open",
    ...(process.env.GHL_CUSTOM_FIELD_BID_ID && {
      customFields: [{ id: process.env.GHL_CUSTOM_FIELD_BID_ID, value: bid.id }],
    }),
  };

  try {
    const res = await fetch(`${GHL_API_BASE}/opportunities/`, {
      method: "POST",
      headers: ghlHeaders(),
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({})) as { opportunity?: { id?: string }; id?: string; message?: string };

    if (!res.ok) {
      const msg = data?.message || res.statusText;
      console.warn(`[ghl] Create opportunity failed ${res.status}: ${msg}`);
      return { success: false, error: msg };
    }

    const opportunityId = data?.opportunity?.id ?? data?.id ?? data?.opportunityId;
    if (!opportunityId) {
      console.warn("[ghl] Create opportunity: no opportunity ID in response");
      return { success: false, error: "No opportunity ID in response" };
    }

    return { success: true, opportunityId };

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.warn("[ghl] Create opportunity error:", msg);
    return { success: false, error: msg };
  }
}

/**
 * Update an opportunity in GHL.
 * PUT /opportunities/:opportunityId
 */
export async function updateOpportunity(
  opportunityId: string,
  bid: BidForGhl,
  pipelineId?: string,
  pipelineStageId?: string
): Promise<OpportunityResult> {
  const token = getGhlToken();
  const locationId = getGhlLocationId();
  if (!token || !locationId) {
    return { success: false, error: "GHL_API_TOKEN or GHL_LOCATION_ID not configured" };
  }

  const body = {
    locationId,
    name: bid.projectName || "Untitled Bid",
    pipelineId: pipelineId || undefined,
    pipelineStageId: pipelineStageId || undefined,
    status: "open",
  };

  try {
    const res = await fetch(`${GHL_API_BASE}/opportunities/${opportunityId}`, {
      method: "PUT",
      headers: ghlHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { message?: string };
      const msg = data?.message || res.statusText;
      console.warn(`[ghl] Update opportunity failed ${res.status}: ${msg}`);
      return { success: false, error: msg };
    }

    return { success: true, opportunityId };

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.warn("[ghl] Update opportunity error:", msg);
    return { success: false, error: msg };
  }
}

/**
 * Delete an opportunity in GHL.
 * DELETE /opportunities/:opportunityId
 */
export async function deleteOpportunity(opportunityId: string): Promise<{ success: boolean; error?: string }> {
  const token = getGhlToken();
  const locationId = getGhlLocationId();
  if (!token || !locationId) {
    return { success: false, error: "GHL_API_TOKEN or GHL_LOCATION_ID not configured" };
  }

  try {
    const res = await fetch(`${GHL_API_BASE}/opportunities/${opportunityId}`, {
      method: "DELETE",
      headers: ghlHeaders(),
    });

    if (!res.ok && res.status !== 404) {
      const data = await res.json().catch(() => ({})) as { message?: string };
      const msg = data?.message || res.statusText;
      console.warn(`[ghl] Delete opportunity failed ${res.status}: ${msg}`);
      return { success: false, error: msg };
    }

    return { success: true };

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.warn("[ghl] Delete opportunity error:", msg);
    return { success: false, error: msg };
  }
}

/**
 * Get an opportunity by ID.
 * GET /opportunities/:opportunityId
 */
export async function getOpportunity(opportunityId: string): Promise<{ success: boolean; opportunity?: unknown; error?: string }> {
  const token = getGhlToken();
  const locationId = getGhlLocationId();
  if (!token || !locationId) {
    return { success: false, error: "GHL_API_TOKEN or GHL_LOCATION_ID not configured" };
  }

  try {
    const res = await fetch(`${GHL_API_BASE}/opportunities/${opportunityId}`, {
      method: "GET",
      headers: ghlHeaders(),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { message?: string };
      return { success: false, error: data?.message || res.statusText };
    }

    const opportunity = await res.json();
    return { success: true, opportunity };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: msg };
  }
}
