'use client';

// components/listings/ListedPrice.tsx
//
// A listing's browse price as styled parts (symbol, whole units, cents, currency code),
// in the VIEWER's currency when it differs from the listing's (0179).
//
// The figure is `listedPriceText`, the one every browse surface shows. When the viewer
// reads prices in another currency it becomes "≈ $155 AUD" instead, converted at the
// day's reference rate (`DisplayCurrencyProvider`), with the listed figure in the
// tooltip and for screen readers. Approximate and display-only: the Buy and Pay dialogs
// show the real amount in the listing's currency, which is what is charged.
//
// A client component so the tile, which also renders inside Server Components, can read
// the provider. It renders a fragment of spans, so each caller keeps its own wrapper.

import { listedPriceCents, listedPriceText, splitMoney } from '@/lib/listings/buyerPrice';
import { useApproximatePrice } from '@/components/money/DisplayCurrencyProvider';

export interface ListedPriceClassNames {
  /** The currency symbol, with a leading "≈ " when approximate. */
  symbol?: string;
  /** The whole units. */
  major?: string;
  /** The cents, when shown and present. */
  minor?: string;
  /** The trailing ISO code. */
  code?: string;
}

export function ListedPrice({
  priceCents,
  currency,
  isShopfront,
  classNames = {},
  showMinor = true,
}: {
  priceCents: number;
  currency: string | null;
  isShopfront: boolean;
  classNames?: ListedPriceClassNames;
  /** False for the catalog tile, which shows whole units only. */
  showMinor?: boolean;
}) {
  const listed = listedPriceText(priceCents, currency, isShopfront);
  const approximate = useApproximatePrice(
    listedPriceCents(priceCents, currency, isShopfront),
    currency,
  );
  const parts = splitMoney(approximate ?? listed);

  return (
    <>
      {approximate ? <span className="sr-only">About </span> : null}
      <span className={classNames.symbol} aria-hidden={approximate ? true : undefined} title={approximate ? listed : undefined}>
        {parts.symbol}
      </span>
      <span className={classNames.major} title={approximate ? listed : undefined}>
        {parts.major}
      </span>
      {showMinor && parts.minor ? <span className={classNames.minor}>{parts.minor}</span> : null}
      {parts.code ? <span className={classNames.code}>{parts.code}</span> : null}
      {approximate ? <span className="sr-only">, listed at {listed}</span> : null}
    </>
  );
}
