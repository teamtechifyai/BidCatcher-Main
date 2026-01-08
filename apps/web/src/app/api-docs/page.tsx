'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, ChevronDown, ChevronRight, Copy, Check, Code, Zap, Database, FileJson } from 'lucide-react';

interface Endpoint {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  description: string;
  params?: { name: string; type: string; description: string; required?: boolean }[];
  query?: { name: string; type: string; description: string; required?: boolean }[];
  body?: { name: string; type: string; description: string; required?: boolean }[];
  response?: string;
}

interface EndpointGroup {
  name: string;
  description: string;
  baseUrl: string;
  endpoints: Endpoint[];
}

const API_DOCS: EndpointGroup[] = [
  {
    name: 'Health',
    description: 'Health check and system status endpoints',
    baseUrl: '/health',
    endpoints: [
      { method: 'GET', path: '/health', description: 'Get API health status', response: '{ status, version, timestamp, uptime, checks }' },
      { method: 'GET', path: '/health/ready', description: 'Readiness probe', response: '{ ready: boolean }' },
      { method: 'GET', path: '/health/live', description: 'Liveness probe', response: '{ alive: boolean }' },
      { method: 'POST', path: '/health/migrate', description: 'Run database migrations', response: '{ success, message, migrations[] }' },
    ],
  },
  {
    name: 'Clients',
    description: 'Manage client configurations',
    baseUrl: '/clients',
    endpoints: [
      { method: 'GET', path: '/clients', description: 'List all clients', response: '{ success, data: Client[] }' },
      { method: 'GET', path: '/clients/:id', description: 'Get client details', params: [{ name: 'id', type: 'UUID', description: 'Client ID', required: true }], response: '{ success, data: Client }' },
      { method: 'GET', path: '/clients/:id/config', description: 'Get client config', params: [{ name: 'id', type: 'UUID', description: 'Client ID', required: true }], response: '{ success, data: ClientConfig }' },
      { method: 'POST', path: '/clients', description: 'Create client', body: [{ name: 'name', type: 'string', description: 'Company name', required: true }, { name: 'contactEmail', type: 'string', description: 'Email', required: true }], response: '{ success, data: Client }' },
      { method: 'PUT', path: '/clients/:id/config', description: 'Update config', params: [{ name: 'id', type: 'UUID', description: 'Client ID', required: true }], body: [{ name: 'config', type: 'ClientConfig', description: 'Config object', required: true }], response: '{ success, data: ClientConfig }' },
      { method: 'DELETE', path: '/clients/:id', description: 'Delete client', params: [{ name: 'id', type: 'UUID', description: 'Client ID', required: true }], query: [{ name: 'hard', type: 'boolean', description: 'Permanent delete' }], response: '{ success, data: { deleted } }' },
    ],
  },
  {
    name: 'Intake',
    description: 'Submit bids via web or email',
    baseUrl: '/intake',
    endpoints: [
      { method: 'POST', path: '/intake/web', description: 'Submit web bid', body: [{ name: 'clientId', type: 'UUID', description: 'Client ID', required: true }, { name: 'projectName', type: 'string', description: 'Project name', required: true }, { name: 'senderEmail', type: 'string', description: 'Email', required: true }], response: '{ success, data: { bidId, status } }' },
      { method: 'POST', path: '/intake/email', description: 'Submit email bid', body: [{ name: 'clientId', type: 'UUID', description: 'Client ID', required: true }, { name: 'fromEmail', type: 'string', description: 'From email', required: true }, { name: 'subject', type: 'string', description: 'Subject', required: true }], response: '{ success, data: { bidId, status } }' },
    ],
  },
  {
    name: 'Bids',
    description: 'Bid queue management',
    baseUrl: '/bids',
    endpoints: [
      { method: 'GET', path: '/bids', description: 'List bids', query: [{ name: 'clientId', type: 'UUID', description: 'Filter by client' }, { name: 'status', type: 'string', description: 'Filter by status' }, { name: 'limit', type: 'number', description: 'Max results' }], response: '{ success, data: { bids[], total } }' },
      { method: 'GET', path: '/bids/:id', description: 'Get bid details', params: [{ name: 'id', type: 'UUID', description: 'Bid ID', required: true }], response: '{ success, data: Bid }' },
      { method: 'PATCH', path: '/bids/:id/status', description: 'Update status', params: [{ name: 'id', type: 'UUID', description: 'Bid ID', required: true }], body: [{ name: 'status', type: 'string', description: 'New status', required: true }], response: '{ success, data: { bidId, newStatus } }' },
      { method: 'DELETE', path: '/bids/:id', description: 'Delete bid', params: [{ name: 'id', type: 'UUID', description: 'Bid ID', required: true }], response: '{ success, data: { bidId } }' },
    ],
  },
  {
    name: 'Decisions',
    description: 'Go/No-Go evaluation',
    baseUrl: '/bids',
    endpoints: [
      { method: 'POST', path: '/bids/:id/evaluate', description: 'Run evaluation', params: [{ name: 'id', type: 'UUID', description: 'Bid ID', required: true }], query: [{ name: 'useAI', type: 'boolean', description: 'Use AI evaluation' }], response: '{ success, data: { outcome, score, rationale } }' },
      { method: 'POST', path: '/bids/:id/override', description: 'Override decision', params: [{ name: 'id', type: 'UUID', description: 'Bid ID', required: true }], body: [{ name: 'outcome', type: 'string', description: 'New outcome', required: true }, { name: 'rationale', type: 'string', description: 'Reason', required: true }], response: '{ success, data: { overrideId } }' },
      { method: 'GET', path: '/bids/:id/decisions', description: 'Get decision history', params: [{ name: 'id', type: 'UUID', description: 'Bid ID', required: true }], response: '{ success, data: { history[] } }' },
    ],
  },
  {
    name: 'Extraction',
    description: 'PDF parsing and AI extraction',
    baseUrl: '/extraction',
    endpoints: [
      { method: 'POST', path: '/extraction/document', description: 'Extract from PDF', body: [{ name: 'documentBase64', type: 'string', description: 'PDF content', required: true }, { name: 'clientId', type: 'UUID', description: 'Client ID', required: true }], response: '{ success, data: { extractedFields, confidenceScores } }' },
      { method: 'GET', path: '/extraction/supported-fields', description: 'Get supported fields', response: '{ success, data: { fields[] } }' },
    ],
  },
  {
    name: 'Documents',
    description: 'Document management',
    baseUrl: '/documents',
    endpoints: [
      { method: 'GET', path: '/documents/:id', description: 'Get document metadata', params: [{ name: 'id', type: 'UUID', description: 'Document ID', required: true }], response: '{ success, data: Document }' },
      { method: 'GET', path: '/documents/:id/download', description: 'Download document', params: [{ name: 'id', type: 'UUID', description: 'Document ID', required: true }], response: 'Binary file' },
    ],
  },
  {
    name: 'Handoff',
    description: 'JobTread integration',
    baseUrl: '/bids',
    endpoints: [
      { method: 'POST', path: '/bids/:id/handoff/jobtread', description: 'Send to JobTread', params: [{ name: 'id', type: 'UUID', description: 'Bid ID', required: true }], response: '{ success, data: { handoffId, status } }' },
      { method: 'GET', path: '/bids/:id/handoff/jobtread', description: 'Get handoff history', params: [{ name: 'id', type: 'UUID', description: 'Bid ID', required: true }], response: '{ success, data: Handoff[] }' },
    ],
  },
];

