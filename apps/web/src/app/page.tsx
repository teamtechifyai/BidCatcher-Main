'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/hooks/use-auth';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowRight, FileText, Users, Upload, ArrowRightLeft, Shield, Building2, Loader2, Mail } from 'lucide-react';

export default function Home() {
  const { user, isOwner, isAdmin, currentWorkspace, workspaces, isLoading, switchWorkspace } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Not logged in or auth not configured - show landing/quick access
  if (!user && !isSupabaseConfigured) {
    // Auth not configured - show quick access to all features
    return (
      <div className="max-w-5xl mx-auto space-y-8">
        <div className="text-center space-y-4 py-8">
          <h1 className="text-4xl font-bold tracking-tight">Bid Catcher Dashboard</h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Unified intake and qualification system for construction bids.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          <Card className="group hover:shadow-lg transition-shadow">
            <CardHeader className="pb-4">
              <div className="h-12 w-12 rounded-lg bg-foreground/5 flex items-center justify-center mb-4">
                <Mail className="h-6 w-6" />
              </div>
              <CardTitle className="text-xl">Incoming Bids</CardTitle>
              <CardDescription>View bids received via email.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline" className="w-full">
                <Link href="/incoming-bids">View Emails<ArrowRight className="ml-2 h-4 w-4" /></Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="group hover:shadow-lg transition-shadow">
            <CardHeader className="pb-4">
              <div className="h-12 w-12 rounded-lg bg-foreground/5 flex items-center justify-center mb-4">
                <Upload className="h-6 w-6" />
              </div>
              <CardTitle className="text-xl">Submit Bid</CardTitle>
              <CardDescription>Upload PDF documents for AI-powered extraction.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full">
                <Link href="/intake">Upload Documents<ArrowRight className="ml-2 h-4 w-4" /></Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="group hover:shadow-lg transition-shadow">
            <CardHeader className="pb-4">
              <div className="h-12 w-12 rounded-lg bg-foreground/5 flex items-center justify-center mb-4">
                <FileText className="h-6 w-6" />
              </div>
              <CardTitle className="text-xl">Bid Queue</CardTitle>
              <CardDescription>View all incoming bids and evaluations.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline" className="w-full">
                <Link href="/bids">View Queue<ArrowRight className="ml-2 h-4 w-4" /></Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="group hover:shadow-lg transition-shadow">
            <CardHeader className="pb-4">
              <div className="h-12 w-12 rounded-lg bg-foreground/5 flex items-center justify-center mb-4">
                <Users className="h-6 w-6" />
              </div>
              <CardTitle className="text-xl">Clients</CardTitle>
              <CardDescription>Manage client configurations.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline" className="w-full">
                <Link href="/clients">Manage Clients<ArrowRight className="ml-2 h-4 w-4" /></Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Not logged in but auth is configured - show login prompt
  if (!user) {
    return (
      <div className="max-w-4xl mx-auto space-y-12">
        <div className="text-center space-y-4 py-16">
          <h1 className="text-5xl font-bold tracking-tight">
            Bid Catcher
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Unified intake and qualification system for construction bids.
            Capture, evaluate, and hand off opportunities efficiently.
          </p>
          <div className="flex justify-center gap-4 pt-4">
            <Button size="lg" asChild>
              <Link href="/login">
                Sign In
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          <Card>
            <CardHeader>
              <Upload className="h-8 w-8 mb-2" />
              <CardTitle>Unified Intake</CardTitle>
              <CardDescription>
                Web forms, email forwarding, and AI-powered PDF extraction in one queue.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <FileText className="h-8 w-8 mb-2" />
              <CardTitle>Smart Qualification</CardTitle>
              <CardDescription>
                Go/No-Go scoring with AI assistance and configurable rules per client.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <ArrowRightLeft className="h-8 w-8 mb-2" />
              <CardTitle>JobTread Handoff</CardTitle>
              <CardDescription>
                Push qualified bids directly to JobTread with complete fields and docs.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>
    );
  }

  // User logged in but has no workspace access - only owners can view without workspace memberships
  if (!isOwner && workspaces.length === 0) {
    return (
      <div className="max-w-3xl mx-auto">
        <Card>
          <CardContent className="py-12 text-center">
            <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">No Workspaces Assigned</h2>
            <p className="text-muted-foreground">You don&apos;t have access to any workspaces yet.</p>
            <p className="text-sm text-muted-foreground mt-1">Contact an administrator to get access to a workspace.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Logged in - show dashboard
  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Welcome Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Welcome{user.name ? `, ${user.name.split(' ')[0]}` : ''}
          </h1>
          <p className="text-muted-foreground mt-1">
            {isOwner ? (
              currentWorkspace 
                ? `Managing ${currentWorkspace.name}`
                : `Platform Owner — ${workspaces.length} workspaces`
            ) : isAdmin ? (
              currentWorkspace 
                ? `${currentWorkspace.name} Admin Dashboard`
                : 'Select a workspace to get started'
            ) : (
              currentWorkspace 
                ? `${currentWorkspace.name} Dashboard`
                : 'Select a workspace to get started'
            )}
          </p>
        </div>
        {isOwner ? (
          <Badge variant="default" className="gap-1">
            <Shield className="h-3 w-3" />
            Owner
          </Badge>
        ) : isAdmin ? (
          <Badge variant="secondary" className="gap-1">
            <Shield className="h-3 w-3" />
            Admin
          </Badge>
        ) : null}
      </div>

      {/* Quick Actions */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <Card className="group hover:shadow-lg transition-shadow flex flex-col">
          <CardHeader className="pb-4 flex-1">
            <div className="h-12 w-12 rounded-lg bg-foreground/5 flex items-center justify-center mb-4">
              <Mail className="h-6 w-6" />
            </div>
            <CardTitle className="text-xl">Incoming Bids</CardTitle>
            <CardDescription className="text-sm leading-relaxed">
              View bid emails received via Gmail integration.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Button asChild variant="outline" className="w-full">
              <Link href="/incoming-bids">
                View Emails
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="group hover:shadow-lg transition-shadow flex flex-col">
          <CardHeader className="pb-4 flex-1">
            <div className="h-12 w-12 rounded-lg bg-foreground/5 flex items-center justify-center mb-4">
              <Upload className="h-6 w-6" />
            </div>
            <CardTitle className="text-xl">Submit Bid</CardTitle>
            <CardDescription className="text-sm leading-relaxed">
              Upload PDF documents for AI-powered field extraction and automatic bid creation.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Button asChild className="w-full">
              <Link href="/intake">
                Upload Documents
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="group hover:shadow-lg transition-shadow flex flex-col">
          <CardHeader className="pb-4 flex-1">
            <div className="h-12 w-12 rounded-lg bg-foreground/5 flex items-center justify-center mb-4">
              <FileText className="h-6 w-6" />
            </div>
            <CardTitle className="text-xl">Bid Queue</CardTitle>
            <CardDescription className="text-sm leading-relaxed">
              {currentWorkspace 
                ? `View bids for ${currentWorkspace.name}`
                : isAdmin 
                  ? 'View all bids across workspaces'
                  : 'View your assigned bids'}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Button asChild variant="outline" className="w-full">
              <Link href="/bids">
                View Queue
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        {isOwner && !currentWorkspace ? (
          <Card className="group hover:shadow-lg transition-shadow flex flex-col">
            <CardHeader className="pb-4 flex-1">
              <div className="h-12 w-12 rounded-lg bg-foreground/5 flex items-center justify-center mb-4">
                <Users className="h-6 w-6" />
              </div>
              <CardTitle className="text-xl">Clients</CardTitle>
              <CardDescription className="text-sm leading-relaxed">
                Manage client configurations, intake schemas, and scoring rules.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <Button asChild variant="outline" className="w-full">
                <Link href="/clients">
                  Manage Clients
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : isAdmin && currentWorkspace ? (
          <Card className="group hover:shadow-lg transition-shadow flex flex-col">
            <CardHeader className="pb-4 flex-1">
              <div className="h-12 w-12 rounded-lg bg-foreground/5 flex items-center justify-center mb-4">
                <Building2 className="h-6 w-6" />
              </div>
              <CardTitle className="text-xl">Configuration</CardTitle>
              <CardDescription className="text-sm leading-relaxed">
                Configure intake fields, scoring rules, and JobTread integration.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <Button asChild variant="outline" className="w-full">
                <Link href={`/workspace/${currentWorkspace.id}/config`}>
                  Configure
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="group hover:shadow-lg transition-shadow flex flex-col">
            <CardHeader className="pb-4 flex-1">
              <div className="h-12 w-12 rounded-lg bg-foreground/5 flex items-center justify-center mb-4">
                <Users className="h-6 w-6" />
              </div>
              <CardTitle className="text-xl">Clients</CardTitle>
              <CardDescription className="text-sm leading-relaxed">
                Manage client configurations and scoring rules.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <Button asChild variant="outline" className="w-full">
                <Link href="/clients">
                  Manage Clients
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Workspace List for Owners */}
      {isOwner && !currentWorkspace && workspaces.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your Workspaces</CardTitle>
            <CardDescription>Switch to a specific workspace to manage it</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {workspaces.slice(0, 8).map((workspace) => (
                <Button
                  key={workspace.id}
                  variant="outline"
                  className="h-auto py-3 px-4 justify-start gap-2 cursor-pointer"
                  onClick={() => switchWorkspace(workspace.id)}
                >
                  <Building2 className="h-4 w-4 shrink-0" />
                  <span className="text-sm font-medium truncate">{workspace.name}</span>
                </Button>
              ))}
            </div>
            {workspaces.length > 8 && (
              <Button variant="link" asChild className="mt-2 p-0">
                <Link href="/clients">View all {workspaces.length} workspaces</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* System Flow */}
      <Card className="bg-muted/30">
        <CardHeader className="text-center pb-4">
          <CardTitle className="text-base font-medium">How It Works</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center gap-3 flex-wrap py-4">
            <span className="px-4 py-2 rounded-lg bg-background border text-sm font-medium">Intake</span>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <span className="px-4 py-2 rounded-lg bg-background border text-sm font-medium">Extract</span>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <span className="px-4 py-2 rounded-lg bg-background border text-sm font-medium">Evaluate</span>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <span className="px-4 py-2 rounded-lg bg-background border text-sm font-medium">Decision</span>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <span className="px-4 py-2 rounded-lg bg-background border text-sm font-medium">JobTread</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
