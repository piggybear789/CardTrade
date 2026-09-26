'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';

import { HeaderSearch } from '@/components/layout/HeaderSearch';
import { LogoMark } from '@/components/layout/Logo';
import { SignInLink } from '@/components/layout/SignInLink';
import {
  MobileChromeBack,
  MobileChromeFrame,
} from '@/components/layout/mobile-chrome/primitives';
import { hierarchicalBackHref } from '@/components/layout/mobile-chrome/routes';
import { ShareListingButton } from '@/components/listings/ShareListingButton';
import { ReportDialog } from '@/components/reports/ReportDialog';
import { Button } from '@/components/ui/button';
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
        className="min-w-0 flex-1 truncate font-display text-body font-semibold tracking-tight"
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
        className="inline-flex min-h-10 items-center gap-snug rounded-md border border-transparent px-tight focus:outline-none focus-visible:border-iris"
      >
        <LogoMark className="size-7" />
        <span
          className="font-display text-body font-semibold tracking-tight"
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
        className="inline-flex min-h-10 min-w-0 items-center gap-snug rounded-md border border-transparent px-tight focus:outline-none focus-visible:border-iris"
      >
        <LogoMark className="size-7" />
        <span
          className="font-display text-body font-semibold tracking-tight"
          translate="no"
        >
          NoDitto
        </span>
      </Link>
      {isAuthenticated ? null : (
        <div className="ml-auto">
          <SignInLink className="inline-flex h-10 items-center rounded-md border border-transparent px-cozy text-body font-semibold text-foreground hover:bg-foreground/5 focus:outline-none focus-visible:border-iris">
            Sign in
          </SignInLink>
        </div>
      )}
    </MobileChromeFrame>
  );
}
