/** @type {import('next').NextConfig} */

// API URL for server-side rewrites (build time)
const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

const nextConfig = {
  reactStrictMode: true,
  
  // Transpile Supabase packages
  transpilePackages: ['@supabase/ssr', '@supabase/supabase-js'],
  
  // API rewrites to proxy requests to the backend
  async rewrites() {
    console.log('[Next.js Config] API rewrites destination:', API_URL);
    return [
      {
        source: '/api/:path*',
        destination: `${API_URL}/:path*`,
      },
    ];
  },
  
  // Environment variables validation
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  },
  
  // Increase body size limit for large file uploads (50MB)
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
};

module.exports = nextConfig;
