/**
 * Global Error Handler
 *
 * Provides consistent error responses across the API.
 */

import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta: {
    requestId: string;
    timestamp: string;
  };
}

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  const requestId = request.id;
  const timestamp = new Date().toISOString();

  // Log the error
  request.log.error(
    {
      err: error,
      requestId,
      url: request.url,
      method: request.method,
    },
    "Request error"
  );

  // Handle Zod validation errors
  if (error instanceof ZodError) {
    const response: ApiError = {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: error.errors.map((e) => ({
          path: e.path.join("."),
          message: e.message,
        })),
      },
      meta: { requestId, timestamp },
    };
    reply.status(400).send(response);
    return;
  }

  // Handle known HTTP errors
  if (error.statusCode) {
    const response: ApiError = {
      success: false,
      error: {
        code: error.code || "HTTP_ERROR",
        message: error.message,
      },
      meta: { requestId, timestamp },
    };
    reply.status(error.statusCode).send(response);
    return;
  }

  // Handle unknown errors
  const response: ApiError = {
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message:
        process.env.NODE_ENV === "production"
          ? "An unexpected error occurred"
          : error.message,
    },
    meta: { requestId, timestamp },
  };
  reply.status(500).send(response);
}


