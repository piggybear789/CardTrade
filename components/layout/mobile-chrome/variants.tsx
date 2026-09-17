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
        <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-iris text-meta font-semibold leading-none text-primary-foreground">
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

/** `/listings/<id>/edit`. Anchored so it cannot also match `/listings/new`. */
const EDIT_LISTING = /^\/listings\/[^/]+\/edit$/;

export function HierarchicalChrome({ pathname }: { pathname: string }) {
  if (pathname === '/listings/new') {
    return <ItemFormChrome title="New Listing" backHref="/" backLabel="Back to marketplace" />;
  }

  // EDIT GETS THE SAME TREATMENT AS CREATE. It used to fall through to the bare
  // back-chevron bar, so the only way to save was a button at the bottom of a long
  // scrolling form.
  if (EDIT_LISTING.test(pathname)) {
    return <ItemFormChrome title="Edit listing" backHref={hierarchicalBackHref(pathname)} />;
  }

  return (
    <MobileChromeFrame>
      <MobileChromeBack href={hierarchicalBackHref(pathname)} />
    </MobileChromeFrame>
  );
}

/**
 * Item-form chrome: back, title, and the form's submit on the right.
 *
 * THE ONLY SUBMIT BELOW `md`. The form's footer is `max-md:hidden`, so this is not a
 * duplicate of it — and there is no Cancel to pair with, because the back chevron on
 * the left already is the way out.
 *
 * The label comes from the form through `publishItemFormChrome` rather than being
 * derived from the route, so "Create listing" / "Save changes" is decided in one
 * place.
 */
function ItemFormChrome({
  title,
  backHref,
  backLabel,
}: {
  title: string;
  backHref: string;
  backLabel?: string;
}) {
  const chrome = useSyncExternalStore(
    subscribeItemFormChrome,
    getItemFormChrome,
    getItemFormChromeServerSnapshot,
  );

  return (
    <MobileChromeFrame>
      <MobileChromeBack href={backHref} label={backLabel} />
      <p
        aria-hidden="true"
        className="min-w-0 flex-1 truncate font-display text-body font-semibold tracking-[-0.025em]"
      >
        {title}
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
          {chrome.submitting ? 'Saving…' : chrome.label}
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

/**
 * Help, Terms and Privacy. These sit outside the workspace group, so there is no
 * bottom nav underneath them — the wordmark is the route back to the catalog for
 * BOTH viewers, which is why it renders unconditionally. Only the trailing call
 * to action is viewer-dependent.
 */
export function MarketingChrome({
  isAuthenticated,
}: {
  isAuthenticated: boolean;
}) {
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
      {isAuthenticated ? null : (
        <div className="ml-auto">
          <SignInLink className="inline-flex h-10 items-center rounded-md border border-transparent px-3 text-body font-semibold text-foreground hover:bg-foreground/5 focus:outline-none focus-visible:border-iris">
            Sign in
          </SignInLink>
        </div>
      )}
    </MobileChromeFrame>
  );
}
