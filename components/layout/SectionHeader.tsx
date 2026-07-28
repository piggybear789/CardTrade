// components/layout/SectionHeader.tsx
//
// Shared heading and load-failure copy for workspace sections. The rail already
// renders the page <h1>, so a section heading is an <h2> to keep the document
// outline hierarchical.

import type { ReactNode } from 'react';

export function SectionHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  /** Optional controls aligned with the heading on wider viewports. */
  actions?: ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-col gap-3 border-b border-border/70 pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h2 className="text-balance text-2xl font-semibold tracking-[-0.025em] sm:text-3xl">
          {title}
        </h2>
        {description ? (
          <p className="mt-1.5 text-pretty text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
    </header>
  );
}

/** Uniform, actionable failure state for a section that could not be read. */
export function SectionLoadError({ label }: { label: string }) {
  return (
    <p
      role="alert"
      className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
    >
      We couldn&apos;t load your {label} right now. Reload the page to try again.
    </p>
  );
}
