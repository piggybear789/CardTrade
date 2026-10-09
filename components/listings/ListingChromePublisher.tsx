'use client';

import { useEffect } from 'react';

import { publishListingChrome } from '@/lib/listings/listingChrome';

/**
 * Renders nothing. Mounted by the listing page so the phone header can offer
 * Save and Report, which need owner and auth facts the header cannot resolve
 * itself.
 */
export function ListingChromePublisher({
  itemId,
  canReport,
  canSave,
  initialWatching,
}: {
  itemId: string;
  canReport: boolean;
  canSave: boolean;
  initialWatching: boolean;
}) {
  useEffect(() => {
    publishListingChrome({ itemId, canReport, canSave, initialWatching });
    return () => publishListingChrome(null);
  }, [itemId, canReport, canSave, initialWatching]);

  return null;
}
