'use client';

import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from 'react';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';
import type { User, Session, AuthChangeEvent } from '@supabase/supabase-js';
import type { UserProfile, Workspace, AuthState } from '@/lib/types/auth';

interface AuthContextType extends AuthState {
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, name?: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  switchWorkspace: (workspaceId: string | null) => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    workspaces: [],
    currentWorkspace: null,
    isOwner: false,
    isAdmin: false,
    isLoading: isSupabaseConfigured,
  });

  const supabase = createClient();
  const processingRef = useRef(false);
  const initializedRef = useRef(false);

  const fetchUserProfile = useCallback(async (authUser: User): Promise<UserProfile | null> => {
    const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const apiKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    
    if (!baseUrl || !apiKey) {
      console.error('[Auth] Missing Supabase config');
      return null;
    }
    
    try {
      console.log('[Auth] Fetching user profile for:', authUser.id);
      
      // Use direct REST API instead of Supabase client (client hangs)
      const response = await fetch(
        `${baseUrl}/rest/v1/users?id=eq.${authUser.id}&select=*`,
        {
          headers: {
            'apikey': apiKey,
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          }
        }
      );
      
      const data = await response.json();
      
      if (!response.ok || !data || data.length === 0) {
        console.log('[Auth] Profile not found, creating...');
        
        // Create user profile via REST API
        const createResponse = await fetch(`${baseUrl}/rest/v1/users`, {
          method: 'POST',
          headers: {
            'apikey': apiKey,
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
          },
          body: JSON.stringify({
            id: authUser.id,
            email: authUser.email || '',
            name: authUser.user_metadata?.name || authUser.user_metadata?.full_name || null,
            avatar_url: authUser.user_metadata?.avatar_url || null,
            role: 'user',
          }),
        });
        
        if (!createResponse.ok) {
          console.error('[Auth] Failed to create profile');
        }
        
        // Return basic profile
        return {
          id: authUser.id,
          email: authUser.email || '',
          name: authUser.user_metadata?.name || authUser.user_metadata?.full_name || null,
          avatarUrl: authUser.user_metadata?.avatar_url || null,
          role: 'user' as const,
          active: true,
          createdAt: authUser.created_at,
          lastLoginAt: null,
        };
      }

      const user = data[0];
      
      // Map old role names to new ones for backwards compatibility
      let role = user.role;
      if (role === 'client_user') role = 'user';
      // Note: 'admin' stays as 'admin' (client admin), 'owner' is platform owner
      
      console.log('[Auth] Profile found:', user.email, 'role:', role);
      
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatar_url,
        role: role as 'owner' | 'admin' | 'user',
        active: user.active,
        createdAt: user.created_at,
        lastLoginAt: user.last_login_at,
      };
    } catch (err) {
      console.error('[Auth] fetchUserProfile error:', err);
      return {
        id: authUser.id,
        email: authUser.email || '',
        name: authUser.user_metadata?.name || null,
        avatarUrl: null,
        role: 'owner' as const,
        active: true,
        createdAt: authUser.created_at,
        lastLoginAt: null,
      };
    }
  }, []);

  const fetchWorkspaces = useCallback(async (userId: string, isOwner: boolean): Promise<Workspace[]> => {
    const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const apiKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    
    if (!baseUrl || !apiKey) {
      console.error('[Auth] Missing Supabase config');
      return [];
    }
    
    console.log('[Auth] Fetching workspaces, isOwner:', isOwner);
    
    try {
      if (isOwner) {
        // Owners can see all clients/workspaces
        const response = await fetch(
          `${baseUrl}/rest/v1/clients?active=eq.true&select=id,name,slug&order=name`,
          {
            headers: {
              'apikey': apiKey,
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            }
          }
        );
        
        const data = await response.json();

        if (!response.ok) {
          console.error('[Auth] Error fetching clients:', data);
          return [];
        }

        console.log('[Auth] Fetched clients:', data?.length || 0);
        return (data || []).map((client: any) => ({
          id: client.id,
          name: client.name,
          slug: client.slug,
          role: 'owner',
          isDefault: false,
        }));
      } else {
        // Admins and Users see only their assigned workspaces
        const response = await fetch(
          `${baseUrl}/rest/v1/workspace_memberships?user_id=eq.${userId}&select=workspace_role,is_default,clients:client_id(id,name,slug)`,
          {
            headers: {
              'apikey': apiKey,
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            }
          }
        );
        
        const data = await response.json();

        if (!response.ok) {
          console.error('[Auth] Error fetching memberships:', data);
          return [];
        }

        console.log('[Auth] Fetched memberships:', data?.length || 0);
        return (data || [])
          .filter((m: any) => m.clients)
          .map((m: any) => ({
            id: m.clients.id,
            name: m.clients.name,
            slug: m.clients.slug,
            role: m.workspace_role,
            isDefault: m.is_default,
          }));
      }
    } catch (err) {
      console.error('[Auth] fetchWorkspaces error:', err);
      return [];
    }
  }, []);

  const processSession = useCallback(async (session: Session | null) => {
    // Prevent concurrent processing
    if (processingRef.current) {
      console.log('[Auth] Already processing, skipping');
      return;
    }
    
    processingRef.current = true;
    console.log('[Auth] Processing session:', session?.user?.email || 'none');

    try {
      if (!session?.user) {
        console.log('[Auth] No session, clearing state');
        setAuthState({
          user: null,
          workspaces: [],
          currentWorkspace: null,
          isOwner: false,
          isAdmin: false,
          isLoading: false,
        });
        localStorage.removeItem('currentWorkspaceId');
        return;
      }

      const authUser = session.user;
      
      // Fetch profile from database
      console.log('[Auth] Fetching profile...');
      const profile = await fetchUserProfile(authUser);
      
      // If we couldn't get profile from DB, use basic info from auth
      const userProfile: UserProfile = profile || {
        id: authUser.id,
        email: authUser.email || '',
        name: authUser.user_metadata?.name || authUser.user_metadata?.full_name || null,
        avatarUrl: authUser.user_metadata?.avatar_url || null,
        role: 'owner',
        active: true,
        createdAt: authUser.created_at,
        lastLoginAt: null,
      };

      console.log('[Auth] Profile:', userProfile.email, 'role:', userProfile.role);

      // Determine role flags
      const isOwner = userProfile.role === 'owner';
      const isAdmin = userProfile.role === 'admin' || userProfile.role === 'owner';
      
      // Fetch workspaces
      console.log('[Auth] Fetching workspaces...');
      const workspaces = await fetchWorkspaces(authUser.id, isOwner);
      
      // Determine current workspace
      const savedWorkspaceId = typeof window !== 'undefined' 
        ? localStorage.getItem('currentWorkspaceId') 
        : null;
      
      let currentWorkspace: Workspace | null = null;
      
      if (isOwner && workspaces.length > 0) {
        currentWorkspace = savedWorkspaceId 
          ? workspaces.find(w => w.id === savedWorkspaceId) || null
          : null;
      } else if (workspaces.length > 0) {
        currentWorkspace = savedWorkspaceId 
          ? workspaces.find(w => w.id === savedWorkspaceId) || workspaces.find(w => w.isDefault) || workspaces[0]
          : workspaces.find(w => w.isDefault) || workspaces[0];
      }

      console.log('[Auth] Complete - user:', userProfile.email, 'role:', userProfile.role, 'isOwner:', isOwner, 'workspaces:', workspaces.length);
      
      setAuthState({
        user: userProfile,
        workspaces,
        currentWorkspace,
        isOwner,
        isAdmin,
        isLoading: false,
      });
        
    } catch (err) {
      console.error('[Auth] processSession error:', err);
      setAuthState(prev => ({ ...prev, isLoading: false }));
    } finally {
      processingRef.current = false;
    }
  }, [fetchUserProfile, fetchWorkspaces]);

  const refreshUser = useCallback(async () => {
    // Refresh workspaces for the current user
    if (!authState.user) {
      console.log('[Auth] refreshUser called but no user');
      return;
    }
    
    console.log('[Auth] Refreshing workspaces...');
    const workspaces = await fetchWorkspaces(authState.user.id, authState.isOwner);
    
    // Update workspace in state, keeping current selection if still valid
    setAuthState(prev => {
      const currentWorkspace = prev.currentWorkspace && workspaces.some(w => w.id === prev.currentWorkspace?.id)
        ? prev.currentWorkspace
        : prev.isOwner ? null : workspaces[0] || null;
      
      return {
        ...prev,
        workspaces,
        currentWorkspace,
      };
    });
    
    console.log('[Auth] Workspaces refreshed:', workspaces.length);
  }, [authState.user, authState.isOwner, fetchWorkspaces]);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      return;
    }
    
    console.log('[Auth] Setting up auth...');
    
    // Check localStorage for existing session (Supabase stores it there)
    const checkLocalSession = async () => {
      const storageKey = `sb-${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '').hostname.split('.')[0]}-auth-token`;
      const storedSession = localStorage.getItem(storageKey);
      
      if (storedSession) {
        try {
          const parsed = JSON.parse(storedSession);
          if (parsed?.user) {
            console.log('[Auth] Found stored session for:', parsed.user.email);
            // Create a session-like object from stored data
            await processSession({ user: parsed.user } as Session);
            return true;
          }
        } catch (e) {
          console.log('[Auth] Could not parse stored session');
        }
      }
      return false;
    };
    
    // Try to load session from localStorage first
    checkLocalSession().then(found => {
      if (!found) {
        console.log('[Auth] No stored session found');
        initializedRef.current = true;
        setAuthState(prev => ({ ...prev, isLoading: false }));
      }
    });
    
    // Listen for auth changes (for sign in/out events)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event: AuthChangeEvent, session: Session | null) => {
      console.log('[Auth] Auth event:', event);
      
      if (event === 'INITIAL_SESSION') {
        // Skip if we already loaded from localStorage
        if (initializedRef.current) return;
        
        initializedRef.current = true;
        if (session) {
          await processSession(session);
        } else {
          setAuthState(prev => ({ ...prev, isLoading: false }));
        }
        return;
      }
      
      if (event === 'SIGNED_OUT') {
        setAuthState({
          user: null,
          workspaces: [],
          currentWorkspace: null,
          isOwner: false,
          isAdmin: false,
          isLoading: false,
        });
        localStorage.removeItem('currentWorkspaceId');
        processingRef.current = false;
        return;
      }
      
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        await processSession(session);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase, processSession]);

  const signIn = async (email: string, password: string) => {
    console.log('[Auth] Signing in...');
    setAuthState(prev => ({ ...prev, isLoading: true }));
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setAuthState(prev => ({ ...prev, isLoading: false }));
    }
    return { error: error as Error | null };
  };

  const signUp = async (email: string, password: string, name?: string) => {
    setAuthState(prev => ({ ...prev, isLoading: true }));
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name },
      },
    });
    if (error) {
      setAuthState(prev => ({ ...prev, isLoading: false }));
    }
    return { error: error as Error | null };
  };

  const signOut = async () => {
    console.log('[Auth] Signing out...');
    processingRef.current = false;
    initializedRef.current = false;
    
    // Clear auth state immediately (don't wait for Supabase)
    setAuthState({
      user: null,
      workspaces: [],
      currentWorkspace: null,
      isOwner: false,
      isAdmin: false,
      isLoading: false,
    });
    
    // Clear all localStorage items (this is what actually logs you out)
    localStorage.removeItem('currentWorkspaceId');
    
    // Clear all Supabase-related items from localStorage
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('sb-') || key.includes('supabase'))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
    
    // Clear sessionStorage as well
    sessionStorage.clear();
    
    // Try to sign out from Supabase (don't wait - it might hang)
    supabase.auth.signOut({ scope: 'global' }).catch(() => {});
    
    console.log('[Auth] Sign out complete, storage cleared');
  };

  const switchWorkspace = (workspaceId: string | null) => {
    if (workspaceId === null) {
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
