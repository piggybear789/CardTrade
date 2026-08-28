// app/listings/new/loading.tsx
//
// Mirrors the create-listing form's photo/details card layout, rather than
// the catalog-grid skeleton that app/listings/loading.tsx would otherwise
// supply for this route.

import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import { ItemFormSkeleton } from '@/components/listings/ItemFormSkeleton';

export default function NewListingLoading() {
  return (
    <MarketplaceShellSkeleton title="New Listing">
      <ItemFormSkeleton />
    </MarketplaceShellSkeleton>
  );
}
