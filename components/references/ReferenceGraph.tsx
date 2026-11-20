'use client';

// components/references/ReferenceGraph.tsx
//
// The Trust Network (0155): everyone who has vouched for a person, drawn as a
// small solar system (`domain/references/orbits.ts`). Selecting someone opens a
// card over the drawing with who they know; double-clicking (or double-tapping)
// goes to their page, the graph walking there as it loads. A segmented control in
// the header switches between references left FOR the person and ones they LEFT.
//
// `ReferenceGraph` is the network as a section of another page (a storefront),
// with the experiences listed as text under it; `ReferenceProfile` is a person's
// references page, built from the same body with a modal trigger to leave a reference.

import { memo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  AlertCircleIcon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
  ShieldCheckIcon,
} from '@hugeicons/core-free-icons';

import { SocialPlatformIcon } from '@/components/profile/SocialPlatformIcon';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Switch } from '@/components/ui/switch';
import {
  PlatformChip,
  SentimentBadge,
  authorStanding,
  platformTint,
  plural,
  referenceProofLabel,
} from '@/components/references/referenceLabels';
import { ReferenceOwnerActions } from '@/components/references/ReferenceOwnerActions';
import { ReferenceStaffRemove } from '@/components/references/ReferenceStaffRemove';
import { REFERENCE_LIST_HEADING_ID } from '@/components/references/referenceListFocus';
import { TrustNetworkPanel } from '@/components/references/TrustNetworkPanel';
import { TrustOrbitsCanvas } from '@/components/references/TrustOrbitsCanvas';
import {
  nodeKey,
  useTrustOrbits,
  viewOf,
  viewTotal,
  type ReferenceDirection,
  type ReferenceView,
  type TrustOrbits,
} from '@/components/references/useTrustOrbits';
import { referenceHref, type ReferenceAddress } from '@/domain/references/address';
import { sentimentLabel, type ReferenceSentiment } from '@/domain/references/reference';
import type {
  ReferenceGraphCentre,
  ReferenceGraphData,
  ReferenceGraphNode,
} from '@/lib/references/graph';
import { cn } from '@/lib/utils';

/**
 * An imported comment's source is its comment permalink, `/p/{code}/c/{id}/`. Desktop
 * Instagram opens the post with that comment shown. The Instagram app, and its mobile
 * site, do not route `/c/` and land on the home feed, so a touch device gets the post
 * itself, `/p/{code}/`. Picked by pointer in CSS, not by user agent in JS, so server
 * and client render the same thing. Any other URL (a post, a profile) is used as is.
 */
function instagramPostUrl(url: string): string {
  return url.replace(/^(https:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\/[A-Za-z0-9_-]+\/)c\/[^/]+\/?$/i, '$1');
}

function cleanExternalItemTitle(title: string): string {
  return title.replace(/\s*\(#\s*\d+\s*\)\s*$/i, '').trim();
}

function SourceLink({ url, label = 'View original post' }: { url: string; label?: string }) {
  const postUrl = instagramPostUrl(url);
  const className = 'text-muted-foreground underline underline-offset-2 hover:text-foreground';
  const link = (href: string, extra?: string) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => event.stopPropagation()}
      className={cn(className, extra)}
    >
      {label}
    </a>
  );
  if (postUrl === url) return link(url);
  return (
    <>
      {link(url, '[@media(pointer:coarse)]:hidden')}
      {link(postUrl, 'hidden [@media(pointer:coarse)]:inline')}
    </>
  );
}

/** Goes to someone's references page. `keepScroll` holds the page where it is, for a page laid out the same. */
export function usePageOpener(keepScroll: boolean): (address: ReferenceAddress) => void {
  const router = useRouter();
  return (address) => router.push(referenceHref(address), { scroll: !keepScroll });
}

/**
 * How settled text about the person in the middle is: it fades up from faint as
 * the graph walks to someone new, so the change of name reads as part of the move.
 */
export function arrival(orbits: TrustOrbits): number {
  return orbits.transition ? Math.min(1, 0.3 + orbits.progress * 1.4) : 1;
}

const STAT_FILTER_BASE =
  'inline-flex cursor-pointer items-center gap-1 rounded-full px-2.5 py-0.5 text-meta font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-default';

