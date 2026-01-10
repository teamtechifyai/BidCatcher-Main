import { relations } from "drizzle-orm";
import { clients } from "./clients";
import { bids } from "./bids";
import { bidDocuments } from "./bid-documents";
import { extractedFields } from "./extracted-fields";
import { goNoGoDecisions, decisionOverrides } from "./decisions";
import { jobtreadHandoffs } from "./jobtread-handoffs";
import { incomingBidEmails } from "./incoming-emails";

/**
 * Drizzle Relations
 *
 * Defines relationships between tables for type-safe joins
 */

export const clientsRelations = relations(clients, ({ many }) => ({
  bids: many(bids),
}));

export const bidsRelations = relations(bids, ({ one, many }) => ({
  client: one(clients, {
    fields: [bids.clientId],
    references: [clients.id],
  }),
  documents: many(bidDocuments),
  extractedFields: many(extractedFields),
  decisions: many(goNoGoDecisions),
  overrides: many(decisionOverrides),
  jobtreadHandoffs: many(jobtreadHandoffs),
  incomingEmail: one(incomingBidEmails),
}));

export const bidDocumentsRelations = relations(bidDocuments, ({ one, many }) => ({
  bid: one(bids, {
    fields: [bidDocuments.bidId],
    references: [bids.id],
  }),
  extractedFields: many(extractedFields),
}));

export const extractedFieldsRelations = relations(extractedFields, ({ one }) => ({
  document: one(bidDocuments, {
    fields: [extractedFields.documentId],
    references: [bidDocuments.id],
  }),
  bid: one(bids, {
    fields: [extractedFields.bidId],
    references: [bids.id],
  }),
}));

export const goNoGoDecisionsRelations = relations(goNoGoDecisions, ({ one, many }) => ({
  bid: one(bids, {
    fields: [goNoGoDecisions.bidId],
    references: [bids.id],
  }),
  overrides: many(decisionOverrides),
}));

export const decisionOverridesRelations = relations(decisionOverrides, ({ one }) => ({
  decision: one(goNoGoDecisions, {
    fields: [decisionOverrides.decisionId],
    references: [goNoGoDecisions.id],
  }),
  bid: one(bids, {
    fields: [decisionOverrides.bidId],
    references: [bids.id],
  }),
}));

export const jobtreadHandoffsRelations = relations(jobtreadHandoffs, ({ one }) => ({
  bid: one(bids, {
    fields: [jobtreadHandoffs.bidId],
    references: [bids.id],
  }),
}));

export const incomingBidEmailsRelations = relations(incomingBidEmails, ({ one }) => ({
  bid: one(bids, {
    fields: [incomingBidEmails.bidId],
    references: [bids.id],
  }),
}));
