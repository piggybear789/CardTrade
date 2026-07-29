// components/layout/PageShell.tsx
//
// Canonical fluid route container for pages outside MarketplaceShell (join
// deal, admin gate). Content widths scale with the viewport while gutters and
// vertical rhythm stay stable. Section titles use SectionHeader instead.

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function PageShell({
  children,
  centered = false,
  className,
}: {
  children: ReactNode;
  /** Vertically centre short pages within the available flex space. */
  centered?: boolean;
  className?: string;
}) {
  return (
    <main
      className={cn(
        'mx-auto flex w-full flex-col px-4 py-8 sm:px-6 sm:py-10 lg:px-8',
        centered && 'flex flex-1 flex-col justify-center',
        className,
      )}
    >
      {children}
    </main>
  );
}
