// app/(workspace)/loading.tsx
//
// THE FALLBACK FOR A ROUTE WHOSE OWN SKELETON HAS NOT ARRIVED YET.
//
// Every workspace route ships a `loading.tsx` that mirrors its page. But a
// segment's loading boundary is part of that segment's payload: on the first
// navigation to a route the client does not have it yet, and Next renders the
// nearest boundary ABOVE the segment instead. With no file here, that was the
// homepage's catalog skeleton (which used to live at this path), so every tab
// in the mobile hub flashed twelve listing tiles before its real placeholder.
// In production `Link` prefetch usually hides this; in development, and for
// any route the hub did not manage to prefetch, it did not.
//
// So this draws the one thing every workspace route shares — the shell — and
// a deliberately generic content column: a title bar and a few rows. It claims
// nothing about the page's shape, because it cannot know it. The route's own
// `loading.tsx` takes over the moment its payload lands, and the page after that.

import { Skeleton, TextLines } from '@/components/ui/skeleton';
import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';

export default function WorkspaceLoading() {
  return (
    <MarketplaceShellSkeleton>
      <div className="mx-auto w-full max-w-2xl">
        <TextLines className="text-subhead md:text-head" widths={['w-40']} />
        <div className="mt-group space-y-cozy">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      </div>
    </MarketplaceShellSkeleton>
  );
}