function NetworkStats({
  stats,
  sentimentFilter,
  filterBySentiment,
}: {
  stats: ReferenceView['stats'];
  sentimentFilter: ReferenceSentiment | null;
  filterBySentiment: (sentiment: ReferenceSentiment | null) => void;
}) {
  const { positive, neutral: neutralCount, negative } = stats;
  const positiveActive = sentimentFilter === 'POSITIVE';
  const neutralActive = sentimentFilter === 'NEUTRAL';
  const negativeActive = sentimentFilter === 'NEGATIVE';
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter references by outcome">
      <button
        type="button"
        disabled={positive === 0}
        aria-pressed={positiveActive}
        title={plural(positive, 'positive reference', 'positive references')}
        aria-label={plural(positive, 'positive reference', 'positive references')}
        onClick={() => filterBySentiment('POSITIVE')}
        className={cn(
          STAT_FILTER_BASE,
          positiveActive
            ? 'bg-trust text-white'
            : 'bg-trust/10 text-trust hover:bg-trust/18 disabled:hover:bg-trust/10',
        )}
      >
        <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-3.5" aria-hidden />
        <span>{positive} positive</span>
      </button>
      {neutralCount > 0 ? (
        <button
          type="button"
          aria-pressed={neutralActive}
          title={plural(neutralCount, 'neutral reference', 'neutral references')}
          aria-label={plural(neutralCount, 'neutral reference', 'neutral references')}
          onClick={() => filterBySentiment('NEUTRAL')}
          // NO BORDER, matching the positive and negative pills. `border-action-border/40`
          // is not a class here (the token is `action-edge`), so it drew a grey hairline.
          className={cn(
            STAT_FILTER_BASE,
            neutralActive
              ? 'bg-action text-action-foreground ring-1 ring-action-edge'
              : 'bg-action/35 text-action-foreground hover:bg-action/55',
          )}
        >
          <span>{neutralCount} neutral</span>
        </button>
      ) : null}
      {negative > 0 ? (
        <button
          type="button"
          aria-pressed={negativeActive}
          title={plural(negative, 'negative reference', 'negative references')}
          aria-label={plural(negative, 'negative reference', 'negative references')}
          onClick={() => filterBySentiment('NEGATIVE')}
          className={cn(
            STAT_FILTER_BASE,
            negativeActive
              ? 'bg-destructive text-destructive-foreground'
              : 'bg-destructive/10 text-destructive hover:bg-destructive/18',
          )}
        >
          <HugeiconsIcon icon={AlertCircleIcon} className="size-3.5" aria-hidden />
          <span>{negative} negative</span>
        </button>
      ) : null}
    </div>
  );
}

/**
 * One filter pill. PHONE: 36px tall in a single row that swipes sideways (the Depop
 * filter row), instead of 28px pills wrapping onto three rows above the drawing.
 * From `sm` the compact wrapping pills come back.
 */
const FILTER_PILL =
  'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-cozy text-meta font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-7 sm:px-2.5';

interface NetworkToolbarProps {
  platforms: ReferenceView['platforms'];
  /** Every reference in the current direction, the "All" count. */
  total: number;
  platformFilter: string | null;
  filterByPlatform: (slug: string | null) => void;
  opacity: number;
  tilted: boolean;
  autoSpin: boolean;
  toggleSpin: () => void;
  resetView: () => void;
}

/**
 * MEMOISED, like the header and the cards: the drawing re-renders on every spin, drag and
 * walk frame, and nothing here changes with it. The props are the values this reads, never
 * the whole `orbits`, which is a new object every frame.
 */
