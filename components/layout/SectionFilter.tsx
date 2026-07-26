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
  const tabs: { key: SectionScope; label: string; count: number; href: string }[] = [
    { key: 'active', label: 'Active', count: activeCount, href: basePath },
    { key: 'past', label: 'Past', count: pastCount, href: `${basePath}?show=past` },
  ];

  return (
    <nav
      aria-label="Filter by status"
      className="mb-5 flex gap-1 border-b border-border/70 pb-px"
    >
      {tabs.map((tab) => {
        const current = tab.key === scope;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={current ? 'page' : undefined}
            className={cn(
              '-mb-px inline-flex items-center gap-2 rounded-t-md border-b-2 px-4 py-2.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              current
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground',
            )}
          >
            {tab.label}
            <span className="text-xs tabular-nums text-muted-foreground">
              {tab.count}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
