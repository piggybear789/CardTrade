// app/listings/[id]/edit/loading.tsx
//
// Mirrors the edit-listing form's photo/details card layout (same shape as
// create), rather than the catalog-grid skeleton that
// app/listings/loading.tsx would otherwise supply for this route.

import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import { ItemFormSkeleton } from '@/components/listings/ItemFormSkeleton';

export default function EditListingLoading() {
  return (
    <MarketplaceShellSkeleton title="Edit Listing">
      <ItemFormSkeleton mode="edit" />
    </MarketplaceShellSkeleton>
  );
}
