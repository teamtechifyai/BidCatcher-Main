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

// Monorepo root: from apps/api/src or apps/api/dist, go up to repo root
const monorepoRoot = resolve(__dirname, "../../..");
const rootEnv = resolve(monorepoRoot, ".env");

// Load .env - prefer monorepo root first (where .env lives), then cwd-based
const envPaths = [
  rootEnv,                                    // Monorepo root (reliable regardless of cwd)
  resolve(process.cwd(), ".env"),             // Running from root
  resolve(process.cwd(), "../../.env"),        // Running from apps/api
  resolve(__dirname, "../../../.env"),        // Fallback: from dist
];

let loadedPath: string | null = null;
for (const envPath of envPaths) {
  if (existsSync(envPath)) {
    config({ path: envPath });
    loadedPath = envPath;
    break;
  }
}

console.log(`[env] cwd=${process.cwd()}`);
console.log(`[env] Loaded .env from: ${loadedPath ?? "NONE (no .env found)"}`);
console.log(`[env] RESEND_API_KEY: ${process.env.RESEND_API_KEY ? "***configured***" : "NOT SET"}`);

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

