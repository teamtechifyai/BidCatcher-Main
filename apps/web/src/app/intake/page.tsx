'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, Upload, FileText, Folder, CheckCircle2, AlertCircle, Loader2, X, Sparkles, Lock } from 'lucide-react';
import { WorkspaceIndicator } from '@/components/workspace-switcher';
import { isSupabaseConfigured } from '@/lib/supabase/client';

interface IntakeField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select' | 'boolean' | 'textarea';
  required: boolean;
  options?: string[];
  placeholder?: string;
  helpText?: string;
}

interface Client {
  id: string;
  name: string;
  slug: string;
}

interface ClientConfig {
  intake?: {
    intakeFields?: IntakeField[];
  };
  intakeFields?: IntakeField[]; // Legacy support for flat structure
}

interface ExtractionResult {
  extractedFields: Record<string, string | number | boolean | null>;
  confidenceScores: Record<string, number>;
  pdfInfo: { numPages: number; title?: string };
  processingInfo: {
    method: 'ai' | 'regex' | 'hybrid';
    processingTimeMs: number;
    warnings: string[];
    fieldsRequested: number;
    fieldsExtracted: number;
  };
  fieldDefinitions: IntakeField[];
}

interface UploadedPDF {
  file: File;
  path: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  result?: ExtractionResult;
  error?: string;
}

type IntakeMode = 'upload' | 'manual';
type UploadType = 'file' | 'folder';

