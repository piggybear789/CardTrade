// components/layout/SectionHeader.tsx
//
// Shared heading and load-failure copy for workspace sections. MarketplaceShell
// renders the page <h1> (visible in the desktop rail, off-screen below `lg`), so
// a section heading is an <h2> to keep the document outline hierarchical. Below
// `lg` this is the first thing on the page: the shell prints no header of its
// own, precisely so the section is not named twice.

import type { ReactNode } from 'react';

export function SectionHeader({
  title,
  description,
  actions,
  mobileAction,
}: {
  title: string;
  description?: ReactNode;
  /** Optional controls aligned with the heading on wider viewports. */
  actions?: ReactNode;
  /**
   * The section's primary action, for small screens only. The shell's rail owns
   * it on desktop but is hidden below `lg`, so a section with a CTA passes the
   * same node here and it lands beside this heading instead.
   */
  mobileAction?: ReactNode;
}) {
  return (
    <header className="mb-snug flex flex-col gap-tight border-b border-border pb-snug md:mb-5 md:gap-3 md:pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h2 className="text-balance text-subhead font-semibold tracking-[-0.025em] md:text-head">
          {title}
        </h2>
        {description ? (
          <p className="mt-tight hidden text-pretty text-body text-muted-foreground md:mt-1.5 md:block">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
      {/* Full width when it stacks under the heading, natural width once the
          header turns into a row. */}
      {mobileAction ? (
        <div className="w-full min-w-0 sm:w-auto sm:shrink-0 md:hidden [&>a]:w-full sm:[&>a]:w-auto">
          {mobileAction}
        </div>
      ) : null}
    </header>
  );
}

/** Uniform, actionable failure state for a section that could not be read. */
export function SectionLoadError({ label }: { label: string }) {
  return (
    <p
      role="alert"
      className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-body text-destructive"
    >
      We couldn&apos;t load your {label} right now. Reload the page to try again.
    </p>
  );
}
