import 'server-only';

// lib/regionBinding.ts
//
// Resolve which Stripe PLATFORM ACCOUNT a contract's money lives in.
//
// WHY THIS EXISTS AT ALL. Each region is a separate Stripe platform account, because
// Stripe refuses transfers from a platform in one region to a connected account in
// another (outside US/CA/UK/EEA/CH, which excludes AU) and refuses cross-border
// payouts to recipient-agreement accounts entirely. Our funds flow is
// buyer → platform balance → seller, so the platform's country is in the path of even
// a wholly domestic sale. `getPaymentService(region)` therefore selects real money,
// and passing the wrong region fails at transfer time with the buyer already charged.
//
// WHY IT KEYS OFF `currency` AND NOT THE PARTIES' PROFILES. A contract freezes its
// currency at creation (0068). A profile's `region_code` can be corrected afterwards —
// by support, or by a future migration — and if the binding read the profile, an
// in-flight contract would be re-pointed at a platform account that never held its
// funds. The currency is what the money actually IS, so it is the safe key.
//
// Falls back to the default region rather than throwing. A missing or unmappable
// currency is a data problem, not a reason to make a contract unresolvable: the
// provider still refuses anything genuinely mismatched, so the failure stays loud but
// lands at the provider rather than taking out a whole page.

import { createAdminClient } from '@/lib/supabase/admin';
import { operationalRegions } from '@/domain/services';
import { DEFAULT_CONFIG_REGION } from '@/domain/services/stripe/config';
import {
  normalizeRegionCode,
  regionCurrency,
  type RegionCode,
} from '@/domain/region';

/**
 * The region whose platform account holds funds denominated in `currency`.
 *
 * Searched over the OPERATIONAL regions only, so a currency that maps to a region we
 * do not run cannot select a binding that has no credentials behind it.
 */
export function regionForCurrency(currency: string | null | undefined): RegionCode {
  const code = currency?.trim().toLowerCase();
  if (!code) return DEFAULT_CONFIG_REGION;

  for (const region of operationalRegions()) {
    if (regionCurrency(region) === code) return region;
  }
  return DEFAULT_CONFIG_REGION;
}

/** The platform-account region for a Cash_Sale, from its frozen currency. */
export async function regionForCashSale(cashSaleId: string): Promise<RegionCode> {
  const { data } = await createAdminClient()
    .from('cash_sales')
    .select('currency')
    .eq('id', cashSaleId)
    .maybeSingle();
  return regionForCurrency(data?.currency as string | null);
}

/**
 * The platform-account region for a MEMBER, from their profile.
 *
 * For the one case a contract's currency cannot answer: placing trade collateral,
 * where the holds are created in the same call that creates the trade, so no frozen
 * currency exists yet. Both traders are in the same region by the time collateral is
 * sought — `openTradeNegotiation` refused the offer otherwise — so either party's
 * region is the trade's region.
 *
 * Prefer {@link regionForTrade} or {@link regionForCashSale} everywhere else: a
 * profile's region can be corrected later, and a contract's currency cannot.
 */
export async function regionForProfile(profileId: string): Promise<RegionCode> {
  const { data } = await createAdminClient()
    .from('profiles')
    .select('region_code')
    .eq('id', profileId)
    .maybeSingle();
  const code = normalizeRegionCode(data?.region_code);
  return code && operationalRegions().has(code) ? code : DEFAULT_CONFIG_REGION;
}

/**
 * The platform-account region for a connected account reference.
 *
 * Needed by the webhook pipeline, which is handed a `merchant_ref` and nothing else.
 * A connected account belongs to exactly one platform, so reading it back — which
 * `applyComplianceUpdate` does — has to go through that platform's client or Stripe
 * reports the account as not found and the member's verification never updates.
 */
export async function regionForMerchantRef(merchantRef: string): Promise<RegionCode> {
  const { data } = await createAdminClient()
    .from('profiles')
    .select('region_code')
    .eq('merchant_ref', merchantRef)
    .maybeSingle();
  const code = normalizeRegionCode(data?.region_code);
  return code && operationalRegions().has(code) ? code : DEFAULT_CONFIG_REGION;
}

/** The platform-account region for a Trade, from its frozen currency. */
export async function regionForTrade(tradeId: string): Promise<RegionCode> {
  const { data } = await createAdminClient()
    .from('trades')
    .select('currency')
    .eq('id', tradeId)
    .maybeSingle();
  return regionForCurrency(data?.currency as string | null);
}
