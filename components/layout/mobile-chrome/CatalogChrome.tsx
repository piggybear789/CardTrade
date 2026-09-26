'use client';

// Catalog phone chrome, kept in its own module so `/` does not download the
// listing, form, and report chrome that live beside it.

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import { SlidersHorizontalIcon } from '@hugeicons/core-free-icons';

import { HeaderSearch } from '@/components/layout/HeaderSearch';
import { LogoMark } from '@/components/layout/Logo';
import {
  MobileChromeFrame,
  MobileChromeIconButton,
} from '@/components/layout/mobile-chrome/primitives';
import { requestCatalogFilters } from '@/lib/catalog/browseEvents';

export function CatalogChrome({ isAuthenticated }: { isAuthenticated: boolean }) {
  return (
    <MobileChromeFrame>
      {/* Brand mark, not a link: the catalog IS `/`, so a "home" link here would
          point at the page it sits on. Guests still get the mark for orientation;
          members have the bottom nav and do not need the width spent. */}
      {isAuthenticated ? null : (
        <span className="inline-flex size-10 shrink-0 items-center justify-center">
          <LogoMark className="size-6" />
          <span className="sr-only" translate="no">
            NoDitto
          </span>
        </span>
      )}
      <HeaderSearch
        className="min-w-0 flex-1"
        ariaLabel="Search marketplace"
        appearance="pill"
      />
      <Suspense fallback={<FiltersButton refineCount={0} />}>
        <CatalogFiltersTrigger />
      </Suspense>
    </MobileChromeFrame>
  );
}

function CatalogFiltersTrigger() {
  const searchParams = useSearchParams();
  const conditions = searchParams
    .getAll('condition')
    .flatMap((value) => value.split(','))
    .filter(Boolean);
  const refineCount =
    conditions.length +
    Number(Boolean(searchParams.get('min') || searchParams.get('max'))) +
    Number(searchParams.get('sold') === '1');

  return <FiltersButton refineCount={refineCount} />;
}

function FiltersButton({ refineCount }: { refineCount: number }) {
  return (
    <MobileChromeIconButton
      onClick={() => requestCatalogFilters(true)}
      aria-haspopup="dialog"
      aria-label={refineCount > 0 ? `Filters, ${refineCount} active` : 'Filters'}
      className="size-10"
    >
      <HugeiconsIcon icon={SlidersHorizontalIcon} className="size-4" strokeWidth={1.75} aria-hidden />
      {refineCount > 0 ? (
        <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-iris text-meta font-semibold leading-none text-primary-foreground">
          {refineCount}
        </span>
      ) : null}
    </MobileChromeIconButton>
  );
}
