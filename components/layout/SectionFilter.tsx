// components/layout/SectionFilter.tsx
//
// Active / Past split for a workspace section. A finished trade or a cancelled
// sale is history, and history should not sit between the things still needing
// attention. URL-driven (`?show=`) so a view is linkable and survives a reload,
// which also keeps these pages server-rendered.

import Link from 'next/link';

import { TabIndicator } from '@/components/motion/TabIndicator';
import { cn } from '@/lib/utils';

/** Which slice of a section's records to show. */
export type SectionScope = 'active' | 'past';

/** Narrow an arbitrary `?show=` value, defaulting to what still needs action. */
export function resolveScope(value: string | string[] | undefined): SectionScope {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === 'past' ? 'past' : 'active';
}

/**
 * Split records into what is still live and what is finished, using a predicate
 * for the terminal states of that record type.
 */
export function partitionByScope<T>(
  records: T[],
  isPast: (record: T) => boolean,
): { active: T[]; past: T[] } {
  const active: T[] = [];
  const past: T[] = [];
  for (const record of records) {
    (isPast(record) ? past : active).push(record);
  }
  return { active, past };
}

/** Merge extra search params into a path that may already have a query string. */
function withQuery(path: string, extra: Record<string, string | null> = {}) {
  const queryIndex = path.indexOf('?');
  const pathname = queryIndex === -1 ? path : path.slice(0, queryIndex);
  const params = new URLSearchParams(
    queryIndex === -1 ? '' : path.slice(queryIndex + 1),
  );
  for (const [key, value] of Object.entries(extra)) {
    if (value == null) params.delete(key);
    else params.set(key, value);
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function SectionFilter({
  scope,
  basePath,
  activeCount,
  pastCount,
}: {
  scope: SectionScope;
  /** Route the tabs link to, e.g. `/trades`. */
  basePath: string;
  activeCount: number;
  pastCount: number;
}) {
  return (
    <SectionTabs
      label="Filter by status"
      currentKey={scope}
      tabs={[
        { key: 'active', label: 'Active', count: activeCount, href: withQuery(basePath, { show: null }) },
        { key: 'past', label: 'Past', count: pastCount, href: withQuery(basePath, { show: 'past' }) },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// Contract lists: Active / Needs you / Waiting / Past
// ---------------------------------------------------------------------------
//
// A contract section splits FOUR ways, not two, because "active" is the answer to a
// question nobody asks. A member with nine open contracts wants to know which ones are
// stuck on them — and the count on the chip answers that whether or not they ever click
// it, which is most of the value.
//
// `Active` stays and stays the default. Landing on "Needs you" would show an empty page
// to a member whose six contracts are all waiting on someone else, which reads as
// nothing happening rather than as a filter.
//
// Whose move it is comes from the contract's own step plan (`ContractNextMove`), so
// these buckets and the next-step column on every row are the same derivation. Nothing
// here re-decides what a status means.

/** Which slice of a contract section to show. */
export type ContractScope = 'active' | 'needs-you' | 'waiting' | 'past';

/** Narrow an arbitrary `?show=` value, defaulting to everything still live. */
export function resolveContractScope(
  value: string | string[] | undefined,
): ContractScope {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === 'past' || raw === 'needs-you' || raw === 'waiting' ? raw : 'active';
}

/** A contract section's records, split every way its tabs can show them. */
export interface ContractGroups<T> {
  /** Everything still running. `needsYou` and `waiting` partition this. */
  active: T[];
  needsYou: T[];
  waiting: T[];
  past: T[];
}

/**
 * Split contracts by whether they are finished and, if not, whose move they are.
 *
 * @param isPast     Terminal-state predicate for the record type (`lib/lifecycle.ts`).
 * @param needsViewer Whether the live step belongs to the person reading the list.
 *   `needsViewer` in `components/account/ContractRow.tsx` is the one definition —
 *   passing it in rather than importing it keeps this module free of a dependency on
 *   the account components it is laid out above.
 */
export function groupContracts<T>(
  records: T[],
  isPast: (record: T) => boolean,
  needsViewer: (record: T) => boolean,
): ContractGroups<T> {
  const groups: ContractGroups<T> = {
    active: [],
    needsYou: [],
    waiting: [],
    past: [],
  };
  for (const record of records) {
    if (isPast(record)) {
      groups.past.push(record);
      continue;
    }
    groups.active.push(record);
    (needsViewer(record) ? groups.needsYou : groups.waiting).push(record);
  }
  return groups;
}

/** The records one scope shows. */
export function contractsForScope<T>(
  groups: ContractGroups<T>,
  scope: ContractScope,
): T[] {
  switch (scope) {
    case 'needs-you':
      return groups.needsYou;
    case 'waiting':
      return groups.waiting;
    case 'past':
      return groups.past;
    default:
      return groups.active;
  }
}

export function ContractFilter({
  scope,
  basePath,
  groups,
  extraActive = 0,
}: {
  scope: ContractScope;
  /** Route the tabs link to, e.g. `/trades`. */
  basePath: string;
  groups: ContractGroups<unknown>;
  /**
   * Records counted as active but held outside the groups — pending private-deal
   * invites, which are live but have no contract and therefore no step plan.
   */
  extraActive?: number;
}) {
  return (
    <SectionTabs
      label="Filter by status"
      currentKey={scope}
      tabs={[
        {
          key: 'active',
          label: 'Active',
          count: groups.active.length + extraActive,
          href: withQuery(basePath, { show: null }),
        },
        {
          key: 'needs-you',
          label: 'Needs you',
          count: groups.needsYou.length,
          href: withQuery(basePath, { show: 'needs-you' }),
        },
        {
          key: 'waiting',
          label: 'Waiting',
          count: groups.waiting.length,
          href: withQuery(basePath, { show: 'waiting' }),
        },
        {
          key: 'past',
          label: 'Past',
          count: groups.past.length,
          href: withQuery(basePath, { show: 'past' }),
        },
      ]}
    />
  );
}

// GEOMETRY LIVES HERE ONCE, so `SectionFilterSkeleton` cannot drift away from the real
// strip — the same arrangement `components/ui/tabbed-panels.tsx` uses, and for the same
// reason. Before this split the placeholder hardcoded `h-10 w-24` per tab: 4px short of
// the real `md:min-h-11`, on the element every list on the page stacks beneath, and
// 96px wide per tab where the real width is intrinsic. Four fixed tabs came to 396px,
// wider than the ~343px a 375px phone leaves, so the strip either overflowed or forced
// the whole content column wider until the data landed.
export const SECTION_TABS_NAV_SHAPE = [
  // Scrolls horizontally rather than wrapping or clipping: three tabs with counts
  // overflow a 320px viewport, and a clipped tab is an unreachable one. Scrollbar
  // hidden to match the rail's treatment in MarketplaceShell.
  'mb-cozy flex gap-tight overflow-x-auto border-b border-border pb-px pr-group',
  '[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
  '[mask-image:linear-gradient(to_right,black_calc(100%-0.75rem),transparent)]',
  'md:mb-5 md:[mask-image:none] md:pr-0',
].join(' ');

// `border border-transparent` is the focus-ring reserve, and it is load-bearing in the
// placeholder too: without it every tab is 2px short.
export const SECTION_TABS_ITEM_SHAPE = [
  'relative -mb-px inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-t-md',
  'border border-transparent px-cozy py-snug text-body font-medium',
  'md:min-h-11 md:gap-snug md:px-group md:py-2.5',
].join(' ');

/** One tab in a {@link SectionTabs} strip. */
export interface SectionTab {
  /** Stable key, also the React key, compared against `currentKey`. */
  key: string;
  label: string;
  /** Shorter label below `md` when the full word clips the last tab. */
  shortLabel?: string;
  /** Shown beside the label. Omit for a tab with nothing to count. */
  count?: number;
  href: string;
}

/**
 * The workspace tab strip: underlined, URL-driven, counted.
 *
 * Extracted so there is exactly ONE of these. The arbitration queue needed three
 * tabs rather than Active/Past and re-implemented this markup class-for-class —
 * two copies of the workspace's tab styling, guaranteed to drift the first time
 * either was touched. {@link SectionFilter} is now a two-tab preset over this.
 */
export function SectionTabs({
  tabs,
  currentKey,
  label,
  className,
}: {
  tabs: readonly SectionTab[];
  currentKey: string;
  /** Accessible name for the strip, e.g. "Filter by status". */
  label: string;
  className?: string;
}) {
  return (
    <nav
      aria-label={label}
      className={cn(SECTION_TABS_NAV_SHAPE, className)}
    >
      {tabs.map((tab) => {
        const current = tab.key === currentKey;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={current ? 'page' : undefined}
            className={cn(
              SECTION_TABS_ITEM_SHAPE,
              'transition-colors active:opacity-70 focus:outline-none focus-visible:border-iris',
              current
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.shortLabel ? (
              <>
                <span className="md:hidden">{tab.shortLabel}</span>
                <span className="hidden md:inline">{tab.label}</span>
              </>
            ) : (
              tab.label
            )}
            {tab.count === undefined ? null : (
              <span className="text-meta tabular-nums text-muted-foreground">
                {tab.count}
              </span>
            )}
            {current ? (
              <TabIndicator layoutId={`section-tabs-${label}`} />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
