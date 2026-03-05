'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  ArrowLeft,
  BarChart3,
  TrendingUp,
  Clock,
  DollarSign,
  Target,
  AlertTriangle,
  Download,
  RefreshCw,
  Loader2,
  Lock,
  Sparkles,
} from 'lucide-react';

interface VolumeMetrics {
  bidsThisWeek: number;
  bidsThisMonth: number;
  bidsThisYear: number;
  totalBids: number;
  totalValueAll: number;
  totalValueYesMaybe: number;
  processedCount: number;
  backlogCount: number;
  processedPercent: number;
  hoursSavedEstimate: number;
}

interface OverrideMetrics {
  totalDecisions: number;
  overriddenCount: number;
  overridePercent: number;
  alignmentTrend: Array<{ period: string; alignmentPercent: number; decisionCount: number }>;
}

interface GoldNuggetBid {
  bidId: string;
  projectName: string | null;
  senderCompany: string | null;
  outcome: string;
  matchedTags: string[];
  receivedAt: string;
  projectValue: number | null;
}

interface Client {
  id: string;
  name: string;
}

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

function formatPeriod(iso: string): string {
  const [y, m] = iso.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parseInt(m, 10) - 1]} ${y}`;
}

export default function AnalyticsPage() {
  const params = useParams();
  const workspaceId = params.id as string;
  const { isAdmin, currentWorkspace, workspaces, isLoading: authLoading } = useAuth();

  const [client, setClient] = useState<Client | null>(null);
  const [volume, setVolume] = useState<VolumeMetrics | null>(null);
  const [override, setOverride] = useState<OverrideMetrics | null>(null);
  const [goldNuggets, setGoldNuggets] = useState<GoldNuggetBid[]>([]);
  const [history, setHistory] = useState<Array<Record<string, unknown>>>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [decisionFilter, setDecisionFilter] = useState<string>('all');
  const [sectorFilter, setSectorFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [timeRangeMonths, setTimeRangeMonths] = useState<string>('24');

  const hasAccess = isAdmin || workspaces.some((w) => w.id === workspaceId);

  useEffect(() => {
    if (!authLoading && hasAccess) fetchData();
  }, [authLoading, hasAccess, workspaceId]);

  useEffect(() => {
    if (hasAccess && (decisionFilter !== 'all' || sectorFilter || ownerFilter || timeRangeMonths)) {
      fetchHistory();
    }
  }, [hasAccess, workspaceId, decisionFilter, sectorFilter, ownerFilter, timeRangeMonths]);

  async function fetchData() {
    try {
      setLoading(true);
      setError(null);
      const [clientRes, metricsRes, nuggetsRes] = await Promise.all([
        fetch(`/api/clients/${workspaceId}`),
        fetch(`/api/clients/${workspaceId}/analytics/metrics`),
        fetch(`/api/clients/${workspaceId}/analytics/gold-nuggets`),
      ]);

      const clientData = await clientRes.json();
      const metricsData = await metricsRes.json();
      const nuggetsData = await nuggetsRes.json();

      if (clientData.success && clientData.data) setClient(clientData.data);
      if (metricsData.success && metricsData.data) {
        setVolume(metricsData.data.volume);
        setOverride(metricsData.data.override);
      }
      if (nuggetsData.success && nuggetsData.data?.goldNuggets) setGoldNuggets(nuggetsData.data.goldNuggets);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  async function fetchHistory() {
    try {
      const params = new URLSearchParams();
      if (decisionFilter !== 'all') params.set('decision', decisionFilter);
      if (sectorFilter) params.set('sector', sectorFilter);
      if (ownerFilter) params.set('owner', ownerFilter);
      if (timeRangeMonths) params.set('timeRangeMonths', timeRangeMonths);
      params.set('limit', '50');

      const res = await fetch(`/api/clients/${workspaceId}/analytics/history?${params}`);
      const data = await res.json();
      if (data.success && data.data) {
        setHistory(data.data.bids || []);
        setHistoryTotal(data.data.total || 0);
      }
    } catch {
      setHistory([]);
      setHistoryTotal(0);
    }
  }

  function handleExport(type: 'bids' | 'decisions') {
    window.open(`/api/clients/${workspaceId}/analytics/export?type=${type}&limit=1000`, '_blank');
  }

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

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <Button variant="ghost" size="sm" asChild>
            <Link href={currentWorkspace ? `/workspace/${currentWorkspace.id}/config` : '/clients'}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Link>
          </Button>
          <h1 className="text-3xl font-bold tracking-tight mt-2">Market Grasp</h1>
          <p className="text-muted-foreground mt-1">
            Analytics & insights for {client.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => fetchData()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleExport('bids')}>
            <Download className="h-4 w-4 mr-2" />
            Export Bids CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleExport('decisions')}>
            <Download className="h-4 w-4 mr-2" />
            Export Decisions CSV
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-destructive">
          <CardContent className="py-4 text-destructive">{error}</CardContent>
        </Card>
      )}

      {/* Volume / Hopper Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <BarChart3 className="h-4 w-4" />
              This Week
            </div>
            <p className="text-2xl font-bold mt-1">{volume?.bidsThisWeek ?? 0}</p>
            <p className="text-xs text-muted-foreground">bids ingested</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <BarChart3 className="h-4 w-4" />
              This Month
            </div>
            <p className="text-2xl font-bold mt-1">{volume?.bidsThisMonth ?? 0}</p>
            <p className="text-xs text-muted-foreground">bids ingested</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <BarChart3 className="h-4 w-4" />
              This Year
            </div>
            <p className="text-2xl font-bold mt-1">{volume?.bidsThisYear ?? 0}</p>
            <p className="text-xs text-muted-foreground">bids ingested</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <DollarSign className="h-4 w-4" />
              Total Value
            </div>
            <p className="text-2xl font-bold mt-1">{volume ? formatCurrency(volume.totalValueAll) : '-'}</p>
            <p className="text-xs text-muted-foreground">all bids</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Target className="h-4 w-4" />
              Yes + Maybe
            </div>
            <p className="text-2xl font-bold mt-1">{volume ? formatCurrency(volume.totalValueYesMaybe) : '-'}</p>
            <p className="text-xs text-muted-foreground">qualified value</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Clock className="h-4 w-4" />
              Hours Saved
            </div>
            <p className="text-2xl font-bold mt-1">{volume?.hoursSavedEstimate ?? 0}</p>
            <p className="text-xs text-muted-foreground">reading time avoided</p>
          </CardContent>
        </Card>
      </div>

      {/* Processed vs Backlog + Override Metrics */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Processed vs Backlog</CardTitle>
            <CardDescription>
              {volume?.processedCount ?? 0} processed, {volume?.backlogCount ?? 0} in backlog
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500/70 rounded-full transition-all"
                  style={{ width: `${volume?.processedPercent ?? 0}%` }}
                />
              </div>
              <span className="text-sm font-medium">{volume?.processedPercent ?? 0}% processed</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Override & Alignment</CardTitle>
            <CardDescription>
              {override?.overriddenCount ?? 0} of {override?.totalDecisions ?? 0} decisions overridden by humans
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-500/70 rounded-full transition-all"
                    style={{ width: `${override?.overridePercent ?? 0}%` }}
                  />
                </div>
                <span className="text-sm font-medium">{override?.overridePercent ?? 0}% overridden</span>
              </div>
              {override?.alignmentTrend && override.alignmentTrend.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  {override.alignmentTrend.map((t) => (
                    <div key={t.period} className="flex items-center gap-1 text-xs">
                      <span className="text-muted-foreground">{formatPeriod(t.period)}:</span>
                      <span className="font-medium">{t.alignmentPercent}% aligned</span>
                      {t.decisionCount > 0 && (
                        <span className="text-muted-foreground">({t.decisionCount})</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Gold Nugget Alerts */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-amber-500" />
            Gold Nugget Alerts
          </CardTitle>
          <CardDescription>
            Bids matching your strategic tags (hospital, rail, repeat owner, etc.)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {goldNuggets.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <AlertTriangle className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No strategic tags configured, or no bids match yet.</p>
              <p className="text-sm mt-1">
                Add strategic tags in <Link href={`/workspace/${workspaceId}/config`} className="underline">Configuration</Link> to highlight bids.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>Matched Tags</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Received</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {goldNuggets.map((b) => (
                  <TableRow key={b.bidId}>
                    <TableCell className="font-medium">{b.projectName || 'Untitled'}</TableCell>
                    <TableCell>{b.senderCompany || '-'}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          b.outcome === 'GO' ? 'default' :
                          b.outcome === 'MAYBE' ? 'secondary' : 'destructive'
                        }
                      >
                        {b.outcome}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {b.matchedTags.map((t) => (
                          <Badge key={t} variant="outline" className="text-amber-600 border-amber-500/50">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>{b.projectValue != null ? formatCurrency(b.projectValue) : '-'}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(b.receivedAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/bids/${b.bidId}`}>View</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* History & What We Missed */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            History & What We Missed
          </CardTitle>
          <CardDescription>
            Filter by sector, owner, location, size band, time range, decision
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 mb-6">
            <div className="flex items-center gap-2">
              <Label className="text-sm">Decision</Label>
              <Select value={decisionFilter} onValueChange={setDecisionFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="GO">Yes (GO)</SelectItem>
                  <SelectItem value="MAYBE">Maybe</SelectItem>
                  <SelectItem value="NO">No</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-sm">Sector</Label>
              <Input
                placeholder="e.g. hospital"
                value={sectorFilter}
                onChange={(e) => setSectorFilter(e.target.value)}
                className="w-[140px]"
              />
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-sm">Owner</Label>
              <Input
                placeholder="e.g. CN Rail"
                value={ownerFilter}
                onChange={(e) => setOwnerFilter(e.target.value)}
                className="w-[140px]"
              />
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-sm">Time Range</Label>
              <Select value={timeRangeMonths} onValueChange={setTimeRangeMonths}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="6">Last 6 months</SelectItem>
                  <SelectItem value="12">Last 12 months</SelectItem>
                  <SelectItem value="24">Last 24 months</SelectItem>
                  <SelectItem value="36">Last 36 months</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Received</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    No bids match the filters. Try adjusting filters or time range.
                  </TableCell>
                </TableRow>
              ) : (
                history.map((b) => (
                  <TableRow key={String(b.id)}>
                    <TableCell className="font-medium">{String(b.projectName || 'Untitled')}</TableCell>
                    <TableCell>{String(b.senderCompany || '-')}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          b.outcome === 'GO' ? 'default' :
                          b.outcome === 'MAYBE' ? 'secondary' : 'destructive'
                        }
                      >
                        {String(b.outcome || '-')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {b.projectValue != null ? formatCurrency(Number(b.projectValue)) : '-'}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {b.receivedAt ? new Date(String(b.receivedAt)).toLocaleDateString() : '-'}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/bids/${b.id}`}>View</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {historyTotal > 50 && (
            <p className="text-sm text-muted-foreground mt-2">
              Showing 50 of {historyTotal} results. Use CSV export for full data.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
