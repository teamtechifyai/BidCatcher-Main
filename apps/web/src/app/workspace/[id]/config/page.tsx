'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, Plus, X, ChevronUp, ChevronDown, CheckCircle2, AlertCircle, Eye, Save, GripVertical, Loader2, Lock, Sparkles, Target, BarChart3 } from 'lucide-react';

interface IntakeField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select' | 'boolean' | 'textarea';
  required: boolean;
  options?: string[];
  placeholder?: string;
  helpText?: string;
  /** Description for AI extraction - helps the AI understand what this field means when processing documents */
  aiDescription?: string;
}

interface ClientConfig {
  version: string;
  clientId: string;
  clientName: string;
  active: boolean;
  intake: {
    intakeFields: IntakeField[];
    requiredFields: string[];
    allowedEmailDomains: string[];
    sendAcknowledgement: boolean;
  };
  pdfExtraction: {
    signals: Array<{ signalId: string; label: string; required: boolean }>;
    enableOcr: boolean;
    maxPages: number;
  };
  scoring: {
    criteria: Array<{
      criterionId: string;
      name: string;
      type: string;
      weight: number;
      maxPoints: number;
    }>;
    autoQualifyThreshold: number;
    autoDisqualifyThreshold: number;
    alwaysRequireReview: boolean;
  };
  strategicTags?: Array<{
    id: string;
    label: string;
    matchType: 'contains' | 'regex' | 'value_band';
    field: string;
    value: string;
  }>;
  hoursSavedPerBid?: number;
}

interface Client {
  id: string;
  name: string;
  slug: string;
  contactEmail: string;
  config: ClientConfig;
}

const FIELD_TYPES = ['text', 'number', 'date', 'select', 'boolean', 'textarea'] as const;

