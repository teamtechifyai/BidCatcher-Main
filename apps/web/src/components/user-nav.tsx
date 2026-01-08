'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/use-auth';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { LogOut, User, Settings, Shield } from 'lucide-react';

export function UserNav() {
  const router = useRouter();
  const { user, isOwner, isAdmin, signOut } = useAuth();

  // Don't show user nav if auth isn't configured
  if (!isSupabaseConfigured) return null;

  if (!user) {
    return (
      <Button variant="outline" size="sm" onClick={() => router.push('/login')}>
        Sign In
      </Button>
    );
  }

  const initials = user.name
    ? user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : user.email.slice(0, 2).toUpperCase();

  async function handleSignOut() {
    await signOut();
    // Hard reload to login to clear all state and cookies
    window.location.href = '/login';
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="relative h-9 w-9 rounded-full">
          <Avatar className="h-9 w-9">
            <AvatarImage src={user.avatarUrl || undefined} alt={user.name || user.email} />
            <AvatarFallback className="bg-primary text-primary-foreground">
              {initials}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end" forceMount>
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium leading-none">{user.name || 'User'}</p>
              {isOwner ? (
                <Badge variant="default" className="text-[10px] gap-1">
                  <Shield className="h-3 w-3" />
                  Owner
                </Badge>
              ) : isAdmin ? (
                <Badge variant="secondary" className="text-[10px] gap-1">
                  <Shield className="h-3 w-3" />
                  Admin
                </Badge>
              ) : null}
            </div>
            <p className="text-xs leading-none text-muted-foreground">
              {user.email}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => router.push('/profile')} className="cursor-pointer">
            <User className="mr-2 h-4 w-4" />
            <span>Profile</span>
          </DropdownMenuItem>
          {isAdmin && (
            <DropdownMenuItem onClick={() => router.push('/admin/users')} className="cursor-pointer">
              <Settings className="mr-2 h-4 w-4" />
              <span>{isOwner ? 'Manage Users' : 'Manage Team'}</span>
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer text-destructive focus:text-destructive">
          <LogOut className="mr-2 h-4 w-4" />
          <span>Sign Out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

