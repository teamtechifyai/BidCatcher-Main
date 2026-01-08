/**
 * Health Check Routes
 *
 * Provides health status for monitoring and load balancers.
 */

import type { FastifyInstance } from "fastify";
import { getDb, sql, extractedFields, goNoGoDecisions, bidDocuments, bids, eq } from "@bid-catcher/db";

interface HealthResponse {
  status: "healthy" | "degraded" | "unhealthy";
  version: string;
  timestamp: string;
  uptime: number;
  checks: {
    database: "ok" | "error";
  };
}

export async function healthRoutes(server: FastifyInstance): Promise<void> {
  /**
   * GET /health
   *
   * Returns the health status of the API service.
   */
  server.get<{ Reply: HealthResponse }>("/health", async (_request, reply) => {
    // TODO: Add actual database health check
    const dbStatus: "ok" | "error" = "ok";

    const response: HealthResponse = {
      status: dbStatus === "ok" ? "healthy" : "degraded",
      version: process.env.npm_package_version || "0.1.0",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks: {
        database: dbStatus,
      },
    };

    reply.status(200).send(response);
  });

  /**
   * GET /health/ready
   *
   * Kubernetes-style readiness probe.
   * Returns 200 if the service is ready to accept traffic.
   */
  server.get("/health/ready", async (_request, reply) => {
    // TODO: Check if database is connected and migrations are applied
    reply.status(200).send({ ready: true });
  });

  /**
   * GET /health/live
   *
   * Kubernetes-style liveness probe.
   * Returns 200 if the service is alive.
   */
  server.get("/health/live", async (_request, reply) => {
    reply.status(200).send({ alive: true });
  });

  /**
   * POST /health/migrate
   *
   * Run pending database migrations.
   * For development/admin use only.
   */
  server.post("/health/migrate", async (request, reply) => {
    try {
      const db = getDb();

      // Run migrations for AI evaluation columns
      await db.execute(sql`
        ALTER TABLE go_no_go_decisions 
        ADD COLUMN IF NOT EXISTS evaluation_method VARCHAR(20)
      `);
      
      await db.execute(sql`
        ALTER TABLE go_no_go_decisions 
        ADD COLUMN IF NOT EXISTS ai_evaluation JSONB
      `);

      await db.execute(sql`
        ALTER TABLE bid_documents 
        ADD COLUMN IF NOT EXISTS content TEXT
      `);

      request.log.info("Database migrations completed successfully");

      reply.status(200).send({
        success: true,
        message: "Migrations completed successfully",
        migrations: [
          "Added evaluation_method column to go_no_go_decisions",
          "Added ai_evaluation column to go_no_go_decisions",
          "Added content column to bid_documents",
        ],
      });
    } catch (error) {
      request.log.error(error, "Migration failed");
      reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : "Migration failed",
      });
    }
  });

  /**
   * POST /health/test-db-writes
   *
   * Test database writes to all tables for a given bid.
   * For debugging database connectivity issues.
   */
  server.post<{ Body: { bidId: string } }>("/health/test-db-writes", async (request, reply) => {
    const { bidId } = request.body;
    
    if (!bidId) {
      return reply.status(400).send({ success: false, error: "bidId is required" });
    }

    const db = getDb();
    const results: Record<string, unknown> = {};

    try {
      // 1. Check if bid exists
      const bidCheck = await db.select({ id: bids.id }).from(bids).where(eq(bids.id, bidId)).limit(1);
      results.bidExists = bidCheck.length > 0;
      
      if (!results.bidExists) {
        return reply.status(404).send({ success: false, error: "Bid not found", bidId });
      }

      // 2. Test bid_documents insert
      try {
        const [doc] = await db.insert(bidDocuments).values({
          bidId,
          filename: '_test_document.pdf',
          contentType: 'application/pdf',
          documentType: 'other',
          processingStatus: 'completed',
        }).returning({ id: bidDocuments.id });
        results.bidDocumentsInsert = { success: true, id: doc.id };

        // 3. Test extracted_fields insert (requires document)
        try {
          const [field] = await db.insert(extractedFields).values({
            bidId,
            documentId: doc.id,
            signalId: '_test_field',
            extractedValue: 'test_value',
            confidence: 0.99,
            extractionMethod: 'test',
          }).returning({ id: extractedFields.id });
          results.extractedFieldsInsert = { success: true, id: field.id };
          
          // Clean up test field
          await db.delete(extractedFields).where(eq(extractedFields.id, field.id));
          results.extractedFieldsDelete = { success: true };
        } catch (fieldErr) {
          results.extractedFieldsInsert = { success: false, error: String(fieldErr) };
        }

        // Clean up test document
        await db.delete(bidDocuments).where(eq(bidDocuments.id, doc.id));
        results.bidDocumentsDelete = { success: true };
      } catch (docErr) {
        results.bidDocumentsInsert = { success: false, error: String(docErr) };
      }

      // 4. Test go_no_go_decisions insert
      try {
        const [decision] = await db.insert(goNoGoDecisions).values({
          bidId,
          outcome: 'MAYBE',
          totalScore: 50,
          maxScore: 100,
          scorePercentage: 50,
          scoreBreakdown: [],
          inputsSnapshot: {},
          thresholdsUsed: {},
          rationale: 'Test decision',
          evaluationMethod: 'test',
          decisionVersion: 999, // Use high version to not conflict
        }).returning({ id: goNoGoDecisions.id });
        results.goNoGoDecisionsInsert = { success: true, id: decision.id };
        
        // Clean up test decision
        await db.delete(goNoGoDecisions).where(eq(goNoGoDecisions.id, decision.id));
        results.goNoGoDecisionsDelete = { success: true };
      } catch (decisionErr) {
        results.goNoGoDecisionsInsert = { success: false, error: String(decisionErr) };
      }

      reply.status(200).send({
        success: true,
        message: "Database write tests completed",
        results,
      });
    } catch (error) {
      reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : "Test failed",
        results,
      });
    }
  });
}

