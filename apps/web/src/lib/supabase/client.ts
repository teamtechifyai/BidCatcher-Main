import { createClient as createSupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Check if Supabase is configured
export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey);

// Create a singleton client instance
let clientInstance: ReturnType<typeof createSupabaseClient> | null = null;

export function createClient() {
  if (!isSupabaseConfigured) {
    // Return a mock client that does nothing when Supabase isn't configured
    return {
      auth: {
        getUser: async () => ({ data: { user: null }, error: null }),
        getSession: async () => ({ data: { session: null }, error: null }),
        signInWithPassword: async () => ({ data: null, error: new Error('Supabase not configured') }),
        signUp: async () => ({ data: null, error: new Error('Supabase not configured') }),
        signOut: async () => ({ error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
      from: () => ({
        select: () => ({ 
          eq: () => ({ 
            single: async () => ({ data: null, error: null }), 
            order: async () => ({ data: [], error: null }),
            limit: async () => ({ data: [], error: null }),
          }),
          limit: async () => ({ data: [], error: null }),
          order: () => ({ data: [], error: null }),
        }),
        update: () => ({ eq: async () => ({ error: null }) }),
        insert: async () => ({ error: null }),
        delete: () => ({ eq: async () => ({ error: null }) }),
      }),
    } as any;
  }
  
  // Return singleton instance
  if (!clientInstance) {
    clientInstance = createSupabaseClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  
  return clientInstance;
}
