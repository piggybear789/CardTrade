// app/account-suspended/page.tsx
//
// Public destination for an existing session whose CardTrade profile has been
// permanently banned after a staff-confirmed Objective_Fraud finding. Middleware
// redirects here before any protected app route can render.

import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';

export default function AccountSuspendedPage() {
  return (
    <main className="flex min-h-[80vh] items-center justify-center px-4 py-12">
      <section className="w-full max-w-md rounded-xl border bg-card p-6 text-center shadow-sm">
        <span className="mx-auto grid size-11 place-items-center rounded-full border border-destructive/30 bg-destructive/10 text-destructive">
          <ShieldAlert className="size-5" aria-hidden />
        </span>
        <h1 className="mt-4 text-xl font-semibold">Account permanently suspended</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          This account was permanently suspended after a staff-confirmed objective
          fraud finding. It cannot buy, sell, trade, or use member features.
        </p>
        <Button asChild variant="outline" className="mt-6">
          <Link href="/">Return to home</Link>
        </Button>
      </section>
    </main>
  );
}
