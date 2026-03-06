/**
 * Intake Service
 *
 * Business logic for processing incoming bid submissions.
 * Handles validation, persistence, and client config enforcement.
 * 
 * IMPORTANT: This service MUST populate:
 * - bids table
 * - bid_documents table  
 * - extracted_fields table
 */

import type { WebIntakeRequest, EmailIntakeRequest, ClientConfig, StartProcessingRequest } from "@bid-catcher/config";
import { BID_STATUS, INTAKE_SOURCE } from "@bid-catcher/config";
import { getDb, bids, bidDocuments, extractedFields, clients, eq, and } from "@bid-catcher/db";
import { syncBidToGhl } from "./ghl-sync.js";

// ----- Types -----

interface ValidationWarning {
  field: string;
  message: string;
  severity: "warning" | "info";
}

interface IntakeResult {
  bidId: string;
  status: string;
  documentCount: number;
  extractedFieldCount: number;
  validationWarnings: ValidationWarning[];
  message: string;
}

// ----- Helper Functions -----

async function getClientConfig(clientId: string): Promise<ClientConfig | null> {
  const db = getDb();
  const result = await db
    .select({ config: clients.config })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);

  if (result.length === 0 || !result[0].config) {
    return null;
  }

  return result[0].config as ClientConfig;
}

interface IntakeFieldConfig {
  key: string;
  label: string;
  type: string;
  required: boolean;
  options?: string[];
}

function validateIntakeFields(
  data: Record<string, unknown>,
  intakeFields: IntakeFieldConfig[] | undefined,
  legacyRequiredFields: string[] | undefined
): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  if (intakeFields && intakeFields.length > 0) {
    for (const field of intakeFields) {
      if (field.required) {
        const value = data[field.key];
        if (value === undefined || value === null || value === "") {
          warnings.push({
            field: field.key,
            message: `Required field '${field.label}' is missing or empty`,
            severity: "warning",
          });
        }
      }
    }
  } else if (legacyRequiredFields) {
    for (const fieldKey of legacyRequiredFields) {
      const value = data[fieldKey];
      if (value === undefined || value === null || value === "") {
        warnings.push({
          field: fieldKey,
          message: `Required field '${fieldKey}' is missing or empty`,
          severity: "warning",
        });
      }
    }
  }

  return warnings;
}

function generateContentHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(16, "0");
}

// ----- Intake Service -----