const NetworkToolbar = memo(function NetworkToolbar({
  platforms,
  total,
  platformFilter,
  filterByPlatform,
  opacity,
  tilted,
  autoSpin,
  toggleSpin,
  resetView,
}: NetworkToolbarProps) {
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border/70 bg-muted/25 px-group py-2 sm:px-6">
      <div
        className="-mx-group flex w-[calc(100%+2rem)] items-center gap-1.5 overflow-x-auto px-group [scrollbar-width:none] sm:mx-0 sm:w-auto sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden"
        role="group"
        aria-label="Filter references by platform"
        style={{ opacity }}
      >
        <button
          type="button"
          aria-pressed={platformFilter === null}
          onClick={() => filterByPlatform(null)}
          className={cn(
            FILTER_PILL,
            platformFilter === null
              ? 'border-foreground bg-foreground text-background'
              : 'border-border/80 bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground',
          )}
        >
          <span>All</span>
          <span className="tabular-nums opacity-75">{total}</span>
        </button>

        {platforms.map((p) => {
          const active = platformFilter === p.slug;
          return (
            <button
              key={p.slug}
              type="button"
              aria-pressed={active}
              onClick={() => filterByPlatform(p.slug)}
              className={cn(
                FILTER_PILL,
                active
                  ? 'border-iris bg-iris/12 text-foreground ring-1 ring-iris/35'
                  : 'border-border/80 bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground',
              )}
            >
              <SocialPlatformIcon
                slug={p.slug}
                className={cn(
                  p.slug === 'ebay' || p.slug === 'noditto' || p.slug === 'whatnot'
                    ? 'size-3.5'
                    : 'size-3',
                  platformTint(p.slug),
                )}
              />
              <span>{p.label}</span>
              <span className="tabular-nums text-muted-foreground">{p.count}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-4">
        {/* Pointer only. Hidden on phones: a vertical drag there scrolls the page, so
            tilt (and so "Reset view") cannot be reached. Rendered only once the system is
            tilted, so the bar keeps its height either way (`min-h-11`). */}
        {tilted ? (
          <Button variant="ghost" size="xs" onClick={resetView} className="hidden sm:inline-flex">
            Reset view
          </Button>
        ) : null}
        {/* AT EVERY WIDTH. The drawing moves on its own, so a reader must be able to stop
            it everywhere it moves (WCAG 2.2.2), phones included. */}
        <label className="flex cursor-pointer items-center gap-2 text-meta font-medium text-muted-foreground">
          <Switch checked={autoSpin} onCheckedChange={toggleSpin} />
          Spin
        </label>
      </div>
    </div>
  );
});

/**
 * Every reference as a readable card, under the drawing at every width: the review list
 * Fiverr, eBay and Depop use, and the one place a review is always shown in full. On
 * the storefront and on the reference profile alike.
 */
function filteredReferenceTotal(
  view: ReferenceView,
  visibleCount: number,
  sentimentFilter: ReferenceSentiment | null,
  platformFilter: string | null,
): number {
  if (sentimentFilter && platformFilter) return visibleCount;
  if (sentimentFilter === 'POSITIVE') return view.stats.positive;
  if (sentimentFilter === 'NEUTRAL') return view.stats.neutral;
  if (sentimentFilter === 'NEGATIVE') return view.stats.negative;
  if (platformFilter) {
    return view.platforms.find((p) => p.slug === platformFilter)?.count ?? visibleCount;
  }
  return viewTotal(view);
}

export function ExperienceList({
  orbits,
  selectable = true,
  viewerId = null,
  canModerate = false,
}: {
  orbits: TrustOrbits;
  /**
   * Whether a card selects its person in the drawing. Off where the list sits below a
   * drawing scrolled out of view (the phone profile): the card already says everything
   * the panel would, and a panel opening off-screen reads as a tap that did nothing.
   */
  selectable?: boolean;
  /** The signed-in member, who can edit or withdraw the references they wrote. */
  viewerId?: string | null;
  /** An admin, who can take a reference down. The server checks again. */
  canModerate?: boolean;
}) {
  const nodes = orbits.visibleNodes;
  return (
    <ExperienceCards
      // A different person, direction, or active filter is a different list: back to page one.
      key={`${orbits.centreKey}:${orbits.view.direction}:${orbits.sentimentFilter ?? 'all'}:${orbits.platformFilter ?? 'all'}`}
      direction={orbits.view.direction}
      nodes={nodes}
      referenceTotal={filteredReferenceTotal(
        orbits.view,
        nodes.length,
        orbits.sentimentFilter,
        orbits.platformFilter,
      )}
      sentimentFilter={orbits.sentimentFilter}
      platformFilter={orbits.platformFilter}
      clearFilters={orbits.clearFilters}
      centre={orbits.graph.centre}
      selectedKey={orbits.selectedKey}
      select={orbits.select}
      opacity={arrival(orbits)}
      selectable={selectable}
      viewerId={viewerId}
      canModerate={canModerate}
    />
  );
}

/**
 * The pager's buttons rest on the hairline every card here is drawn with. The outline
 * variant's own edge is the darker field edge, and two of them under a list of
 * hairline cards were the heaviest lines in it.
 */
const QUIET_EDGE = 'border-border disabled:border-border';

/** References to a page. */
const REFERENCES_PER_PAGE = 6;

const ExperienceCards = memo(function ExperienceCards({
  direction,
  nodes,
  referenceTotal,
  sentimentFilter,
  platformFilter,
  clearFilters,
  centre,
  selectedKey,
  select,
  opacity,
  selectable,
  viewerId,
  canModerate,
}: {
  direction: ReferenceDirection;
  nodes: readonly ReferenceGraphNode[];
  /** Every reference counted in this direction/filter, which can be more than there are cards. */
  referenceTotal: number;
  sentimentFilter: ReferenceSentiment | null;
  platformFilter: string | null;
  clearFilters: () => void;
  centre: ReferenceGraphCentre;
  selectedKey: string | null;
  select: (key: string | null) => void;
  opacity: number;
  selectable: boolean;
  viewerId: string | null;
  canModerate: boolean;
}) {
  const given = direction === 'given';
  // Given: every card is the person in the middle's own words. Received: each card's
  // author is the person on it.
  const authorOf = (node: ReferenceGraphNode) => (given ? centre.profileId : node.profileId);

  // A PAGE AT A TIME. With another site's feedback drawn in (eBay, 0170) a list runs to
  // dozens of cards, and the page under it to several screens. The heading keeps the
  // whole count; the cards are one page of it. The page is kept for as long as
  // the list is the same person's, in the same direction (`ExperienceList` keys on
  // both), and clamped, since a reference can be withdrawn from the last page.
  const [page, setPage] = useState(0);
  const total = nodes.length;
  const pageCount = Math.max(1, Math.ceil(total / REFERENCES_PER_PAGE));
  const current = Math.min(page, pageCount - 1);
  const first = current * REFERENCES_PER_PAGE;
  const shown = nodes.slice(first, first + REFERENCES_PER_PAGE);
  const filtered = sentimentFilter !== null || platformFilter !== null;

  // Someone picked in the drawing has a card here that lights up. Turn to its page, or
  // the selection would point at a card that is not on screen.
  const [followedKey, setFollowedKey] = useState(selectedKey);
  if (followedKey !== selectedKey) {
    setFollowedKey(selectedKey);
    const index = selectable && selectedKey ? nodes.findIndex((node) => nodeKey(node) === selectedKey) : -1;
    if (index >= 0) setPage(Math.floor(index / REFERENCES_PER_PAGE));
  }

  const headingRef = useRef<HTMLHeadingElement>(null);
  const turnTo = (next: number) => {
    setPage(next);
    // To the top of the new page: the pager sits under the cards, so a reader who
    // pressed it is at the bottom of a list that has just been replaced (on a phone,
    // six cards down). Focus goes with it, which also keeps it off a pager button that
    // has just been disabled by reaching the first or last page.
    headingRef.current?.focus();
  };

  return (
    <div className="border-t border-border/70 bg-card px-group py-group sm:px-6" style={{ opacity }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4
          ref={headingRef}
          id={REFERENCE_LIST_HEADING_ID}
          tabIndex={-1}
          // Sentence case with a muted count, like every other heading inside a card on
          // this page ("Open web & community (7)"). When more references are counted than
          // there are cards to read (eBay gives a tally, and comments for the latest),
          // the count says so, so it agrees with the tally in the header.
          className="scroll-mt-24 text-body font-semibold text-foreground focus:outline-none"
        >
          {given ? 'References given' : 'References received'}
          <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">
            ({total < referenceTotal ? `${total} of ${referenceTotal}` : total})
          </span>
        </h4>
        {filtered ? (
          <button
            type="button"
            onClick={clearFilters}
            className="text-meta font-medium text-iris-ink underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {sentimentFilter ? `${sentimentLabel(sentimentFilter)} · Show all` : 'Show all'}
          </button>
        ) : null}
      </div>
      {shown.length === 0 ? (
        <p className="py-group text-body text-muted-foreground">
          No matching references.{' '}
          <button
            type="button"
            onClick={clearFilters}
            className="font-medium text-iris-ink underline-offset-4 hover:underline"
          >
            Show all
          </button>
        </p>
      ) : null}
      {/* ROWS, NOT BOXES. One column split by hairlines, the review list Base44 and Meetup
          use: a grid of bordered cards inside a bordered card put eight boxes on screen
          to hold six sentences. Each row bleeds a little past the text edge so a
          selected or hovered row has a fill to sit in. */}
      <ul className="divide-y divide-border">
        {shown.map((node) => {
          const key = nodeKey(node);
          const isSelected = key === selectedKey;
          const negative = node.sentiment === 'NEGATIVE';
          const mine = viewerId !== null && node.referenceId !== null && authorOf(node) === viewerId;
          const meta = [
            referenceProofLabel(node),
            node.imported ? 'Imported from Instagram' : null,
            node.dateLabel,
            node.edited ? 'Edited' : null,
          ]
            .filter(Boolean)
            .join(' · ');
          const footerSummary = [
            negative ? (node.categoryLabel ?? 'Issue') : node.external ? null : plural(node.deals, 'deal', 'deals'),
            meta,
          ]
            .filter(Boolean)
            .join(' · ');
          const itemTitle = node.external?.itemTitle ? cleanExternalItemTitle(node.external.itemTitle) : '';
          const itemPrice = node.external?.priceText ?? '';
          const hasSourceLink = Boolean(node.sourceUrl && (node.imported || node.external));
          return (
            <li key={node.id}>
              <div
                {...(selectable
                  ? {
                      role: 'button',
                      tabIndex: 0,
                      'aria-pressed': isSelected,
                      onClick: () => select(key),
                      onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          select(key);
                        }
                      },
                    }
                  : {})}
                className={cn(
                  '-mx-snug rounded-md px-snug py-5 transition-colors',
                  selectable
                    ? cn(
                        'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        isSelected ? 'bg-muted/60' : 'hover:bg-muted/30',
                      )
                    : null,
                )}
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Avatar avatarPath={node.avatarPath} displayName={node.name} size="sm" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1">
                          {node.address ? (
                            <Link
                              href={referenceHref(node.address)}
                              onClick={(event) => event.stopPropagation()}
                              className="break-all text-body font-semibold text-foreground hover:underline"
                            >
                              {node.handle}
                            </Link>
                          ) : (
                            // An eBay feedback author has no page here to open.
                            <span className="break-all text-body font-semibold text-foreground">{node.handle}</span>
                          )}
                          {node.identityVerified ? (
                            <HugeiconsIcon icon={ShieldCheckIcon} className="size-3.5 shrink-0 text-trust" aria-hidden />
                          ) : null}
                        </div>
                        <p className="text-meta tabular-nums text-muted-foreground">
                          {authorStanding(node)} · {node.roleLabel}
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                      {node.platforms.map((slug) => (
                        <PlatformChip key={slug} slug={slug} />
                      ))}
                      <SentimentBadge sentiment={node.sentiment} />
                    </div>
                  </div>

                  {node.comment ? (
                    <p className="mt-cozy max-w-[68ch] text-body leading-relaxed text-foreground sm:pl-10">
                      {node.comment}
                    </p>
                  ) : null}
                  {itemTitle || itemPrice ? (
                    <p className="mt-snug flex max-w-[68ch] items-baseline gap-x-2 text-meta text-muted-foreground sm:pl-10">
                      {itemTitle ? <span className="min-w-0 truncate">{itemTitle}</span> : null}
                      {itemPrice ? (
                        <span className="shrink-0 font-medium tabular-nums text-foreground/75">{itemPrice}</span>
                      ) : null}
                    </p>
                  ) : null}
                </div>

                {/* One line of small print under the row: proof, date, and source link. */}
                {footerSummary || hasSourceLink ? (
                  <p className="mt-snug flex flex-wrap items-center gap-x-1.5 text-meta text-muted-foreground sm:pl-10">
                    {footerSummary ? <span>{footerSummary}</span> : null}
                    {footerSummary && hasSourceLink ? <span aria-hidden>·</span> : null}
                    {node.imported && node.sourceUrl ? (
                      <SourceLink url={node.sourceUrl} label="View original post" />
                    ) : node.external && node.sourceUrl ? (
                      <SourceLink url={node.sourceUrl} label="View on eBay" />
                    ) : null}
                  </p>
                ) : null}

                {mine ? (
                  <div className="mt-snug flex items-center justify-between gap-2 sm:pl-10">
                    <span className="text-meta text-muted-foreground">Your reference</span>
                    <ReferenceOwnerActions node={node} subject={given ? node.handle : centre.handle} />
                  </div>
                ) : canModerate && node.referenceId ? (
                  <div className="mt-snug flex items-center justify-between gap-2 sm:pl-10">
                    <span className="text-meta text-muted-foreground">Staff</span>
                    <ReferenceStaffRemove
                      referenceId={node.referenceId}
                      subject={given ? node.handle : centre.handle}
                    />
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {pageCount > 1 ? (
        <nav aria-label="Reference pages" className="mt-cozy flex items-center justify-between gap-cozy">
          <p role="status" className="text-meta tabular-nums text-muted-foreground">
            {first + 1}–{first + shown.length} of {total}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className={QUIET_EDGE}
              disabled={current === 0}
              onClick={() => turnTo(current - 1)}
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} aria-hidden />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              className={QUIET_EDGE}
              disabled={current >= pageCount - 1}
              onClick={() => turnTo(current + 1)}
            >
              Next
              <HugeiconsIcon icon={ArrowRight01Icon} aria-hidden />
            </Button>
          </div>
        </nav>
      ) : null}
    </div>
  );
});

function EmptyNetwork({
  centre,
  direction,
}: {
  centre: ReferenceGraphCentre;
  direction: ReferenceDirection;
}) {
  return (
    <div className="relative flex min-h-[340px] flex-1 flex-col items-center justify-center bg-muted/15 px-6 py-14 text-center">
      <div className="mx-auto mb-3 grid size-14 place-items-center rounded-lg border border-border bg-card shadow-market">
        <span className="text-lead font-semibold text-foreground">
          {centre.name.replace(/^@/, '').slice(0, 2).toUpperCase()}
        </span>
      </div>
      <p className="text-body font-semibold text-foreground">{centre.handle}</p>
      <p className="mt-1 max-w-md text-body text-muted-foreground">
        {direction === 'given'
          ? `${centre.handle} hasn't left a reference for anyone yet.`
          : `No references yet for ${centre.handle}. Done a deal with them? Be the first to leave a reference.`}
      </p>
    </div>
  );
}

/** The network under its header: controls, and the drawing with its card. */
export function TrustNetworkBody({ orbits }: { orbits: TrustOrbits }) {
  const { centre } = orbits.graph;
  const { view } = orbits;
  if (view.nodes.length === 0) return <EmptyNetwork centre={centre} direction={view.direction} />;
  return (
    <>
      <NetworkToolbar
        platforms={view.platforms}
        // References, like the platform pills beside it and the tally in the header.
        // The number of people drawn was smaller than a single platform's count.
        total={viewTotal(view)}
        platformFilter={orbits.platformFilter}
        filterByPlatform={orbits.filterByPlatform}
        opacity={arrival(orbits)}
        tilted={orbits.tilted}
        autoSpin={orbits.autoSpin}
        toggleSpin={orbits.toggleSpin}
        resetView={orbits.resetView}
      />
      <div
        className="relative flex-1 px-2 py-3 sm:px-4"
        style={{
          backgroundImage:
            'radial-gradient(ellipse at 50% 44%, hsl(var(--iris) / 0.05) 0%, transparent 65%), radial-gradient(hsl(var(--foreground) / 0.08) 1px, transparent 1px)',
          backgroundSize: '100% 100%, 22px 22px',
        }}
      >
        <TrustOrbitsCanvas
          orbits={orbits}
          label={
            view.direction === 'given'
              ? `References for ${centre.handle}: references they have left for ${plural(view.nodes.length, 'person', 'people')}`
              : `References for ${centre.handle}: ${plural(centre.peopleCount, 'person vouches', 'people vouch')} for them`
          }
        >
          <TrustNetworkPanel orbits={orbits} />
        </TrustOrbitsCanvas>
      </div>
    </>
  );
}

/** The network's title and how well vouched for the person in the middle is, with an optional action. */
export function TrustNetworkHeader({ orbits, action }: { orbits: TrustOrbits; action?: ReactNode }) {
  const { graph } = orbits;
  return (
    <NetworkHeader
      stats={orbits.view.stats}
      sentimentFilter={orbits.sentimentFilter}
      filterBySentiment={orbits.filterBySentiment}
      opacity={arrival(orbits)}
      centre={graph.centre}
      centreKey={orbits.centreKey}
      direction={orbits.direction}
      setDirection={orbits.setDirection}
      receivedTotal={viewTotal(viewOf(graph, 'received'))}
      givenTotal={viewTotal(viewOf(graph, 'given'))}
      action={action}
    />
  );
}

const NetworkHeader = memo(function NetworkHeader({
  stats,
  sentimentFilter,
  filterBySentiment,
  opacity,
  centre,
  centreKey,
  direction,
  setDirection,
  receivedTotal,
  givenTotal,
  action,
}: {
  stats: ReferenceView['stats'];
  sentimentFilter: ReferenceSentiment | null;
  filterBySentiment: (sentiment: ReferenceSentiment | null) => void;
  opacity: number;
  centre: ReferenceGraphCentre;
  centreKey: string;
  direction: ReferenceDirection;
  setDirection: (next: ReferenceDirection) => void;
  receivedTotal: number;
  givenTotal: number;
  action?: ReactNode;
}) {
  // Received (left FOR them) or Given (left BY them). Only a member can have left a
  // reference, so an unclaimed handle has nothing to switch to and gets no control.
  const member = centre.profileId !== null;
  return (
    <div className="flex flex-col gap-3 border-b border-border/70 px-group py-group sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div className="flex min-w-0 flex-wrap items-center gap-2.5" style={{ opacity }}>
        <h3 id="references-heading" className="text-subhead font-semibold tracking-tight text-foreground">
          References
        </h3>
        <NetworkStats
          stats={stats}
          sentimentFilter={sentimentFilter}
          filterBySentiment={filterBySentiment}
        />
      </div>
      {member || action ? (
        <div className="flex flex-col gap-2 sm:shrink-0 sm:flex-row sm:items-center">
          {member ? (
            <SegmentedControl<ReferenceDirection>
              name={`reference-direction-${centreKey}`}
              label={`Which references to show for ${centre.handle}`}
              options={[
                { value: 'received', label: 'Received', count: receivedTotal },
                { value: 'given', label: 'Given', count: givenTotal },
              ]}
              value={direction}
              onChange={setDirection}
              // PHONE: COMPACT. Full width at 44px, the switch was the largest thing in
              // the header, heavier than the title above it. Below `sm` it is 36px tall
              // (32px segments, the `xs` button height), `meta` labels, and only as wide
              // as its labels. From `sm` it sits beside the title at its usual size.
              className="w-fit max-sm:gap-0.5 max-sm:p-0.5 sm:w-60"
              segmentClassName="max-sm:min-h-8 max-sm:px-cozy max-sm:text-meta"
            />
          ) : null}
          {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
        </div>
      ) : null}
    </div>
  );
});

export function ReferenceGraph({
  data,
  action,
  viewerId = null,
}: {
  data: ReferenceGraphData;
  /** The ShareExperience control (or the owner's share link control) for this page's person. */
  action?: ReactNode;
  /** The signed-in member, who can edit or withdraw the references they wrote. */
  viewerId?: string | null;
}) {
  const orbits = useTrustOrbits(data, { openPage: usePageOpener(false) });
  return (
    <section
      aria-labelledby="references-heading"
      className="overflow-hidden rounded-2xl border border-border/90 bg-card shadow-xs"
    >
      <TrustNetworkHeader orbits={orbits} action={orbits.away ? null : action} />
      <TrustNetworkBody orbits={orbits} />
      {orbits.view.nodes.length > 0 ? <ExperienceList orbits={orbits} viewerId={viewerId} /> : null}
    </section>
  );
}