function IntakePageContent() {
  const searchParams = useSearchParams();
  const preselectedClientId = searchParams.get('clientId');
  const folderInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const { user, isOwner: authIsOwner, currentWorkspace, workspaces, isLoading: authLoading } = useAuth();
  
  // If auth isn't configured, treat as owner (for development)
  const isOwner = !isSupabaseConfigured || authIsOwner;

  const [mode, setMode] = useState<IntakeMode>('upload');
  const [uploadType, setUploadType] = useState<UploadType>('folder');
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>(preselectedClientId || '');
  const [clientConfig, setClientConfig] = useState<ClientConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [loading, setLoading] = useState(false);
  
  const [uploadedPDFs, setUploadedPDFs] = useState<UploadedPDF[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [currentProcessingIndex, setCurrentProcessingIndex] = useState<number>(-1);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  
  const [mergedResult, setMergedResult] = useState<ExtractionResult | null>(null);
  
  const [formData, setFormData] = useState<Record<string, string | number | boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string; bidId?: string } | null>(null);

  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (!authLoading || !isSupabaseConfigured) {
      fetchClients();
    }
  }, [authLoading, isOwner, currentWorkspace, workspaces]);

  useEffect(() => {
    // When in a specific workspace, always use that workspace's client
    if (currentWorkspace) {
      setSelectedClientId(currentWorkspace.id);
    } else if (preselectedClientId) {
      setSelectedClientId(preselectedClientId);
    }
  }, [preselectedClientId, currentWorkspace]);

  // Auto-dismiss result messages after 6 seconds
  useEffect(() => {
    if (result) {
      const timer = setTimeout(() => setResult(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [result]);

  async function fetchClients() {
    setLoading(true);
    try {
      const res = await fetch('/api/clients');
      const data = await res.json();
      if (data.success && data.data) {
        // Filter clients based on user access
        let filteredClients = data.data;
        if (!isOwner) {
          const workspaceIds = workspaces.map(w => w.id);
          filteredClients = data.data.filter((c: Client) => workspaceIds.includes(c.id));
        }
        setClients(filteredClients);
        
        // Auto-select if only one available
        if (filteredClients.length === 1) {
          setSelectedClientId(filteredClients[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to load clients:', err);
    } finally {
      setLoading(false);
    }
  }

  async function fetchClientConfig(clientId: string) {
    if (!clientId) {
      setClientConfig(null);
      return;
    }
    
    setLoadingConfig(true);
    try {
      const res = await fetch(`/api/clients/${clientId}`);
      const data = await res.json();
      if (data.success && data.data?.config) {
        const config = data.data.config;
        console.log('[Intake] Client config loaded:', {
          hasIntake: !!config.intake,
          hasIntakeFields: !!(config.intake?.intakeFields || config.intakeFields),
          fieldCount: (config.intake?.intakeFields || config.intakeFields || []).length
        });
        setClientConfig(config);
      } else {
        console.log('[Intake] No config found for client');
        setClientConfig(null);
      }
    } catch (err) {
      console.error('Failed to load client config:', err);
      setClientConfig(null);
    } finally {
      setLoadingConfig(false);
    }
  }

  // Fetch client config when client changes
  useEffect(() => {
    if (selectedClientId) {
      fetchClientConfig(selectedClientId);
    } else {
      setClientConfig(null);
    }
  }, [selectedClientId]);

  const collectPDFsFromFiles = useCallback((fileList: FileList): UploadedPDF[] => {
    const pdfs: UploadedPDF[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        const path = (file as unknown as { webkitRelativePath?: string }).webkitRelativePath || file.name;
        pdfs.push({ file, path, status: 'pending' });
      }
    }
    pdfs.sort((a, b) => a.path.localeCompare(b.path));
    return pdfs;
  }, []);

  const handleFolderSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    const pdfs = collectPDFsFromFiles(files);
    if (pdfs.length === 0) {
      setExtractionError('No PDF files found in the selected folder');
      return;
    }
    
    setUploadedPDFs(pdfs);
    setExtractionError(null);
    setMergedResult(null);
    setFormData({});
    setResult(null);
  }, [collectPDFsFromFiles]);

  const handleFileSelect = useCallback((file: File) => {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setExtractionError('Please upload a PDF file');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setExtractionError('File size must be less than 50MB');
      return;
    }
    
    setUploadedPDFs([{ file, path: file.name, status: 'pending' }]);
    setExtractionError(null);
    setMergedResult(null);
    setFormData({});
    setResult(null);
  }, []);

  async function traverseFileTree(entry: FileSystemEntry, path: string, allFiles: File[]): Promise<void> {
    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry;
      return new Promise((resolve) => {
        fileEntry.file((file) => {
          (file as unknown as { relativePath: string }).relativePath = path + file.name;
          allFiles.push(file);
          resolve();
        });
      });
    } else if (entry.isDirectory) {
      const dirEntry = entry as FileSystemDirectoryEntry;
      const dirReader = dirEntry.createReader();
      
      return new Promise((resolve) => {
        dirReader.readEntries(async (entries) => {
          for (const childEntry of entries) {
            await traverseFileTree(childEntry, path + entry.name + '/', allFiles);
          }
          resolve();
        });
      });
    }
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const items = e.dataTransfer.items;
    const files = e.dataTransfer.files;
    
    if (items && items.length > 0) {
      const allFiles: File[] = [];
      const promises: Promise<void>[] = [];
      
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file') {
          const entry = item.webkitGetAsEntry?.();
          if (entry) {
            promises.push(traverseFileTree(entry, '', allFiles));
          }
        }
      }
      
      Promise.all(promises).then(() => {
        if (allFiles.length > 0) {
          const pdfs = allFiles
            .filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))
            .map(f => ({
              file: f,
              path: (f as unknown as { relativePath?: string }).relativePath || f.name,
              status: 'pending' as const,
            }));
          
          if (pdfs.length > 0) {
            setUploadedPDFs(pdfs);
            setExtractionError(null);
            setMergedResult(null);
            setFormData({});
            setResult(null);
          } else {
            setExtractionError('No PDF files found in the dropped items');
          }
        }
      });
    } else if (files.length === 1 && files[0].type === 'application/pdf') {
      handleFileSelect(files[0]);
    }
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  async function extractFromPDF(pdf: UploadedPDF): Promise<ExtractionResult | null> {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(pdf.file);
    });

    // Check file size - if > 5MB, warn user
    const fileSizeMB = pdf.file.size / (1024 * 1024);
    if (fileSizeMB > 20) {
      console.warn(`[extraction] Large file: ${pdf.path} (${fileSizeMB.toFixed(2)}MB) - may take longer`);
    }

    // Call backend directly to bypass Next.js proxy size limits
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
    const res = await fetch(`${apiUrl}/extraction/document`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentBase64: base64, filename: pdf.path, clientId: selectedClientId, useAI: true }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[extraction] Failed for ${pdf.path}:`, res.status, errorText);
      throw new Error(`Extraction failed (${res.status}): ${errorText.substring(0, 200)}`);
    }

    const data = await res.json();
    if (data.success && data.data) return data.data;
    throw new Error(data.error?.message || 'Extraction failed');
  }

  function mergeExtractionResults(results: ExtractionResult[]): ExtractionResult {
    if (results.length === 0) throw new Error('No results to merge');
    if (results.length === 1) return results[0];
    
    const merged: ExtractionResult = {
      extractedFields: { ...results[0].extractedFields },
      confidenceScores: { ...results[0].confidenceScores },
      pdfInfo: { numPages: results.reduce((sum, r) => sum + r.pdfInfo.numPages, 0), title: results[0].pdfInfo.title },
      processingInfo: {
        method: results.some(r => r.processingInfo.method === 'ai') ? 'ai' : 'hybrid',
        processingTimeMs: results.reduce((sum, r) => sum + r.processingInfo.processingTimeMs, 0),
        warnings: [`Merged data from ${results.length} PDF files`],
        fieldsRequested: results[0].processingInfo.fieldsRequested,
        fieldsExtracted: 0,
      },
      fieldDefinitions: results[0].fieldDefinitions,
    };
    
    for (let i = 1; i < results.length; i++) {
      const result = results[i];
      for (const [key, value] of Object.entries(result.extractedFields)) {
        const existingValue = merged.extractedFields[key];
        const existingConfidence = merged.confidenceScores[key] || 0;
        const newConfidence = result.confidenceScores[key] || 0;
        
        if ((existingValue === null || existingValue === undefined || existingValue === '') && value !== null && value !== undefined && value !== '') {
          merged.extractedFields[key] = value;
          merged.confidenceScores[key] = newConfidence;
        } else if (newConfidence > existingConfidence && value !== null && value !== undefined) {
          merged.extractedFields[key] = value;
          merged.confidenceScores[key] = newConfidence;
        }
      }
      merged.processingInfo.warnings.push(...result.processingInfo.warnings);
    }
    
    merged.processingInfo.fieldsExtracted = Object.values(merged.extractedFields).filter(v => v !== null && v !== undefined && v !== '').length;
    return merged;
  }

  async function extractFromAllDocuments() {
    if (uploadedPDFs.length === 0 || !selectedClientId) return;

    setExtracting(true);
    setExtractionError(null);
    setMergedResult(null);

    const results: ExtractionResult[] = [];
    const updatedPDFs = [...uploadedPDFs];

    try {
      for (let i = 0; i < uploadedPDFs.length; i++) {
        setCurrentProcessingIndex(i);
        updatedPDFs[i] = { ...updatedPDFs[i], status: 'processing' };
        setUploadedPDFs([...updatedPDFs]);

        try {
          const result = await extractFromPDF(uploadedPDFs[i]);
          if (result) {
            results.push(result);
            updatedPDFs[i] = { ...updatedPDFs[i], status: 'done', result };
          } else {
            updatedPDFs[i] = { ...updatedPDFs[i], status: 'error', error: 'No result' };
          }
        } catch (err) {
          updatedPDFs[i] = { ...updatedPDFs[i], status: 'error', error: err instanceof Error ? err.message : 'Failed' };
        }
        setUploadedPDFs([...updatedPDFs]);
      }

      if (results.length > 0) {
        const merged = mergeExtractionResults(results);
        setMergedResult(merged);
        
        const prefilled: Record<string, string | number | boolean> = {};
        for (const [key, value] of Object.entries(merged.extractedFields)) {
          if (value !== null && value !== undefined) prefilled[key] = value as string | number | boolean;
        }
        setFormData(prefilled);
      } else {
        setExtractionError('Failed to extract data from any PDF');
      }
    } catch (err) {
      setExtractionError(err instanceof Error ? err.message : 'Extraction failed');
    } finally {
      setExtracting(false);
      setCurrentProcessingIndex(-1);
    }
  }

  function handleFieldChange(key: string, value: string | number | boolean) {
    setFormData((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedClientId) { setResult({ type: 'error', message: 'Please select a client' }); return; }

    const projectName = String(formData.projectName || formData.project_name || formData.projectDescription || formData.project_description || 'Untitled Project').trim();
    const senderEmail = String(formData.senderEmail || formData.sender_email || formData.filledBy || formData.filled_by || '').trim();

    if (!projectName || projectName === 'Untitled Project') {
      setResult({ type: 'error', message: 'Project name is required.' });
      return;
    }

    const emailToUse = senderEmail && senderEmail.includes('@') ? senderEmail : 'intake@bidcatcher.local';

    setSubmitting(true);
    setResult(null);

    try {
      // Build extracted fields with confidence scores for storage
      const extractedFieldsWithConfidence = mergedResult ? Object.entries(mergedResult.extractedFields).map(([key, value]) => ({
        fieldKey: key,
        extractedValue: value,
        confidence: mergedResult.confidenceScores[key] ?? 0.5,
      })) : [];

      // Build confidence scores map for storage
      const confidenceScores = mergedResult?.confidenceScores || {};

      const payload = {
        clientId: selectedClientId,
        projectName,
        senderEmail: emailToUse,
        senderName: String(formData.senderName || formData.sender_name || formData.filledBy || formData.filled_by || '').trim() || undefined,
        senderCompany: String(formData.senderCompany || formData.sender_company || formData.clientName || formData.client_name || '').trim() || undefined,
        notes: String(formData.notes || formData.otherNotes || formData.other_notes || '').trim() || undefined,
        customFields: formData,
        confidenceScores: Object.keys(confidenceScores).length > 0 ? confidenceScores : undefined,
        extractedFields: extractedFieldsWithConfidence.length > 0 ? extractedFieldsWithConfidence : undefined,
        documentMetadata: mergedResult ? { fileCount: uploadedPDFs.length, filenames: uploadedPDFs.map(p => p.path), totalPages: mergedResult.pdfInfo.numPages, extractionMethod: mergedResult.processingInfo.method } : undefined,
      };

      // Debug logging - CRITICAL FOR DEBUGGING
      console.log('[intake] ========== PAYLOAD DEBUG ==========');
      console.log('[intake] mergedResult:', mergedResult);
      console.log('[intake] mergedResult.extractedFields:', mergedResult?.extractedFields);
      console.log('[intake] extractedFieldsWithConfidence:', extractedFieldsWithConfidence);
      console.log('[intake] payload.extractedFields:', payload.extractedFields);
      console.log('[intake] payload.extractedFields length:', payload.extractedFields?.length);
      if (payload.extractedFields && payload.extractedFields.length > 0) {
        console.log('[intake] First 3 extracted fields:', payload.extractedFields.slice(0, 3));
      }
      console.log('[intake] Full payload keys:', Object.keys(payload));
      console.log('[intake] ======================================');

      const res = await fetch('/api/intake/web', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();

      if (data.success) {
        setResult({ type: 'success', message: `Bid created successfully!`, bidId: data.data?.bidId });
        setUploadedPDFs([]);
        setMergedResult(null);
        setFormData({});
      } else {
        let errorMessage = data.error?.message || 'Submission failed';
        if (data.error?.details) {
          const details = Array.isArray(data.error.details) ? data.error.details.map((d: { path?: string[]; message?: string }) => `${d.path?.join('.')}: ${d.message}`).join(', ') : JSON.stringify(data.error.details);
          errorMessage += ` (${details})`;
        }
        setResult({ type: 'error', message: errorMessage });
      }
    } catch (err) {
      setResult({ type: 'error', message: err instanceof Error ? err.message : 'Submission failed' });
    } finally {
      setSubmitting(false);
    }
  }

  function clearAll() {
    setUploadedPDFs([]);
    setMergedResult(null);
    setFormData({});
    setExtractionError(null);
    setResult(null);
    if (folderInputRef.current) folderInputRef.current.value = '';
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function renderField(field: IntakeField) {
    const value = formData[field.key] ?? '';
    const confidence = mergedResult?.confidenceScores[field.key];
    const hasAIValue = confidence !== undefined && confidence > 0;

    let input;
    switch (field.type) {
      case 'textarea':
        input = <Textarea id={field.key} value={value as string} onChange={(e) => handleFieldChange(field.key, e.target.value)} placeholder={field.placeholder} required={field.required} disabled={submitting} rows={3} />;
        break;
      case 'select':
        input = (
          <Select value={value as string} onValueChange={(v) => handleFieldChange(field.key, v)}>
            <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
            <SelectContent>{field.options?.map((opt) => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}</SelectContent>
          </Select>
        );
        break;
      case 'boolean':
        input = <div className="flex items-center gap-3 pt-2"><Checkbox id={field.key} checked={value as boolean} onCheckedChange={(c) => handleFieldChange(field.key, !!c)} disabled={submitting} /><Label htmlFor={field.key} className="cursor-pointer">Yes</Label></div>;
        break;
      case 'number':
        input = <Input id={field.key} type="number" value={value as number} onChange={(e) => handleFieldChange(field.key, e.target.valueAsNumber || 0)} placeholder={field.placeholder} required={field.required} disabled={submitting} />;
        break;
      case 'date':
        input = <Input id={field.key} type="date" value={value as string} onChange={(e) => handleFieldChange(field.key, e.target.value)} required={field.required} disabled={submitting} />;
        break;
      default:
        input = <Input id={field.key} type={field.key.toLowerCase().includes('email') ? 'email' : 'text'} value={value as string} onChange={(e) => handleFieldChange(field.key, e.target.value)} placeholder={field.placeholder} required={field.required} disabled={submitting} />;
    }

    return (
      <div key={field.key} className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor={field.key} className="text-sm font-medium">
            {field.label}
            {field.required && <span className="text-destructive ml-1">*</span>}
          </Label>
          {hasAIValue && (
            <Badge variant="outline" className={`text-xs gap-1 ${confidence >= 0.8 ? 'text-green-500 border-green-800' : confidence >= 0.5 ? 'text-yellow-500 border-yellow-800' : 'text-red-500 border-red-800'}`}>
              <Sparkles className="h-3 w-3" />
              {Math.round(confidence * 100)}%
            </Badge>
          )}
        </div>
        {input}
        {field.helpText && <p className="text-xs text-muted-foreground">{field.helpText}</p>}
      </div>
    );
  }

  // Use fields from: 1) extraction result, 2) client config (nested or flat), or 3) empty (fallback to hardcoded)
  const configIntakeFields = clientConfig?.intake?.intakeFields || clientConfig?.intakeFields || [];
  const fields = mergedResult?.fieldDefinitions || configIntakeFields;
  const completedCount = uploadedPDFs.filter(p => p.status === 'done').length;
  const errorCount = uploadedPDFs.filter(p => p.status === 'error').length;
  
  // Check if user has access to selected client
  const hasAccessToClient = isOwner || workspaces.some(w => w.id === selectedClientId);

  if (authLoading && isSupabaseConfigured) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // No workspaces assigned (only check if auth is configured)
  if (isSupabaseConfigured && !isOwner && workspaces.length === 0) {
    return (
      <div className="max-w-3xl mx-auto">
        <Card>
          <CardContent className="py-12 text-center">
            <Lock className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">You don&apos;t have access to any workspaces yet.</p>
            <p className="text-sm text-muted-foreground mt-1">Contact an administrator to get access.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-4 -ml-2">
          <Link href="/">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Link>
        </Button>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Submit Bid</h1>
            <p className="text-muted-foreground mt-1">
              Upload bid documents for AI-powered field extraction
            </p>
          </div>
          <WorkspaceIndicator />
        </div>
      </div>

      {/* Mode Toggle */}
      <div className="flex gap-2 p-1 bg-muted rounded-lg w-fit">
        <Button variant={mode === 'upload' ? 'default' : 'ghost'} size="sm" onClick={() => setMode('upload')} className="gap-2">
          <Upload className="h-4 w-4" />
          Upload Documents
        </Button>
        <Button variant={mode === 'manual' ? 'default' : 'ghost'} size="sm" onClick={() => setMode('manual')}>
          Manual Entry
        </Button>
      </div>

      {/* Client Selector - Only show when in "All Workspaces" mode (no specific workspace selected) */}
      {!currentWorkspace && (isOwner || clients.length > 1) && (
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Select Client</CardTitle>
            <CardDescription>
              Choose which client this bid is for
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading clients...</p>
            ) : (
              <Select value={selectedClientId} onValueChange={(v) => { setSelectedClientId(v); clearAll(); }}>
                <SelectTrigger className="w-full max-w-sm"><SelectValue placeholder="Choose a client..." /></SelectTrigger>
                <SelectContent>{clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}</SelectContent>
              </Select>
            )}
          </CardContent>
        </Card>
      )}

      {/* Result Message */}
      {result && (
        <Card className={result.type === 'success' ? 'border-green-800 bg-green-950/20' : 'border-destructive bg-destructive/10'}>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              {result.type === 'success' ? <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" /> : <AlertCircle className="h-5 w-5 text-destructive shrink-0" />}
              <div className="flex-1">
                <p className={result.type === 'success' ? 'text-green-500' : 'text-destructive'}>{result.message}</p>
                {result.bidId && (
                  <Button variant="link" asChild className="p-0 h-auto mt-1 text-green-400">
                    <Link href={`/bids/${result.bidId}`}>View Bid &rarr;</Link>
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {mode === 'upload' && selectedClientId && (
        <>
          {/* Upload Type Toggle */}
          <div className="flex gap-2">
            <Button variant={uploadType === 'folder' ? 'secondary' : 'ghost'} size="sm" onClick={() => setUploadType('folder')} className="gap-2">
              <Folder className="h-4 w-4" />
              Upload Folder
            </Button>
            <Button variant={uploadType === 'file' ? 'secondary' : 'ghost'} size="sm" onClick={() => setUploadType('file')} className="gap-2">
              <FileText className="h-4 w-4" />
              Single File
            </Button>
          </div>

          {/* Document Upload Zone */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={`relative border-2 border-dashed rounded-xl p-12 text-center transition-all cursor-pointer ${
              isDragging ? 'border-foreground bg-foreground/5' :
              uploadedPDFs.length > 0 ? 'border-green-800 bg-green-950/10' : 'border-muted-foreground/25 hover:border-muted-foreground/50'
            }`}
          >
            {uploadType === 'folder' ? (
              // @ts-expect-error - webkitdirectory works in browsers
              <input ref={folderInputRef} type="file" webkitdirectory="" directory="" multiple onChange={handleFolderSelect} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
            ) : (
              <input ref={fileInputRef} type="file" accept=".pdf,application/pdf" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
            )}
            
            {uploadedPDFs.length > 0 ? (
              <div className="space-y-3">
                <div className="h-16 w-16 rounded-full bg-green-950 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="h-8 w-8 text-green-500" />
                </div>
                <div>
                  <p className="font-semibold text-lg text-green-500">{uploadedPDFs.length} PDF{uploadedPDFs.length !== 1 ? 's' : ''} selected</p>
                  <p className="text-sm text-muted-foreground mt-1">Ready for extraction</p>
                </div>
                <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); clearAll(); }} className="text-muted-foreground hover:text-destructive">
                  Clear all
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mx-auto">
                  {uploadType === 'folder' ? <Folder className="h-8 w-8 text-muted-foreground" /> : <FileText className="h-8 w-8 text-muted-foreground" />}
                </div>
                <div>
                  <p className="font-semibold text-lg">{uploadType === 'folder' ? 'Drop a folder here' : 'Drop a PDF here'}</p>
                  <p className="text-sm text-muted-foreground mt-1">or click to browse</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {uploadType === 'folder' ? 'All PDFs in nested folders will be found automatically' : 'PDF only, max 50MB'}
                </p>
              </div>
            )}
          </div>

          {/* PDF List */}
          {uploadedPDFs.length > 0 && (
            <Card>
              <CardHeader className="py-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium">PDF Files ({uploadedPDFs.length})</CardTitle>
                  {extracting && (
                    <span className="text-xs text-blue-500 flex items-center gap-2">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Processing {currentProcessingIndex + 1} of {uploadedPDFs.length}...
                    </span>
                  )}
                  {!extracting && completedCount > 0 && (
                    <span className="text-xs text-green-500">{completedCount} extracted</span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="max-h-48 overflow-y-auto divide-y border rounded-lg">
                  {uploadedPDFs.map((pdf, index) => (
                    <div key={index} className={`px-4 py-3 flex items-center gap-3 text-sm ${currentProcessingIndex === index ? 'bg-blue-950/30' : ''}`}>
                      {pdf.status === 'pending' && <div className="h-4 w-4 rounded-full border-2 border-muted-foreground" />}
                      {pdf.status === 'processing' && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
                      {pdf.status === 'done' && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                      {pdf.status === 'error' && <X className="h-4 w-4 text-destructive" />}
                      <span className="flex-1 truncate text-muted-foreground font-mono text-xs">{pdf.path}</span>
                      {pdf.result && <span className="text-xs text-muted-foreground">{pdf.result.pdfInfo.numPages} pg</span>}
                      {pdf.error && <span className="text-xs text-destructive">Failed</span>}
                    </div>
                  ))}
                </div>
                {errorCount > 0 && <p className="text-xs text-destructive mt-3">{errorCount} file{errorCount !== 1 ? 's' : ''} failed to process</p>}
              </CardContent>
            </Card>
          )}

          {/* Extract Button */}
          {uploadedPDFs.length > 0 && !mergedResult && (
            <Button onClick={extractFromAllDocuments} disabled={extracting} className="w-full h-12 text-base gap-2">
              {extracting ? (
                <><Loader2 className="h-5 w-5 animate-spin" />Extracting {currentProcessingIndex + 1} of {uploadedPDFs.length}...</>
              ) : (
                <><Sparkles className="h-5 w-5" />Extract Fields from {uploadedPDFs.length} PDF{uploadedPDFs.length !== 1 ? 's' : ''}</>
              )}
            </Button>
          )}

          {/* Extraction Error */}
          {extractionError && (
            <Card className="border-destructive bg-destructive/10">
              <CardContent className="py-4 flex items-center gap-3">
                <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
                <p className="text-destructive">{extractionError}</p>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Extracted Fields Form - Shows after PDF extraction */}
      {mode === 'upload' && mergedResult && selectedClientId && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2 text-green-500">
                  <CheckCircle2 className="h-5 w-5" />
                  AI Extraction Complete
                </CardTitle>
                <CardDescription>
                  {uploadedPDFs.length} file{uploadedPDFs.length !== 1 ? 's' : ''} &bull; {mergedResult.pdfInfo.numPages} pages &bull; {mergedResult.processingInfo.processingTimeMs}ms
                </CardDescription>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold">
                  <span className="text-green-500">{mergedResult.processingInfo.fieldsExtracted}</span>
                  <span className="text-muted-foreground text-lg">/{mergedResult.processingInfo.fieldsRequested || fields.length}</span>
                </p>
                <p className="text-xs text-muted-foreground">fields extracted</p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid md:grid-cols-2 gap-6">
                {fields.map((field) => renderField(field))}
              </div>

              <div className="flex items-center justify-between pt-6 border-t">
                <p className="text-sm text-muted-foreground"><span className="text-destructive">*</span> Required fields</p>
                <Button type="submit" disabled={submitting} className="min-w-[140px]">
                  {submitting ? 'Creating...' : 'Create Bid'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Empty State - only show if no client is selected and we're in "All Workspaces" mode */}
      {!selectedClientId && !currentWorkspace && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-muted-foreground">
            Select a client above to start
          </CardContent>
        </Card>
      )}

      {mode === 'manual' && selectedClientId && (
        <Card>
          <CardHeader>
            <CardTitle>Enter Bid Details</CardTitle>
            {configIntakeFields.length > 0 && (
              <CardDescription>
                Using custom fields from client configuration ({configIntakeFields.length} fields)
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {loadingConfig ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid md:grid-cols-2 gap-6">
                  {fields.length > 0 ? (
                    fields.map((field) => renderField(field))
                  ) : (
                    <>
                      {renderField({ key: 'project_name', label: 'Project Name', type: 'text', required: true })}
                      {renderField({ key: 'sender_email', label: 'Your Email', type: 'text', required: true })}
                      {renderField({ key: 'project_location', label: 'Project Location', type: 'text', required: false })}
                      {renderField({ key: 'bid_due_date', label: 'Bid Due Date', type: 'date', required: false })}
                      {renderField({ key: 'owner_name', label: 'Owner/Client Name', type: 'text', required: false })}
                      {renderField({ key: 'general_contractor', label: 'General Contractor', type: 'text', required: false })}
                      {renderField({ key: 'project_value_estimate', label: 'Estimated Value', type: 'text', required: false })}
                      {renderField({ key: 'bond_required', label: 'Bond Required', type: 'boolean', required: false })}
                      {renderField({ key: 'scope_of_work', label: 'Scope of Work', type: 'textarea', required: false })}
                      {renderField({ key: 'notes', label: 'Additional Notes', type: 'textarea', required: false })}
                    </>
                  )}
                </div>
                <div className="flex items-center justify-between pt-6 border-t">
                  <p className="text-sm text-muted-foreground"><span className="text-destructive">*</span> Required fields</p>
                  <Button type="submit" disabled={submitting} className="min-w-[140px]">{submitting ? 'Creating...' : 'Create Bid'}</Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function IntakePage() {
  return (
    <Suspense fallback={
      <div className="min-h-[50vh] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    }>
      <IntakePageContent />
    </Suspense>
  );
}
