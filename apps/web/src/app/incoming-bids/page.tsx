'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/hooks/use-auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, Mail, Paperclip, CheckCircle, XCircle, Clock, AlertCircle, RefreshCw, Loader2, Download } from 'lucide-react';

interface IncomingEmail {
  id: string;
  resendEmailId: string | null;
  clientId: string | null;
  clientName: string | null;
  fromEmail: string;
  fromName: string | null;
  subject: string;
  emailReceivedAt: string;
  processed: boolean;
  processingStatus: string;
  bidId: string | null;
  attachmentCount: number;
  createdAt: string;
}

interface IncomingEmailDetail extends IncomingEmail {
  bodyText: string | null;
  bodyHtml: string | null;
  processingError: string | null;
  processedAt: string | null;
  attachments: Array<{
    filename: string;
    contentType: string;
    size?: number;
    storageKey?: string;
    hasContent?: boolean;
  }> | null;
}

interface Client {
  id: string;
  name: string;
  slug: string;
  intakeEmailAddress?: string | null;
}

interface Stats {
  total: number;
  pending: number;
  processed: number;
  failed: number;
  receivingDomain?: string;
}

export default function IncomingBidsPage() {
  const { currentWorkspace, isOwner } = useAuth();
  const [emails, setEmails] = useState<IncomingEmail[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Filter state
  const [filter, setFilter] = useState<'all' | 'pending' | 'processed'>('all');
  
  // Dialog state
  const [selectedEmail, setSelectedEmail] = useState<IncomingEmailDetail | null>(null);
  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false);
  const [isProcessDialogOpen, setIsProcessDialogOpen] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isFixingRouting, setIsFixingRouting] = useState(false);
  const [refetching, setRefetching] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Refetch attachments from Resend (for emails with "No content")
  const refetchAttachments = async (emailId: string) => {
    setRefetching(true);
    try {
      const response = await fetch(`/api/incoming-emails/${emailId}/refetch-attachments`, { method: 'POST' });
      const data = await response.json();
      if (data.success) {
        if (selectedEmail?.id === emailId) {
          fetchEmailDetails(emailId);
        }
      } else {
        setError(data.error?.message || 'Refetch failed');
      }
    } catch (err) {
      setError('Failed to refetch attachments');
      console.error(err);
    } finally {
      setRefetching(false);
    }
  };

  // Fetch emails (filter by client when workspace selected - no overlap between workspaces)
  const fetchEmails = async () => {
    try {
      setIsLoading(true);
      const processedParam = filter === 'all' ? '' : `&processed=${filter === 'processed'}`;
      const clientParam = currentWorkspace ? `&clientId=${currentWorkspace.id}` : '';
      const response = await fetch(`/api/incoming-emails?limit=100${processedParam}${clientParam}`);
      const data = await response.json();
      
      if (data.success) {
        setEmails(data.data.emails);
      } else {
        setError(data.error?.message || 'Failed to fetch emails');
      }
    } catch (err) {
      setError('Failed to connect to API');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch stats (includes receivingDomain for address display)
  const fetchStats = async () => {
    try {
      const response = await fetch('/api/incoming-emails/stats');
      const data = await response.json();
      
      if (data.success) {
        setStats(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  };

  // Fetch clients
  const fetchClients = async () => {
    try {
      const response = await fetch('/api/clients');
      const data = await response.json();
      
      if (data.success) {
        setClients(data.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch clients:', err);
    }
  };

  // Fetch email details
  const fetchEmailDetails = async (id: string) => {
    try {
      const response = await fetch(`/api/incoming-emails/${id}`);
      const data = await response.json();
      
      if (data.success) {
        setSelectedEmail(data.data);
        setIsDetailDialogOpen(true);
      }
    } catch (err) {
      console.error('Failed to fetch email details:', err);
    }
  };

  // Fix routing for emails with clientId null (assign to client from to-address)
  const fixRouting = async (emailId: string) => {
    setIsFixingRouting(true);
    try {
      const response = await fetch(`/api/incoming-emails/${emailId}/fix-routing`, { method: 'POST' });
      const data = await response.json();
      if (data.success) {
        fetchEmails();
        if (selectedEmail?.id === emailId) {
          fetchEmailDetails(emailId);
        }
      } else {
        setError(data.error?.message || 'Failed to fix routing');
      }
    } catch (err) {
      setError('Failed to fix routing');
      console.error(err);
    } finally {
      setIsFixingRouting(false);
    }
  };

  const fixAllRouting = async () => {
    setIsFixingRouting(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const response = await fetch('/api/incoming-emails/fix-all-routing', { method: 'POST' });
      const data = await response.json();
      if (data.success && data.data) {
        const { fixed, failed } = data.data;
        fetchEmails();
        if (fixed > 0) {
          setSuccessMessage(`Fixed ${fixed} email(s).`);
          setTimeout(() => setSuccessMessage(null), 5000);
        }
        if (failed > 0) {
          setError(`${failed} email(s) could not be assigned to a client.`);
          setTimeout(() => setError(null), 5000);
        }
      }
    } catch (err) {
      setError('Failed to fix routing');
      console.error(err);
    } finally {
      setIsFixingRouting(false);
    }
  };

  // Process email to bid (clientId from email or user selection)
  const processEmail = async () => {
    if (!selectedEmail) return;
    const clientId = selectedClientId || selectedEmail.clientId;
    if (!clientId) return;
    
    setIsProcessing(true);
    try {
      const response = await fetch(`/api/incoming-emails/${selectedEmail.id}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        setIsProcessDialogOpen(false);
        setIsDetailDialogOpen(false);
        fetchEmails();
        fetchStats();
      } else {
        setError(data.error?.message || 'Failed to process email');
      }
    } catch (err) {
      setError('Failed to process email');
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };

  // Skip email
  const skipEmail = async (id: string) => {
    try {
      const response = await fetch(`/api/incoming-emails/${id}/skip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Manually skipped' }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        fetchEmails();
        fetchStats();
      }
    } catch (err) {
      console.error('Failed to skip email:', err);
    }
  };

  useEffect(() => {
    fetchEmails();
    fetchStats();
    fetchClients();
  }, [filter, currentWorkspace?.id]);

  // When opening process dialog, pre-select client from email if routed
  useEffect(() => {
    if (isProcessDialogOpen && selectedEmail?.clientId) {
      setSelectedClientId(selectedEmail.clientId);
    } else if (!isProcessDialogOpen) {
      setSelectedClientId('');
    }
  }, [isProcessDialogOpen, selectedEmail?.clientId]);

  const getStatusBadge = (status: string, processed: boolean) => {
    if (processed) {
      return <Badge className="bg-green-500/10 text-green-500 border-green-500/20"><CheckCircle className="h-3 w-3 mr-1" />Processed</Badge>;
    }
    switch (status) {
      case 'pending':
        return <Badge variant="outline" className="text-yellow-500 border-yellow-500/30"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
      case 'processing':
        return <Badge variant="outline" className="text-blue-500 border-blue-500/30"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Processing</Badge>;
      case 'failed':
        return <Badge variant="destructive"><AlertCircle className="h-3 w-3 mr-1" />Failed</Badge>;
      case 'skipped':
        return <Badge variant="secondary"><XCircle className="h-3 w-3 mr-1" />Skipped</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Incoming Bids</h1>
            <p className="text-muted-foreground">Emails received at your bid intake address</p>
          </div>
        </div>
        <Button variant="outline" onClick={() => { fetchEmails(); fetchStats(); }}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{stats.total}</div>
              <p className="text-xs text-muted-foreground">Total Emails</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-yellow-500">{stats.pending}</div>
              <p className="text-xs text-muted-foreground">Pending Review</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-green-500">{stats.processed}</div>
              <p className="text-xs text-muted-foreground">Processed</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-red-500">{stats.failed}</div>
              <p className="text-xs text-muted-foreground">Failed</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Per-Client Forwarding Address - only when workspace selected or all-workspace view */}
      {((currentWorkspace && clients.some((c) => c.id === currentWorkspace.id)) || (!currentWorkspace && isOwner)) && (
        <Card className="bg-blue-500/5 border-blue-500/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Mail className="h-4 w-4" />
              {currentWorkspace ? 'Forwarding Address' : 'Forwarding Addresses by Client'}
            </CardTitle>
            <CardDescription>
              Forward bid emails to the address below. Only emails with &quot;Bid&quot; in the subject are processed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {(() => {
              const domain = stats?.receivingDomain || 'intake.bidcatcher.app';
              const clientsToShow = currentWorkspace
                ? clients.filter((c) => c.id === currentWorkspace.id)
                : clients;
              if (clientsToShow.length === 0) {
                return <p className="text-sm text-muted-foreground">No clients yet. Add clients to see their intake addresses.</p>;
              }
              return (
                <div className="space-y-3">
                  {clientsToShow.map((client) => {
                    const address = client.intakeEmailAddress || `intake-${client.slug}@${domain}`;
                    return (
                      <div key={client.id} className="flex items-center justify-between gap-4 p-3 rounded-lg border bg-background/50">
                        <div>
                          <p className="font-medium text-sm">{client.name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 font-mono">{address}</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="shrink-0"
                          onClick={() => {
                            navigator.clipboard.writeText(address);
                            setCopiedId(client.id);
                            setTimeout(() => setCopiedId(null), 2000);
                          }}
                        >
                          {copiedId === client.id ? 'Copied!' : 'Copy'}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {/* Workspace filter indicator */}
      <div className="text-sm text-muted-foreground">
        {currentWorkspace ? (
          <span>Showing emails for <strong>{currentWorkspace.name}</strong> only</span>
        ) : (
          <span>Showing all workspaces — select a workspace above to filter</span>
        )}
      </div>

      {/* Filter Tabs + Fix unassigned (when viewing all, no workspace filter) */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex gap-2">
          <Button 
            variant={filter === 'all' ? 'default' : 'outline'} 
            size="sm"
            onClick={() => setFilter('all')}
          >
            All
          </Button>
        <Button 
          variant={filter === 'pending' ? 'default' : 'outline'} 
          size="sm"
          onClick={() => setFilter('pending')}
        >
          Pending
        </Button>
        <Button 
          variant={filter === 'processed' ? 'default' : 'outline'} 
          size="sm"
          onClick={() => setFilter('processed')}
        >
          Processed
        </Button>
        </div>
        {filter === 'all' && !currentWorkspace && isOwner && (
          <Button
            variant="outline"
            size="sm"
            onClick={fixAllRouting}
            disabled={isFixingRouting}
          >
            {isFixingRouting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Fix unassigned
          </Button>
        )}
      </div>

      {/* Success / Error Display */}
      {successMessage && (
        <Card className="border-green-500/50 bg-green-500/10">
          <CardContent className="pt-6">
            <p className="text-green-500">{successMessage}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => setSuccessMessage(null)}>
              Dismiss
            </Button>
          </CardContent>
        </Card>
      )}
      {error && (
        <Card className="border-red-500/50 bg-red-500/10">
          <CardContent className="pt-6">
            <p className="text-red-500">{error}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => setError(null)}>
              Dismiss
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Email List */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : emails.length === 0 ? (
            <div className="text-center py-12">
              <Mail className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium">No emails yet</h3>
              <p className="text-sm text-muted-foreground">
                Forward bid emails to your intake address to see them here
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>From</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead className="w-[140px]">Client</TableHead>
                  <TableHead className="w-[100px]">Attachments</TableHead>
                  <TableHead className="w-[120px]">Status</TableHead>
                  <TableHead className="w-[180px]">Received</TableHead>
                  <TableHead className="w-[150px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {emails.map((email) => (
                  <TableRow key={email.id} className="cursor-pointer hover:bg-muted/50">
                    <TableCell onClick={() => fetchEmailDetails(email.id)}>
                      <div>
                        <div className="font-medium">{email.fromName || email.fromEmail}</div>
                        {email.fromName && (
                          <div className="text-xs text-muted-foreground">{email.fromEmail}</div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell onClick={() => fetchEmailDetails(email.id)}>
                      <div className="max-w-[300px] truncate">{email.subject}</div>
                    </TableCell>
                    <TableCell onClick={() => fetchEmailDetails(email.id)}>
                      <span className="text-sm text-muted-foreground">{email.clientName || '—'}</span>
                    </TableCell>
                    <TableCell onClick={() => fetchEmailDetails(email.id)}>
                      {email.attachmentCount > 0 && (
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <Paperclip className="h-4 w-4" />
                          <span>{email.attachmentCount}</span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell onClick={() => fetchEmailDetails(email.id)}>
                      {getStatusBadge(email.processingStatus, email.processed)}
                    </TableCell>
                    <TableCell onClick={() => fetchEmailDetails(email.id)}>
                      <div className="text-sm">{formatDate(email.emailReceivedAt)}</div>
                    </TableCell>
                    <TableCell>
                      {!email.processed && email.processingStatus === 'pending' && (
                        <div className="flex gap-2">
                          <Button 
                            size="sm" 
                            variant="default"
                            onClick={(e) => {
                              e.stopPropagation();
                              fetchEmailDetails(email.id).then(() => {
                                setIsProcessDialogOpen(true);
                              });
                            }}
                          >
                            Process
                          </Button>
                          <Button 
                            size="sm" 
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              skipEmail(email.id);
                            }}
                          >
                            Skip
                          </Button>
                        </div>
                      )}
                      {email.bidId && (
                        <Button size="sm" variant="outline" asChild>
                          <Link href={`/bids/${email.bidId}`}>View Bid</Link>
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Email Detail Dialog */}
      <Dialog open={isDetailDialogOpen} onOpenChange={setIsDetailDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          {selectedEmail && (
            <>
              <DialogHeader>
                <DialogTitle className="text-lg">{selectedEmail.subject}</DialogTitle>
                <DialogDescription>
                  From: {selectedEmail.fromName ? `${selectedEmail.fromName} <${selectedEmail.fromEmail}>` : selectedEmail.fromEmail}
                  <br />
                  Received: {formatDate(selectedEmail.emailReceivedAt)}
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-4">
                {/* Client */}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Client:</span>
                  <span className="text-sm">{selectedEmail.clientName ?? (selectedEmail.clientId ? '—' : 'Unassigned')}</span>
                </div>

                {/* Status */}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Status:</span>
                  {getStatusBadge(selectedEmail.processingStatus, selectedEmail.processed)}
                </div>

                {/* Attachments */}
                {selectedEmail.attachments && selectedEmail.attachments.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-medium">Attachments (stored in incoming_bid_emails)</h4>
                      {selectedEmail.attachments.some(a => !a.hasContent) && (
                        <Button variant="outline" size="sm" onClick={() => refetchAttachments(selectedEmail.id)} disabled={refetching}>
                          {refetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                          Refetch from Resend
                        </Button>
                      )}
                    </div>
                    <div className="space-y-1">
                      {selectedEmail.attachments.map((att, idx) => (
                        <div key={idx} className="flex items-center justify-between gap-2 text-sm bg-muted/50 px-3 py-2 rounded">
                          <div className="flex items-center gap-2">
                            <Paperclip className="h-4 w-4 text-muted-foreground" />
                            <span>{att.filename}</span>
                            <span className="text-muted-foreground">({formatFileSize(att.size ?? 0)})</span>
                            {att.hasContent ? (
                              <Badge variant="default" className="text-xs">Content stored</Badge>
                            ) : (
                              <Badge variant="secondary" className="text-xs">No content</Badge>
                            )}
                          </div>
                          {att.hasContent && (
                            <Button variant="outline" size="sm" asChild>
                              <a href={`/api/incoming-emails/${selectedEmail.id}/download-attachment?filename=${encodeURIComponent(att.filename)}`} download>
                                <Download className="h-4 w-4 mr-1" />
                                Download
                              </a>
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Email Body */}
                {selectedEmail.bodyText && (
                  <div>
                    <h4 className="text-sm font-medium mb-2">Email Body</h4>
                    <div className="bg-muted/50 p-4 rounded text-sm whitespace-pre-wrap max-h-[300px] overflow-y-auto">
                      {selectedEmail.bodyText}
                    </div>
                  </div>
                )}

                {/* Error Message */}
                {selectedEmail.processingError && (
                  <div className="bg-red-500/10 border border-red-500/20 p-3 rounded">
                    <h4 className="text-sm font-medium text-red-500 mb-1">Error</h4>
                    <p className="text-sm">{selectedEmail.processingError}</p>
                  </div>
                )}
              </div>

              <DialogFooter>
                {!selectedEmail.clientId && (
                  <Button
                    variant="outline"
                    onClick={() => fixRouting(selectedEmail.id)}
                    disabled={isFixingRouting}
                  >
                    {isFixingRouting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    Fix routing
                  </Button>
                )}
                {!selectedEmail.processed && selectedEmail.processingStatus === 'pending' && (
                  <>
                    <Button variant="outline" onClick={() => skipEmail(selectedEmail.id)}>
                      Skip
                    </Button>
                    <Button onClick={() => {
                      if (selectedEmail?.clientId) setSelectedClientId(selectedEmail.clientId);
                      setIsProcessDialogOpen(true);
                    }}>
                      Process to Bid
                    </Button>
                  </>
                )}
                {selectedEmail.bidId && (
                  <Button asChild>
                    <Link href={`/bids/${selectedEmail.bidId}`}>View Bid</Link>
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Process Dialog */}
      <Dialog open={isProcessDialogOpen} onOpenChange={setIsProcessDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Process Email to Bid</DialogTitle>
            <DialogDescription>
              Select a client to create a bid from this email.
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4">
            <label className="text-sm font-medium mb-2 block">Client</label>
            <Select value={selectedClientId} onValueChange={setSelectedClientId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a client..." />
              </SelectTrigger>
              <SelectContent>
                {clients.map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsProcessDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={processEmail} 
              disabled={!selectedClientId || isProcessing}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                'Create Bid'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
