# Resend Setup Guide for BidCatcher

This guide walks you through setting up Resend for per-client email intake in BidCatcher.

---

## Prerequisites

- A [Resend](https://resend.com) account
- Your BidCatcher API deployed and accessible via HTTPS (for webhook)

---

## Step 1: Get Your Receiving Domain

1. Go to [Resend Dashboard](https://resend.com/emails)
2. Click the **Receiving** tab
3. Click the three dots (⋮) and select **Receiving address**
4. Copy your receiving domain (e.g. `abc123.resend.app` or your custom domain)

**Custom domain (optional):**  
To use your own domain (e.g. `bids.yourcompany.com`), follow [Resend's custom domain guide](https://resend.com/docs/dashboard/receiving/custom-domains).

---

## Step 2: Create a Webhook

1. Go to [Resend Webhooks](https://resend.com/webhooks)
2. Click **Add Webhook**
3. **Endpoint URL:**  
   `https://your-api-domain.com/incoming-emails/webhook/resend`  
   (Replace with your actual API URL, e.g. `https://bidcatcher-api.railway.app/incoming-emails/webhook/resend`)
4. **Event:** Select `email.received`
5. Click **Add**
6. **Copy the Signing Secret** (starts with `whsec_`) – you'll need it for env vars

---

## Step 3: Get Your API Key

1. Go to [Resend API Keys](https://resend.com/api-keys)
2. Create a new API key (or use an existing one)
3. Copy the key (starts with `re_`)

---

## Step 4: Environment Variables

Add these to your **API service** (e.g. Railway, `.env`):

```env
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxx
RESEND_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxxxxx
RESEND_RECEIVING_DOMAIN=abc123.resend.app
```

| Variable | Description |
|----------|-------------|
| `RESEND_API_KEY` | Required. Resend API key for fetching email content and attachments |
| `RESEND_WEBHOOK_SECRET` | Recommended. Verifies webhook requests (Svix signature) |
| `RESEND_RECEIVING_DOMAIN` | Required. Must match the domain in intake addresses (e.g. `intake.bidcatcher.app`). Used to parse client from `to` address. |

---

## Step 5: Database Migration

Run the migration to add Resend columns and remove Gmail columns:

```bash
# From project root - run the SQL in your database (Supabase SQL editor or psql)
```

Execute the contents of `packages/db/migration-resend-incoming.sql` in your database.

---

## How It Works

### Per-Client Intake Addresses

Each client gets a unique address:

```
intake-{client-slug}@{your-domain}
```

Examples:
- Client slug `test-construction` → `intake-test-construction@abc123.resend.app`
- Client slug `acme-builders` → `intake-acme-builders@abc123.resend.app`

### Flow

1. User forwards a bid email to `intake-test-construction@abc123.resend.app`
2. Resend receives it and sends a webhook to your API
3. Your API verifies the signature, fetches full content from Resend, parses the client from the `to` address
4. Email is stored with `client_id` set; appears in Incoming Bids
5. User can Process to Bid (client pre-selected) or Skip

### Subject Filter

Only emails with **"Bid"** in the subject (case-insensitive) are stored. Others are skipped.

---

## Local Development (ngrok)

To test webhooks locally:

1. Install [ngrok](https://ngrok.com/download)
2. Run: `ngrok http 3000` (or your API port)
3. Use the ngrok URL in Resend: `https://xxxx.ngrok.io/incoming-emails/webhook/resend`
4. Ensure `RESEND_WEBHOOK_SECRET` is set so verification works

---

## Troubleshooting

| Issue | Check |
|-------|-------|
| Webhook returns 401 | `RESEND_WEBHOOK_SECRET` matches the secret in Resend Dashboard |
| Emails not stored | Subject must contain "Bid"; check API logs |
| Client not routed | `RESEND_RECEIVING_DOMAIN` must match your Resend domain; address must be `intake-{slug}@domain` |
| Attachments missing | `RESEND_API_KEY` must be set; Resend fetches attachments via API |

---

## References

- [Resend Receiving Introduction](https://resend.com/docs/dashboard/receiving/introduction)
- [Resend Webhooks](https://resend.com/webhooks)
- [Verify Webhooks](https://resend.com/docs/webhooks/verify-webhooks-requests)
