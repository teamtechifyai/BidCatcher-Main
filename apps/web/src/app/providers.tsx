'use client';

import { AuthProvider } from '@/lib/hooks/use-auth';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      {!isSupabaseConfigured && (
        <div className="bg-yellow-900/50 border-b border-yellow-800 px-4 py-2 text-center text-sm text-yellow-200">
          ⚠️ Supabase not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to your .env file to enable authentication.
        </div>
      )}
      {children}
    </AuthProvider>
  );
}

