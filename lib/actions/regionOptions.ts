'use server';

// lib/actions/regionOptions.ts
//
// The regions a member may CHOOSE as their own, as a Server Action so a client
// component can read the runtime answer.
//
// WHY THIS IS NOT JUST `tradingRegions()`. That reads the registry's product-intent
// flag. The real answer additionally requires a configured Stripe platform account
// for the region, because each region is a separate account and Stripe refuses a
// transfer from a platform in one region to a connected account in another. Offering
// a region with no account behind it would badge the member ready to sell and then
// fail every payout — a state that looks complete and is not, which is the 0060
// mistake with money attached.
//
// `operationalRegions()` reads `process.env`, so it cannot run in the browser; this
// module is the seam that carries the answer across.

import { operationalRegions } from '@/domain/services';
import { findRegion, type RegionCode } from '@/domain/region';

/** A region a member may select, with everything the picker needs to label it. */
export interface SelectableRegion {
  code: RegionCode;
  label: string;
  /** ISO 4217, lowercase. Shown so the member knows what they will be paid in. */
  currency: string;
}

/**
 * Every region in which a member can actually transact right now.
 *
 * Sorted by label so the list is stable and scannable rather than ordered by the
 * accident of how the environment enumerates.
 */
export async function listSelectableRegions(): Promise<SelectableRegion[]> {
  return [...operationalRegions()]
    .map((code) => findRegion(code))
    .filter((region): region is NonNullable<typeof region> => region !== null)
    .map((region) => ({
      code: region.code,
      label: region.label,
      currency: region.currency,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
