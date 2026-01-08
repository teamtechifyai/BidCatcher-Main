'use client';

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { User } from '@supabase/supabase-js';
import type { UserProfile, Workspace, AuthState } from '@/lib/types/auth';

interface AuthContextType extends AuthState {
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, name?: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  switchWorkspace: (workspaceId: string) => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    workspaces: [],
    currentWorkspace: null,
    isAdmin: false,
    isLoading: true,
  });

  const supabase = createClient();

  const fetchUserProfile = useCallback(async (authUser: User): Promise<UserProfile | null> => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .single();

      if (error) {
        console.error('Error fetching user profile:', error);
        // If user doesn't exist in our users table yet, create a basic profile
        if (error.code === 'PGRST116') {
          return {
            id: authUser.id,
            email: authUser.email || '',
            name: authUser.user_metadata?.name || authUser.user_metadata?.full_name || null,
            avatarUrl: authUser.user_metadata?.avatar_url || null,
            role: 'client_user',
            active: true,
            createdAt: authUser.created_at,
            lastLoginAt: null,
          };
        }
        return null;
      }

      return {
        id: data.id,
        email: data.email,
        name: data.name,
        avatarUrl: data.avatar_url,
        role: data.role,
        active: data.active,
        createdAt: data.created_at,
        lastLoginAt: data.last_login_at,
      };
    } catch (err) {
      console.error('Error in fetchUserProfile:', err);
      return null;
    }
  }, [supabase]);

  const fetchWorkspaces = useCallback(async (userId: string, isAdmin: boolean): Promise<Workspace[]> => {
    try {
      if (isAdmin) {
        // Admins can access all workspaces
        const { data, error } = await supabase
          .from('clients')
          .select('id, name, slug')
          .eq('active', true)
          .order('name');

        if (error) throw error;

        return (data || []).map(client => ({
          id: client.id,
          name: client.name,
          slug: client.slug,
          role: 'admin',
          isDefault: false,
        }));
      } else {
        // Client users only see their assigned workspaces
        const { data, error } = await supabase
          .from('workspace_memberships')
          .select(`
            workspace_role,
            is_default,
            clients:client_id (id, name, slug)
          `)
          .eq('user_id', userId);

        if (error) throw error;

        return (data || [])
          .filter(m => m.clients)
          .map(m => ({
            id: (m.clients as any).id,
            name: (m.clients as any).name,
            slug: (m.clients as any).slug,
            role: m.workspace_role,
            isDefault: m.is_default,
          }));
      }
    } catch (err) {
      console.error('Error fetching workspaces:', err);
      return [];
    }
  }, [supabase]);

  const refreshUser = useCallback(async () => {
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      
      if (!authUser) {
        setAuthState({
          user: null,
          workspaces: [],
          currentWorkspace: null,
          isAdmin: false,
          isLoading: false,
        });
        return;
      }

      const profile = await fetchUserProfile(authUser);
      if (!profile) {
        setAuthState(prev => ({ ...prev, isLoading: false }));
        return;
      }

      const isAdmin = profile.role === 'admin';
      const workspaces = await fetchWorkspaces(authUser.id, isAdmin);
      
      // Get current workspace from localStorage or use default
      const savedWorkspaceId = typeof window !== 'undefined' 
        ? localStorage.getItem('currentWorkspaceId') 
        : null;
      
      let currentWorkspace: Workspace | null = null;
      
      if (isAdmin && workspaces.length > 0) {
        // Admin: all workspaces view by default, or specific workspace if selected
        currentWorkspace = savedWorkspaceId 
          ? workspaces.find(w => w.id === savedWorkspaceId) || null
          : null; // null means "All Workspaces" for admins
      } else if (workspaces.length > 0) {
        // Client user: use saved or default workspace
        currentWorkspace = savedWorkspaceId 
          ? workspaces.find(w => w.id === savedWorkspaceId) || workspaces.find(w => w.isDefault) || workspaces[0]
          : workspaces.find(w => w.isDefault) || workspaces[0];
      }

      setAuthState({
        user: profile,
        workspaces,
        currentWorkspace,
        isAdmin,
        isLoading: false,
      });

      // Update last login
      await supabase
        .from('users')
        .update({ last_login_at: new Date().toISOString() })
        .eq('id', authUser.id);
        
    } catch (err) {
      console.error('Error refreshing user:', err);
      setAuthState(prev => ({ ...prev, isLoading: false }));
    }
  }, [supabase, fetchUserProfile, fetchWorkspaces]);

  useEffect(() => {
    refreshUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        await refreshUser();
      } else if (event === 'SIGNED_OUT') {
        setAuthState({
          user: null,
          workspaces: [],
          currentWorkspace: null,
          isAdmin: false,
          isLoading: false,
        });
        localStorage.removeItem('currentWorkspaceId');
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase, refreshUser]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  };

  const signUp = async (email: string, password: string, name?: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name },
      },
    });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    localStorage.removeItem('currentWorkspaceId');
  };

  const switchWorkspace = (workspaceId: string | null) => {
    if (workspaceId === null) {
      // Admin switching to "All Workspaces" view
      localStorage.removeItem('currentWorkspaceId');
      setAuthState(prev => ({ ...prev, currentWorkspace: null }));
    } else {
      const workspace = authState.workspaces.find(w => w.id === workspaceId);
      if (workspace) {
        localStorage.setItem('currentWorkspaceId', workspaceId);
        setAuthState(prev => ({ ...prev, currentWorkspace: workspace }));
      }
    }
  };

  return (
    <AuthContext.Provider value={{
      ...authState,
      signIn,
      signUp,
      signOut,
      switchWorkspace,
      refreshUser,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

