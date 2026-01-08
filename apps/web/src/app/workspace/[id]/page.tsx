'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/use-auth';
import { Loader2 } from 'lucide-react';

export default function WorkspacePage() {
  const params = useParams();
  const router = useRouter();
  const { switchWorkspace, workspaces, isLoading } = useAuth();
  const workspaceId = params.id as string;

  useEffect(() => {
    if (!isLoading) {
      const workspace = workspaces.find(w => w.id === workspaceId);
      if (workspace) {
        switchWorkspace(workspaceId);
        router.push('/');
      } else {
        // Workspace not found or no access
        router.push('/');
      }
    }
  }, [isLoading, workspaceId, workspaces, switchWorkspace, router]);

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

