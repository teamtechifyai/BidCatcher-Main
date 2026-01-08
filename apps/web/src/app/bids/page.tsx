'use client';

import { useState, useEffect, Fragment } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/hooks/use-auth';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { RefreshCw, Trash2, X, ExternalLink, Filter, FileText, Building2, Loader2, ChevronDown, ChevronUp, Brain, Zap } from 'lucide-react';
import { WorkspaceIndicator } from '@/components/workspace-switcher';

interface ExtractedField {
  fieldKey: string;
  extractedValue: unknown;
  confidence: number | null;
}

interface LatestDecision {
  outcome: string;
  totalScore: number | null;
  scorePercentage: number | null;
  rationale: string | null;
  evaluatedBy: string | null;
  evaluationMethod: string | null;
  aiEvaluation: {
    recommendation?: string;
    confidence?: number;
    reasoning?: string;
    riskFactors?: string[];
  } | null;
  decidedAt: string;
}

interface Bid {
  id: string;
  clientId: string;
  clientName: string | null;
  projectName: string | null;
  senderEmail: string | null;
  senderCompany: string | null;
  intakeSource: string;
  status: string;
  receivedAt: string;
  createdAt: string;
  extractedFields?: ExtractedField[];
  customFields?: Record<string, unknown> | null;
  confidenceScores?: Record<string, number> | null;
  latestDecision?: LatestDecision | null;
}

interface Client {
  id: string;
  name: string;
  slug: string;
}

interface DecisionData {
  currentOutcome: string;
}

