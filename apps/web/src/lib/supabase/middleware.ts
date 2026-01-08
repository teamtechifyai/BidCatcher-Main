import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey);

export async function updateSession(request: NextRequest) {
  // Create base response
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  // Skip auth check if Supabase isn't configured
  if (!isSupabaseConfigured) {
    return response;
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          // Update request cookies
          request.cookies.set({ name, value, ...options });
          // Create new response with updated cookies
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: '', ...options });
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          response.cookies.set({ name, value: '', ...options });
        },
      },
    }
  );

  // Get user - this also refreshes the session if needed
  const { data: { user }, error } = await supabase.auth.getUser();
  
  const pathname = request.nextUrl.pathname;
  
  // Define route types
  const isLoginPage = pathname === '/login';
  const isPublicPath = pathname.startsWith('/api') || 
                       pathname.startsWith('/auth') ||
                       pathname === '/';
  const isProtectedPath = pathname.startsWith('/bids') || 
                          pathname.startsWith('/clients') || 
                          pathname.startsWith('/intake') || 
                          pathname.startsWith('/api-docs') ||
                          pathname.startsWith('/admin') ||
                          pathname.startsWith('/workspace') ||
                          pathname.startsWith('/profile');

  // Redirect logged-in users away from login page
  if (isLoginPage && user) {
    const redirectUrl = request.nextUrl.searchParams.get('redirect') || '/';
    return NextResponse.redirect(new URL(redirectUrl, request.url));
  }

  // Redirect unauthenticated users to login for protected paths
  if (isProtectedPath && !user) {
    const redirectUrl = new URL('/login', request.url);
    redirectUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}
