'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { Plus, Settings, FileInput, Trash2, AlertCircle, CheckCircle2, X, Users, Shield, Loader2 } from 'lucide-react';
import { isSupabaseConfigured } from '@/lib/supabase/client';

interface Client {
  id: string;
  name: string;
  slug: string;
  contactEmail: string;
  active: boolean;
}

export default function ClientsPage() {
  const router = useRouter();
  const { user, isOwner: authIsOwner, isLoading: authLoading, refreshUser } = useAuth();
  
  // If auth isn't configured, treat as owner (for development)
  const isOwner = !isSupabaseConfigured || authIsOwner;
  
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [newClient, setNewClient] = useState({
    name: '',
    contactEmail: '',
    contactName: '',
    phone: '',
    notes: '',
  });

  useEffect(() => {
    if (!authLoading || !isSupabaseConfigured) {
      if (isSupabaseConfigured && !isOwner) {
        // Only owners can manage clients
        router.push('/');
        return;
      }
      fetchClients();
    }
  }, [authLoading, isOwner, router]);

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

  async function fetchClients() {
    try {
      setLoading(true);
      const res = await fetch('/api/clients');
      const data = await res.json();
      if (data.success && data.data) {
        setClients(data.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load clients');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateClient(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newClient),
      });

      const data = await res.json();

      if (data.success) {
        setSuccess(`Client "${data.data.name}" created successfully! It's now available as a workspace.`);
        setNewClient({ name: '', contactEmail: '', contactName: '', phone: '', notes: '' });
        setShowCreateForm(false);
        fetchClients();
        // Refresh workspaces so the new client appears in the workspace switcher
        await refreshUser();
      } else {
        setError(data.error?.message || 'Failed to create client');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create client');
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteClient(clientId: string, clientName: string, hardDelete: boolean = false) {
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/clients/${clientId}${hardDelete ? '?hard=true' : ''}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      
      if (data.success) {
        setSuccess(data.data.message);
        if (hardDelete) {
          setClients(clients.filter(c => c.id !== clientId));
        } else {
          setClients(clients.map(c => c.id === clientId ? { ...c, active: false } : c));
        }
        // Refresh workspaces to remove deleted client
        await refreshUser();
      } else {
        setError(data.error?.message || 'Failed to delete client');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete client');
    }
  }

  if ((authLoading && isSupabaseConfigured) || loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isSupabaseConfigured && !isOwner) {
    return null; // Will redirect
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">Clients</h1>
            {isSupabaseConfigured && (
              <Badge variant="default" className="gap-1">
                <Shield className="h-3 w-3" />
                Owner
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground mt-1">
            Manage client configurations and intake schemas
          </p>
        </div>
        <Button onClick={() => setShowCreateForm(!showCreateForm)} className="w-fit">
          {showCreateForm ? (
            <>
              <X className="h-4 w-4 mr-2" />
              Cancel
            </>
          ) : (
            <>
              <Plus className="h-4 w-4 mr-2" />
              New Client
            </>
          )}
        </Button>
      </div>

      {/* Success Message */}
      {success && (
        <Card className="border-green-800 bg-green-950/20">
          <CardContent className="py-4 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
            <p className="text-green-500">{success}</p>
          </CardContent>
        </Card>
      )}

      {/* Error Message */}
      {error && (
        <Card className="border-destructive bg-destructive/10">
          <CardContent className="py-4 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
            <p className="text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Create Form */}
      {showCreateForm && (
        <Card>
          <CardHeader>
            <CardTitle>Create New Client</CardTitle>
            <CardDescription>Add a new client to the system</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreateClient} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="name">Company Name <span className="text-destructive">*</span></Label>
                  <Input
                    id="name"
                    value={newClient.name}
                    onChange={(e) => setNewClient({ ...newClient, name: e.target.value })}
                    required
                    placeholder="ABC Construction"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contactEmail">Contact Email <span className="text-destructive">*</span></Label>
                  <Input
                    id="contactEmail"
                    type="email"
                    value={newClient.contactEmail}
                    onChange={(e) => setNewClient({ ...newClient, contactEmail: e.target.value })}
                    required
                    placeholder="contact@company.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contactName">Contact Name</Label>
                  <Input
                    id="contactName"
                    value={newClient.contactName}
                    onChange={(e) => setNewClient({ ...newClient, contactName: e.target.value })}
                    placeholder="John Smith"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    type="tel"
                    value={newClient.phone}
                    onChange={(e) => setNewClient({ ...newClient, phone: e.target.value })}
                    placeholder="(555) 123-4567"
                  />
                </div>
                <div className="md:col-span-2 space-y-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea
                    id="notes"
                    value={newClient.notes}
                    onChange={(e) => setNewClient({ ...newClient, notes: e.target.value })}
                    placeholder="Any notes about this client..."
                    rows={3}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button type="button" variant="outline" onClick={() => setShowCreateForm(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={creating}>
                  {creating ? 'Creating...' : 'Create Client'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Loading State */}
      {loading && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Loading clients...
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {!loading && clients.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No clients found. Create one to get started.</p>
          </CardContent>
        </Card>
      )}

      {/* Clients Grid */}
      {!loading && clients.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {clients.map((client) => (
            <Card key={client.id} className="group hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-lg truncate">{client.name}</CardTitle>
                    <CardDescription className="truncate">{client.slug}</CardDescription>
                  </div>
                  <Badge variant={client.active ? 'success' : 'secondary'} className="shrink-0">
                    {client.active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground truncate">{client.contactEmail}</p>
                
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" asChild>
                    <Link href={`/clients/${client.id}`}>
                      <Settings className="h-4 w-4 mr-2" />
                      Configure
                    </Link>
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/intake?clientId=${client.id}`}>
                      <FileInput className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>
                
                <div className="flex gap-2 pt-3 border-t">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="flex-1 text-muted-foreground hover:text-yellow-500">
                        Deactivate
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Deactivate Client</AlertDialogTitle>
                        <AlertDialogDescription>
                          Deactivate &quot;{client.name}&quot;? You can reactivate later.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDeleteClient(client.id, client.name, false)}>
                          Deactivate
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Client Permanently</AlertDialogTitle>
                        <AlertDialogDescription>
                          PERMANENTLY delete &quot;{client.name}&quot; and ALL related bids? This cannot be undone!
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleDeleteClient(client.id, client.name, true)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Delete Permanently
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
