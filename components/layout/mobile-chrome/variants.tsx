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
import { ListingOverflowMenu } from '@/components/listings/ListingOverflowMenu';
import { WatchButton } from '@/components/listings/WatchButton';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
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
 * Save and a "⋯" (Share, Report) ride in the header so the bottom bar can spend
 * all of its width on labelled Offer, Trade and Buy. Two trailing controls plus
 * Back keeps the search pill usable at a 360px viewport.
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
      {listing ? (
        <>
          {isAuthenticated && listing.canSave ? (
            <WatchButton
              // Keyed on the item so a client navigation to another listing does
              // not carry the previous listing's heart state.
              key={listing.itemId}
              itemId={listing.itemId}
              initialWatching={listing.initialWatching}
              variant="icon"
              className="size-10 rounded-full text-foreground hover:bg-foreground/5 md:size-10"
              glyphClassName="size-5"
            />
          ) : null}
          <ListingOverflowMenu
            itemId={listing.itemId}
            canReport={isAuthenticated && listing.canReport}
            triggerClassName="size-10 rounded-full text-foreground hover:bg-foreground/5 md:size-10"
          />
        </>
      ) : (
        // RESERVE THE SLOTS until the page publishes. The server snapshot is null,
        // so without this the controls arrived after hydration and squeezed the
        // search pill sideways. Most signed-in viewers are not the owner, so holding
        // the heart's slot is the likelier outcome; an owner sees it collapse once.
        <>
          {isAuthenticated ? <span aria-hidden className="size-10 shrink-0" /> : null}
          <span aria-hidden className="size-10 shrink-0" />
        </>
      )}
    </MobileChromeFrame>
  );
}

/** `/listings/<id>/edit`. Anchored so it cannot also match `/listings/new`. */
const EDIT_LISTING = /^\/listings\/[^/]+\/edit$/;

export function HierarchicalChrome({ pathname }: { pathname: string }) {
  if (pathname === '/listings/new') {
    return <ItemFormChrome title="New listing" backHref="/" backLabel="Back to marketplace" />;
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
          {/* BOTH LABELS OCCUPY ONE GRID CELL, so the button is as wide as the
              longer of the two whichever is showing. "Saving…" is narrower than
              "Create listing", and the right-aligned button used to shrink on tap,
              sliding its own left edge and re-truncating the title beside it at
              the moment the member was watching it. */}
          <span className="grid">
            <span
              className={cn('col-start-1 row-start-1', chrome.submitting && 'invisible')}
              aria-hidden={chrome.submitting || undefined}
            >
              {chrome.label}
            </span>
            <span
              className={cn('col-start-1 row-start-1', !chrome.submitting && 'invisible')}
              aria-hidden={!chrome.submitting || undefined}
            >
              Saving…
            </span>
          </span>
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
          className="font-wordmark text-body font-bold"
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
          className="font-wordmark text-body font-bold"
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
