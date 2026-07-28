'use client';

// components/layout/HeaderSearch.tsx
//
// The site-wide search box, mounted in <SiteHeader /> so it is available from
// every page. Catalog searches update the current URL; searches elsewhere
// navigate to the marketplace results page.

import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** Static placeholder shown while the Suspense-gated search box hydrates. */
function HeaderSearchFallback({ className }: { className?: string }) {
  return (
    <div role="search" className={cn('relative w-full', className)}>
      {/* Default icon colour suits light surfaces (e.g. the menu panel); the
          `.market-search` styles in globals.css recolour it for the dark bar. */}
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/70"
        aria-hidden="true"
      />
      <Input
        type="search"
        name="q"
        placeholder="Search cards, comics, coins…"
        aria-label="Search listings"
        autoComplete="off"
        spellCheck={false}
        className="h-9 w-full pl-9"
        disabled
      />
    </div>
  );
}

/** Keeps useSearchParams behind Suspense so non-dynamic pages can prerender. */
export function HeaderSearch({ className }: { className?: string }) {
  return (
    <Suspense fallback={<HeaderSearchFallback className={className} />}>
      <HeaderSearchInner className={className} />
    </Suspense>
  );
}

function HeaderSearchInner({ className }: { className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const onCatalog = pathname === '/listings';
  const [query, setQuery] = useState(onCatalog ? searchParams.get('q') ?? '' : '');

  useEffect(() => {
    if (onCatalog) setQuery(searchParams.get('q') ?? '');
  }, [onCatalog, searchParams]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();

    if (onCatalog) {
      const params = new URLSearchParams(searchParams.toString());
      if (trimmed) {
        params.set('q', trimmed);
      } else {
        params.delete('q');
      }
      params.delete('page');
      const qs = params.toString();
      router.push(qs ? `/listings?${qs}` : '/listings');
      return;
    }

    router.push(trimmed ? `/listings?q=${encodeURIComponent(trimmed)}` : '/listings');
  }

  return (
    <form
      role="search"
      onSubmit={handleSubmit}
      className={cn('relative w-full', className)}
    >
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/70"
        aria-hidden="true"
      />
      <Input
        type="search"
        name="q"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search cards, comics, coins…"
        aria-label="Search listings"
        autoComplete="off"
        spellCheck={false}
        className="h-9 w-full pl-9"
      />
    </form>
  );
}
