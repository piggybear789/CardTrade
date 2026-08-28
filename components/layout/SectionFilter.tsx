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
      // Scrolls horizontally rather than wrapping or clipping: three tabs with
      // counts overflow a 320px viewport, and a clipped tab is an unreachable one.
      // Scrollbar hidden to match the rail's treatment in MarketplaceShell.
      className={cn(
        'mb-3 flex gap-1 overflow-x-auto border-b border-border pb-px pr-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_right,black_calc(100%-0.75rem),transparent)] md:mb-5 md:[mask-image:none] md:pr-0',
        className,
      )}
    >
      {tabs.map((tab) => {
        const current = tab.key === currentKey;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={current ? 'page' : undefined}
            className={cn(
              'relative -mb-px inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-t-md border border-transparent px-3 py-2 text-body font-medium transition-colors active:opacity-70 focus:outline-none focus-visible:border-iris md:min-h-11 md:gap-2 md:px-4 md:py-2.5',
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