function MethodBadge({ method }: { method: string }) {
  const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info'> = {
    GET: 'success', POST: 'info', PUT: 'warning', PATCH: 'secondary', DELETE: 'destructive',
  };
  return <Badge variant={variants[method] || 'outline'} className="font-mono text-xs w-16 justify-center">{method}</Badge>;
}

function EndpointCard({ endpoint }: { endpoint: Endpoint }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  
  const curlCommand = `curl ${endpoint.method !== 'GET' ? `-X ${endpoint.method} ` : ''}http://localhost:3000${endpoint.path.replace(':id', '{id}')}`;
  
  function copyToClipboard() {
    navigator.clipboard.writeText(curlCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  
  return (
    <div className="border rounded-lg overflow-hidden transition-shadow hover:shadow-sm">
      <button onClick={() => setExpanded(!expanded)} className="w-full px-4 py-3 flex items-center gap-4 hover:bg-muted/50 transition text-left">
        <MethodBadge method={endpoint.method} />
        <code className="text-sm flex-1 font-mono truncate">{endpoint.path}</code>
        <span className="text-muted-foreground text-sm hidden lg:block truncate max-w-[300px]">{endpoint.description}</span>
        {expanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
      </button>
      
      {expanded && (
        <div className="px-4 py-4 border-t bg-muted/30 space-y-4">
          <p className="text-sm text-muted-foreground">{endpoint.description}</p>
          
          {endpoint.params && endpoint.params.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Path Parameters</h4>
              <div className="space-y-1.5">
                {endpoint.params.map(param => (
                  <div key={param.name} className="flex items-center gap-2 text-sm">
                    <code className="text-purple-400 font-mono">{param.name}</code>
                    <span className="text-muted-foreground/60">:</span>
                    <span className="text-muted-foreground">{param.type}</span>
                    {param.required && <Badge variant="destructive" className="text-[10px] py-0 h-4">required</Badge>}
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {endpoint.query && endpoint.query.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Query Parameters</h4>
              <div className="space-y-1.5">
                {endpoint.query.map(param => (
                  <div key={param.name} className="flex items-center gap-2 text-sm">
                    <code className="text-blue-400 font-mono">{param.name}</code>
                    <span className="text-muted-foreground/60">:</span>
                    <span className="text-muted-foreground">{param.type}</span>
                    {param.required && <Badge variant="destructive" className="text-[10px] py-0 h-4">required</Badge>}
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {endpoint.body && endpoint.body.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Request Body</h4>
              <div className="space-y-1.5">
                {endpoint.body.map(param => (
                  <div key={param.name} className="flex items-center gap-2 text-sm">
                    <code className="text-green-400 font-mono">{param.name}</code>
                    <span className="text-muted-foreground/60">:</span>
                    <span className="text-muted-foreground">{param.type}</span>
                    {param.required && <Badge variant="destructive" className="text-[10px] py-0 h-4">required</Badge>}
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {endpoint.response && (
            <div>
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Response</h4>
              <code className="text-sm text-muted-foreground bg-background px-3 py-2 rounded-md block font-mono">{endpoint.response}</code>
            </div>
          )}
          
          <div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Try It</h4>
            <div className="flex items-center gap-2">
              <code className="text-sm text-muted-foreground bg-background px-3 py-2 rounded-md flex-1 overflow-x-auto font-mono">{curlCommand}</code>
              <Button variant="outline" size="sm" onClick={copyToClipboard} className="shrink-0">
                {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ApiDocsPage() {
  return (
    <div className="max-w-5xl mx-auto space-y-12">
      {/* Header */}
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-4 -ml-2">
          <Link href="/">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Link>
        </Button>
        <h1 className="text-3xl font-bold tracking-tight">API Documentation</h1>
        <p className="text-muted-foreground mt-2">
          Bid Catcher REST API v0.1.0 &bull; Base URL: <code className="text-foreground font-mono bg-muted px-2 py-0.5 rounded">http://localhost:3000</code>
        </p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <Code className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <div className="text-2xl font-bold">{API_DOCS.length}</div>
            <p className="text-xs text-muted-foreground">API Groups</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <Zap className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <div className="text-2xl font-bold">{API_DOCS.reduce((acc, g) => acc + g.endpoints.length, 0)}</div>
            <p className="text-xs text-muted-foreground">Endpoints</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <Database className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <div className="text-2xl font-bold">REST</div>
            <p className="text-xs text-muted-foreground">API Style</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <FileJson className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <div className="text-2xl font-bold">JSON</div>
            <p className="text-xs text-muted-foreground">Data Format</p>
          </CardContent>
        </Card>
      </div>

      {/* Response Format */}
      <Card>
        <CardHeader>
          <CardTitle>Response Format</CardTitle>
          <CardDescription>All endpoints return a consistent JSON structure</CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="bg-muted rounded-lg p-4 text-sm overflow-x-auto font-mono">
{`{
  "success": true,
  "data": { ... },
  "error": { "code": "...", "message": "..." },
  "meta": { "requestId": "uuid", "timestamp": "ISO8601" }
}`}
          </pre>
        </CardContent>
      </Card>

      {/* Endpoint Groups */}
      <div className="space-y-8">
        {API_DOCS.map(group => (
          <Card key={group.name}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>{group.name}</CardTitle>
                  <CardDescription>{group.description}</CardDescription>
                </div>
                <code className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded font-mono">{group.baseUrl}</code>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-2">
                {group.endpoints.map((endpoint, idx) => (
                  <EndpointCard key={idx} endpoint={endpoint} />
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Footer */}
      <div className="text-center text-sm text-muted-foreground pt-8 pb-4 border-t">
        <p>Bid Catcher API Documentation</p>
        <div className="flex items-center justify-center gap-6 mt-3">
          <Link href="/intake" className="hover:text-foreground transition">Submit a Bid</Link>
          <Link href="/bids" className="hover:text-foreground transition">View Bid Queue</Link>
          <Link href="/clients" className="hover:text-foreground transition">Manage Clients</Link>
        </div>
      </div>
    </div>
  );
}
