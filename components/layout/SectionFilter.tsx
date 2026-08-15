// components/layout/SectionFilter.tsx
//
// Active / Past split for a workspace section. A finished trade or a cancelled
// sale is history, and history should not sit between the things still needing
// attention. URL-driven (`?show=`) so a view is linkable and survives a reload,
// which also keeps these pages server-rendered.

import Link from 'next/link';

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
        { key: 'active', label: 'Active', count: activeCount, href: basePath },
        { key: 'past', label: 'Past', count: pastCount, href: `${basePath}?show=past` },
      ]}
    />
  );
}

/** One tab in a {@link SectionTabs} strip. */
export interface SectionTab {
  /** Stable key, also the React key, compared against `currentKey`. */
  key: string;
  label: string;
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
        'mb-5 flex gap-1 overflow-x-auto border-b border-border/70 pb-px [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)] sm:[mask-image:none]',
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
              '-mb-px inline-flex shrink-0 items-center gap-2 rounded-t-md border-b-2 px-4 py-2.5 text-body font-medium transition-colors active:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              current
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground',
            )}
          >
            {tab.label}
            {tab.count === undefined ? null : (
              <span className="text-meta tabular-nums text-muted-foreground">
                {tab.count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
