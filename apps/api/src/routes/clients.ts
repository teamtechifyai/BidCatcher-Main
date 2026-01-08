/**
 * Clients Routes
 *
 * API endpoints for client configuration management.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getDb, clients, eq } from "@bid-catcher/db";
import { ClientConfigSchema, createDefaultClientConfig } from "@bid-catcher/config";
import { randomUUID } from "crypto";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function clientsRoutes(server: FastifyInstance): Promise<void> {
  /**
   * GET /clients
   *
   * List all active clients
   */
  server.get("/", async (request: FastifyRequest, reply: FastifyReply) => {
    const db = getDb();

    try {
      const allClients = await db
        .select({
          id: clients.id,
          name: clients.name,
          slug: clients.slug,
          contactEmail: clients.contactEmail,
          active: clients.active,
        })
        .from(clients)
        .where(eq(clients.active, true));

      return reply.status(200).send({
        success: true,
        data: allClients,
        meta: {
          requestId: request.id,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      request.log.error(error, "Failed to list clients");
      return reply.status(500).send({
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : "Failed to list clients",
        },
        meta: {
          requestId: request.id,
          timestamp: new Date().toISOString(),
        },
      });
    }
  });

  /**
   * GET /clients/:id
   *
   * Get client details including config
   */
  server.get<{ Params: { id: string } }>(
    "/:id",
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;

      if (!UUID_REGEX.test(id)) {
        return reply.status(400).send({
          success: false,
          error: {
            code: "INVALID_ID",
            message: "Invalid client ID format",
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }

      const db = getDb();

      try {
        const results = await db
          .select({
            id: clients.id,
            name: clients.name,
            slug: clients.slug,
            contactEmail: clients.contactEmail,
            contactName: clients.contactName,
            phone: clients.phone,
            active: clients.active,
            config: clients.config,
            notes: clients.notes,
            createdAt: clients.createdAt,
            updatedAt: clients.updatedAt,
          })
          .from(clients)
          .where(eq(clients.id, id))
          .limit(1);

        if (results.length === 0) {
          return reply.status(404).send({
            success: false,
            error: {
              code: "NOT_FOUND",
              message: `Client with ID ${id} not found`,
            },
            meta: {
              requestId: request.id,
              timestamp: new Date().toISOString(),
            },
          });
        }

        const client = results[0];

        return reply.status(200).send({
          success: true,
          data: {
            ...client,
            createdAt: client.createdAt.toISOString(),
            updatedAt: client.updatedAt.toISOString(),
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (error) {
        request.log.error(error, "Failed to get client");
        return reply.status(500).send({
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to get client",
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }
    }
  );

  /**
   * GET /clients/:id/config
   *
   * Get just the client configuration (for intake forms)
   */
  server.get<{ Params: { id: string } }>(
    "/:id/config",
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;

      if (!UUID_REGEX.test(id)) {
        return reply.status(400).send({
          success: false,
          error: {
            code: "INVALID_ID",
            message: "Invalid client ID format",
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }

      const db = getDb();

      try {
        const results = await db
          .select({
            id: clients.id,
            name: clients.name,
            config: clients.config,
            active: clients.active,
          })
          .from(clients)
          .where(eq(clients.id, id))
          .limit(1);

        if (results.length === 0) {
          return reply.status(404).send({
            success: false,
            error: {
              code: "NOT_FOUND",
              message: `Client with ID ${id} not found`,
            },
            meta: {
              requestId: request.id,
              timestamp: new Date().toISOString(),
            },
          });
        }

        const client = results[0];

        if (!client.active) {
          return reply.status(403).send({
            success: false,
            error: {
              code: "CLIENT_INACTIVE",
              message: "This client is not active",
            },
            meta: {
              requestId: request.id,
              timestamp: new Date().toISOString(),
            },
          });
        }

        // Parse and validate config
        let parsedConfig;
        try {
          parsedConfig = ClientConfigSchema.parse(client.config);
        } catch {
          // Return raw config if parsing fails (for backwards compatibility)
          parsedConfig = client.config;
        }

        return reply.status(200).send({
          success: true,
          data: {
            clientId: client.id,
            clientName: client.name,
            config: parsedConfig,
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (error) {
        request.log.error(error, "Failed to get client config");
        return reply.status(500).send({
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to get client config",
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }
    }
  );

  /**
   * POST /clients
   *
   * Create a new client with default configuration
   */
  server.post<{
    Body: {
      name: string;
      slug?: string;
      contactEmail: string;
      contactName?: string;
      phone?: string;
      notes?: string;
    };
  }>(
    "/",
    async (
      request: FastifyRequest<{
        Body: {
          name: string;
          slug?: string;
          contactEmail: string;
          contactName?: string;
          phone?: string;
          notes?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const { name, slug, contactEmail, contactName, phone, notes } = request.body;

      if (!name || !contactEmail) {
        return reply.status(400).send({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Name and contactEmail are required",
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }

      const db = getDb();

      try {
        // Generate client ID and slug
        const clientId = randomUUID();
        const clientSlug = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

        // Check for duplicate slug
        const existing = await db
          .select({ id: clients.id })
          .from(clients)
          .where(eq(clients.slug, clientSlug))
          .limit(1);

        if (existing.length > 0) {
          return reply.status(409).send({
            success: false,
            error: {
              code: "DUPLICATE_SLUG",
              message: `Client with slug '${clientSlug}' already exists`,
            },
            meta: {
              requestId: request.id,
              timestamp: new Date().toISOString(),
            },
          });
        }

        // Create default config
        const defaultConfig = createDefaultClientConfig(clientId, name);

        // Insert client
        const [newClient] = await db
          .insert(clients)
          .values({
            id: clientId,
            name,
            slug: clientSlug,
            contactEmail,
            contactName: contactName || null,
            phone: phone || null,
            notes: notes || null,
            active: true,
            config: defaultConfig,
          })
          .returning({
            id: clients.id,
            name: clients.name,
            slug: clients.slug,
            createdAt: clients.createdAt,
          });

        console.log(`Created new client: ${newClient.id} (${newClient.name})`);

        return reply.status(201).send({
          success: true,
          data: {
            ...newClient,
            config: defaultConfig,
            createdAt: newClient.createdAt.toISOString(),
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (error) {
        request.log.error(error, "Failed to create client");
        return reply.status(500).send({
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to create client",
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }
    }
  );

  /**
   * PUT /clients/:id/config
   *
   * Update client configuration
   */
  server.put<{
    Params: { id: string };
    Body: Record<string, unknown>;
  }>(
    "/:id/config",
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: Record<string, unknown>;
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const configUpdate = request.body;

      if (!UUID_REGEX.test(id)) {
        return reply.status(400).send({
          success: false,
          error: {
            code: "INVALID_ID",
            message: "Invalid client ID format",
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }

      const db = getDb();

      try {
        // Check client exists
        const existing = await db
          .select({ id: clients.id, config: clients.config })
          .from(clients)
          .where(eq(clients.id, id))
          .limit(1);

        if (existing.length === 0) {
          return reply.status(404).send({
            success: false,
            error: {
              code: "NOT_FOUND",
              message: `Client with ID ${id} not found`,
            },
            meta: {
              requestId: request.id,
              timestamp: new Date().toISOString(),
            },
          });
        }

        // Validate config structure
        let validatedConfig;
        try {
          validatedConfig = ClientConfigSchema.parse(configUpdate);
        } catch (validationError) {
          return reply.status(400).send({
            success: false,
            error: {
              code: "INVALID_CONFIG",
              message: "Invalid configuration format",
              details: validationError,
            },
            meta: {
              requestId: request.id,
              timestamp: new Date().toISOString(),
            },
          });
        }

        // Update config
        await db
          .update(clients)
          .set({
            config: validatedConfig,
            updatedAt: new Date(),
          })
          .where(eq(clients.id, id));

        console.log(`Updated config for client: ${id}`);

        return reply.status(200).send({
          success: true,
          data: {
            clientId: id,
            config: validatedConfig,
            updatedAt: new Date().toISOString(),
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (error) {
        request.log.error(error, "Failed to update client config");
        return reply.status(500).send({
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to update client config",
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }
    }
  );

  /**
   * DELETE /clients/:id
   *
   * Delete a client. By default, soft-deletes (sets active=false).
   * Use ?hard=true to permanently delete (will fail if client has bids).
   */
  server.delete<{ Params: { id: string }; Querystring: { hard?: string } }>(
    "/:id",
    async (
      request: FastifyRequest<{ Params: { id: string }; Querystring: { hard?: string } }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const hardDelete = request.query.hard === "true";

      if (!UUID_REGEX.test(id)) {
        return reply.status(400).send({
          success: false,
          error: {
            code: "INVALID_ID",
            message: "Invalid client ID format",
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }

      const db = getDb();

      try {
        // Check client exists
        const existing = await db
          .select({ id: clients.id, name: clients.name })
          .from(clients)
          .where(eq(clients.id, id))
          .limit(1);

        if (existing.length === 0) {
          return reply.status(404).send({
            success: false,
            error: {
              code: "NOT_FOUND",
              message: `Client with ID ${id} not found`,
            },
            meta: {
              requestId: request.id,
              timestamp: new Date().toISOString(),
            },
          });
        }

        const clientName = existing[0].name;

        if (hardDelete) {
          // Hard delete - will cascade delete all related bids
          await db.delete(clients).where(eq(clients.id, id));
          console.log(`Hard deleted client: ${id} (${clientName})`);

          return reply.status(200).send({
            success: true,
            data: {
              clientId: id,
              clientName,
              deleted: true,
              type: "hard",
              message: `Client '${clientName}' and all related data permanently deleted`,
            },
            meta: {
              requestId: request.id,
              timestamp: new Date().toISOString(),
            },
          });
        } else {
          // Soft delete - just set active to false
          await db
            .update(clients)
            .set({ active: false, updatedAt: new Date() })
            .where(eq(clients.id, id));

          console.log(`Soft deleted (deactivated) client: ${id} (${clientName})`);

          return reply.status(200).send({
            success: true,
            data: {
              clientId: id,
              clientName,
              deleted: true,
              type: "soft",
              message: `Client '${clientName}' deactivated. Use ?hard=true to permanently delete.`,
            },
            meta: {
              requestId: request.id,
              timestamp: new Date().toISOString(),
            },
          });
        }
      } catch (error) {
        request.log.error(error, "Failed to delete client");

        // Check for foreign key violation (bids referencing this client)
        const errorMessage = error instanceof Error ? error.message : "Failed to delete client";
        if (errorMessage.includes("violates foreign key constraint")) {
          return reply.status(409).send({
            success: false,
            error: {
              code: "HAS_DEPENDENCIES",
              message: "Cannot delete client with existing bids. Delete the bids first or use soft delete.",
            },
            meta: {
              requestId: request.id,
              timestamp: new Date().toISOString(),
            },
          });
        }

        return reply.status(500).send({
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: errorMessage,
          },
          meta: {
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }
    }
  );
}

