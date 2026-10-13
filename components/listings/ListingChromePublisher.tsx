'use client';

import { useEffect } from 'react';

import { publishListingChrome } from '@/lib/listings/listingChrome';

/**
 * Renders nothing. Mounted by the listing page so the phone header can offer
 * Report, which needs owner and auth facts the header cannot resolve itself.
 */
export function ListingChromePublisher({
  itemId,
  canReport,
}: {
  itemId: string;
  canReport: boolean;
}) {
  useEffect(() => {
    publishListingChrome({ itemId, canReport });
    return () => publishListingChrome(null);
  }, [itemId, canReport]);

  return null;
}
