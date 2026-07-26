// components/layout/PageShell.tsx
//
// Canonical fluid route container and heading. Content widths scale with the
// viewport while gutters, vertical rhythm, title sizing, and actions stay stable.

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const WIDTHS = {
  form: 'sm:w-5/6 lg:w-2/3 xl:w-1/2',
  reading: 'lg:w-5/6',
  detail: 'lg:w-11/12',
  standard: 'lg:w-11/12',
  catalog: 'w-full',
} as const;

export function PageShell({
  children,
  width = 'standard',
  centered = false,
  className,
}: {
  children: ReactNode;
  width?: keyof typeof WIDTHS;
  /** Vertically centre short pages within the available flex space. */
  centered?: boolean;
  className?: string;
}) {
  return (
    <main
      className={cn(
        'mx-auto flex w-full flex-col px-4 py-8 sm:px-6 sm:py-10 lg:px-8',
        centered && 'flex flex-1 flex-col justify-center',
        WIDTHS[width],
        className,
      )}
    >
      {children}
    </main>
  );
}

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  className,
}: {
  title: string;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        'mb-8 flex flex-col gap-4 border-b border-border/65 pb-5 sm:flex-row sm:items-end sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <p className="cardtrade-eyebrow mb-3">{eyebrow}</p>
        ) : null}
        <h1 className="font-display text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 text-pretty text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">{actions}</div>
      ) : null}
    </header>
  );
}
