// components/ui/empty-state.tsx
//
// Shared centered state for empty collections and first-use guidance. Keeps
// icon, copy, spacing, and mobile action width consistent across features.

import type { ReactNode } from 'react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact = false,
  titleAs: Title = 'h2',
}: {
  icon?: ReactNode;
  title: string;
  description: ReactNode;
  action?: { label: string; href: string; variant?: 'default' | 'outline' };
  className?: string;
  compact?: boolean;
  /** Match the state title to its surrounding document outline. */
  titleAs?: 'h1' | 'h2' | 'h3';
}) {
  return (
    <div
      className={cn(
        // Sits where the first row of content would: a section empty state
        // belongs under its heading, not floating in the middle of the viewport.
        // Full-page interstitials are centred by their shell instead.
        'flex w-full flex-col items-center justify-center rounded-lg border border-dashed px-6 text-center',
        compact ? 'py-10' : 'py-14 sm:py-16',
        className,
      )}
    >
      {icon ? (
        <div className="flex size-12 items-center justify-center rounded-full border bg-muted/40 text-muted-foreground">
          {icon}
        </div>
      ) : null}
      <Title className={cn('text-base font-semibold', icon && 'mt-4')}>
        {title}
      </Title>
      <p className="mt-1.5 max-w-sm text-sm leading-6 text-muted-foreground">
        {description}
      </p>
      {action ? (
        <Button
          asChild
          variant={action.variant ?? 'default'}
          className="mt-5 w-full sm:w-auto"
        >
          <Link href={action.href}>{action.label}</Link>
        </Button>
      ) : null}
    </div>
  );
}
