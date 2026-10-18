// app/not-found.tsx
//
// Branded 404. Rendered by Next.js for unmatched routes and any notFound()
// call. Kept as a Server Component so it stays cheap and works without JS.
//
// ONE WAY BACK. The marketplace is the home page, so a second "Back to home"
// button led to the same place as the first.

import Link from 'next/link';

import { Button } from '@/components/ui/button';

export const metadata = {
  title: 'Page not found · NoDitto',
};

export default function NotFound() {
  // `py-12` on a phone, `py-20` from `sm`. This page has no bottom nav under it,
  // and 80px of padding either side of a `text-display` heading pushed the button
  // under the fold on a 375x667 screen — the one thing the page exists to offer.
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-group py-12 text-center sm:px-6 sm:py-20">
      <p className="text-body font-medium text-muted-foreground">Error 404</p>
      <h1 className="mt-group text-balance font-display text-display font-semibold tracking-tight">
        We couldn&apos;t find that page
      </h1>
      <p className="mt-cozy text-pretty text-body text-muted-foreground">
        The link may be broken, or the listing or contract may have been removed.
        Everything on NoDitto stays one click from the marketplace.
      </p>
      <Button asChild size="lg" className="mt-section">
        <Link href="/">Browse the marketplace</Link>
      </Button>
    </main>
  );
}