export const intakeService = {
  /**
   * Start a processing bid - creates minimal bid record visible in queue during extraction.
   * Call this when extraction begins; complete with processWebIntake (pass processingBidId).
   */
  async startProcessingBid(data: StartProcessingRequest, requestId: string): Promise<{ bidId: string }> {
    const db = getDb();

    // Verify client exists
    const clientExists = await db
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.id, data.clientId))
      .limit(1);

    if (clientExists.length === 0) {
      throw new Error(`Client with ID ${data.clientId} not found`);
    }

    const projectName = data.projectName?.trim() || (data.filenames?.[0] ? `${data.filenames[0]}...` : null) || "Processing...";

    const [newBid] = await db
      .insert(bids)
      .values({
        clientId: data.clientId,
        intakeSource: INTAKE_SOURCE.WEB,
        status: BID_STATUS.PROCESSING,
        projectName: projectName.substring(0, 500),
        senderEmail: "processing@bidcatcher.local",
        rawPayload: { startProcessing: true, filenames: data.filenames || [] },
      })
      .returning({ id: bids.id });

    console.log(`[${requestId}] ✓ Processing bid created: ${newBid.id}`);
    return { bidId: newBid.id };
  },

  /**
   * Process a web form submission
   * 
   * IMPORTANT: This MUST insert into:
   * 1. bids table
   * 2. bid_documents table (for each document/filename)
   * 3. extracted_fields table (for each extracted field)
   */
  async processWebIntake(
    data: WebIntakeRequest,
    requestId: string
  ): Promise<IntakeResult> {
    const db = getDb();
    const validationWarnings: ValidationWarning[] = [];

    console.log(`\n========== [${requestId}] INTAKE START ==========`);
    console.log(`[${requestId}] Client ID: ${data.clientId}`);
    console.log(`[${requestId}] Project: ${data.projectName}`);
    console.log(`[${requestId}] Extracted Fields Count: ${data.extractedFields?.length || 0}`);
    console.log(`[${requestId}] Document Metadata Filenames: ${data.documentMetadata?.filenames?.length || 0}`);

    // 1. Verify client exists and get config
    const clientConfig = await getClientConfig(data.clientId);
    if (!clientConfig) {
      const clientExists = await db
        .select({ id: clients.id })
        .from(clients)
        .where(eq(clients.id, data.clientId))
        .limit(1);

      if (clientExists.length === 0) {
        throw new Error(`Client with ID ${data.clientId} not found`);
      }
    }

    // 2. Validate fields
    const intakeFields = clientConfig?.intake?.intakeFields;
    const legacyRequiredFields = clientConfig?.intake?.requiredFields || ["projectName", "senderEmail"];
    
    const validationData: Record<string, unknown> = {
      projectName: data.projectName,
      senderEmail: data.senderEmail,
      senderName: data.senderName,
      senderCompany: data.senderCompany,
      notes: data.notes,
      ...(data as unknown as Record<string, unknown>),
    };
    
    const fieldWarnings = validateIntakeFields(validationData, intakeFields, legacyRequiredFields);
    validationWarnings.push(...fieldWarnings);

    // 3. INSERT or UPDATE bid
    const rawPayload: Record<string, unknown> = {
      ...data,
      customFields: data.customFields || {},
      confidenceScores: data.confidenceScores || {},
      documentMetadata: data.documentMetadata || null,
    };

    const processingBidId = (data as WebIntakeRequest & { processingBidId?: string }).processingBidId;
    let newBidId: string;

    if (processingBidId) {
      // Update existing processing bid
      console.log(`[${requestId}] Step 1: Updating processing bid ${processingBidId}...`);
      const [updated] = await db
        .update(bids)
        .set({
          status: BID_STATUS.NEW,
          projectName: data.projectName || null,
          senderEmail: data.senderEmail,
          senderName: data.senderName || null,
          senderCompany: data.senderCompany || null,
          rawPayload: rawPayload,
          validationWarnings: validationWarnings.length > 0 ? validationWarnings : null,
          updatedAt: new Date(),
        })
        .where(and(eq(bids.id, processingBidId), eq(bids.status, BID_STATUS.PROCESSING)))
        .returning({ id: bids.id });

      if (!updated) {
        throw new Error(`Processing bid ${processingBidId} not found or already completed`);
      }
      newBidId = updated.id;
      console.log(`[${requestId}] ✓ Bid updated: ${newBidId}`);
    } else {
      // Create new bid
      console.log(`[${requestId}] Step 1: Creating bid record...`);
      try {
        const [newBid] = await db
          .insert(bids)
          .values({
            clientId: data.clientId,
            intakeSource: INTAKE_SOURCE.WEB,
            status: BID_STATUS.NEW,
            projectName: data.projectName || null,
            senderEmail: data.senderEmail,
            senderName: data.senderName || null,
            senderCompany: data.senderCompany || null,
            rawPayload: rawPayload,
            validationWarnings: validationWarnings.length > 0 ? validationWarnings : null,
          })
          .returning({ id: bids.id });

        newBidId = newBid.id;
        console.log(`[${requestId}] ✓ Bid created: ${newBidId}`);
      } catch (err) {
        console.error(`[${requestId}] ✗ Failed to create bid:`, err);
        throw new Error(`Failed to create bid: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    // 4. INSERT INTO bid_documents
    console.log(`[${requestId}] Step 2: Creating document records...`);
    let documentCount = 0;
    const createdDocumentIds: string[] = [];

    // Collect all filenames to create documents for
    const filenamesToCreate: string[] = [];
    
    if (data.documents && data.documents.length > 0) {
      // If actual documents were uploaded
      for (const doc of data.documents) {
        filenamesToCreate.push(doc.filename);
      }
    } else if (data.documentMetadata?.filenames && data.documentMetadata.filenames.length > 0) {
      // If only metadata (from client-side extraction)
      filenamesToCreate.push(...data.documentMetadata.filenames);
    } else if (data.extractedFields && data.extractedFields.length > 0) {
      // If we have extracted fields but no filenames, create a placeholder
      filenamesToCreate.push('uploaded_documents.pdf');
    }

    console.log(`[${requestId}] Creating ${filenamesToCreate.length} document records...`);

    for (const filename of filenamesToCreate) {
      try {
        const [newDoc] = await db.insert(bidDocuments).values({
          bidId: newBidId,
          filename: filename.substring(0, 500), // Limit to schema max length
          contentType: 'application/pdf',
          sizeBytes: null,
          documentType: "bid_invitation",
          processingStatus: "completed",
          storagePath: null,
        }).returning({ id: bidDocuments.id });
        
        createdDocumentIds.push(newDoc.id);
        documentCount++;
        console.log(`[${requestId}] ✓ Document created: ${newDoc.id} (${filename.substring(0, 50)}...)`);
      } catch (docErr) {
        console.error(`[${requestId}] ✗ Failed to create document for ${filename}:`, docErr);
        // Continue with other documents
      }
    }

    console.log(`[${requestId}] Total documents created: ${documentCount}`);

    // 5. INSERT INTO extracted_fields
    console.log(`[${requestId}] Step 3: Storing extracted fields...`);
    let extractedFieldCount = 0;

    if (data.extractedFields && data.extractedFields.length > 0) {
      // Use first document ID as the primary document
      const primaryDocumentId = createdDocumentIds[0];
      
      if (!primaryDocumentId) {
        console.error(`[${requestId}] ✗ No document ID available to link extracted fields`);
      } else {
        console.log(`[${requestId}] Linking ${data.extractedFields.length} fields to document ${primaryDocumentId}`);
        
        for (const field of data.extractedFields) {
          try {
            // Convert value to string
            let valueStr: string | null = null;
            if (field.extractedValue !== null && field.extractedValue !== undefined) {
              valueStr = typeof field.extractedValue === 'string' 
                ? field.extractedValue 
                : JSON.stringify(field.extractedValue);
            }

            // Normalize confidence - it might be a number, string, or undefined
            let confidenceNum = 0.5;
            if (field.confidence !== undefined && field.confidence !== null) {
              const parsed = typeof field.confidence === 'number' 
                ? field.confidence 
                : parseFloat(String(field.confidence));
              if (!isNaN(parsed)) {
                // Normalize to 0-1 range (in case it's a percentage)
                confidenceNum = parsed > 1 ? parsed / 100 : parsed;
                confidenceNum = Math.max(0, Math.min(1, confidenceNum)); // Clamp to 0-1
              }
            }

            await db.insert(extractedFields).values({
              bidId: newBidId,
              documentId: primaryDocumentId,
              signalId: field.fieldKey.substring(0, 100), // Limit to schema max
              extractedValue: valueStr,
              rawValue: valueStr,
              confidence: confidenceNum,
              extractionMethod: data.documentMetadata?.extractionMethod || 'ai',
              extractionVersion: 1,
            });
            
            extractedFieldCount++;
            console.log(`[${requestId}] ✓ Stored field: ${field.fieldKey} (confidence: ${confidenceNum})`);
          } catch (fieldErr) {
            // Likely a duplicate - try with incremented version
            try {
              // Normalize confidence again
              let confidenceNum = 0.5;
              if (field.confidence !== undefined && field.confidence !== null) {
                const parsed = typeof field.confidence === 'number' 
                  ? field.confidence 
                  : parseFloat(String(field.confidence));
                if (!isNaN(parsed)) {
                  confidenceNum = parsed > 1 ? parsed / 100 : parsed;
                  confidenceNum = Math.max(0, Math.min(1, confidenceNum));
                }
              }

              await db.insert(extractedFields).values({
                bidId: newBidId,
                documentId: primaryDocumentId,
                signalId: field.fieldKey.substring(0, 100),
                extractedValue: typeof field.extractedValue === 'string' 
                  ? field.extractedValue 
                  : JSON.stringify(field.extractedValue),
                rawValue: typeof field.extractedValue === 'string' 
                  ? field.extractedValue 
                  : JSON.stringify(field.extractedValue),
                confidence: confidenceNum,
                extractionMethod: data.documentMetadata?.extractionMethod || 'ai',
                extractionVersion: 2,
              });
              extractedFieldCount++;
            } catch (retryErr) {
              console.warn(`[${requestId}] Could not store field ${field.fieldKey}: ${retryErr}`);
            }
          }
        }
        
        console.log(`[${requestId}] ✓ Extracted fields stored: ${extractedFieldCount}/${data.extractedFields.length}`);
      }
    } else {
      console.log(`[${requestId}] No extracted fields to store`);
    }

    // Sync bid to GHL (non-blocking)
    const clientForGhl = await db
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
      .where(eq(clients.id, data.clientId))
      .limit(1);
    if (clientForGhl[0]) {
      const bidRow = await db.select().from(bids).where(eq(bids.id, newBidId)).limit(1);
      if (bidRow[0]) {
        syncBidToGhl(
          {
            id: bidRow[0].id,
            clientId: bidRow[0].clientId,
            projectName: bidRow[0].projectName,
            status: bidRow[0].status,
            senderEmail: bidRow[0].senderEmail,
            senderName: bidRow[0].senderName,
            senderCompany: bidRow[0].senderCompany,
            ghlOpportunityId: bidRow[0].ghlOpportunityId,
          },
          clientForGhl[0]
        ).catch((err) => console.warn(`[${requestId}] GHL sync failed:`, err));
      }
    }

    console.log(`\n========== [${requestId}] INTAKE COMPLETE ==========`);
    console.log(`[${requestId}] Bid ID: ${newBidId}`);
    console.log(`[${requestId}] Documents: ${documentCount}`);
    console.log(`[${requestId}] Extracted Fields: ${extractedFieldCount}`);
    console.log(`=================================================\n`);

    return {
      bidId: newBidId,
      status: BID_STATUS.NEW,
      documentCount,
      extractedFieldCount,
      validationWarnings,
      message: `Bid created with ${documentCount} documents and ${extractedFieldCount} extracted fields`,
    };
  },

  /**
   * Process an email webhook submission
   */
  async processEmailIntake(
    data: EmailIntakeRequest,
    requestId: string
  ): Promise<IntakeResult> {
    const db = getDb();
    const validationWarnings: ValidationWarning[] = [];

    // 1. Verify client exists
    const clientConfig = await getClientConfig(data.clientId);
    if (!clientConfig) {
      const clientExists = await db
        .select({ id: clients.id })
        .from(clients)
        .where(eq(clients.id, data.clientId))
        .limit(1);

      if (clientExists.length === 0) {
        throw new Error(`Client with ID ${data.clientId} not found`);
      }
    }

    // 2. Check for duplicate emails
    const messageId = data.headers?.["message-id"] || data.headers?.["Message-ID"];
    if (messageId) {
      const existing = await db
        .select({ id: bids.id })
        .from(bids)
        .where(eq(bids.externalRef, messageId))
        .limit(1);

      if (existing.length > 0) {
        return {
          bidId: existing[0].id,
          status: BID_STATUS.NEW,
          documentCount: 0,
          extractedFieldCount: 0,
          validationWarnings: [],
          message: "Duplicate email detected - returning existing bid",
        };
      }
    }

    // 3. Validate fields
    const intakeFields = clientConfig?.intake?.intakeFields;
    const legacyRequiredFields = clientConfig?.intake?.requiredFields || ["projectName", "senderEmail"];
    
    const mappedData: Record<string, unknown> = {
      projectName: data.subject,
      senderEmail: data.fromEmail,
      senderName: data.fromName,
      senderCompany: undefined,
    };
    
    const fieldWarnings = validateIntakeFields(mappedData, intakeFields, legacyRequiredFields);
    validationWarnings.push(...fieldWarnings);

    // 4. Create bid record
    const [newBid] = await db
      .insert(bids)
      .values({
        clientId: data.clientId,
        intakeSource: INTAKE_SOURCE.EMAIL,
        status: BID_STATUS.NEW,
        projectName: data.subject || null,
        senderEmail: data.fromEmail,
        senderName: data.fromName || null,
        emailSubject: data.subject,
        emailBody: data.bodyText || data.bodyHtml || null,
        rawPayload: data as unknown as Record<string, unknown>,
        externalRef: messageId || null,
        validationWarnings: validationWarnings.length > 0 ? validationWarnings : null,
        receivedAt: new Date(data.receivedAt),
      })
      .returning({ id: bids.id });

    console.log(`[${requestId}] Created bid ${newBid.id} from email intake`);

    // Sync bid to GHL (non-blocking)
    const clientForGhl = await db
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
      .where(eq(clients.id, data.clientId))
      .limit(1);
    if (clientForGhl[0]) {
      syncBidToGhl(
        {
          id: newBid.id,
          clientId: data.clientId,
          projectName: data.subject || null,
          status: BID_STATUS.NEW,
          senderEmail: data.fromEmail,
          senderName: data.fromName ?? null,
          senderCompany: null,
          ghlOpportunityId: null,
        },
        clientForGhl[0]
      ).catch((err) => console.warn(`[${requestId}] GHL sync failed:`, err));
    }

    // 5. Create document records for attachments
    let documentCount = 0;
    if (data.attachments && data.attachments.length > 0) {
      for (const attachment of data.attachments) {
        await db.insert(bidDocuments).values({
          bidId: newBid.id,
          filename: attachment.filename,
          contentType: attachment.contentType,
          sizeBytes: attachment.size,
          documentType: "bid_invitation",
          processingStatus: "pending",
          contentHash: generateContentHash(attachment.content),
        });
        documentCount++;
      }
      console.log(`[${requestId}] Created ${documentCount} document records for bid ${newBid.id}`);
    }

    return {
      bidId: newBid.id,
      status: BID_STATUS.NEW,
      documentCount,
      extractedFieldCount: 0,
      validationWarnings,
      message: validationWarnings.length > 0
        ? `Bid created with ${validationWarnings.length} validation warning(s)`
        : "Bid created successfully",
    };
  },
};
