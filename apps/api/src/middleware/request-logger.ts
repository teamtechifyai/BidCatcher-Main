/**
 * Request Logger Middleware
 *
 * Logs incoming requests with relevant metadata.
 */

import type { FastifyRequest } from "fastify";

export async function requestLogger(request: FastifyRequest): Promise<void> {
  request.log.info(
    {
      requestId: request.id,
      method: request.method,
      url: request.url,
      userAgent: request.headers["user-agent"],
      contentType: request.headers["content-type"],
    },
    "Incoming request"
  );
}


