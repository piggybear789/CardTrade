import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

// app/(marketing)/safety/stage-rail.tsx
//
// Building blocks for the safety page. Content lives in `page.tsx`.
//
// TYPOGRAPHY ONLY. No icons, badges or list fragments: the page is written as plain
// prose, so the only structure it needs is paragraph spacing, section headings and the
// collapsible guides. Native <details> keeps those keyboard and screen-reader friendly
// with no client JavaScript.

/** Paragraph spacing and colour for a block of prose. */
export function Prose({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-group text-pretty text-body leading-relaxed text-muted-foreground', className)}>
      {children}
    </div>
  );
}

/** A page section: heading, optional one-line lede, content. Same rhythm everywhere. */
export function PageSection({
  id,
  title,
  lede,
  children,
}: {
  id: string;
  title: string;
  lede?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-24">
      <h2 id={`${id}-heading`} className="text-subhead font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      {lede ? <p className="mt-tight text-pretty text-body text-muted-foreground">{lede}</p> : null}
      <div className="mt-group">{children}</div>
    </section>
  );
}

/** One collapsible guide. The +/− is text, centred with the title in a fixed-height row. */
export function Guide({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <details id={id} className="group scroll-mt-24 border-b border-border">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-cozy text-body font-semibold text-foreground [&::-webkit-details-marker]:hidden">
        <span>{title}</span>
        <span aria-hidden className="text-lead font-normal leading-none text-muted-foreground group-open:hidden">
          +
        </span>
        <span aria-hidden className="hidden text-lead font-normal leading-none text-muted-foreground group-open:inline">
          −
        </span>
      </summary>
      <Prose className="pb-section pt-snug">{children}</Prose>
    </details>
  );
}
