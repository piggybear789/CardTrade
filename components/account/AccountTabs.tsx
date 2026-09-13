// components/account/AccountTabs.tsx
//
// The Account hub's tab strip: the glossary in `account-tabs-config` bound to the
// shared strip in `components/ui/tabbed-panels`.
//
// NO `'use client'`. Everything interactive moved into `TabbedPanels` when the seller
// profile needed the same strip, and what is left here is a mapping from the tab
// config to that component's props. Keeping this file server-renderable means the
// mapping is not shipped to the browser, and — more usefully — it means this module
// can go on exporting plain values without the client-reference trap documented in
// `account-tabs-config.ts`.

import type { ReactNode } from 'react';

import {
  ACCOUNT_TABS,
  accountTabHref,
  type AccountTabId,
} from '@/components/account/account-tabs-config';
import { TabbedPanels, TabbedPanelsSkeleton } from '@/components/ui/tabbed-panels';

// Hrefs are resolved here, on the server, because `TabbedPanels` takes strings rather
// than an `hrefFor` callback — a Server Component cannot hand a client component a
// function. See the note on `TabDescriptor`.
const TABS = ACCOUNT_TABS.map((tab) => ({
  id: tab.id,
  label: tab.label,
  href: accountTabHref(tab.id),
}));

export interface AccountTabsProps {
  /** Resolved on the server from `?tab=`, so a deep link opens on the right panel. */
  initialTab: AccountTabId;
  /** All three panels, server-rendered once. Hidden ones cost no effects. */
  panels: Record<AccountTabId, ReactNode>;
}

export function AccountTabs({ initialTab, panels }: AccountTabsProps) {
  return (
    <TabbedPanels
      tabs={TABS}
      initialTab={initialTab}
      panels={panels}
      label="Account sections"
      layoutId="account-tabs"
    />
  );
}

/** The strip's loading placeholder, in the shape the real strip occupies. */
export function AccountTabsSkeleton() {
  return <TabbedPanelsSkeleton labels={ACCOUNT_TABS.map((tab) => tab.label)} />;
}
