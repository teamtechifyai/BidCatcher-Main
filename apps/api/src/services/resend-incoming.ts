/**
 * Resend Incoming Email Service
 *
 * Fetches email content and attachments from Resend API after receiving webhook.
 * Parses client from Resend to-address (intake-{slug}@{domain}).
 */

import { Resend } from "resend";

// Read at runtime - module-level const is evaluated before dotenv runs (ESM import order)
const getResendApiKey = () => process.env.RESEND_API_KEY;
const RESEND_RECEIVING_DOMAIN = process.env.RESEND_RECEIVING_DOMAIN || "";
const RESEND_API_BASE = "https://api.resend.com";

/** Resend webhook event payload (email.received) */
export interface ResendWebhookEvent {
  type: "email.received";
  created_at: string;
  data: {
    email_id: string;
    created_at: string;
    from: string;
    to: string[];
    bcc: string[];
    cc: string[];
    message_id?: string;
    subject: string;
    attachments?: Array<{
      id: string;
      filename: string;
      content_type: string;
      content_disposition?: string;
      content_id?: string;
    }>;
  };
}

/** Extract email from "Name <email@domain>" or return as-is if plain. Exported for use in incoming-emails. */
export function extractEmail(addr: string): string {
  const match = addr.match(/<([^>]+)>/);
  return match ? match[1].trim() : addr.trim();
}

/** Result of parsing intake address from to-addresses */
export interface IntakeAddressParseResult {
  slug: string;
  intakeAddress: string;
}

/**
 * Parse client slug and intake address from Resend to-addresses.
 * Format: intake-{slug}@{domain}
 * Handles "Name <email@domain>" format.
 * If RESEND_RECEIVING_DOMAIN is set, only matches that domain. Otherwise uses first intake-* address.
 */
export function parseIntakeAddressFromTo(toAddresses: string[]): IntakeAddressParseResult | null {
  const domain = RESEND_RECEIVING_DOMAIN.toLowerCase();
  let fallback: IntakeAddressParseResult | null = null;

  for (const rawAddr of toAddresses) {
    const addr = extractEmail(rawAddr);
    const localPart = addr.split("@")[0]?.toLowerCase() || "";
    const addrDomain = addr.split("@")[1]?.toLowerCase() || "";
    if (!localPart.startsWith("intake-")) continue;
    const slug = localPart.slice(7);
    if (slug.length === 0) continue;

    const result: IntakeAddressParseResult = { slug, intakeAddress: `${localPart}@${addrDomain}` };
    if (domain && addrDomain === domain) return result;
    if (!fallback) fallback = result;
  }
  return fallback;
}

/** @deprecated Use parseIntakeAddressFromTo. Kept for backwards compat. */
export function parseClientSlugFromToAddress(toAddresses: string[]): string | null {
  const result = parseIntakeAddressFromTo(toAddresses);
  return result?.slug ?? null;
}

