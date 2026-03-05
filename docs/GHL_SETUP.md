# GoHighLevel (GHL) Setup Guide for BidCatcher

This guide walks you through setting up GoHighLevel integration. **One-way sync** (BidCatcher → GHL) works out of the box once configured.

---

## Quick Start: One-Way Sync (BidCatcher → GHL)

1. Add `GHL_API_TOKEN` and `GHL_LOCATION_ID` to `.env`
2. Add `GHL_PIPELINE_ID` and `GHL_PIPELINE_STAGE_ID` (get these from GHL Opportunities → Pipelines)
3. Run the migration: `packages/db/migration-ghl.sql`
4. Restart the API

**Result:** When you create a client in BidCatcher, it appears as a Contact in GHL. When you create a bid for that client, an Opportunity is created and linked to that Contact.

---

## Prerequisites

- A GoHighLevel account (single location/sub-account)
- Private Integration Token (no marketplace/OAuth required)
- BidCatcher API deployed and accessible via HTTPS (for webhooks)

---

## Step 1: Get Your Location ID

1. Log into GoHighLevel
2. The Location ID is in the URL when viewing your location: `https://app.gohighlevel.com/v2/location/{locationId}/...`
3. Or go to **Settings → Business Info** and copy the Location ID

---

## Step 2: Create a Private Integration Token

1. Go to **Settings → API Keys** (or **Integrations → API**)
2. Create a **Private Integration** token
3. Select scopes: `contacts.readonly`, `contacts.write`, `opportunities.readonly`, `opportunities.write`, `locations.readonly`
4. Copy the token (store securely; it cannot be retrieved later)

---

## Step 3: Environment Variables

Add these to your **API service** (e.g. `.env`):

```env
GHL_API_TOKEN=your_private_integration_token
GHL_LOCATION_ID=your_location_id

# Required for creating Opportunities (bids → GHL)
GHL_PIPELINE_ID=your_pipeline_id
GHL_PIPELINE_STAGE_ID=your_stage_id
```

| Variable | Description |
|----------|-------------|
| `GHL_API_TOKEN` | Required. Private Integration Token from GHL |
| `GHL_LOCATION_ID` | Required. GHL location/sub-account ID |
| `GHL_PIPELINE_ID` | Required for bids. Your GHL pipeline ID (Sales Pipeline) |
| `GHL_PIPELINE_STAGE_ID` | Required for bids. A stage ID from that pipeline (e.g. "New" or "Lead") |
| `GHL_CUSTOM_FIELD_CLIENT_ID` | Optional. GHL custom field ID for storing BidCatcher client ID (for webhook lookups) |
| `GHL_CUSTOM_FIELD_BID_ID` | Optional. GHL custom field ID for storing BidCatcher bid ID |

**Finding Pipeline and Stage IDs:** Call `GET /ghl/pipelines` (e.g. `http://localhost:3000/ghl/pipelines`) after configuring your token and location. It returns all pipelines and their stages with IDs. Copy a pipeline ID and a stage ID into your `.env`.

---

## Step 4: Database Migration

Run the GHL migration:

```bash
# Execute the contents of packages/db/migration-ghl.sql in your database
```

---

## Step 5: Enable GHL per Client

1. Edit a client's configuration (via API or Settings)
2. Add `ghl: { enabled: true }` to the config
3. Optionally add `pipelineId` and `stageMapping` for pipeline/stage mapping

Example config:

```json
{
  "ghl": {
    "enabled": true,
    "pipelineId": "your_pipeline_id",
    "stageMapping": {
      "new": "stage_id_for_new",
      "in_review": "stage_id_for_review",
      "qualified": "stage_id_for_qualified",
      "rejected": "stage_id_for_rejected"
    }
  }
}
```

---

## Step 6: Configure GHL Webhooks (Bi-directional Sync)

For GHL → BidCatcher sync, you need to send events to BidCatcher when contacts or opportunities change. There are two approaches:

### Option A: Workflows + Custom Webhook (No Marketplace Required)

Create workflows that trigger on contact/opportunity events and send data to BidCatcher via Custom Webhook.

**Your webhook URL:** `https://your-api-domain.com/ghl/webhook`  
(Replace with your actual API URL, e.g. `https://your-tunnel.ngrok.io/ghl/webhook` for local testing)

#### 1. Contact Created Workflow

1. Go to **Automation → Workflows**
2. Click **Create Workflow**
3. **Trigger:** Contact Created
4. **Action:** Add Action → **Custom Webhook**
5. Configure:
   - **URL:** `https://your-api-domain.com/ghl/webhook`
   - **Method:** POST
   - **Content-Type:** application/json
   - **Body** (raw JSON):

```json
{
  "type": "ContactCreate",
  "locationId": "{{location.id}}",
  "id": "{{contact.id}}",
  "companyName": "{{contact.company_name}}",
  "name": "{{contact.name}}",
  "firstName": "{{contact.first_name}}",
  "lastName": "{{contact.last_name}}",
  "email": "{{contact.email}}",
  "phone": "{{contact.phone}}"
}
```

6. Save and activate the workflow

#### 2. Contact Updated Workflow

Same as above, but:
- **Trigger:** Contact Updated
- **Body:** Use `"type": "ContactUpdate"` and the same field mapping

#### 3. Contact Deleted Workflow

- **Trigger:** Contact Deleted
- **Body:**

```json
{
  "type": "ContactDelete",
  "locationId": "{{location.id}}",
  "id": "{{contact.id}}"
}
```

#### 4. Opportunity Created Workflow

- **Trigger:** Opportunity Created
- **Body:**

```json
{
  "type": "OpportunityCreate",
  "locationId": "{{location.id}}",
  "id": "{{opportunity.id}}",
  "contactId": "{{opportunity.contact_id}}",
  "name": "{{opportunity.name}}",
  "status": "{{opportunity.status}}"
}
```

#### 5. Opportunity Updated / Stage Updated Workflow

- **Trigger:** Opportunity Updated (or Opportunity Stage Updated, if available)
- **Body:** Use `"type": "OpportunityUpdate"` with the same fields

#### 6. Opportunity Deleted Workflow

- **Trigger:** Opportunity Deleted (if available)
- **Body:**

```json
{
  "type": "OpportunityDelete",
  "locationId": "{{location.id}}",
  "id": "{{opportunity.id}}"
}
```

**Note:** GHL workflow variable names may differ (e.g. `{{contact.id}}` vs `{{contact_id}}`). Use the autocomplete in the Custom Webhook editor to pick the correct variables for your GHL version.

### Option B: Marketplace OAuth App (If You Have Access)

If you have a GHL Marketplace app:

1. Go to your app's **Advanced Settings → Webhooks**
2. Add your webhook URL: `https://your-api-domain.com/ghl/webhook`
3. Enable events: ContactCreate, ContactUpdate, ContactDelete, OpportunityCreate, OpportunityUpdate, OpportunityStageUpdate, OpportunityDelete

---

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/ghl/status` | Check GHL configuration |
| POST | `/ghl/webhook` | Receive GHL webhooks |
| POST | `/ghl/sync-client/:clientId` | Manual sync: client → GHL Contact |
| POST | `/ghl/sync-bid/:bidId` | Manual sync: bid → GHL Opportunity |

---

## Data Mapping

| BidCatcher | GHL |
|------------|-----|
| Client | Contact (companyName, email, phone) |
| Bid | Opportunity (linked to Contact) |

---

## Troubleshooting

- **GHL sync not running:** Ensure `ghl.enabled` is true in client config
- **401 Unauthorized:** Check `GHL_API_TOKEN` is valid and not expired
- **Webhook not updating:** Verify `GHL_LOCATION_ID` matches webhook payload's `locationId`
