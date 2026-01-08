'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/hooks/use-auth';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

export function MainNav() {
  const pathname = usePathname();
  const { user, isOwner, isAdmin, currentWorkspace, workspaces } = useAuth();

  // If auth isn't configured, show all nav items for development
  if (!isSupabaseConfigured) {
    const navItems = [
      { href: '/clients', label: 'Clients' },
      { href: '/intake', label: 'Submit Bid' },
      { href: '/bids', label: 'Bid Queue' },
      { href: '/api-docs', label: 'API' },
    ];
    
    return (
      <nav className="flex items-center gap-6">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'text-sm font-medium transition-colors hover:text-foreground',
              pathname === item.href || pathname.startsWith(item.href + '/')
                ? 'text-foreground'
                : 'text-muted-foreground'
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    );
  }

  if (!user) return null;

  // Check if user has any workspace access (owners can see all, others need workspace memberships)
  const hasWorkspaceAccess = isOwner || workspaces.length > 0;

  const navItems = [
    // Owner-only: Clients management (when viewing all workspaces)
    ...(isOwner && !currentWorkspace ? [
      { href: '/clients', label: 'Clients' },
    ] : []),
    // Admin+ in workspace: Configuration 
    ...(isAdmin && currentWorkspace ? [
      { href: `/workspace/${currentWorkspace.id}/config`, label: 'Configuration' },
    ] : []),
    // Only show if user has workspace access
    ...(hasWorkspaceAccess ? [
      { href: '/intake', label: 'Submit Bid' },
      { href: '/bids', label: 'Bid Queue' },
    ] : []),
    // Owner-only: API docs
    ...(isOwner ? [
      { href: '/api-docs', label: 'API' },
    ] : []),
  ];

  return (
    <nav className="flex items-center gap-6">
      {navItems.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            'text-sm font-medium transition-colors hover:text-foreground',
            pathname === item.href || pathname.startsWith(item.href + '/')
              ? 'text-foreground'
              : 'text-muted-foreground'
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
