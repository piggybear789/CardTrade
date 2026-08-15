// app/not-found.tsx
//
// Branded 404. Rendered by Next.js for unmatched routes and any notFound()
// call. Kept as a Server Component so it stays cheap and works without JS.

import Link from 'next/link';
import { Compass, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';

export const metadata = {
  title: 'Page not found · NoDitto',
};

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-4 py-20 text-center sm:px-6">
      <div className="flex size-14 items-center justify-center rounded-full border bg-muted/40 text-muted-foreground">
        <Compass className="size-6" aria-hidden="true" />
      </div>
      <p className="cardtrade-eyebrow mt-6">Error 404</p>
      <h1 className="mt-4 text-balance font-display text-4xl font-semibold leading-[1.08] tracking-[-0.025em] sm:text-5xl">
        We couldn&apos;t find that page
      </h1>
      <p className="mt-3 text-pretty leading-7 text-muted-foreground">
        The link may be broken, or the listing or deal may have been removed.
        Everything on NoDitto stays one click from the marketplace.
      </p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Button asChild size="lg">
          <Link href="/listings">Browse the marketplace</Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/">Back to home</Link>
        </Button>
      </div>
      <p className="mt-10 inline-flex items-center gap-2 text-meta text-muted-foreground">
        <ShieldCheck className="size-4 text-trust" aria-hidden="true" />
        Every trade on NoDitto shows collateral terms and DittoShield identity status.
      </p>
    </main>
  );
}