/** Fetch full email content from Resend Receiving API (GET /emails/receiving/:id) */
export async function fetchEmailContent(emailId: string): Promise<{
  html?: string;
  text?: string;
  headers?: Record<string, string>;
  error?: string;
}> {
  const url = `${RESEND_API_BASE}/emails/receiving/${emailId}`;
  console.log(`[resend] GET ${url} (fetch email content)`);
  if (!getResendApiKey()) {
    console.warn("[resend] RESEND_API_KEY not configured - skipping");
    return { error: "RESEND_API_KEY not configured" };
  }

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${getResendApiKey()}`,
      },
    });

    console.log(`[resend] GET /emails/receiving/:id → ${res.status} ${res.statusText}`);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = (err as { message?: string })?.message || res.statusText;
      console.warn(`[resend] Email content error: ${res.status} - ${msg}`);
      return { error: msg || `Resend API error: ${res.status}` };
    }

    const data = (await res.json()) as { html?: string; text?: string; headers?: Record<string, string> };
    const htmlLen = data.html?.length ?? 0;
    const textLen = data.text?.length ?? 0;
    console.log(`[resend] Email content OK: html=${htmlLen} chars, text=${textLen} chars`);
    return {
      html: data.html,
      text: data.text,
      headers: data.headers,
    };
  } catch (err) {
    console.warn("[resend] Email content fetch error:", err instanceof Error ? err.message : err);
    return {
      error: err instanceof Error ? err.message : "Failed to fetch email content",
    };
  }
}

/** Fetch a single attachment by ID. Uses Resend SDK first, falls back to raw fetch. */
export async function fetchAttachmentById(
  emailId: string,
  attachmentId: string
): Promise<{ id: string; filename: string; content_type: string; size?: number; download_url?: string; expires_at?: string } | null> {
  const url = `${RESEND_API_BASE}/emails/receiving/${emailId}/attachments/${attachmentId}`;
  console.log(`[resend] Retrieve-by-ID: GET ${url}`);

  if (!getResendApiKey()) {
    console.warn("[resend] RESEND_API_KEY not configured - skipping Retrieve-by-ID");
    return null;
  }

  const toResult = (d: { id?: string; filename?: string; content_type?: string; size?: number; download_url?: string; expires_at?: string } | null) => {
    if (!d?.download_url) return null;
    return {
      id: d.id ?? attachmentId,
      filename: d.filename ?? "attachment",
      content_type: d.content_type ?? "application/octet-stream",
      size: d.size,
      download_url: d.download_url,
      expires_at: d.expires_at,
    };
  };

  try {
    const resend = new Resend(getResendApiKey());
    const { data, error } = await resend.emails.receiving.attachments.get({ emailId, id: attachmentId });
    console.log(`[resend] SDK attachments.get({ emailId: ${emailId}, id: ${attachmentId} }) → error=${error ?? "null"}, hasDownloadUrl=${!!data?.download_url}`);
    if (!error && data?.download_url) {
      console.log(`[resend] Retrieve-by-ID OK (SDK): filename=${(data as { filename?: string }).filename}, size=${(data as { size?: number }).size}`);
      return toResult(data as { download_url: string; filename?: string; content_type?: string; size?: number });
    }
    if (error) console.warn("[resend] SDK get attachment error:", error);
  } catch (err) {
    console.warn("[resend] SDK get attachment error:", err instanceof Error ? err.message : err);
  }

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${getResendApiKey()}`,
        "User-Agent": "BidCatcher/1.0",
      },
    });
    const bodyText = await res.text();
    console.log(`[resend] GET /emails/receiving/:id/attachments/:attachmentId → ${res.status} ${res.statusText}, bodyLen=${bodyText.length}`);
    if (!res.ok) {
      console.warn(`[resend] Retrieve-by-ID failed: ${res.status} - ${bodyText.slice(0, 300)}`);
      return null;
    }
    const data = JSON.parse(bodyText) as { download_url?: string; filename?: string; content_type?: string; size?: number };
    const result = toResult(data);
    if (result) console.log(`[resend] Retrieve-by-ID OK (fetch): filename=${data.filename}, size=${data.size}, hasUrl=${!!data.download_url}`);
    else console.warn(`[resend] Retrieve-by-ID: response missing download_url. Keys: ${Object.keys(data).join(", ")}`);
    return result;
  } catch (err) {
    console.warn("[resend] Get attachment error:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Fetch attachment list with download URLs from Resend (GET /emails/receiving/:id/attachments) */
export async function fetchAttachmentList(emailId: string): Promise<
  Array<{
    id: string;
    filename: string;
    content_type: string;
    size?: number;
    download_url?: string;
    expires_at?: string;
  }>
> {
  const url = `${RESEND_API_BASE}/emails/receiving/${emailId}/attachments`;
  console.log(`[resend] List: GET ${url}`);

  if (!getResendApiKey()) {
    console.warn("[resend] RESEND_API_KEY not configured - skipping List API");
    return [];
  }

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${getResendApiKey()}`,
        "User-Agent": "BidCatcher/1.0",
      },
    });

    const bodyText = await res.text();
    console.log(`[resend] GET /emails/receiving/:id/attachments (List) → ${res.status} ${res.statusText}, bodyLen=${bodyText.length}`);

    if (!res.ok) {
      let err: { message?: string } = {};
      try {
        if (bodyText) err = JSON.parse(bodyText) as { message?: string };
      } catch {
        /* ignore */
      }
      const msg = err?.message || res.statusText;
      console.warn(`[resend] List API error: ${res.status} - ${msg}. Body preview: ${bodyText.slice(0, 200)}`);
      return [];
    }

    const body = bodyText ? (JSON.parse(bodyText) as { data?: unknown[] }) : {};
    const list = body?.data ?? [];
    const items = (Array.isArray(list) ? list : []) as Array<{
      id: string;
      filename: string;
      content_type: string;
      size?: number;
      download_url?: string;
      expires_at?: string;
    }>;
    const hasUrls = items.filter((i) => i.download_url).length;
    console.log(`[resend] List API: ${items.length} items, ${hasUrls} with download_url. IDs: [${items.map((i) => i.id).join(", ")}]`);
    return items;
  } catch (err) {
    console.warn("[resend] List API error:", err instanceof Error ? err.message : err);
    return [];
  }
}

/** Download attachment content via URL, return base64 and size. Retries once on failure. */
export async function downloadAttachment(downloadUrl: string): Promise<{ base64: string; size: number } | null> {
  const attempt = async (withAuth: boolean): Promise<{ base64: string; size: number } | null> => {
    const headers: Record<string, string> = {
      "User-Agent": "BidCatcher/1.0",
      Accept: "*/*",
    };
    if (withAuth && getResendApiKey()) {
      headers["Authorization"] = `Bearer ${getResendApiKey()}`;
    }

    console.log(`[resend] Download: GET ${downloadUrl.slice(0, 100)}... (withAuth=${withAuth})`);

    const res = await fetch(downloadUrl, {
      headers,
      redirect: "follow",
    });

    console.log(`[resend] Download → ${res.status} ${res.statusText}`);

    if (!res.ok) {
      const bodyPreview = await res.text().then((t) => t.slice(0, 200));
      console.warn(
        `[resend] Download failed ${res.status} ${res.statusText} url=${downloadUrl.slice(0, 80)}... body=${bodyPreview}`
      );
      return null;
    }

    const buf = await res.arrayBuffer();
    const size = buf.byteLength;
    if (size === 0) {
      console.warn("[resend] Download returned empty body (0 bytes)");
      return null;
    }
    const base64 = Buffer.from(buf).toString("base64");
    console.log(`[resend] Downloaded ${size} bytes successfully`);
    return { base64, size };
  };

  try {
    // Resend docs use plain fetch(download_url) with no auth - try that first
    let result = await attempt(false);
    if (!result) {
      console.log("[resend] Download retry with Authorization header...");
      await new Promise((r) => setTimeout(r, 1500));
      result = await attempt(true);
    }
    return result;
  } catch (err) {
    console.warn("[resend] Download error:", err instanceof Error ? err.message : err);
    return null;
  }
}
