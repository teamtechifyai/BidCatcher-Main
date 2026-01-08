'use client';

import { useAuth } from '@/lib/hooks/use-auth';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Building2, Globe } from 'lucide-react';

export function WorkspaceSwitcher() {
  const { user, workspaces, currentWorkspace, isOwner, switchWorkspace } = useAuth();

  // Don't show workspace switcher if auth isn't configured
  if (!isSupabaseConfigured) return null;
  
  if (!user) return null;

  // Non-owners with 0 or 1 workspace just show the name (no dropdown)
  if (!isOwner && workspaces.length <= 1) {
    if (!currentWorkspace) return null;
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted">
        <Building2 className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">{currentWorkspace.name}</span>
      </div>
    );
  }

  // Non-owners with multiple workspaces get a switcher (but no "All" option)
  if (!isOwner && workspaces.length > 1) {
    return (
      <Select
        value={currentWorkspace?.id || workspaces[0]?.id}
        onValueChange={(value) => switchWorkspace(value)}
      >
        <SelectTrigger className="w-[200px] gap-2">
          <Building2 className="h-4 w-4" />
          <span className="truncate flex-1 text-left">
            {currentWorkspace?.name || workspaces[0]?.name}
          </span>
        </SelectTrigger>
        <SelectContent align="start">
          {workspaces.map((workspace) => (
            <SelectItem key={workspace.id} value={workspace.id}>
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                <span>{workspace.name}</span>
                {workspace.isDefault && (
                  <Badge variant="outline" className="text-[10px] ml-2">Default</Badge>
                )}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  // Owners always get the full switcher with "All Workspaces" option
  return (
    <Select
      value={currentWorkspace?.id || '__all__'}
      onValueChange={(value) => switchWorkspace(value === '__all__' ? null : value)}
    >
      <SelectTrigger className="w-[200px] gap-2">
        {currentWorkspace ? (
          <>
            <Building2 className="h-4 w-4" />
            <span className="truncate flex-1 text-left">{currentWorkspace.name}</span>
          </>
        ) : (
          <>
            <Globe className="h-4 w-4" />
            <span className="truncate flex-1 text-left">All Workspaces</span>
          </>
        )}
      </SelectTrigger>
      <SelectContent align="start">
        <SelectItem value="__all__" className="gap-2">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4" />
            <span>All Workspaces</span>
            <Badge variant="default" className="text-[10px] ml-2">Owner</Badge>
          </div>
        </SelectItem>
        {workspaces.length > 0 && <div className="h-px bg-border my-1" />}
        {workspaces.map((workspace) => (
          <SelectItem key={workspace.id} value={workspace.id}>
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              <span>{workspace.name}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function WorkspaceIndicator() {
  const { currentWorkspace, isOwner } = useAuth();

  if (!currentWorkspace && !isOwner) return null;

  return (
    <div className="flex items-center gap-2 text-sm">
      {currentWorkspace ? (
        <>
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Workspace:</span>
          <span className="font-medium">{currentWorkspace.name}</span>
        </>
      ) : isOwner ? (
        <>
          <Globe className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Viewing:</span>
          <span className="font-medium">All Workspaces</span>
          <Badge variant="default" className="text-[10px]">Owner</Badge>
        </>
      ) : null}
    </div>
  );
}
