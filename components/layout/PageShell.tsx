// components/layout/PageShell.tsx
//
// Canonical fluid route container for pages outside MarketplaceShell (join
// deal, admin gate). The shell itself stays full-bleed so chrome can dock to
// the viewport edge; MarketplaceShell caps the content column, not this frame.

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
        'mx-auto flex w-full flex-col pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] py-section sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))] sm:py-10 lg:pl-[max(2rem,env(safe-area-inset-left))] lg:pr-[max(2rem,env(safe-area-inset-right))]',
        centered && 'flex flex-1 flex-col justify-center',
        className,
      )}
    >
      {children}
    </main>
  );
}
