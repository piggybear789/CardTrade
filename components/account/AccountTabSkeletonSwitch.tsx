'use client';

// components/account/AccountTabSkeletonSwitch.tsx
//
// Picks the Account hub's tab placeholder from `?tab=`.
//
// A route `loading.tsx` receives no `searchParams`, which is why the hub's loader drew
// the Profile tab for every URL. But the router has already committed the destination
// URL by the time it paints a loading boundary, so a client component inside one CAN
// read it. The three placeholders stay server-rendered and arrive as props; this only
// chooses between them, through the same `resolveAccountTab` the page uses, so the
// placeholder and the page cannot disagree about which tab a URL means.

import type { ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';

import { resolveAccountTab, type AccountTabId } from '@/components/account/account-tabs-config';

export function AccountTabSkeletonSwitch({
  panels,
}: {
  panels: Record<AccountTabId, ReactNode>;
}) {
  const tab = resolveAccountTab(useSearchParams().get('tab') ?? undefined);
  return <>{panels[tab]}</>;
}
