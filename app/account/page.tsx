// app/account/page.tsx
//
// Legacy alias. The account hub's transaction lists are now first-class rail
// sections (/purchases, /sales, /trades, /deals, /offers, /saved, and
// /listings/mine), leaving /profile as the personal settings surface. Existing
// links and bookmarks — including the old ?tab= URLs — land there.

import { redirect } from 'next/navigation';

/** Where each retired account tab now lives. */
const TAB_DESTINATIONS: Record<string, string> = {
  listings: '/listings/mine',
  purchases: '/purchases',
  sales: '/sales',
  trades: '/trades',
  offers: '/offers',
  saved: '/saved',
};

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  redirect((tab && TAB_DESTINATIONS[tab]) || '/profile');
}
