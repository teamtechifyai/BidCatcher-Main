'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/use-auth';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { 
  UserPlus, 
  Mail, 
  Shield, 
  Building2, 
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  Trash2,
  Settings,
  Users,
  Crown
} from 'lucide-react';

interface User {
  id: string;
  email: string;
  name: string | null;
  role: 'owner' | 'admin' | 'user';
  active: boolean;
  created_at: string;
  last_login_at: string | null;
}

interface Client {
  id: string;
  name: string;
  slug: string;
}

interface WorkspaceMembership {
  id: string;
  user_id: string;
  client_id: string;
  workspace_role: string;
  is_default: boolean;
  client_name?: string;
}

export default function AdminUsersPage() {
  const router = useRouter();
  const { user: currentUser, isOwner, isAdmin, workspaces, isLoading: authLoading } = useAuth();
  
  const [users, setUsers] = useState<User[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [memberships, setMemberships] = useState<WorkspaceMembership[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Invite dialog state
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'user'>('admin');
  const [inviteClientId, setInviteClientId] = useState<string>('');
  const [inviting, setInviting] = useState(false);
  
  // Manage memberships dialog
  const [managingUser, setManagingUser] = useState<User | null>(null);
  const [userMemberships, setUserMemberships] = useState<WorkspaceMembership[]>([]);
  const [addingMembership, setAddingMembership] = useState(false);
  const [newMembershipClientId, setNewMembershipClientId] = useState('');

  // For non-owners, get their workspace IDs for filtering
  const userWorkspaceIds = workspaces.map(w => w.id);

  useEffect(() => {
    if (!authLoading && isSupabaseConfigured) {
      // Only admins and owners can access this page
      if (!isAdmin) {
        router.push('/');
        return;
      }
      fetchData();
    }
  }, [authLoading, isAdmin, router]);

  // Auto-dismiss success/error messages after 6 seconds
  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  async function fetchData() {
    setLoading(true);
    try {
      const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const apiKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      
      // Fetch all memberships first (we'll use these to filter users for admins)
      const membershipsRes = await fetch(`${baseUrl}/rest/v1/workspace_memberships?select=*`, {
        headers: {
          'apikey': apiKey!,
          'Authorization': `Bearer ${apiKey}`,
        }
      });
      const membershipsData = await membershipsRes.json();
      setMemberships(membershipsData || []);
      
      // Fetch all users
      const usersRes = await fetch(`${baseUrl}/rest/v1/users?select=*&order=created_at.desc`, {
        headers: {
          'apikey': apiKey!,
          'Authorization': `Bearer ${apiKey}`,
        }
      });
      let usersData = await usersRes.json() || [];
      
      // For non-owners, filter to only show users in their workspaces
      if (!isOwner && userWorkspaceIds.length > 0) {
        // Get user IDs that have memberships in the admin's workspaces
        const allowedUserIds = new Set(
          (membershipsData || [])
            .filter((m: WorkspaceMembership) => userWorkspaceIds.includes(m.client_id))
            .map((m: WorkspaceMembership) => m.user_id)
        );
        // Always include the current user
        if (currentUser) {
          allowedUserIds.add(currentUser.id);
        }
        // Filter users to only those in allowed workspaces (exclude owners)
        usersData = usersData.filter((u: User) => 
          allowedUserIds.has(u.id) && u.role !== 'owner'
        );
      }
      setUsers(usersData);
      
      // Fetch clients - for owners get all, for admins only their workspaces
      let clientsUrl = `${baseUrl}/rest/v1/clients?select=id,name,slug&active=eq.true&order=name`;
      if (!isOwner && userWorkspaceIds.length > 0) {
        clientsUrl += `&id=in.(${userWorkspaceIds.join(',')})`;
      }
      const clientsRes = await fetch(clientsUrl, {
        headers: {
          'apikey': apiKey!,
          'Authorization': `Bearer ${apiKey}`,
        }
      });
      const clientsData = await clientsRes.json();
      setClients(clientsData || []);
      
    } catch (err) {
      setError('Failed to load data');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleInviteUser(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    setError(null);
    setSuccess(null);

    // Admins must select a workspace
    const selectedClientId = inviteClientId && inviteClientId !== '__none__' ? inviteClientId : null;
    if (!isOwner && !selectedClientId) {
      setError('Please select a workspace to invite the user to');
      setInviting(false);
      return;
    }

    // Admins can only invite to their own workspaces
    if (!isOwner && selectedClientId && !userWorkspaceIds.includes(selectedClientId)) {
      setError('You can only invite users to your own workspaces');
      setInviting(false);
      return;
    }

    try {
      const res = await fetch('/api/admin/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail,
          name: inviteName,
          role: inviteRole,
          clientId: selectedClientId,
        }),
      });

      const data = await res.json();

      if (data.success) {
        let message = data.data.message;
        
        // If a temp password was generated, show it
        if (data.data.tempPassword) {
          message += `\n\nTemporary Password: ${data.data.tempPassword}\n\nShare this password securely with the user.`;
          // Also copy to clipboard
          navigator.clipboard?.writeText(data.data.tempPassword);
        }
        
        if (data.data.inviteLink) {
          message += `\n\nInvite Link: ${data.data.inviteLink}`;
          navigator.clipboard?.writeText(data.data.inviteLink);
        }
        
        setSuccess(message);
        setInviteOpen(false);
        setInviteEmail('');
        setInviteName('');
        setInviteRole('admin');
        setInviteClientId('');
        fetchData();
      } else {
        if (data.error?.code === 'USER_EXISTS') {
          setError(`${data.error.message} You can add them to workspaces using the "Workspaces" button.`);
        } else {
          setError(data.error?.message || 'Failed to send invitation');
        }
      }
    } catch (err) {
      setError('Failed to send invitation');
    } finally {
      setInviting(false);
    }
  }

  async function handleUpdateRole(userId: string, newRole: 'owner' | 'admin' | 'user') {
    setError(null);
    setSuccess(null);

    // Users cannot change their own role
    if (userId === currentUser?.id) {
      setError('You cannot change your own role');
      return;
    }

    // Admins cannot promote users to owner
    if (!isOwner && newRole === 'owner') {
      setError('Only owners can promote users to owner role');
      return;
    }

    // Admins cannot change roles of users outside their workspaces
    if (!isOwner) {
      const userInWorkspace = memberships.some(
        m => m.user_id === userId && userWorkspaceIds.includes(m.client_id)
      );
      if (!userInWorkspace) {
        setError('You can only change roles for users in your workspaces');
        return;
      }
    }

    try {
      const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const apiKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      
      const res = await fetch(`${baseUrl}/rest/v1/users?id=eq.${userId}`, {
        method: 'PATCH',
        headers: {
          'apikey': apiKey!,
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation',
        },
        body: JSON.stringify({ role: newRole }),
      });

      if (res.ok) {
        setSuccess('Role updated successfully');
        fetchData();
      } else {
        setError('Failed to update role');
      }
    } catch (err) {
      setError('Failed to update role');
    }
  }

  async function handleDeactivateUser(userId: string) {
    setError(null);
    setSuccess(null);

    // Admins can only deactivate users in their workspaces
    if (!isOwner) {
      const userInWorkspace = memberships.some(
        m => m.user_id === userId && userWorkspaceIds.includes(m.client_id)
      );
      if (!userInWorkspace) {
        setError('You can only deactivate users in your workspaces');
        return;
      }
    }

    try {
      const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const apiKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      
      const res = await fetch(`${baseUrl}/rest/v1/users?id=eq.${userId}`, {
        method: 'PATCH',
        headers: {
          'apikey': apiKey!,
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ active: false }),
      });

      if (res.ok) {
        setSuccess('User deactivated');
        fetchData();
      } else {
        setError('Failed to deactivate user');
      }
    } catch (err) {
      setError('Failed to deactivate user');
    }
  }

  async function openMembershipManager(user: User) {
    setManagingUser(user);
    const userMs = memberships.filter(m => m.user_id === user.id);
    // Add client names to memberships
    const withNames = userMs.map(m => ({
      ...m,
      client_name: clients.find(c => c.id === m.client_id)?.name || 'Unknown'
    }));
    setUserMemberships(withNames);
  }

  async function handleAddMembership() {
    if (!managingUser || !newMembershipClientId) return;
    
    // Admins can only add users to their own workspaces
    if (!isOwner && !userWorkspaceIds.includes(newMembershipClientId)) {
      setError('You can only add users to your own workspaces');
      return;
    }
    
    setAddingMembership(true);
    setError(null);

    try {
      const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const apiKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      
      const res = await fetch(`${baseUrl}/rest/v1/workspace_memberships`, {
        method: 'POST',
        headers: {
          'apikey': apiKey!,
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation',
        },
        body: JSON.stringify({
          user_id: managingUser.id,
          client_id: newMembershipClientId,
          workspace_role: managingUser.role === 'admin' ? 'admin' : 'member',
          is_default: userMemberships.length === 0,
        }),
      });

      if (res.ok) {
        setSuccess('Workspace access added');
        setNewMembershipClientId('');
        fetchData();
        // Refresh memberships for this user
        const newMembership = await res.json();
        setUserMemberships([...userMemberships, {
          ...newMembership[0],
          client_name: clients.find(c => c.id === newMembershipClientId)?.name
        }]);
      } else {
        const errData = await res.json();
        setError(errData.message || 'Failed to add workspace access');
      }
    } catch (err) {
      setError('Failed to add workspace access');
    } finally {
      setAddingMembership(false);
    }
  }

  async function handleRemoveMembership(membershipId: string) {
    setError(null);

    // Admins can only remove users from their own workspaces
    const membership = userMemberships.find(m => m.id === membershipId);
    if (!isOwner && membership && !userWorkspaceIds.includes(membership.client_id)) {
      setError('You can only remove users from your own workspaces');
      return;
    }

    try {
      const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const apiKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      
      const res = await fetch(`${baseUrl}/rest/v1/workspace_memberships?id=eq.${membershipId}`, {
        method: 'DELETE',
        headers: {
          'apikey': apiKey!,
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      if (res.ok) {
        setSuccess('Workspace access removed');
        setUserMemberships(userMemberships.filter(m => m.id !== membershipId));
        fetchData();
      } else {
        setError('Failed to remove workspace access');
      }
    } catch (err) {
      setError('Failed to remove workspace access');
    }
  }

  function getRoleBadge(role: string) {
    switch (role) {
      case 'owner':
        return <Badge variant="default" className="gap-1"><Crown className="h-3 w-3" />Owner</Badge>;
      case 'admin':
        return <Badge variant="secondary" className="gap-1"><Shield className="h-3 w-3" />Admin</Badge>;
      default:
        return <Badge variant="outline">User</Badge>;
    }
  }

  function getUserWorkspaces(userId: string): string {
    const userMs = memberships.filter(m => m.user_id === userId);
    if (userMs.length === 0) return 'None';
    return userMs.map(m => clients.find(c => c.id === m.client_id)?.name || 'Unknown').join(', ');
  }

  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Only admins and owners can view this page
  if (!isAdmin) {
    return null;
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Users className="h-8 w-8" />
            {isOwner ? 'User Management' : 'Team Management'}
          </h1>
          <p className="text-muted-foreground mt-1">
            {isOwner 
              ? 'Manage all users, roles, and workspace access'
              : 'Manage users in your workspaces'
            }
          </p>
        </div>
        
        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <UserPlus className="h-4 w-4" />
              Invite User
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Invite New User</DialogTitle>
              <DialogDescription>
                {isOwner 
                  ? 'Send an invitation email to add a new user to the platform.'
                  : 'Invite a user to join your workspace.'
                }
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleInviteUser} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="invite-email">Email Address</Label>
                <Input
                  id="invite-email"
                  type="email"
                  placeholder="user@company.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-name">Name (optional)</Label>
                <Input
                  id="invite-name"
                  placeholder="John Smith"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-role">Role</Label>
                <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as 'admin' | 'user')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">
                      <div className="flex items-center gap-2">
                        <Shield className="h-4 w-4" />
                        Admin - Can manage workspace config & bids
                      </div>
                    </SelectItem>
                    <SelectItem value="user">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4" />
                        User - Can upload bids only
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-client">
                  Assign to Workspace {isOwner ? '(optional)' : '(required)'}
                </Label>
                <Select 
                  value={inviteClientId || (isOwner ? '__none__' : '')} 
                  onValueChange={(v) => setInviteClientId(v === '__none__' ? '' : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a workspace..." />
                  </SelectTrigger>
                  <SelectContent>
                    {isOwner && (
                      <SelectItem value="__none__">No workspace (assign later)</SelectItem>
                    )}
                    {clients.map(client => (
                      <SelectItem key={client.id} value={client.id}>
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4" />
                          {client.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!isOwner && (
                  <p className="text-xs text-muted-foreground">
                    You can only invite users to your own workspaces
                  </p>
                )}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={inviting} className="gap-2">
                  {inviting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Mail className="h-4 w-4" />
                  )}
                  Send Invitation
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Messages */}
      {success && (
        <Card className="border-green-800 bg-green-950/20">
          <CardContent className="py-3 flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
            <pre className="text-sm text-green-500 whitespace-pre-wrap font-sans">{success}</pre>
          </CardContent>
        </Card>
      )}
      {error && (
        <Card className="border-destructive bg-destructive/10">
          <CardContent className="py-3 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <p className="text-sm text-destructive whitespace-pre-wrap">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      <div className={`grid grid-cols-1 gap-4 ${isOwner ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{users.length}</div>
            <p className="text-sm text-muted-foreground">
              {isOwner ? 'Total Users' : 'Team Members'}
            </p>
          </CardContent>
        </Card>
        {isOwner && (
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{users.filter(u => u.role === 'owner').length}</div>
              <p className="text-sm text-muted-foreground">Owners</p>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{users.filter(u => u.role === 'admin').length}</div>
            <p className="text-sm text-muted-foreground">Admins</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{users.filter(u => u.active).length}</div>
            <p className="text-sm text-muted-foreground">Active</p>
          </CardContent>
        </Card>
      </div>

      {/* Users Table */}
      <Card>
        <CardHeader>
          <CardTitle>{isOwner ? 'All Users' : 'Team Members'}</CardTitle>
          <CardDescription>
            {isOwner 
              ? 'Manage user accounts and their workspace access'
              : 'Manage team members in your workspaces'
            }
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Workspaces</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Login</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <div>
                      <div className="font-medium">{user.name || 'No name'}</div>
                      <div className="text-sm text-muted-foreground">{user.email}</div>
                    </div>
                  </TableCell>
                  <TableCell>{getRoleBadge(user.role)}</TableCell>
                  <TableCell>
                    <div className="text-sm max-w-[200px] truncate">
                      {user.role === 'owner' ? (
                        <span className="text-muted-foreground italic">All workspaces</span>
                      ) : (
                        getUserWorkspaces(user.id)
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.active ? 'success' : 'secondary'}>
                      {user.active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {user.last_login_at 
                      ? new Date(user.last_login_at).toLocaleDateString()
                      : 'Never'
                    }
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {user.role !== 'owner' && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openMembershipManager(user)}
                            className="gap-1"
                          >
                            <Building2 className="h-3 w-3" />
                            Workspaces
                          </Button>
                          {user.id !== currentUser?.id ? (
                            <Select
                              value={user.role}
                              onValueChange={(v) => handleUpdateRole(user.id, v as any)}
                            >
                              <SelectTrigger className="w-[100px] h-8">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="admin">Admin</SelectItem>
                                <SelectItem value="user">User</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge variant="outline" className="h-8 px-3">
                              {user.role === 'admin' ? 'Admin' : 'User'}
                            </Badge>
                          )}
                          {user.id !== currentUser?.id && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="sm" className="text-destructive">
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Deactivate User</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Deactivate {user.email}? They will no longer be able to access the platform.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => handleDeactivateUser(user.id)}>
                                    Deactivate
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                        </>
                      )}
                      {user.role === 'owner' && user.id === currentUser?.id && (
                        <span className="text-sm text-muted-foreground">You</span>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Workspace Management Dialog */}
      <Dialog open={!!managingUser} onOpenChange={(open) => !open && setManagingUser(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Manage Workspace Access</DialogTitle>
            <DialogDescription>
              {managingUser?.email} - Assign or remove workspace access
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* Current Workspaces */}
            <div>
              <Label className="text-sm font-medium">Current Workspaces</Label>
              {userMemberships.length === 0 ? (
                <p className="text-sm text-muted-foreground mt-2">No workspace access assigned</p>
              ) : (
                <div className="space-y-2 mt-2">
                  {userMemberships.map((m) => {
                    // Admins can only remove users from their own workspaces
                    const canRemove = isOwner || userWorkspaceIds.includes(m.client_id);
                    return (
                      <div key={m.id} className="flex items-center justify-between p-2 border rounded-lg">
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                          <span>{m.client_name}</span>
                          {m.is_default && (
                            <Badge variant="outline" className="text-xs">Default</Badge>
                          )}
                          {!canRemove && (
                            <Badge variant="secondary" className="text-xs">Other workspace</Badge>
                          )}
                        </div>
                        {canRemove && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            onClick={() => handleRemoveMembership(m.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            
            {/* Add Workspace */}
            <div className="border-t pt-4">
              <Label className="text-sm font-medium">Add Workspace Access</Label>
              <div className="flex gap-2 mt-2">
                <Select value={newMembershipClientId} onValueChange={setNewMembershipClientId}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select workspace..." />
                  </SelectTrigger>
                  <SelectContent>
                    {clients
                      .filter(c => !userMemberships.some(m => m.client_id === c.id))
                      .map(client => (
                        <SelectItem key={client.id} value={client.id}>
                          {client.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <Button 
                  onClick={handleAddMembership} 
                  disabled={!newMembershipClientId || addingMembership}
                >
                  {addingMembership ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    'Add'
                  )}
                </Button>
              </div>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setManagingUser(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
