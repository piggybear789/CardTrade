'use client';

import { Suspense, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import { SlidersHorizontalIcon } from '@hugeicons/core-free-icons';

import { HeaderSearch } from '@/components/layout/HeaderSearch';
import { LogoMark } from '@/components/layout/Logo';
import { SignInLink } from '@/components/layout/SignInLink';
import {
  MobileChromeBack,
  MobileChromeFrame,
  MobileChromeIconButton,
} from '@/components/layout/mobile-chrome/primitives';
import { hierarchicalBackHref } from '@/components/layout/mobile-chrome/routes';
import { ShareListingButton } from '@/components/listings/ShareListingButton';
import { ReportDialog } from '@/components/reports/ReportDialog';
import { Button } from '@/components/ui/button';
import { requestCatalogFilters } from '@/lib/catalog/browseEvents';
import {
  getListingChrome,
  getListingChromeServerSnapshot,
  subscribeListingChrome,
} from '@/lib/listings/listingChrome';
import {
  getItemFormChrome,
  getItemFormChromeServerSnapshot,
  ITEM_FORM_ID,
  subscribeItemFormChrome,
} from '@/lib/listings/itemFormChrome';

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
        <span className="absolute right-1 top-1 flex size-3.5 items-center justify-center rounded-full bg-iris text-[10px] font-semibold leading-none text-primary-foreground">
          {refineCount}
        </span>
      ) : null}
    </MobileChromeIconButton>
  );
}

/**
 * Report and Share ride in the header so the bottom bar can spend all of its
 * width on Buy and Trade. Three trailing controls plus Back leaves the pill
 * near 198px at a 360px viewport, hence the shorter prompt.
 */
export function ListingDetailChrome({
  isAuthenticated,
}: {
  isAuthenticated: boolean;
}) {
  const listing = useSyncExternalStore(
    subscribeListingChrome,
    getListingChrome,
    getListingChromeServerSnapshot,
  );
  const reportTargetId =
    isAuthenticated && listing?.canReport ? listing.itemId : null;

  return (
    <MobileChromeFrame>
      <MobileChromeBack
        href="/"
        label="Back to marketplace"
        className="size-10 [&_svg]:size-5"
      />
      <HeaderSearch
        className="min-w-0 flex-1"
        ariaLabel="Search listings"
        placeholder="Search cards"
        appearance="pill"
      />
      {reportTargetId ? (
        <ReportDialog
          targetType="item"
          targetId={reportTargetId}
          triggerLabel="Report listing"
          appearance="icon-only"
          triggerClassName="size-10 rounded-full text-foreground hover:bg-foreground/5 md:size-10 [&_svg]:size-4"
        />
      ) : null}
      <ShareListingButton className="size-10 [&_svg]:size-4" />
    </MobileChromeFrame>
  );
}

export function HierarchicalChrome({ pathname }: { pathname: string }) {
  if (pathname === '/listings/new') {
    return <NewListingChrome />;
  }

  return (
    <MobileChromeFrame>
      <MobileChromeBack href={hierarchicalBackHref(pathname)} />
    </MobileChromeFrame>
  );
}

/**
 * Compose chrome: title in the bar, Sell on the right. Cancel stays in the
 * form — a header dismiss next to the primary action is the wrong pair.
 */
function NewListingChrome() {
  const chrome = useSyncExternalStore(
    subscribeItemFormChrome,
    getItemFormChrome,
    getItemFormChromeServerSnapshot,
  );

  return (
    <MobileChromeFrame>
      <MobileChromeBack href="/" label="Back to marketplace" />
      <p
        aria-hidden="true"
        className="min-w-0 flex-1 truncate font-display text-body font-semibold tracking-[-0.025em]"
      >
        New Listing
      </p>
      {chrome ? (
        <Button
          type="submit"
          form={ITEM_FORM_ID}
          size="sm"
          disabled={chrome.submitting}
          aria-busy={chrome.submitting}
          className="shrink-0"
        >
          {chrome.submitting ? 'Saving…' : 'Sell'}
        </Button>
      ) : null}
    </MobileChromeFrame>
  );
}

export function HubChrome() {
  return <MobileChromeFrame compact />;
}

export function AuthChrome() {
  return (
    <MobileChromeFrame>
      <Link
        href="/"
        aria-label="NoDitto home"
        className="inline-flex min-h-10 items-center gap-2 rounded-md border border-transparent px-1 focus:outline-none focus-visible:border-iris"
      >
        <LogoMark className="size-7" />
        <span
          className="font-display text-body font-semibold tracking-[-0.025em]"
          translate="no"
        >
          NoDitto
        </span>
      </Link>
    </MobileChromeFrame>
  );
}

export function MarketingChrome() {
  return (
    <MobileChromeFrame>
      <Link
        href="/"
        aria-label="NoDitto home"
        className="inline-flex min-h-10 min-w-0 items-center gap-2 rounded-md border border-transparent px-1 focus:outline-none focus-visible:border-iris"
      >
        <LogoMark className="size-7" />
        <span
          className="font-display text-body font-semibold tracking-[-0.025em]"
          translate="no"
        >
          NoDitto
        </span>
      </Link>
      <div className="ml-auto">
        <SignInLink className="inline-flex h-10 items-center rounded-md border border-transparent px-3 text-body font-semibold text-foreground hover:bg-foreground/5 focus:outline-none focus-visible:border-iris">
          Sign in
        </SignInLink>
      </div>
    </MobileChromeFrame>
  );
}
