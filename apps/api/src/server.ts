/**
 * Fastify Server Configuration
 */

import Fastify from "fastify";
import cors from "@fastify/cors";
import { healthRoutes } from "./routes/health.js";
import { intakeRoutes } from "./routes/intake.js";
import { bidsRoutes } from "./routes/bids.js";
import { documentsRoutes } from "./routes/documents.js";
import { decisionsRoutes } from "./routes/decisions.js";
import { handoffRoutes } from "./routes/handoff.js";
import { clientsRoutes } from "./routes/clients.js";
import { extractionRoutes } from "./routes/extraction.js";
import { incomingEmailsRoutes } from "./routes/incoming-emails.js";
import { oreSamplesRoutes } from "./routes/ore-samples.js";
import { analyticsRoutes } from "./routes/analytics.js";
import { ghlRoutes } from "./routes/ghl.js";
import { errorHandler } from "./middleware/error-handler.js";
import { requestLogger } from "./middleware/request-logger.js";

export async function createServer() {
  const server = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || "info",
      transport:
        process.env.NODE_ENV === "development"
          ? {
              target: "pino-pretty",
              options: {
                translateTime: "HH:MM:ss Z",
                ignore: "pid,hostname",
              },
            }
          : undefined,
    },
    requestIdHeader: "x-request-id",
    genReqId: () => crypto.randomUUID(),
    // Increase body size limit for large PDF uploads (50MB)
    bodyLimit: 52428800,
  });

  // Store raw body for webhook verification (Resend uses Svix signing)
  server.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
    (req as { rawBody?: string }).rawBody = body.toString("utf8");
    try {
      done(null, JSON.parse(body.toString("utf8")));
    } catch (e) {
      done(e as Error, undefined);
    }
  });

  // Register plugins
  await server.register(cors, {
    origin: process.env.CORS_ORIGIN || true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  // Register middleware
  server.addHook("onRequest", requestLogger);
  server.setErrorHandler(errorHandler);

  // Register routes
  await server.register(healthRoutes);
  await server.register(clientsRoutes, { prefix: "/clients" });
  await server.register(intakeRoutes, { prefix: "/intake" });
  await server.register(extractionRoutes, { prefix: "/extraction" }); // PDF extraction routes
  await server.register(bidsRoutes, { prefix: "/bids" });
  await server.register(decisionsRoutes, { prefix: "/bids" }); // Decision routes under /bids/:id/...
  await server.register(handoffRoutes, { prefix: "/bids" }); // Handoff routes under /bids/:id/handoff/...
  await server.register(documentsRoutes, { prefix: "/documents" });
  await server.register(incomingEmailsRoutes, { prefix: "/incoming-emails" });
  await server.register(oreSamplesRoutes, { prefix: "/clients" });
  await server.register(analyticsRoutes, { prefix: "/clients" });
  await server.register(ghlRoutes, { prefix: "/ghl" });

  return server;
}

