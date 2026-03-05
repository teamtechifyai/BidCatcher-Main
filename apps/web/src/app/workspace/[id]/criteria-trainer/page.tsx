'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ArrowLeft, Plus, Trash2, Sparkles, Loader2, Lock, CheckCircle2, AlertCircle, Target } from 'lucide-react';

interface OreSample {
  id: string;
  bidId: string;
  outcome: string;
  reason: string;
  notes?: string | null;
  projectName?: string | null;
  senderCompany?: string | null;
  createdAt: string;
}

interface Bid {
  id: string;
  projectName: string | null;
  senderCompany: string | null;
  clientId: string;
}

interface Client {
  id: string;
  name: string;
  slug: string;
}

const TARGET_PER_BUCKET = { yes: 15, maybe: 15, no: 15 };
const MIN_SAMPLES_TO_ANALYZE = 5;

export default function CriteriaTrainerPage() {
  const params = useParams();
  const workspaceId = params.id as string;
  const { isAdmin, currentWorkspace, workspaces, isLoading: authLoading } = useAuth();

  const [client, setClient] = useState<Client | null>(null);
  const [samples, setSamples] = useState<OreSample[]>([]);
  const [counts, setCounts] = useState({ GO: 0, MAYBE: 0, NO: 0 });
  const [bids, setBids] = useState<Bid[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [selectedBidId, setSelectedBidId] = useState<string>('');
  const [addOutcome, setAddOutcome] = useState<'GO' | 'MAYBE' | 'NO'>('GO');
  const [addReason, setAddReason] = useState('');
  const [addNotes, setAddNotes] = useState('');
  const [adding, setAdding] = useState(false);

  const [analyzing, setAnalyzing] = useState(false);
  const [proposedCriteria, setProposedCriteria] = useState<{
    criteria: Array<{
      criterionId: string;
      name: string;
      description?: string;
      type: string;
      weight: number;
      maxPoints: number;
      dependsOnSignals: string[];
      rules: Array<{ signal: string; condition: string; value?: unknown; points: number }>;
    }>;
    suggestedThresholds: { autoQualifyThreshold: number; autoDisqualifyThreshold: number };
    summary: string;
  } | null>(null);

  const hasAccess = isAdmin || workspaces.some((w) => w.id === workspaceId);
  const canEdit = isAdmin;

  useEffect(() => {
    if (!authLoading && hasAccess) {
      fetchData();
    }
  }, [authLoading, hasAccess, workspaceId]);

  useEffect(() => {
    if (success) {
      const t = setTimeout(() => setSuccess(null), 5000);
      return () => clearTimeout(t);
    }
  }, [success]);

  useEffect(() => {
    if (error) {
      const t = setTimeout(() => setError(null), 6000);
      return () => clearTimeout(t);
    }
  }, [error]);

  async function fetchData() {
    try {
      setLoading(true);
      const [clientRes, samplesRes, bidsRes] = await Promise.all([
        fetch(`/api/clients/${workspaceId}`),
        fetch(`/api/clients/${workspaceId}/ore-samples`),
        fetch(`/api/bids?clientId=${workspaceId}&limit=200`),
      ]);

      const clientData = await clientRes.json();
      const samplesData = await samplesRes.json();
      const bidsData = await bidsRes.json();

      if (clientData.success && clientData.data) {
        setClient(clientData.data);
      }
      if (samplesData.success && samplesData.data) {
        setSamples(samplesData.data.samples || []);
        setCounts(samplesData.data.counts || { GO: 0, MAYBE: 0, NO: 0 });
      }
      if (bidsData.success && (bidsData.data?.bids || bidsData.bids)) {
        const bidsList = bidsData.data?.bids || bidsData.bids;
        const sampleBidIds = new Set((samplesData.data?.samples || []).map((s: OreSample) => s.bidId));
        setBids(bidsList.filter((b: Bid) => !sampleBidIds.has(b.id)));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  async function handleAddSample() {
    if (!selectedBidId || !addReason.trim() || !canEdit) return;

    setAdding(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${workspaceId}/ore-samples`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bidId: selectedBidId,
          outcome: addOutcome,
          reason: addReason.trim(),
          notes: addNotes.trim() || undefined,
        }),
      });
      const data = await res.json();

      if (data.success) {
        setSuccess('Sample added');
        setAddDialogOpen(false);
        setSelectedBidId('');
        setAddReason('');
        setAddNotes('');
        fetchData();
      } else {
        setError(data.error?.message || 'Failed to add sample');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add');
    } finally {
      setAdding(false);
    }
  }

  async function handleRemoveSample(sampleId: string) {
    if (!canEdit) return;

    try {
      const res = await fetch(`/api/clients/${workspaceId}/ore-samples/${sampleId}`, {
        method: 'DELETE',
      });
      const data = await res.json();

      if (data.success) {
        setSuccess('Sample removed');
        fetchData();
      } else {
        setError(data.error?.message || 'Failed to remove');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove');
    }
  }

  async function handleAnalyze() {
    setAnalyzing(true);
    setError(null);
    setProposedCriteria(null);

    try {
      const res = await fetch(`/api/clients/${workspaceId}/ore-samples/analyze`, {
        method: 'POST',
      });
      const data = await res.json();

      if (data.success) {
        setProposedCriteria(data.data);
        setSuccess('Analysis complete');
      } else {
        setError(data.error?.message || 'Analysis failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  }

  const totalSamples = counts.GO + counts.MAYBE + counts.NO;
  const canAnalyze = totalSamples >= MIN_SAMPLES_TO_ANALYZE;

  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="max-w-4xl mx-auto">
        <Card className="border-destructive">
          <CardContent className="py-12 text-center">
            <Lock className="h-12 w-12 mx-auto text-destructive mb-4" />
            <p className="text-destructive">You don&apos;t have access to this workspace.</p>
            <Button variant="link" asChild className="mt-2">
              <Link href="/">Return to Dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="max-w-4xl mx-auto">
        <Card className="border-destructive">
          <CardContent className="py-6 text-destructive text-center">{error || 'Workspace not found'}</CardContent>
        </Card>
      </div>
    );
  }

  const bucketConfig = [
    { key: 'GO' as const, label: 'Yes', desc: 'Bids you would pursue', target: TARGET_PER_BUCKET.yes, color: 'green' },
    { key: 'MAYBE' as const, label: 'Maybe', desc: 'Yes with caveats', target: TARGET_PER_BUCKET.maybe, color: 'yellow' },
    { key: 'NO' as const, label: 'No', desc: 'Bids you would reject', target: TARGET_PER_BUCKET.no, color: 'red' },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-4 -ml-2">
          <Link href={`/workspace/${workspaceId}/config`}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Configuration
          </Link>
        </Button>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Criteria Trainer</h1>
            <p className="text-muted-foreground mt-1">
              Upload past bids into Yes / Maybe / No buckets. AI will analyze patterns and propose qualification rules.
            </p>
          </div>
        </div>
      </div>

      {success && (
        <Card className="border-green-800 bg-green-950/20">
          <CardContent className="py-4 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
            <p className="text-green-500">{success}</p>
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-destructive bg-destructive/10">
          <CardContent className="py-4 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
            <p className="text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Targets & Analyze */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5" />
                Ore Sample Targets
              </CardTitle>
              <CardDescription>
                Aim for 10–20 samples per bucket. Need at least {MIN_SAMPLES_TO_ANALYZE} total to run AI analysis.
              </CardDescription>
            </div>
            <Button
              onClick={handleAnalyze}
              disabled={!canAnalyze || analyzing}
              className="gap-2"
            >
              {analyzing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {analyzing ? 'Analyzing...' : 'Propose Criteria'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            {bucketConfig.map(({ key, label, target }) => (
              <div key={key} className="p-4 rounded-lg border bg-muted/30">
                <p className="text-sm font-medium text-muted-foreground">{label}</p>
                <p className="text-2xl font-bold mt-1">
                  {counts[key]} <span className="text-sm font-normal text-muted-foreground">/ {target}</span>
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Buckets */}
      <div className="grid gap-6 md:grid-cols-3">
        {bucketConfig.map(({ key, label, desc, color }) => {
          const bucketSamples = samples.filter((s) => s.outcome === key);
          return (
            <Card key={key}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">{label}</CardTitle>
                    <CardDescription>{desc}</CardDescription>
                  </div>
                  {canEdit && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setAddOutcome(key);
                        setAddDialogOpen(true);
                      }}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-[320px] overflow-y-auto">
                  {bucketSamples.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic py-4 text-center">No samples yet</p>
                  ) : (
                    bucketSamples.map((s) => (
                      <div
                        key={s.id}
                        className="flex items-start justify-between gap-2 p-3 rounded border bg-background group"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">{s.projectName || 'Untitled'}</p>
                          <p className="text-xs text-muted-foreground truncate">{s.reason}</p>
                          <Button variant="link" className="p-0 h-auto text-xs" asChild>
                            <Link href={`/bids/${s.bidId}`}>View bid</Link>
                          </Button>
                        </div>
                        {canEdit && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="opacity-0 group-hover:opacity-100 shrink-0 text-muted-foreground hover:text-destructive"
                            onClick={() => handleRemoveSample(s.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Proposed Criteria */}
      {proposedCriteria && (
        <Card>
          <CardHeader>
            <CardTitle>Proposed Qualification Criteria</CardTitle>
            <CardDescription>{proposedCriteria.summary}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              {proposedCriteria.criteria.map((c) => (
                <div key={c.criterionId} className="p-4 rounded border bg-muted/20">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{c.name}</p>
                    <Badge variant="outline">{c.type}</Badge>
                  </div>
                  {c.description && <p className="text-sm text-muted-foreground mt-1">{c.description}</p>}
                  <p className="text-xs text-muted-foreground mt-2">
                    Weight: {c.weight} × max {c.maxPoints} pts • Signals: {c.dependsOnSignals.join(', ')}
                  </p>
                  {c.rules?.length > 0 && (
                    <div className="mt-2 text-xs font-mono text-muted-foreground">
                      {c.rules.map((r, i) => (
                        <div key={i}>
                          {r.signal} {r.condition} {r.value != null ? String(r.value) : ''} → +{r.points} pts
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-4 pt-4 border-t">
              <p className="text-sm">
                Suggested thresholds: Qualify ≥{proposedCriteria.suggestedThresholds.autoQualifyThreshold}%,
                Disqualify ≤{proposedCriteria.suggestedThresholds.autoDisqualifyThreshold}%
              </p>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/workspace/${workspaceId}/config`}>
                  Review in Configuration
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Add Sample Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Ore Sample</DialogTitle>
            <DialogDescription>
              Add a bid to the {addOutcome === 'GO' ? 'Yes' : addOutcome === 'MAYBE' ? 'Maybe' : 'No'} bucket. Explain why it was classified this way.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>Select Bid</Label>
              <Select value={selectedBidId} onValueChange={setSelectedBidId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a bid..." />
                </SelectTrigger>
                <SelectContent>
                  {bids.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.projectName || 'Untitled'} {b.senderCompany && `(${b.senderCompany})`}
                    </SelectItem>
                  ))}
                  {bids.length === 0 && (
                    <div className="p-4 text-sm text-muted-foreground text-center">
                      No bids available. Submit bids first, or they may already be in a bucket.
                    </div>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Reason (required)</Label>
              <Textarea
                value={addReason}
                onChange={(e) => setAddReason(e.target.value)}
                placeholder="Why was this bid classified as Yes/Maybe/No?"
                rows={3}
              />
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Input
                value={addNotes}
                onChange={(e) => setAddNotes(e.target.value)}
                placeholder="Caveats, context..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddSample} disabled={!selectedBidId || !addReason.trim() || adding}>
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
