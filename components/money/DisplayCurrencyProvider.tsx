'use client';

// components/money/DisplayCurrencyProvider.tsx
//
// The viewer's display currency and the day's reference rates, for the browse
// surfaces that show a listing's price in the viewer's own currency (0179). Supplied
// once by `DisplayCurrencyBoundary` in the root layout, so every catalog tile, listing
// page and search suggestion converts with the same table and no request of its own.
//
// Approximate and display-only: see `domain/fx/displayConversion.ts`. Without a
// provider (tests, a surface outside the layout) or without rates, prices show as
// listed.

import { createContext, useContext, type ReactNode } from 'react';

import { approximateMinor, type DisplayCurrency } from '@/domain/fx/displayConversion';
import { formatMoneyWhole } from '@/lib/format';

const DisplayCurrencyContext = createContext<DisplayCurrency | null>(null);

export function DisplayCurrencyProvider({
  value,
  children,
}: {
  value: DisplayCurrency;
  children: ReactNode;
}) {
  return <DisplayCurrencyContext.Provider value={value}>{children}</DisplayCurrencyContext.Provider>;
}

/** The viewer's display currency, or null outside a provider. */
export function useDisplayCurrency(): DisplayCurrency | null {
  return useContext(DisplayCurrencyContext);
}

/**
 * `amountMinor` in `currency` as an approximate figure in the viewer's currency:
 * "≈ $155 AUD", whole units. Null when there is nothing to convert (same currency,
 * no rate, no provider), so the caller shows the listed figure.
 */
export function useApproximatePrice(amountMinor: number, currency: string | null | undefined): string | null {
  const display = useDisplayCurrency();
  if (!display || !currency) return null;
  const converted = approximateMinor(amountMinor, currency, display.currency, display.rates);
  return converted === null ? null : `≈ ${formatMoneyWhole(converted, display.currency)}`;
}
