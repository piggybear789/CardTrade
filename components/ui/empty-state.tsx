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
  help,
  className,
  compact = false,
  titleAs: Title = 'h2',
}: {
  icon?: ReactNode;
  title: string;
  description: ReactNode;
  action?: {
    label: string;
    variant?: 'default' | 'outline';
    disabled?: boolean;
  } & ({ href: string; onClick?: never } | { onClick: () => void; href?: never });
  help?: { label: string; href: string };
  className?: string;
  compact?: boolean;
  /**
   * Match the state title to its surrounding document outline.
   *
   * `h4` exists because the workspace nests three levels before a section's content:
   * MarketplaceShell owns the `h1`, SectionHeader the `h2`, and a page's own sections
   * are `h3` — so an empty state inside one of those sections is a `h4`. Without it,
   * pages were forced to either mislabel the section or repeat `h3`.
   */
  titleAs?: 'h1' | 'h2' | 'h3' | 'h4';
}) {
  return (
    <div
      className={cn(
        // Sits where the first row of content would: a section empty state
        // belongs under its heading, not floating in the middle of the viewport.
        // Full-page interstitials are centred by their shell instead.
        'flex w-full flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-group text-center',
        compact ? 'py-4 md:py-10' : 'py-5 md:py-14',
        className,
      )}
    >
      {icon ? (
        <div
          aria-hidden="true"
          className="mb-1 hidden size-8 items-center justify-center rounded-full border bg-muted text-muted-foreground md:mb-0 md:flex md:size-12"
        >
          {icon}
        </div>
      ) : null}
      <Title className={cn('text-body font-semibold md:text-lead', icon && 'md:mt-snug')}>
        {title}
      </Title>
      <p className="mt-tight max-w-sm text-pretty text-body text-muted-foreground">
        {description}
      </p>
      {action ? (
        'href' in action && action.href ? (
          <Button
            asChild
            size="sm"
            variant={action.variant ?? 'default'}
            className="mt-snug w-auto md:mt-group"
          >
            <Link href={action.href}>{action.label}</Link>
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant={action.variant ?? 'default'}
            disabled={action.disabled}
            onClick={'onClick' in action ? action.onClick : undefined}
            className="mt-snug w-auto md:mt-group"
          >
            {action.label}
          </Button>
        )
      ) : null}
      {help ? (
        <Link
          href={help.href}
          className="mt-3 text-body font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          {help.label}
        </Link>
      ) : null}
    </div>
  );
}
