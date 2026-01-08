import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { Providers } from './providers';
import { MainNav } from '@/components/main-nav';
import { UserNav } from '@/components/user-nav';
import { WorkspaceSwitcher } from '@/components/workspace-switcher';

export const metadata: Metadata = {
  title: 'Bid Catcher',
  description: 'Bid intake and qualification platform',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background antialiased">
        <Providers>
          <div className="relative flex min-h-screen flex-col">
            <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
              <div className="container mx-auto flex h-16 items-center justify-between px-4 md:px-8">
                <div className="flex items-center gap-6 md:gap-8">
                  <Link href="/" className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-md bg-foreground flex items-center justify-center">
                      <span className="text-background font-bold text-sm">BC</span>
                    </div>
                    <span className="font-semibold text-lg hidden sm:inline-block">Bid Catcher</span>
                  </Link>
                  <MainNav />
                </div>
                <div className="flex items-center gap-4">
                  <WorkspaceSwitcher />
                  <UserNav />
                </div>
              </div>
            </header>
            <main className="flex-1 container mx-auto px-4 md:px-8 py-8">
              {children}
            </main>
            <footer className="border-t">
              <div className="container mx-auto px-4 md:px-8 py-6 text-center text-sm text-muted-foreground">
                Bid Catcher &copy; {new Date().getFullYear()}
              </div>
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
