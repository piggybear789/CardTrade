// components/ui/mobile-list.tsx
//
// Phone lists sit on the page colour. Desktop keeps the existing market cards.
// Use `sheet` for one grouped list (inbox). Use `cards` when desktop still
// wants a card per row (purchases, sales, trades).

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function MobileList({
  children,
  label,
  variant = 'sheet',
  className,
}: {
  children: ReactNode;
  label?: string;
  variant?: 'sheet' | 'cards';
  className?: string;
}) {
  return (
    <ul
      role="list"
      aria-label={label}
      className={cn(
        'max-md:divide-y max-md:divide-border',
        variant === 'sheet' &&
          'md:divide-y md:divide-border md:overflow-hidden md:rounded-xl md:border md:border-border md:bg-card md:shadow-market',
        variant === 'cards' && 'md:space-y-cozy md:divide-y-0',
        className,
      )}
    >
      {children}
    </ul>
  );
}

export function MobileListItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <li
      className={cn(
        'md:rounded-xl md:border md:border-border md:bg-card md:p-cozy md:shadow-market',
        className,
      )}
    >
      {children}
    </li>
  );
}

/** iOS-style inset group: one sheet on the phone, separate cards on desktop. */
export function InsetGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'max-md:divide-y max-md:divide-border max-md:overflow-hidden max-md:rounded-xl max-md:border max-md:border-border max-md:bg-card',
        'md:space-y-cozy',
        className,
      )}
    >
      {children}
    </div>
  );
}
