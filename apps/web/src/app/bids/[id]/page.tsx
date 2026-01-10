'use client';

import { useState, useEffect, Fragment } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { 
  ArrowLeft, 
  FileText, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  Send, 
  Download, 
  Brain, 
  Zap,
  ClipboardList,
  FileJson,
  Files,
  Scale,
  Quote,
  FileSearch
} from 'lucide-react';

interface Citation {
  documentId: string | null;
  documentFilename: string | null;
  pageNumber: number | null;
  text: string | null;
  context: string | null;
  boundingBox: unknown | null;
}

interface ExtractedField {
  id: string;
  signalId: string;
  extractedValue: unknown;
  confidence: number | null;
  extractionMethod: string | null;
  citation?: Citation | null;
}

interface Bid {
  id: string;
  clientId: string;
  clientName: string | null;
  projectName: string | null;
  senderEmail: string | null;
  senderName: string | null;
  senderCompany: string | null;
  intakeSource: string;
  status: string;
  receivedAt: string;
  createdAt: string;
  rawPayload: Record<string, unknown>;
  extractedFields?: ExtractedField[];
  documents?: Array<{ id: string; filename: string; contentType: string; sizeBytes: number | null; createdAt: string }>;
  decision?: {
    id: string;
    outcome: string;
    totalScore: number | null;
    maxScore: number | null;
    scorePercentage: number | null;
    rationale: string | null;
    evaluationMethod: string | null;
    aiEvaluation: unknown;
    createdAt: string;
  } | null;
}

interface Decision {
  id: string;
  outcome: 'GO' | 'MAYBE' | 'NO';
  overallScore: number;
  rationale: string;
  decidedAt: string;
  evaluatedBy: string;
  evaluationMethod?: string;
  aiEvaluation?: { recommendation: string; confidence: number; reasoning: string; riskFactors: string[] };
}

interface DecisionData {
  currentOutcome: string;
  latestDecision?: Decision;
  overrides: Array<{ id: string; previousOutcome: string; newOutcome: string; rationale: string; overriddenBy: string; overriddenAt: string }>;
  history: Decision[];
}