export default function WorkspaceConfigPage() {
  const params = useParams();
  const router = useRouter();
  const { user, isAdmin, currentWorkspace, workspaces, isLoading: authLoading } = useAuth();
  const workspaceId = params.id as string;

  const [client, setClient] = useState<Client | null>(null);
  const [config, setConfig] = useState<ClientConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [newField, setNewField] = useState<IntakeField>({
    key: '',
    label: '',
    type: 'text',
    required: false,
    placeholder: '',
    options: [],
  });
  
  // Track which field is expanded for editing options
  const [expandedField, setExpandedField] = useState<string | null>(null);
  const [newOption, setNewOption] = useState<string>('');
  // Track which field has AI description expanded
  const [expandedAiField, setExpandedAiField] = useState<string | null>(null);
  const [newAllowedDomain, setNewAllowedDomain] = useState('');

  // Check access
  const hasAccess = isAdmin || workspaces.some(w => w.id === workspaceId);
  const canEdit = isAdmin; // Only admins can edit config

  useEffect(() => {
    if (!authLoading && user && hasAccess) {
      fetchClient();
    }
  }, [authLoading, user, hasAccess, workspaceId]);

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

  async function fetchClient() {
    try {
      setLoading(true);
      const res = await fetch(`/api/clients/${workspaceId}`);
      const data = await res.json();
      if (data.success && data.data) {
        setClient(data.data);
        setConfig(data.data.config);
      } else {
        setError(data.error?.message || 'Failed to load workspace');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workspace');
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveConfig() {
    if (!config || !canEdit) return;

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/clients/${workspaceId}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      const data = await res.json();

      if (data.success) {
        setSuccess('Configuration saved successfully!');
        setConfig(data.data.config);
      } else {
        setError(data.error?.message || 'Failed to save configuration');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  }

  function addIntakeField() {
    if (!config || !newField.key || !newField.label || !canEdit) return;

    if (config.intake.intakeFields.some((f) => f.key === newField.key)) {
      setError(`Field with key "${newField.key}" already exists`);
      return;
    }

    setConfig({
      ...config,
      intake: {
        ...config.intake,
        intakeFields: [...config.intake.intakeFields, { ...newField }],
      },
    });

    setNewField({ key: '', label: '', type: 'text', required: false, placeholder: '' });
  }

  function removeIntakeField(key: string) {
    if (!config || !canEdit) return;
    setConfig({
      ...config,
      intake: {
        ...config.intake,
        intakeFields: config.intake.intakeFields.filter((f) => f.key !== key),
      },
    });
  }

  function updateIntakeField(key: string, updates: Partial<IntakeField>) {
    if (!config || !canEdit) return;
    setConfig({
      ...config,
      intake: {
        ...config.intake,
        intakeFields: config.intake.intakeFields.map((f) =>
          f.key === key ? { ...f, ...updates } : f
        ),
      },
    });
  }

  function moveField(index: number, direction: 'up' | 'down') {
    if (!config || !canEdit) return;
    const fields = [...config.intake.intakeFields];
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= fields.length) return;
    
    [fields[index], fields[newIndex]] = [fields[newIndex], fields[index]];
    
    setConfig({
      ...config,
      intake: { ...config.intake, intakeFields: fields },
    });
  }

  function addOptionToField(fieldKey: string, option: string) {
    if (!config || !option.trim() || !canEdit) return;
    const field = config.intake.intakeFields.find(f => f.key === fieldKey);
    if (!field) return;
    
    const currentOptions = field.options || [];
    if (currentOptions.includes(option.trim())) {
      setError(`Option "${option}" already exists`);
      return;
    }
    
    updateIntakeField(fieldKey, { options: [...currentOptions, option.trim()] });
    setNewOption('');
  }

  function removeOptionFromField(fieldKey: string, option: string) {
    if (!config || !canEdit) return;
    const field = config.intake.intakeFields.find(f => f.key === fieldKey);
    if (!field || !field.options) return;
    
    updateIntakeField(fieldKey, { options: field.options.filter(o => o !== option) });
  }

  function moveOption(fieldKey: string, optionIndex: number, direction: 'up' | 'down') {
    if (!config || !canEdit) return;
    const field = config.intake.intakeFields.find(f => f.key === fieldKey);
    if (!field || !field.options) return;
    
    const options = [...field.options];
    const newIndex = direction === 'up' ? optionIndex - 1 : optionIndex + 1;
    if (newIndex < 0 || newIndex >= options.length) return;
    
    [options[optionIndex], options[newIndex]] = [options[newIndex], options[optionIndex]];
    updateIntakeField(fieldKey, { options });
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

  if (!client || !config) {
    return (
      <div className="max-w-4xl mx-auto">
        <Card className="border-destructive">
          <CardContent className="py-6 text-destructive text-center">{error || 'Workspace not found'}</CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
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
            <h1 className="text-3xl font-bold tracking-tight">{client.name}</h1>
            <p className="text-muted-foreground mt-1">{client.slug} &bull; {client.contactEmail}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href={`/workspace/${workspaceId}/criteria-trainer`}>
                <Target className="h-4 w-4 mr-2" />
                Criteria Trainer
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href={`/workspace/${workspaceId}/analytics`}>
                <BarChart3 className="h-4 w-4 mr-2" />
                Market Grasp
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href={`/intake?clientId=${workspaceId}`}>
                <Eye className="h-4 w-4 mr-2" />
                Preview Form
              </Link>
            </Button>
            {canEdit && (
              <Button onClick={handleSaveConfig} disabled={saving}>
                <Save className="h-4 w-4 mr-2" />
                {saving ? 'Saving...' : 'Save'}
              </Button>
            )}
          </div>
        </div>
        {!canEdit && (
          <Badge variant="secondary" className="mt-2">
            <Lock className="h-3 w-3 mr-1" />
            View Only — Contact admin to make changes
          </Badge>
        )}
      </div>

      {/* Messages */}
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

      {/* Intake Fields Editor */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Intake Form Fields</CardTitle>
              <CardDescription>Configure the fields shown on the intake form. Use the AI button to add context that helps the AI extract each field from documents.</CardDescription>
            </div>
            <span className="text-sm text-muted-foreground">
              {config.intake.intakeFields.length} fields
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Existing Fields */}
          {config.intake.intakeFields.length > 0 ? (
            <div className="space-y-2">
              {config.intake.intakeFields.map((field, index) => (
                <div key={field.key} className="rounded-lg border bg-muted/30 group">
                  <div className="flex items-center gap-3 p-3">
                    {canEdit && (
                      <>
                        <div className="flex flex-col gap-0.5 text-muted-foreground">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => moveField(index, 'up')}
                            disabled={index === 0}
                            className="h-6 w-6 p-0"
                          >
                            <ChevronUp className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => moveField(index, 'down')}
                            disabled={index === config.intake.intakeFields.length - 1}
                            className="h-6 w-6 p-0"
                          >
                            <ChevronDown className="h-4 w-4" />
                          </Button>
                        </div>
                        <GripVertical className="h-4 w-4 text-muted-foreground" />
                      </>
                    )}
                    <div className="flex-1 grid grid-cols-4 gap-3">
                      <Input
                        value={field.key}
                        disabled
                        className="text-xs bg-background font-mono"
                      />
                      <Input
                        value={field.label}
                        onChange={(e) => updateIntakeField(field.key, { label: e.target.value })}
                        className="text-sm"
                        placeholder="Label"
                        disabled={!canEdit}
                      />
                      <Select
                        value={field.type}
                        onValueChange={(v) => {
                          updateIntakeField(field.key, { 
                            type: v as IntakeField['type'],
                            options: v === 'select' ? (field.options || []) : undefined
                          });
                          if (v === 'select') setExpandedField(field.key);
                        }}
                        disabled={!canEdit}
                      >
                        <SelectTrigger className="text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FIELD_TYPES.map((t) => (
                            <SelectItem key={t} value={t}>{t}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={field.required}
                          onCheckedChange={(c) => updateIntakeField(field.key, { required: !!c })}
                          id={`required-${field.key}`}
                          disabled={!canEdit}
                        />
                        <Label htmlFor={`required-${field.key}`} className="text-sm cursor-pointer">Required</Label>
                      </div>
                    </div>
                    {/* Expand button for select fields */}
                    {field.type === 'select' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setExpandedField(expandedField === field.key ? null : field.key)}
                        className="gap-1 text-xs"
                      >
                        <span>{field.options?.length || 0} options</span>
                        <ChevronDown className={`h-3 w-3 transition-transform ${expandedField === field.key ? 'rotate-180' : ''}`} />
                      </Button>
                    )}
                    {/* AI description button - for document extraction context */}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setExpandedAiField(expandedAiField === field.key ? null : field.key)}
                      className={`gap-1 text-xs ${field.aiDescription ? 'border-primary/50 text-primary' : ''}`}
                      title="Add context for AI when extracting this field from documents"
                    >
                      <Sparkles className="h-3 w-3" />
                      {field.aiDescription ? 'AI context' : 'AI'}
                      <ChevronDown className={`h-3 w-3 transition-transform ${expandedAiField === field.key ? 'rotate-180' : ''}`} />
                    </Button>
                    {canEdit && (
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => removeIntakeField(field.key)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  
                  {/* Expanded AI Description - helps AI understand field when processing documents */}
                  {expandedAiField === field.key && (
                    <div className="px-3 pb-3 pt-0 ml-14 border-t border-border/50 mt-2">
                      <div className="bg-background rounded-lg p-4 space-y-2">
                        <Label className="text-sm font-medium flex items-center gap-2">
                          <Sparkles className="h-4 w-4 text-primary" />
                          AI Extraction Context
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Explain to the AI what this field means. This helps when processing documents (e.g., &quot;Look for project name in RFP subject line or first paragraph&quot;).
                        </p>
                        <Textarea
                          value={field.aiDescription || ''}
                          onChange={(e) => updateIntakeField(field.key, { aiDescription: e.target.value || undefined })}
                          placeholder="e.g., Look for the project name in the RFP subject or cover letter..."
                          disabled={!canEdit}
                          rows={3}
                          className="min-h-[80px]"
                        />
                      </div>
                    </div>
                  )}

                  {/* Expanded Options Editor for Select Fields */}
                  {field.type === 'select' && expandedField === field.key && (
                    <div className="px-3 pb-3 pt-0 ml-14 border-t border-border/50 mt-2">
                      <div className="bg-background rounded-lg p-4 space-y-3">
                        <Label className="text-sm font-medium">Select Options</Label>
                        
                        {/* Existing Options */}
                        {field.options && field.options.length > 0 ? (
                          <div className="space-y-1">
                            {field.options.map((option, optIndex) => (
                              <div key={option} className="flex items-center gap-2 p-2 rounded border bg-muted/50 group/option">
                                {canEdit && (
                                  <div className="flex flex-col gap-0.5">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => moveOption(field.key, optIndex, 'up')}
                                      disabled={optIndex === 0}
                                      className="h-5 w-5 p-0"
                                    >
                                      <ChevronUp className="h-3 w-3" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => moveOption(field.key, optIndex, 'down')}
                                      disabled={optIndex === (field.options?.length || 0) - 1}
                                      className="h-5 w-5 p-0"
                                    >
                                      <ChevronDown className="h-3 w-3" />
                                    </Button>
                                  </div>
                                )}
                                <span className="flex-1 text-sm">{option}</span>
                                {canEdit && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => removeOptionFromField(field.key, option)}
                                    className="h-6 w-6 p-0 opacity-0 group-hover/option:opacity-100 text-muted-foreground hover:text-destructive"
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground italic">No options defined yet</p>
                        )}
                        
                        {/* Add New Option */}
                        {canEdit && (
                          <div className="flex gap-2 pt-2">
                            <Input
                              value={newOption}
                              onChange={(e) => setNewOption(e.target.value)}
                              placeholder="Enter option value..."
                              className="text-sm"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  addOptionToField(field.key, newOption);
                                }
                              }}
                            />
                            <Button
                              size="sm"
                              onClick={() => addOptionToField(field.key, newOption)}
                              disabled={!newOption.trim()}
                            >
                              <Plus className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground border rounded-lg border-dashed">
              No fields configured yet.{canEdit && ' Add your first field below.'}
            </div>
          )}

          {/* Add New Field - Admin Only */}
          {canEdit && (
            <div className="pt-6 border-t">
              <Label className="text-sm font-medium mb-3 block">Add New Field</Label>
              <div className="space-y-3">
                <div className="grid grid-cols-5 gap-3">
                  <Input
                    value={newField.key}
                    onChange={(e) => setNewField({ ...newField, key: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') })}
                    placeholder="field_key"
                    className="font-mono text-sm"
                  />
                  <Input
                    value={newField.label}
                    onChange={(e) => setNewField({ ...newField, label: e.target.value })}
                    placeholder="Field Label"
                  />
                  <Select
                    value={newField.type}
                    onValueChange={(v) => setNewField({ 
                      ...newField, 
                      type: v as IntakeField['type'],
                      options: v === 'select' ? (newField.options || []) : undefined
                    })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FIELD_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-3">
                    <Checkbox
                      checked={newField.required}
                      onCheckedChange={(c) => setNewField({ ...newField, required: !!c })}
                      id="new-required"
                    />
                    <Label htmlFor="new-required" className="text-sm cursor-pointer">Required</Label>
                  </div>
                  <Button onClick={addIntakeField} disabled={!newField.key || !newField.label || (newField.type === 'select' && (!newField.options || newField.options.length === 0))}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add
                  </Button>
                </div>
                
                {/* Options Editor for new Select field */}
                {newField.type === 'select' && (
                  <div className="bg-background rounded-lg p-4 space-y-3 border">
                    <Label className="text-sm font-medium">Select Options {newField.options?.length === 0 && <span className="text-destructive">(add at least one)</span>}</Label>
                    
                    {/* Existing Options for new field */}
                    {newField.options && newField.options.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {newField.options.map((option) => (
                          <div key={option} className="flex items-center gap-1 px-2 py-1 rounded bg-muted text-sm">
                            <span>{option}</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setNewField({ ...newField, options: newField.options?.filter(o => o !== option) })}
                              className="h-4 w-4 p-0 hover:text-destructive"
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                    
                    {/* Add Option Input */}
                    <div className="flex gap-2">
                      <Input
                        placeholder="Enter option value and press Enter..."
                        className="text-sm"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const input = e.target as HTMLInputElement;
                            const value = input.value.trim();
                            if (value && !newField.options?.includes(value)) {
                              setNewField({ ...newField, options: [...(newField.options || []), value] });
                              input.value = '';
                            }
                          }
                        }}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          const input = (e.target as HTMLElement).parentElement?.querySelector('input');
                          if (input) {
                            const value = input.value.trim();
                            if (value && !newField.options?.includes(value)) {
                              setNewField({ ...newField, options: [...(newField.options || []), value] });
                              input.value = '';
                            }
                          }
                        }}
                      >
                        Add Option
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Allowed Email Domains (Resend Intake) */}
          <div className="pt-6 border-t mt-6">
            <Label className="text-sm font-medium block mb-2">Allowed Email Domains (Resend Intake)</Label>
            <p className="text-sm text-muted-foreground mb-3">
              Only emails from these domains will be processed. Leave empty to allow all senders.
            </p>
            <div className="space-y-2">
              {(config.intake.allowedEmailDomains || []).map((domain) => (
                <div key={domain} className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 rounded bg-muted text-sm">{domain}</code>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setConfig({
                          ...config,
                          intake: {
                            ...config.intake,
                            allowedEmailDomains: (config.intake.allowedEmailDomains || []).filter((d) => d !== domain),
                          },
                        })
                      }
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              {canEdit && (
                <div className="flex gap-2">
                  <Input
                    placeholder="e.g. company.com"
                    className="font-mono text-sm"
                    value={newAllowedDomain}
                    onChange={(e) => setNewAllowedDomain(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const value = newAllowedDomain.trim().toLowerCase();
                        if (value && !(config.intake.allowedEmailDomains || []).includes(value)) {
                          setConfig({
                            ...config,
                            intake: {
                              ...config.intake,
                              allowedEmailDomains: [...(config.intake.allowedEmailDomains || []), value],
                            },
                          });
                          setNewAllowedDomain('');
                        }
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    onClick={() => {
                      const value = newAllowedDomain.trim().toLowerCase();
                      if (value && !(config.intake.allowedEmailDomains || []).includes(value)) {
                        setConfig({
                          ...config,
                          intake: {
                            ...config.intake,
                            allowedEmailDomains: [...(config.intake.allowedEmailDomains || []), value],
                          },
                        });
                        setNewAllowedDomain('');
                      }
                    }}
                    disabled={!newAllowedDomain.trim()}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Domain
                  </Button>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Scoring Thresholds */}
      <Card>
        <CardHeader>
          <CardTitle>Scoring Thresholds</CardTitle>
          <CardDescription>Configure automatic qualification and disqualification thresholds</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="space-y-4">
              <Label className="text-sm font-medium">Auto-Qualify (GO) Threshold</Label>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Percentage</span>
                  <span className="text-green-500 font-medium">{config.scoring.autoQualifyThreshold}%</span>
                </div>
                <Input
                  type="range"
                  min="0"
                  max="100"
                  value={config.scoring.autoQualifyThreshold}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      scoring: { ...config.scoring, autoQualifyThreshold: Number(e.target.value) },
                    })
                  }
                  className="w-full"
                  disabled={!canEdit}
                />
              </div>
            </div>
            <div className="space-y-4">
              <Label className="text-sm font-medium">Auto-Disqualify (NO) Threshold</Label>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Percentage</span>
                  <span className="text-red-500 font-medium">{config.scoring.autoDisqualifyThreshold}%</span>
                </div>
                <Input
                  type="range"
                  min="0"
                  max="100"
                  value={config.scoring.autoDisqualifyThreshold}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      scoring: { ...config.scoring, autoDisqualifyThreshold: Number(e.target.value) },
                    })
                  }
                  className="w-full"
                  disabled={!canEdit}
                />
              </div>
            </div>
            <div className="space-y-4">
              <Label className="text-sm font-medium">Review Settings</Label>
              <div className="flex items-center gap-3 p-3 rounded-lg border">
                <Checkbox
                  checked={config.scoring.alwaysRequireReview}
                  onCheckedChange={(c) =>
                    setConfig({
                      ...config,
                      scoring: { ...config.scoring, alwaysRequireReview: !!c },
                    })
                  }
                  id="always-review"
                  disabled={!canEdit}
                />
                <Label htmlFor="always-review" className="text-sm cursor-pointer">
                  Force MAYBE for all bids
                </Label>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Strategic Tags (Gold Nugget Alerts) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-amber-500" />
            Strategic Tags (Gold Nugget Alerts)
          </CardTitle>
          <CardDescription>
            Bids matching these tags get highlighted in Market Grasp. E.g. hospital, rail, repeat owner, specific geos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {(config.strategicTags || []).map((tag) => (
              <div key={tag.id} className="flex items-center gap-4 p-3 rounded-lg border">
                <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-2">
                  <Input
                    placeholder="Label (e.g. Hospital)"
                    value={tag.label}
                    onChange={(e) => {
                      const tags = [...(config.strategicTags || [])];
                      const i = tags.findIndex((t) => t.id === tag.id);
                      if (i >= 0) {
                        tags[i] = { ...tags[i], label: e.target.value };
                        setConfig({ ...config, strategicTags: tags });
                      }
                    }}
                    disabled={!canEdit}
                  />
                  <Select
                    value={tag.field}
                    onValueChange={(v) => {
                      const tags = [...(config.strategicTags || [])];
                      const i = tags.findIndex((t) => t.id === tag.id);
                      if (i >= 0) {
                        tags[i] = { ...tags[i], field: v };
                        setConfig({ ...config, strategicTags: tags });
                      }
                    }}
                    disabled={!canEdit}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="scope_of_work">Scope / Sector</SelectItem>
                      <SelectItem value="owner_name">Owner</SelectItem>
                      <SelectItem value="project_location">Location</SelectItem>
                      <SelectItem value="project_value_estimate">Project Value</SelectItem>
                      <SelectItem value="project_name">Project Name</SelectItem>
                      <SelectItem value="sender_company">Sender Company</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={tag.matchType}
                    onValueChange={(v: 'contains' | 'regex' | 'value_band') => {
                      const tags = [...(config.strategicTags || [])];
                      const i = tags.findIndex((t) => t.id === tag.id);
                      if (i >= 0) {
                        tags[i] = { ...tags[i], matchType: v };
                        setConfig({ ...config, strategicTags: tags });
                      }
                    }}
                    disabled={!canEdit}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="contains">Contains</SelectItem>
                      <SelectItem value="regex">Regex</SelectItem>
                      <SelectItem value="value_band">Value Range</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder={tag.matchType === 'value_band' ? 'min:1000000,max:5000000' : 'value'}
                    value={tag.value}
                    onChange={(e) => {
                      const tags = [...(config.strategicTags || [])];
                      const i = tags.findIndex((t) => t.id === tag.id);
                      if (i >= 0) {
                        tags[i] = { ...tags[i], value: e.target.value };
                        setConfig({ ...config, strategicTags: tags });
                      }
                    }}
                    disabled={!canEdit}
                  />
                </div>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setConfig({
                        ...config,
                        strategicTags: (config.strategicTags || []).filter((t) => t.id !== tag.id),
                      })
                    }
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const tags = config.strategicTags || [];
                  setConfig({
                    ...config,
                    strategicTags: [
                      ...tags,
                      {
                        id: crypto.randomUUID(),
                        label: '',
                        matchType: 'contains' as const,
                        field: 'scope_of_work',
                        value: '',
                      },
                    ],
                  });
                }}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Strategic Tag
              </Button>
            )}
            <div className="flex items-center gap-4 pt-2">
              <Label className="text-sm">Hours saved per bid (for ROI estimate)</Label>
              <Input
                type="number"
                min={0}
                max={10}
                step={0.5}
                value={config.hoursSavedPerBid ?? 1.5}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    hoursSavedPerBid: parseFloat(e.target.value) || 1.5,
                  })
                }
                className="w-24"
                disabled={!canEdit}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Raw Config View */}
      <Card>
        <CardHeader>
          <details className="group">
            <summary className="cursor-pointer flex items-center justify-between">
              <CardTitle className="text-base">View Full Configuration (JSON)</CardTitle>
              <ChevronDown className="h-4 w-4 text-muted-foreground group-open:rotate-180 transition-transform" />
            </summary>
            <pre className="mt-4 p-4 bg-muted rounded-lg text-xs overflow-auto max-h-96 font-mono">
              {JSON.stringify(config, null, 2)}
            </pre>
          </details>
        </CardHeader>
      </Card>
    </div>
  );
}

