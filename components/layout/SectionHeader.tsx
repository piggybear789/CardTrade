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
    <header className="mb-snug flex flex-row items-center justify-between gap-cozy border-b border-border pb-snug md:mb-5 md:items-end md:gap-cozy md:pb-5">
      {/* `min-h-10` ON A PHONE, ALWAYS. The phone action (`mobileAction`) is a 40px
          button that callers pass only once their list has rows, so without the
          reserve the header was taller with data than without — and the tab strip
          and list under it moved depending on what came back. Reserving the
          button's height whether or not it renders makes the header one height on
          every page. */}
      <div className="flex min-h-10 min-w-0 flex-col justify-center md:block md:min-h-0">
        <h2 className="text-balance text-subhead font-semibold tracking-tight md:text-head">
          {title}
        </h2>
        {description ? (
          <p className="mt-tight hidden text-pretty text-body text-muted-foreground md:mt-1.5 md:block">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 gap-snug">{actions}</div> : null}
      {/* Sits beside the heading, never under it. RailPrimaryAction is `w-full`
          for the rail that normally holds it, so the width is unset here. */}
      {mobileAction ? (
        <div className="shrink-0 md:hidden [&>a]:w-auto [&>button]:w-auto">
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
      className="rounded-xl border border-destructive/40 bg-destructive/10 px-group py-cozy text-body text-destructive"
    >
      We couldn&apos;t load your {label} right now. Reload the page to try again.
    </p>
  );
}
