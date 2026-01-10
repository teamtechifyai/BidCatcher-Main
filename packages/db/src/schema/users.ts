import { pgTable, uuid, varchar, text, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { clients } from "./clients.js";

/**
 * User roles enum
 * - owner: Platform owner - full control over all clients, configs, bids, users
 * - admin: Client admin - manages their own client's config and bids
 * - user: Regular user - can upload bids for their client but can't manage config
 */
export const userRoleEnum = pgEnum("user_role", ["owner", "admin", "user"]);

/**
 * Users table
 * 
 * Stores user profiles linked to Supabase Auth.
 * - Owners can see and manage everything
 * - Admins can manage their assigned workspaces
 * - Users can only upload bids for their workspaces
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey(), // Matches Supabase auth.users.id
  
  /** User's email (synced from Supabase auth) */
  email: varchar("email", { length: 255 }).notNull().unique(),
  
  /** Display name */
  name: varchar("name", { length: 255 }),
  
  /** Avatar URL */
  avatarUrl: text("avatar_url"),
  
  /** User role - owner, admin, or user */
  role: userRoleEnum("role").notNull().default("user"),
  
  /** Whether user account is active */
  active: boolean("active").notNull().default(true),
  
  // ----- Timestamps -----
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

/**
 * Workspace memberships table
 * 
 * Links users to workspaces (clients).
 * Admins can access all workspaces.
 * Client users are restricted to their assigned workspaces.
 */
export const workspaceMemberships = pgTable("workspace_memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  
  /** User ID */
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  
  /** Client/Workspace ID */
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  
  /** Role within this workspace */
  workspaceRole: varchar("workspace_role", { length: 50 }).notNull().default("member"),
  
  /** Whether this is the user's default workspace */
  isDefault: boolean("is_default").notNull().default(false),
  
  // ----- Timestamps -----
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type WorkspaceMembership = typeof workspaceMemberships.$inferSelect;
export type NewWorkspaceMembership = typeof workspaceMemberships.$inferInsert;

