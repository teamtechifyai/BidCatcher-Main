/**
 * Bid Catcher API
 *
 * Main entry point for the backend service.
 * Handles bid intake, processing, and retrieval.
 */

import { config } from "dotenv";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root (try multiple paths)
const envPaths = [
  resolve(process.cwd(), ".env"),           // Running from root
  resolve(process.cwd(), "../../.env"),     // Running from apps/api
  resolve(__dirname, "../../../.env"),      // Relative to compiled file
  resolve(__dirname, "../../.env"),         // Relative to source in apps/api/src
];

for (const envPath of envPaths) {
  if (existsSync(envPath)) {
    config({ path: envPath });
    console.log(`Loaded .env from: ${envPath}`);
    break;
  }
}

import { createServer } from "./server.js";
import { initializeDb } from "@bid-catcher/db";

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";

async function main() {
  // Initialize database connection
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL environment variable is required");
    process.exit(1);
  }

  try {
    initializeDb(databaseUrl);
    console.log("✓ Database connection initialized");
  } catch (error) {
    console.error("Failed to initialize database:", error);
    process.exit(1);
  }

  // Create and start server
  const server = await createServer();

  try {
    await server.listen({ port: PORT, host: HOST });
    console.log(`
╔═══════════════════════════════════════════════╗
║         🎯 Bid Catcher API Started            ║
╠═══════════════════════════════════════════════╣
║  Server:  http://${HOST}:${PORT}                   
║  Health:  http://${HOST}:${PORT}/health            
║  Env:     ${process.env.NODE_ENV || "development"}                          
╚═══════════════════════════════════════════════╝
    `);
  } catch (error) {
    server.log.error(error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down gracefully...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\nShutting down gracefully...");
  process.exit(0);
});

main();

