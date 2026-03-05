# Per-Client Intake Emails with Resend

This document explains how BidCatcher will implement per-client intake email addresses using [Resend's Receiving Emails](https://resend.com/docs/dashboard/receiving/introduction) feature.

---

## How Resend Receiving Works

Resend receives **all emails** sent to your receiving domain. You don't create individual addresses—you use a **single domain** and route by the **local part** (the part before `@`).

### Key Concepts

1. **Single domain, many addresses**
   - Resend domain: `cool-hedgehog.resend.app` (or your custom domain)
   - Any email to `anything@cool-hedgehog.resend.app` is received
   - Examples: `client-abc@domain.com`, `intake-xyz@domain.com`, `bids@domain.com`

2. **Webhook-only metadata**
   - The webhook sends **metadata only** (no body, no attachments)
   - You must call Resend's APIs to fetch:
     - [Retrieve Received Email](https://resend.com/docs/dashboard/receiving/get-email-content) → body (HTML/text), headers
     - [List Received Email Attachments](https://resend.com/docs/dashboard/receiving/attachments) → attachment metadata + `download_url` (valid 1 hour)

3. **Routing by `to` field**
   - The webhook event includes `data.to` (array of recipient addresses)
   - Parse the local part to determine which client received the email

---

## Per-Client Design

### Address format

Each client gets a unique intake address:

```
intake-{clientSlug}@{domain}
```

Examples:
- `intake-test-construction@bidcatcher.resend.app`
- `intake-acme-builders@bidcatcher.resend.app`

The `clientSlug` is unique per client (from `clients.slug`). When a client is created, we **assign** this address—we don't create it in Resend (Resend already receives all mail at the domain).

### Client schema changes

Add to `clients` table or `clients.config`:

| Field | Type | Description |
|-------|------|-------------|
| `intakeEmailAddress` | string | Full address, e.g. `intake-{slug}@domain.com` |
| `intakeEmailEnabled` | boolean | Whether email intake is enabled for this client |

### Flow

```
1. Client created → Compute intakeEmailAddress = intake-{slug}@{RESEND_RECEIVING_DOMAIN}
2. Display address in UI for client to forward bids to
3. Email arrives at Resend → Webhook POST to /incoming-emails/webhook/resend
4. Parse event.data.to → extract client slug from local part
5. Look up client by slug → resolve clientId
6. Fetch email body via Resend API
7. Fetch attachments via Resend API (download URLs)
8. Store in incoming_bid_emails (with clientId)
9. Process through pipeline (extraction, scoring, etc.)
```

---

## Resend Webhook Event Payload

From [Resend Receiving docs](https://resend.com/docs/dashboard/receiving/introduction):

```json
{
  "type": "email.received",
  "created_at": "2024-02-22T23:41:12.126Z",
  "data": {
    "email_id": "56761188-7520-42d8-8898-ff6fc54ce618",
    "created_at": "2024-02-22T23:41:11.894719+00:00",
    "from": "Acme <onboarding@resend.dev>",
    "to": ["intake-test-construction@bidcatcher.resend.app"],
    "bcc": [],
    "cc": [],
    "message_id": "<example+123>",
    "subject": "Bid Invitation - Hospital Project",
    "attachments": [
      {
        "id": "2a0c9ce0-3112-4728-976e-47ddcd16a318",
        "filename": "plans.pdf",
        "content_type": "application/pdf",
        "content_disposition": "inline",
        "content_id": "img001"
      }
    ]
  }
}
```

**Routing logic:** Parse `data.to[0]` → `intake-test-construction@...` → `intake-test-construction` → `clientSlug = "test-construction"` → lookup client.

---

## Implementation Steps

### 1. Resend setup (one-time)

1. **Get your receiving domain**
   - [Resend Dashboard](https://resend.com/emails) → Receiving tab → Receiving address
   - Or use Resend-managed: `{id}.resend.app`
   - Or [custom domain](https://resend.com/docs/dashboard/receiving/custom-domains.md)

2. **Configure webhook**
   - [Resend Webhooks](https://resend.com/webhooks) → Add Webhook
   - URL: `https://your-api-domain.com/incoming-emails/webhook/resend`
   - Event: `email.received`
   - Save the signing secret for verification

3. **Environment variables**
   ```
   RESEND_API_KEY=re_...
   RESEND_WEBHOOK_SECRET=whsec_...
   RESEND_RECEIVING_DOMAIN=bidcatcher.resend.app  # or your domain
   ```

### 2. Database changes

- Add `client_id` to `incoming_bid_emails` (nullable for now; required when Resend is used)
- Add `resend_email_id` to `incoming_bid_emails` (Resend's `email_id` for deduplication and API calls)
- Store `intakeEmailAddress` per client (computed or in config)

### 3. Client creation/update

- When creating a client: compute `intakeEmailAddress = intake-{slug}@{RESEND_RECEIVING_DOMAIN}`
- Store in `clients.config.intake.intakeEmailAddress` or new column
- Expose in UI (client detail, workspace config)

### 4. New webhook endpoint: `POST /incoming-emails/webhook/resend`

- Accept Resend's `email.received` payload (not Gmail format)
- Verify webhook signature (Svix headers: `svix-id`, `svix-timestamp`, `svix-signature`)
- Parse `data.to` → extract client slug → lookup client
- If no matching client: skip or store with `client_id = null` for manual assignment
- Call Resend API to fetch full email body
- Call Resend API to list attachments, then download each via `download_url`
- Store in `incoming_bid_emails` with `client_id`, `resend_email_id`, `body_text`, `body_html`, `attachments`
- Optionally: auto-process into bid if client is known (or keep as manual "Process" flow)

### 5. Resend API client

- Use `resend` npm package
- `resend.emails.receiving.get(emailId)` → body, headers
- `resend.emails.receiving.attachments.list({ emailId })` → list with `download_url`
- Fetch each attachment, store in object storage or as base64 for MVP

### 6. Webhook verification

- Use `resend.webhooks.verify()` or Svix library
- **Important:** Use raw request body for verification (string), not parsed JSON

---

## Differences from Gmail Integration

| Aspect | Gmail (current) | Resend (new) |
|--------|-----------------|--------------|
| Webhook payload | Custom format with full body | Metadata only; must fetch body/attachments |
| Client routing | Manual (user selects client when processing) | Automatic via `to` address |
| Deduplication | `gmailMessageId` | `resend_email_id` |
| Attachments | In payload or Gmail API | Fetch via Resend Attachments API |
| Setup | Google Apps Script + forwarding | Resend domain + webhook |

---

## Current vs new flow

**Current (Gmail):**
- Single Gmail inbox → all emails → manual client selection when processing

**New (Resend):**
- Per-client address → email arrives → client known from `to` → can auto-process or store for review

---

## Optional: Keep both

- **Gmail webhook** (`/webhook`) → for legacy or single-inbox setup; no client routing
- **Resend webhook** (`/webhook/resend`) → per-client routing; auto-assign client

Both can write to `incoming_bid_emails`. Use `intake_source` or `raw_email_data.source` to distinguish.

---

## Files to create/modify

1. **Schema:** `incoming_bid_emails` + `client_id`, `resend_email_id`
2. **Schema:** `clients.config.intake.intakeEmailAddress`
3. **Service:** `resend-incoming.ts` – fetch email, fetch attachments, parse client from `to`
4. **Routes:** `POST /incoming-emails/webhook/resend` – verify, parse, store
5. **Client UI:** Show intake email per client/workspace
6. **Env:** `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `RESEND_RECEIVING_DOMAIN`

---

## References

- [Resend Receiving Introduction](https://resend.com/docs/dashboard/receiving/introduction)
- [Get Email Content](https://resend.com/docs/dashboard/receiving/get-email-content)
- [Process Attachments](https://resend.com/docs/dashboard/receiving/attachments)
- [Verify Webhooks](https://resend.com/docs/webhooks/verify-webhooks-requests)