export default function BidsPage() {
  const { user, isOwner: authIsOwner, isAdmin: authIsAdmin, currentWorkspace, workspaces, isLoading: authLoading } = useAuth();
  
  // If auth isn't configured, treat as owner (for development)
  const isOwner = !isSupabaseConfigured || authIsOwner;
  const isAdmin = !isSupabaseConfigured || authIsAdmin;
  
  const [bids, setBids] = useState<Bid[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [decisions, setDecisions] = useState<Record<string, DecisionData>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedBid, setExpandedBid] = useState<string | null>(null);
  
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [clientFilter, setClientFilter] = useState<string>('all');
  const [decisionFilter, setDecisionFilter] = useState<string>('all');

  useEffect(() => {
    if (!authLoading || !isSupabaseConfigured) {
      fetchClients();
    }
  }, [authLoading, isAdmin, workspaces]);

  useEffect(() => {
    if (!authLoading || !isSupabaseConfigured) {
      fetchBids();
    }
  }, [authLoading, statusFilter, clientFilter, currentWorkspace, workspaces, isAdmin]);

  // Auto-dismiss error messages after 6 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  async function fetchClients() {
    try {
      const res = await fetch('/api/clients');
      const data = await res.json();
      if (data.success && data.data) {
        // Filter clients based on workspace access
        let filteredClients = data.data;
        if (!isAdmin) {
          const workspaceIds = workspaces.map(w => w.id);
          filteredClients = data.data.filter((c: Client) => workspaceIds.includes(c.id));
        }
        setClients(filteredClients);
      }
    } catch {
      // Ignore
    }
  }

  async function fetchBids() {
    // Don't fetch if user has no workspace access (only owners can view all)
    if (isSupabaseConfigured && !isOwner && workspaces.length === 0) {
      setBids([]);
      setLoading(false);
      return;
    }
    
    try {
      setLoading(true);
      const params = new URLSearchParams();
      
      // Get the list of accessible workspace IDs for this user
      const accessibleWorkspaceIds = isAdmin 
        ? null // Admin can see all
        : workspaces.map(w => w.id);
      
      // Filter by current workspace if selected
      if (currentWorkspace) {
        params.set('clientId', currentWorkspace.id);
      } else if (clientFilter && clientFilter !== 'all') {
        // Apply client filter if set
        params.set('clientId', clientFilter);
      }
      
      if (statusFilter && statusFilter !== 'all') params.set('status', statusFilter);
      params.set('limit', '100');

      const res = await fetch(`/api/bids?${params}`);
      const data = await res.json();

      if (data.success !== false) {
        let bidsList = data.data?.bids || data.bids || [];
        
        // Client-side filtering for non-admin users to ensure they only see allowed bids
        if (!isAdmin && accessibleWorkspaceIds) {
          bidsList = bidsList.filter((b: Bid) => accessibleWorkspaceIds.includes(b.clientId));
        }
        
        setBids(bidsList);
        
        // Build decisions map from latestDecision included in bids
        const decisionsMap: Record<string, DecisionData> = {};
        for (const bid of bidsList) {
          if (bid.latestDecision) {
            decisionsMap[bid.id] = { currentOutcome: bid.latestDecision.outcome };
          }
        }
        setDecisions(decisionsMap);
      } else {
        setError(data.error?.message || 'Failed to fetch bids');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch bids');
    } finally {
      setLoading(false);
    }
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function getStatusBadge(status: string) {
    switch (status) {
      case 'new':
        return <Badge variant="info">New</Badge>;
      case 'in_review':
        return <Badge variant="warning">In Review</Badge>;
      case 'qualified':
        return <Badge variant="success">Qualified</Badge>;
      case 'rejected':
        return <Badge variant="destructive">Rejected</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  }

  function getDecisionBadge(outcome: string | undefined) {
    switch (outcome) {
      case 'GO':
        return <Badge variant="success">GO</Badge>;
      case 'MAYBE':
        return <Badge variant="warning">MAYBE</Badge>;
      case 'NO':
        return <Badge variant="destructive">NO</Badge>;
      default:
        return <Badge variant="outline">-</Badge>;
    }
  }

  async function handleDelete(bidId: string) {
    try {
      const res = await fetch(`/api/bids/${bidId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setBids(bids.filter(b => b.id !== bidId));
      } else {
        setError(data.error?.message || 'Failed to delete bid');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete bid');
    }
  }

  function clearFilters() {
    setStatusFilter('all');
    setClientFilter('all');
    setDecisionFilter('all');
  }

  const filteredBids = decisionFilter && decisionFilter !== 'all'
    ? bids.filter(bid => {
        const outcome = decisions[bid.id]?.currentOutcome || 'NONE';
        return outcome === decisionFilter;
      })
    : bids;

  const hasActiveFilters = statusFilter !== 'all' || clientFilter !== 'all' || decisionFilter !== 'all';

  const bidsByClient = bids.reduce((acc, bid) => {
    const clientName = bid.clientName || 'Unknown';
    acc[clientName] = (acc[clientName] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  if (authLoading && isSupabaseConfigured) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // No workspaces assigned - only owners can view without workspace memberships
  if (isSupabaseConfigured && !isOwner && workspaces.length === 0) {
    return (
      <div className="max-w-3xl mx-auto">
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">You don&apos;t have access to any workspaces yet.</p>
            <p className="text-sm text-muted-foreground mt-1">Contact an administrator to get access.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Bid Queue</h1>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-muted-foreground">
              {filteredBids.length} bid{filteredBids.length !== 1 ? 's' : ''}
              {hasActiveFilters && ` (filtered from ${bids.length})`}
            </p>
            <WorkspaceIndicator />
          </div>
        </div>
        
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 p-1 bg-muted rounded-lg">
            <Filter className="h-4 w-4 text-muted-foreground ml-2" />
            
            {/* Only show client filter if admin viewing all workspaces or has multiple workspaces */}
            {((isAdmin && !currentWorkspace) || (!isAdmin && workspaces.length > 1)) && (
              <Select value={clientFilter} onValueChange={setClientFilter}>
                <SelectTrigger className="w-[160px] border-0 bg-transparent">
                  <SelectValue placeholder="All Clients" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Clients</SelectItem>
                  {clients.map(client => (
                    <SelectItem key={client.id} value={client.id}>
                      {client.name} {bidsByClient[client.name] ? `(${bidsByClient[client.name]})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[130px] border-0 bg-transparent">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="in_review">In Review</SelectItem>
                <SelectItem value="qualified">Qualified</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>

            <Select value={decisionFilter} onValueChange={setDecisionFilter}>
              <SelectTrigger className="w-[130px] border-0 bg-transparent">
                <SelectValue placeholder="All Decisions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Decisions</SelectItem>
                <SelectItem value="GO">GO</SelectItem>
                <SelectItem value="MAYBE">MAYBE</SelectItem>
                <SelectItem value="NO">NO</SelectItem>
                <SelectItem value="NONE">No Decision</SelectItem>
              </SelectContent>
            </Select>

            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8">
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
          
          <Button variant="outline" size="sm" onClick={fetchBids} className="h-9">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Client Summary Cards - Only show when admin viewing all or multiple workspaces */}
      {((isAdmin && !currentWorkspace) || (!isAdmin && workspaces.length > 1)) && 
       (!clientFilter || clientFilter === 'all') && clients.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {clients.map(client => {
            const count = bidsByClient[client.name] || 0;
            return (
              <Card
                key={client.id}
                className={`cursor-pointer transition-all hover:shadow-md ${count > 0 ? 'hover:border-foreground/20' : 'opacity-60'}`}
                onClick={() => count > 0 && setClientFilter(client.id)}
              >
                <CardContent className="p-4 text-center">
                  <p className="text-sm font-medium truncate">{client.name}</p>
                  <p className="text-2xl font-bold mt-1">{count}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-3" />
            Loading bids...
          </CardContent>
        </Card>
      )}

      {/* Error State */}
      {error && (
        <Card className="border-destructive">
          <CardContent className="py-6 text-destructive text-center">
            {error}
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {!loading && !error && filteredBids.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              {hasActiveFilters 
                ? 'No bids match the selected filters.' 
                : currentWorkspace
                  ? `No bids found for ${currentWorkspace.name}.`
                  : 'No bids found. Submit a bid via the intake form to get started.'}
            </p>
            {hasActiveFilters && (
              <Button variant="link" onClick={clearFilters} className="mt-2">
                Clear filters
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Bids Table */}
      {!loading && filteredBids.length > 0 && (
        <Card>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[30%]">Project</TableHead>
                {/* Only show client column when viewing multiple clients */}
                {((isAdmin && !currentWorkspace) || (!isAdmin && workspaces.length > 1)) && (
                  <TableHead>Client</TableHead>
                )}
                <TableHead className="text-center">Source</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-center">Decision</TableHead>
                <TableHead>Received</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredBids.map((bid) => (
                <Fragment key={bid.id}>
                  <TableRow 
                    className={`group cursor-pointer ${expandedBid === bid.id ? 'bg-muted/50' : ''}`}
                    onClick={() => setExpandedBid(expandedBid === bid.id ? null : bid.id)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="text-muted-foreground">
                          {expandedBid === bid.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </div>
                        <div>
                          <p className="font-medium">
                            {bid.projectName || 'Untitled Project'}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {bid.senderCompany || bid.senderEmail || 'Unknown sender'}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    {((isAdmin && !currentWorkspace) || (!isAdmin && workspaces.length > 1)) && (
                      <TableCell>
                        <Button
                          variant="link"
                          className="p-0 h-auto font-normal"
                          onClick={(e) => { e.stopPropagation(); setClientFilter(bid.clientId); }}
                        >
                          {bid.clientName || 'Unknown'}
                        </Button>
                      </TableCell>
                    )}
                    <TableCell className="text-center">
                      <span className="text-sm capitalize text-muted-foreground">
                        {bid.intakeSource}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">{getStatusBadge(bid.status)}</TableCell>
                    <TableCell className="text-center">
                      <div className="flex flex-col items-center gap-1">
                        {getDecisionBadge(bid.latestDecision?.outcome || decisions[bid.id]?.currentOutcome)}
                        {bid.latestDecision?.scorePercentage != null && (
                          <span className="text-xs text-muted-foreground">{bid.latestDecision.scorePercentage}%</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {formatDate(bid.receivedAt)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="sm" asChild className="h-8 w-8 p-0" onClick={(e) => e.stopPropagation()}>
                          <Link href={`/bids/${bid.id}`}>
                            <ExternalLink className="h-4 w-4" />
                          </Link>
                        </Button>
                        {isAdmin && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={(e) => e.stopPropagation()}>
                                <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Bid</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to delete &quot;{bid.projectName || 'Untitled'}&quot;? 
                                  This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleDelete(bid.id)}>
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  
                  {/* Expanded Row with Details */}
                  {expandedBid === bid.id && (
                    <TableRow key={`${bid.id}-details`} className="bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={7} className="p-0">
                        <div className="p-6 grid md:grid-cols-2 gap-6">
                          {/* Extracted/Custom Fields */}
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 text-sm font-medium">
                                <Zap className="h-4 w-4 text-yellow-500" />
                                {bid.extractedFields && bid.extractedFields.length > 0 ? 'Extracted Fields' : 'Submitted Data'}
                                <Badge variant="outline" className="text-xs">
                                  {bid.extractedFields?.length || Object.keys(bid.customFields || {}).length || 0}
                                </Badge>
                              </div>
                            </div>
                            {bid.extractedFields && bid.extractedFields.length > 0 ? (
                              <>
                                <div className="grid gap-2 max-h-[240px] overflow-y-auto pr-2 scrollbar-thin">
                                  {bid.extractedFields.slice(0, 10).map((field) => (
                                    <div key={field.fieldKey} className="flex items-start justify-between p-2 rounded border bg-background text-sm group/field">
                                      <div className="flex items-center gap-2">
                                        <div className={`w-1.5 h-1.5 rounded-full ${
                                          (field.confidence ?? 0) >= 0.8 ? 'bg-green-500' :
                                          (field.confidence ?? 0) >= 0.5 ? 'bg-yellow-500' : 'bg-red-500'
                                        }`} title={`${Math.round((field.confidence ?? 0) * 100)}% confidence`} />
                                        <span className="text-muted-foreground capitalize text-xs">{field.fieldKey.replace(/_/g, ' ')}</span>
                                      </div>
                                      <span className="font-medium text-right max-w-[55%] truncate text-xs" title={String(field.extractedValue || '')}>
                                        {field.extractedValue != null && String(field.extractedValue) !== '' 
                                          ? String(field.extractedValue).substring(0, 50) + (String(field.extractedValue).length > 50 ? '...' : '')
                                          : <span className="text-muted-foreground/50 italic">empty</span>}
                                      </span>
                                    </div>
                                  ))}
                                  {bid.extractedFields.length > 10 && (
                                    <p className="text-xs text-muted-foreground text-center py-1">+{bid.extractedFields.length - 10} more fields</p>
                                  )}
                                </div>
                                {/* Confidence Legend */}
                                <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1">
                                  <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-green-500" /> High</div>
                                  <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-yellow-500" /> Medium</div>
                                  <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-red-500" /> Low</div>
                                </div>
                              </>
                            ) : bid.customFields && Object.keys(bid.customFields).length > 0 ? (
                              <>
                                <div className="grid gap-2 max-h-[240px] overflow-y-auto pr-2 scrollbar-thin">
                                  {Object.entries(bid.customFields).slice(0, 10).map(([key, value]) => {
                                    const confidence = bid.confidenceScores?.[key];
                                    return (
                                      <div key={key} className="flex items-start justify-between p-2 rounded border bg-background text-sm group/field">
                                        <div className="flex items-center gap-2">
                                          {confidence !== undefined && (
                                            <div className={`w-1.5 h-1.5 rounded-full ${
                                              confidence >= 0.8 ? 'bg-green-500' :
                                              confidence >= 0.5 ? 'bg-yellow-500' : 'bg-red-500'
                                            }`} title={`${Math.round(confidence * 100)}% confidence`} />
                                          )}
                                          <span className="text-muted-foreground capitalize text-xs">{key.replace(/_/g, ' ')}</span>
                                        </div>
                                        <span className="font-medium text-right max-w-[55%] truncate text-xs" title={String(value || '')}>
                                          {value != null && String(value) !== '' 
                                            ? String(value).substring(0, 50) + (String(value).length > 50 ? '...' : '')
                                            : <span className="text-muted-foreground/50 italic">empty</span>}
                                        </span>
                                      </div>
                                    );
                                  })}
                                  {Object.keys(bid.customFields).length > 10 && (
                                    <p className="text-xs text-muted-foreground text-center py-1">+{Object.keys(bid.customFields).length - 10} more fields</p>
                                  )}
                                </div>
                                {/* Confidence Legend */}
                                {bid.confidenceScores && Object.keys(bid.confidenceScores).length > 0 && (
                                  <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1">
                                    <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-green-500" /> High</div>
                                    <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-yellow-500" /> Medium</div>
                                    <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-red-500" /> Low</div>
                                  </div>
                                )}
                              </>
                            ) : (
                              <div className="text-sm text-muted-foreground p-6 border rounded bg-background text-center border-dashed">
                                <Zap className="h-6 w-6 mx-auto mb-2 opacity-30" />
                                <p>No data available</p>
                                <p className="text-xs mt-1">Upload PDFs or enter data manually</p>
                              </div>
                            )}
                          </div>
                          
                          {/* Decision Details */}
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 text-sm font-medium">
                                <Brain className="h-4 w-4 text-purple-500" />
                                Decision Details
                              </div>
                              {bid.latestDecision && (
                                <span className="text-xs text-muted-foreground">
                                  {new Date(bid.latestDecision.decidedAt).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                            {bid.latestDecision ? (
                              <div className="space-y-3">
                                <div className="grid grid-cols-3 gap-2">
                                  <div className={`p-3 rounded border text-center ${
                                    bid.latestDecision.outcome === 'GO' ? 'bg-green-500/10 border-green-500/30' :
                                    bid.latestDecision.outcome === 'MAYBE' ? 'bg-yellow-500/10 border-yellow-500/30' :
                                    bid.latestDecision.outcome === 'NO' ? 'bg-red-500/10 border-red-500/30' : 'bg-background'
                                  }`}>
                                    <p className={`text-xl font-bold ${
                                      bid.latestDecision.outcome === 'GO' ? 'text-green-500' :
                                      bid.latestDecision.outcome === 'MAYBE' ? 'text-yellow-500' :
                                      bid.latestDecision.outcome === 'NO' ? 'text-red-500' : ''
                                    }`}>{bid.latestDecision.outcome}</p>
                                    <p className="text-xs text-muted-foreground">Decision</p>
                                  </div>
                                  <div className="p-3 rounded border bg-background text-center">
                                    <p className="text-xl font-bold">{bid.latestDecision.scorePercentage ?? '-'}%</p>
                                    <p className="text-xs text-muted-foreground">Score</p>
                                  </div>
                                  <div className="p-3 rounded border bg-background text-center">
                                    <p className="text-sm font-bold capitalize">{bid.latestDecision.evaluationMethod || 'rules'}</p>
                                    <p className="text-xs text-muted-foreground">Method</p>
                                  </div>
                                </div>
                                {bid.latestDecision.rationale && (
                                  <div className="p-3 rounded border bg-background">
                                    <p className="text-xs font-medium text-muted-foreground mb-1">Rationale</p>
                                    <p className="text-sm leading-relaxed">{bid.latestDecision.rationale.substring(0, 250)}{bid.latestDecision.rationale.length > 250 ? '...' : ''}</p>
                                  </div>
                                )}
                                {bid.latestDecision.aiEvaluation?.reasoning && (
                                  <div className="p-3 rounded border bg-purple-500/5 border-purple-500/20">
                                    <div className="flex items-center justify-between mb-2">
                                      <div className="flex items-center gap-2">
                                        <Brain className="h-3 w-3 text-purple-500" />
                                        <p className="text-xs font-medium text-purple-400">AI Analysis</p>
                                      </div>
                                      {bid.latestDecision.aiEvaluation.confidence && (
                                        <Badge variant="outline" className="text-xs border-purple-500/30 text-purple-400">
                                          {Math.round(bid.latestDecision.aiEvaluation.confidence * 100)}% confident
                                        </Badge>
                                      )}
                                    </div>
                                    <p className="text-sm text-muted-foreground leading-relaxed">{bid.latestDecision.aiEvaluation.reasoning.substring(0, 200)}{bid.latestDecision.aiEvaluation.reasoning.length > 200 ? '...' : ''}</p>
                                    {bid.latestDecision.aiEvaluation.riskFactors && bid.latestDecision.aiEvaluation.riskFactors.length > 0 && (
                                      <div className="flex flex-wrap gap-1 mt-2">
                                        {bid.latestDecision.aiEvaluation.riskFactors.slice(0, 3).map((risk: string, i: number) => (
                                          <Badge key={i} variant="outline" className="text-xs bg-red-500/10 border-red-500/30 text-red-400">{risk}</Badge>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="text-sm text-muted-foreground p-6 border rounded bg-background text-center border-dashed">
                                <Brain className="h-6 w-6 mx-auto mb-2 opacity-30" />
                                <p>No evaluation run yet</p>
                                <p className="text-xs mt-1">Click &quot;View Full Details&quot; to run an evaluation</p>
                              </div>
                            )}
                          </div>
                        </div>
                        
                        {/* Action Bar */}
                        <div className="px-6 pb-4 flex items-center justify-between border-t border-border/50 pt-4 mt-2">
                          <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <span>ID: <code className="bg-muted px-1 rounded">{bid.id.substring(0, 8)}...</code></span>
                            <span>Created: {formatDate(bid.createdAt)}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" asChild>
                              <Link href={`/bids/${bid.id}`}>
                                View Full Details
                                <ExternalLink className="h-3 w-3 ml-2" />
                              </Link>
                            </Button>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
