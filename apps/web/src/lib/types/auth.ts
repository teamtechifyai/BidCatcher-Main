/**
 * User roles:
 * - owner: Platform owner - full control over all clients, configs, bids, users
 * - admin: Client admin - manages their own client's config and bids  
 * - user: Regular user - can upload bids for their client but can't manage config
 */
export type UserRole = 'owner' | 'admin' | 'user';

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  role: UserRole;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  role: string; // workspace-level role (owner, manager, member)
  isDefault: boolean;
}

export interface AuthState {
  user: UserProfile | null;
  workspaces: Workspace[];
  currentWorkspace: Workspace | null;
  /** True if user is platform owner */
  isOwner: boolean;
  /** True if user is client admin (can manage their workspaces) */
  isAdmin: boolean;
  isLoading: boolean;
}