export default function BidDetailPage() {
  const params = useParams();
  const bidId = params.id as string;
  const { user } = useAuth();

  const [bid, setBid] = useState<Bid | null>(null);
  const [decisionData, setDecisionData] = useState<DecisionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [evaluating, setEvaluating] = useState(false);
  const [evaluationMode, setEvaluationMode] = useState<'hybrid' | 'ai' | 'rules'>('hybrid');
  const [overriding, setOverriding] = useState(false);
  const [overrideOutcome, setOverrideOutcome] = useState<'GO' | 'MAYBE' | 'NO'>('GO');
  const [overrideRationale, setOverrideRationale] = useState('');
  const [showOverrideForm, setShowOverrideForm] = useState(false);
  
  const [handing, setHanding] = useState(false);
  const [handoffResult, setHandoffResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    fetchBid();
    fetchDecisions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bidId]);

  async function fetchBid() {
    try {
      const res = await fetch(`/api/bids/${bidId}`);
      const data = await res.json();
      if (data.success && data.data) setBid(data.data);
      else setError(data.error?.message || 'Bid not found');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load bid');
    } finally {
      setLoading(false);
    }
  }

  async function fetchDecisions() {
    try {
      const res = await fetch(`/api/bids/${bidId}/decisions`);
      const data = await res.json();
      if (data.success && data.data) setDecisionData(data.data);
    } catch {
      // May not have decisions yet
    }
  }

  async function runEvaluation() {
    setEvaluating(true);
    try {
      const params = new URLSearchParams();
      if (evaluationMode === 'ai') params.set('useAI', 'true');
      else if (evaluationMode === 'rules') params.set('useAI', 'false');
      else { params.set('useAI', 'true'); params.set('aiWeight', '0.5'); }

      const res = await fetch(`/api/bids/${bidId}/evaluate?${params}`, { method: 'POST' });
      const data = await res.json();
      if (data.success) fetchDecisions();
      else setError(data.error?.message || 'Evaluation failed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Evaluation failed');
    } finally {
      setEvaluating(false);
    }
  }

  async function submitOverride() {
    if (!overrideRationale.trim()) return;
    setOverriding(true);
    try {
      const res = await fetch(`/api/bids/${bidId}/override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          outcome: overrideOutcome, 
          rationale: overrideRationale,
          overriddenBy: user?.email || 'unknown',
          reasonCategory: 'other',
        }),
      });
      const data = await res.json();
      if (data.success) {
        fetchDecisions();
        setShowOverrideForm(false);
        setOverrideRationale('');
      } else setError(data.error?.message || 'Override failed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Override failed');
    } finally {
      setOverriding(false);
    }
  }

  async function sendToJobTread() {
    setHanding(true);
    setHandoffResult(null);
    try {
      const res = await fetch(`/api/bids/${bidId}/handoff/jobtread`, { method: 'POST' });
      const data = await res.json();
      setHandoffResult(data.success ? { type: 'success', message: `Sent to JobTread (ID: ${data.data?.externalId || 'pending'})` } : { type: 'error', message: data.error?.message || 'Handoff failed' });
    } catch (err) {
      setHandoffResult({ type: 'error', message: err instanceof Error ? err.message : 'Handoff failed' });
    } finally {
      setHanding(false);
    }
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function getOutcomeStyles(outcome: string) {
    switch (outcome) {
      case 'GO': return { badge: 'success' as const, icon: CheckCircle2, text: 'text-green-500', bg: 'bg-green-500/10 border-green-800' };
      case 'MAYBE': return { badge: 'warning' as const, icon: AlertCircle, text: 'text-yellow-500', bg: 'bg-yellow-500/10 border-yellow-800' };
      case 'NO': return { badge: 'destructive' as const, icon: AlertCircle, text: 'text-red-500', bg: 'bg-red-500/10 border-red-800' };
      default: return { badge: 'secondary' as const, icon: AlertCircle, text: 'text-muted-foreground', bg: 'bg-muted' };
    }
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto">
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4" />
            Loading bid details...
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!bid) {
    return (
      <div className="max-w-5xl mx-auto">
        <Card className="border-destructive">
          <CardContent className="py-8 text-center text-destructive">{error || 'Bid not found'}</CardContent>
        </Card>
      </div>
    );
  }

  // Build extracted fields map from API extractedFields (signalId-based)
  const extractedFieldsMap = bid.extractedFields?.reduce((acc, f) => { 
    acc[f.signalId] = { 
      value: f.extractedValue, 
      confidence: f.confidence ?? 0.5,
      citation: f.citation || null,
    }; 
    return acc; 
  }, {} as Record<string, { value: unknown; confidence: number; citation: Citation | null }>) || {};
  
  // Get custom fields and confidence scores from rawPayload (for backwards compatibility with older bids)
  const customFields = (bid.rawPayload?.customFields as Record<string, unknown>) || {};
  const confidenceScores = (bid.rawPayload?.confidenceScores as Record<string, number>) || {};
  const hasExtractedFields = Object.keys(extractedFieldsMap).length > 0;
  const hasCustomFields = Object.keys(customFields).length > 0;
  
  // Use decision from bid data or from decisionData
  const latestDecision = decisionData?.latestDecision || (bid.decision ? {
    id: bid.decision.id,
    outcome: bid.decision.outcome as 'GO' | 'MAYBE' | 'NO',
    overallScore: bid.decision.scorePercentage ?? 0,
    rationale: bid.decision.rationale || '',
    decidedAt: bid.decision.createdAt,
    evaluatedBy: 'system',
    evaluationMethod: bid.decision.evaluationMethod || 'rules',
    aiEvaluation: bid.decision.aiEvaluation as Decision['aiEvaluation'],
  } : null);
  const outcomeStyles = getOutcomeStyles(decisionData?.currentOutcome || bid.decision?.outcome || '');

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-4 -ml-2">
          <Link href="/bids">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Bid Queue
          </Link>
        </Button>
        
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-3xl font-bold tracking-tight">
                {bid.projectName || 'Untitled Project'}
              </h1>
              <Badge variant={bid.status === 'new' ? 'info' : bid.status === 'qualified' ? 'success' : 'secondary'}>
                {bid.status}
              </Badge>
            </div>
            <p className="text-muted-foreground">
              <span className="font-medium">{bid.clientName || 'Unknown Client'}</span> &bull; {bid.intakeSource} &bull; {formatDate(bid.receivedAt)}
            </p>
          </div>
          
          {decisionData?.currentOutcome && (
            <Card className={`w-fit shrink-0 ${outcomeStyles.bg}`}>
              <CardContent className="py-4 px-6 flex items-center gap-4">
                <div className="text-center">
                  <p className={`text-3xl font-bold ${outcomeStyles.text}`}>{decisionData.currentOutcome}</p>
                  <p className="text-xs text-muted-foreground">Decision</p>
                </div>
                {latestDecision && (
                  <div className="text-center border-l pl-4">
                    <p className="text-2xl font-bold">{latestDecision.overallScore}%</p>
                    <p className="text-xs text-muted-foreground">Score</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <Card className="border-destructive bg-destructive/10">
          <CardContent className="py-4 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
            <p className="text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid grid-cols-5 w-full max-w-xl">
          <TabsTrigger value="overview" className="gap-2"><ClipboardList className="h-4 w-4" /><span className="hidden sm:inline">Overview</span></TabsTrigger>
          <TabsTrigger value="extracted" className="gap-2"><Zap className="h-4 w-4" /><span className="hidden sm:inline">Extracted</span></TabsTrigger>
          <TabsTrigger value="documents" className="gap-2"><Files className="h-4 w-4" /><span className="hidden sm:inline">Docs</span></TabsTrigger>
          <TabsTrigger value="decision" className="gap-2"><Scale className="h-4 w-4" /><span className="hidden sm:inline">Decision</span></TabsTrigger>
          <TabsTrigger value="raw" className="gap-2"><FileJson className="h-4 w-4" /><span className="hidden sm:inline">Raw</span></TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Bid Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {[
                  { label: 'Project Name', value: bid.projectName },
                  { label: 'Company', value: bid.senderCompany },
                  { label: 'Contact', value: bid.senderName },
                  { label: 'Email', value: bid.senderEmail },
                  { label: 'Received', value: formatDate(bid.receivedAt) },
                  { label: 'Source', value: bid.intakeSource },
                ].map(item => (
                  <div key={item.label} className="flex justify-between items-start">
                    <span className="text-sm text-muted-foreground">{item.label}</span>
                    <span className="text-sm font-medium text-right max-w-[60%] break-words">{String(item.value || '-')}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  <Select value={evaluationMode} onValueChange={(v) => setEvaluationMode(v as 'hybrid' | 'ai' | 'rules')}>
                    <SelectTrigger className="w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hybrid"><Brain className="h-3 w-3 inline mr-2" />Hybrid</SelectItem>
                      <SelectItem value="ai"><Zap className="h-3 w-3 inline mr-2" />AI Only</SelectItem>
                      <SelectItem value="rules"><ClipboardList className="h-3 w-3 inline mr-2" />Rules Only</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button onClick={runEvaluation} disabled={evaluating} className="flex-1">
                    {evaluating ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Evaluating...</> : <><Brain className="h-4 w-4 mr-2" />Run Evaluation</>}
                  </Button>
                </div>
                
                <Button variant="outline" onClick={() => setShowOverrideForm(!showOverrideForm)} className="w-full">
                  Override Decision
                </Button>

                {decisionData?.currentOutcome === 'GO' && (
                  <Button variant="outline" onClick={sendToJobTread} disabled={handing} className="w-full">
                    {handing ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Sending...</> : <><Send className="h-4 w-4 mr-2" />Send to JobTread</>}
                  </Button>
                )}

                {handoffResult && (
                  <div className={`p-3 rounded-lg text-sm ${handoffResult.type === 'success' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                    {handoffResult.message}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Override Form */}
          {showOverrideForm && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Override Decision</CardTitle>
                <CardDescription>Manually override the Go/No-Go decision</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  {(['GO', 'MAYBE', 'NO'] as const).map(o => (
                    <Button key={o} variant={overrideOutcome === o ? 'default' : 'outline'} onClick={() => setOverrideOutcome(o)} className="flex-1">
                      {o}
                    </Button>
                  ))}
                </div>
                <Textarea value={overrideRationale} onChange={(e) => setOverrideRationale(e.target.value)} placeholder="Provide rationale for this override..." rows={3} />
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" onClick={() => setShowOverrideForm(false)}>Cancel</Button>
                  <Button onClick={submitOverride} disabled={overriding || !overrideRationale.trim()}>
                    {overriding ? 'Submitting...' : 'Submit Override'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Extracted Fields Tab */}
        <TabsContent value="extracted" className="space-y-6">
          {/* AI Extracted Fields with confidence scores */}
          {hasExtractedFields && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">AI-Extracted Fields</CardTitle>
                    <CardDescription>Data extracted from documents with confidence scores</CardDescription>
                  </div>
                  <span className="text-sm text-muted-foreground">{Object.keys(extractedFieldsMap).length} fields</span>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-2 gap-4">
                  {Object.entries(extractedFieldsMap).map(([key, { value, confidence, citation }]) => (
                    <div key={key} className="p-4 rounded-lg border bg-muted/30">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium">{key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</span>
                        <Badge variant={confidence >= 0.8 ? 'success' : confidence >= 0.5 ? 'warning' : 'destructive'} className="text-xs">
                          {Math.round(confidence * 100)}%
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground break-words mb-2">
                        {value !== null && value !== undefined && String(value) !== '' ? String(value) : <em className="text-muted-foreground/50">Not extracted</em>}
                      </p>
                      
                      {/* Citation - only show if value was actually extracted */}
                      {value !== null && value !== undefined && String(value) !== '' && citation && (citation.documentFilename || citation.text) && (
                        <div className="mt-3 pt-3 border-t border-dashed">
                          <div className="flex items-start gap-2">
                            <Quote className="h-3 w-3 mt-1 text-muted-foreground shrink-0" />
                            <div className="text-xs space-y-1">
                              {citation.text && (
                                <p className="italic text-muted-foreground line-clamp-2">&ldquo;{citation.text}&rdquo;</p>
                              )}
                              <div className="flex items-center gap-2 text-muted-foreground/70">
                                {citation.documentFilename && (
                                  <span className="flex items-center gap-1">
                                    <FileSearch className="h-3 w-3" />
                                    {citation.documentFilename}
                                  </span>
                                )}
                                {citation.pageNumber && (
                                  <span>• Page {citation.pageNumber}</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Custom/Form Fields from submission */}
          {hasCustomFields && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">{hasExtractedFields ? 'Form Fields' : 'Submitted Data'}</CardTitle>
                    <CardDescription>
                      {hasExtractedFields ? 'Additional fields from the submission form' : 
                       Object.keys(confidenceScores).length > 0 ? 'AI-extracted data with confidence scores' : 'Data submitted with this bid'}
                    </CardDescription>
                  </div>
                  <span className="text-sm text-muted-foreground">{Object.keys(customFields).length} fields</span>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-2 gap-4">
                  {Object.entries(customFields).map(([key, value]) => {
                    const confidence = confidenceScores[key];
                    return (
                      <div key={key} className="p-4 rounded-lg border bg-muted/30">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium">{key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</span>
                          {confidence !== undefined && (
                            <Badge variant={confidence >= 0.8 ? 'success' : confidence >= 0.5 ? 'warning' : 'destructive'} className="text-xs">
                              {Math.round(confidence * 100)}%
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground break-words">
                          {value !== null && value !== undefined && String(value) !== '' ? String(value) : <em className="text-muted-foreground/50">Empty</em>}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* No data state */}
          {!hasExtractedFields && !hasCustomFields && (
            <Card>
              <CardContent className="py-12 text-center">
                <Zap className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground mb-2">No extracted fields available</p>
                <p className="text-sm text-muted-foreground">Upload bid documents to extract data automatically</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Documents Tab */}
        <TabsContent value="documents">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Attached Documents</CardTitle>
                  <CardDescription>Documents uploaded with this bid</CardDescription>
                </div>
                <span className="text-sm text-muted-foreground">{bid.documents?.length || 0} files</span>
              </div>
            </CardHeader>
            <CardContent>
              {bid.documents && bid.documents.length > 0 ? (
                <div className="divide-y border rounded-lg">
                  {bid.documents.map(doc => (
                    <div key={doc.id} className="p-4 flex items-center justify-between hover:bg-muted/50 transition">
                      <div className="flex items-center gap-3">
                        <FileText className="h-8 w-8 text-muted-foreground" />
                        <div>
                          <p className="font-medium text-sm">{doc.filename}</p>
                          <p className="text-xs text-muted-foreground">
                            {((doc.sizeBytes ?? 0) / 1024).toFixed(1)} KB &bull; {formatDate(doc.createdAt)}
                          </p>
                        </div>
                      </div>
                      <Button variant="outline" size="sm" asChild>
                        <a href={`/api/documents/${doc.id}/download`} download>
                          <Download className="h-4 w-4 mr-2" />
                          Download
                        </a>
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Files className="h-8 w-8 mx-auto mb-3 opacity-50" />
                  No documents attached
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Decision Tab */}
        <TabsContent value="decision" className="space-y-6">
          {latestDecision ? (
            <Fragment>
              <Card className={outcomeStyles.bg}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-base">Latest Decision</CardTitle>
                      <CardDescription>{formatDate(latestDecision.decidedAt)}</CardDescription>
                    </div>
                    <Badge variant={outcomeStyles.badge} className="text-lg px-4 py-1">{latestDecision.outcome}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid md:grid-cols-3 gap-4">
                    <div className="text-center p-4 bg-background rounded-lg">
                      <p className="text-2xl font-bold">{latestDecision.overallScore}%</p>
                      <p className="text-xs text-muted-foreground">Overall Score</p>
                    </div>
                    <div className="text-center p-4 bg-background rounded-lg">
                      <p className="text-2xl font-bold capitalize">{latestDecision.evaluationMethod || 'rules'}</p>
                      <p className="text-xs text-muted-foreground">Method</p>
                    </div>
                    <div className="text-center p-4 bg-background rounded-lg">
                      <p className="text-2xl font-bold">{latestDecision.evaluatedBy}</p>
                      <p className="text-xs text-muted-foreground">Evaluated By</p>
                    </div>
                  </div>

                  <div className="p-4 bg-background rounded-lg">
                    <h4 className="text-sm font-medium mb-2">Rationale</h4>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{latestDecision.rationale}</p>
                  </div>

                  {latestDecision.aiEvaluation && (
                    <div className="p-4 bg-background rounded-lg space-y-3">
                      <div className="flex items-center gap-2">
                        <Brain className="h-4 w-4 text-purple-400" />
                        <h4 className="text-sm font-medium">AI Analysis</h4>
                        <Badge variant="outline" className="text-xs">{Math.round(latestDecision.aiEvaluation.confidence * 100)}% confidence</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{latestDecision.aiEvaluation.reasoning}</p>
                      {latestDecision.aiEvaluation.riskFactors?.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">Risk Factors:</p>
                          <div className="flex flex-wrap gap-1">
                            {latestDecision.aiEvaluation.riskFactors.map((risk, i) => (
                              <Badge key={i} variant="outline" className="text-xs">{risk}</Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {decisionData?.overrides && decisionData.overrides.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Override History</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {decisionData.overrides.map(override => (
                        <div key={override.id} className="p-4 border rounded-lg">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline">{override.previousOutcome}</Badge>
                              <span>→</span>
                              <Badge variant={getOutcomeStyles(override.newOutcome).badge}>{override.newOutcome}</Badge>
                            </div>
                            <span className="text-xs text-muted-foreground">{formatDate(override.overriddenAt)}</span>
                          </div>
                          <p className="text-sm text-muted-foreground">{override.rationale}</p>
                          <p className="text-xs text-muted-foreground mt-1">By {override.overriddenBy}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {decisionData?.history && decisionData.history.length > 1 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Evaluation History</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {decisionData.history.map(d => (
                        <div key={d.id} className="p-3 border rounded-lg flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <Badge variant={getOutcomeStyles(d.outcome).badge}>{d.outcome}</Badge>
                            <span className="text-sm">{d.overallScore}%</span>
                          </div>
                          <span className="text-xs text-muted-foreground">{formatDate(d.decidedAt)}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </Fragment>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <Scale className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground mb-4">No evaluation has been run yet</p>
                <Button onClick={runEvaluation} disabled={evaluating}>
                  {evaluating ? 'Evaluating...' : 'Run First Evaluation'}
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Raw Data Tab */}
        <TabsContent value="raw">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Raw Payload Data</CardTitle>
              <CardDescription>Original submission data in JSON format</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted rounded-lg p-4 text-xs overflow-auto max-h-[600px] font-mono scrollbar-thin">
                {JSON.stringify(bid.rawPayload, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
