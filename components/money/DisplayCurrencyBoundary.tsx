// components/money/DisplayCurrencyBoundary.tsx
//
// Reads the viewer's display currency and the day's reference rates on the server and
// hands them to `DisplayCurrencyProvider` (0179). In the root layout, so the header's
// search suggestions and every page below share one table.
//
// Both reads are cheap: the currency comes from the request-cached profile (already
// awaited by the header) or a request header, and the rates are cached for 12 hours.
// A failed rate read yields null rates, and every price then shows as listed.

import type { ReactNode } from 'react';

import { DisplayCurrencyProvider } from '@/components/money/DisplayCurrencyProvider';
import { viewerDisplayCurrency } from '@/lib/fx/displayRates';

export async function DisplayCurrencyBoundary({ children }: { children: ReactNode }) {
  const value = await viewerDisplayCurrency();
  return <DisplayCurrencyProvider value={value}>{children}</DisplayCurrencyProvider>;
}
