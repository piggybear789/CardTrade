'use client';

// components/admin/ConsoleTabSkeletonSwitch.tsx
//
// Picks the Operations console's queue placeholder from `?tab=`.
//
// Same reasoning as `AccountTabSkeletonSwitch`: a route `loading.tsx` receives no
// `searchParams`, so the console's loader used to draw the Payouts body — custody panel
// and all, roughly 400px — in front of every tab. The router has already committed the
// destination URL when it paints the boundary, so a client component inside it can read
// the tab, and it resolves it through the page's own `resolveConsoleTab`. The panels stay
// server-rendered and arrive as props; this only chooses between them.

import type { ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';

import { resolveConsoleTab, type ConsoleTab } from '@/components/admin/consoleTabs';

export function ConsoleTabSkeletonSwitch({
  panels,
}: {
  panels: Record<ConsoleTab, ReactNode>;
}) {
  const tab = resolveConsoleTab(useSearchParams().get('tab'));
  return <>{panels[tab]}</>;
}
