import 'server-only';

// lib/regionBinding.ts
//
// Resolve which Stripe PLATFORM ACCOUNT a contract's money lives in.
//
// WHY THIS EXISTS AT ALL. A platform can only pay connected accounts it can reach:
// the US platform serves the US/UK/EEA/CA/CH cross-border group, and Australia has
// its own. Our funds flow is buyer → platform balance → seller, so
// `getPaymentService(region)` selects real money, and passing the wrong one fails at
// transfer time with the buyer already charged.
//
// Every function here returns a PLATFORM region (`AU` or `US` today), never a member's
// own country, so two contracts on one platform resolve to the same binding.
//
// WHY IT KEYS OFF `currency` AND NOT THE PARTIES' PROFILES. A contract freezes its
// currency at creation (0068). A profile's `region_code` can be corrected afterwards —
// by support, or by a future migration — and if the binding read the profile, an
// in-flight contract would be re-pointed at a platform account that never held its
// funds. The currency is what the money actually IS, and every currency belongs to
// exactly one platform, so it is the safe key.
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
  platformRegion,
  regionCurrency,
  type RegionCode,
} from '@/domain/region';

/**
 * The platform whose account holds funds denominated in `currency`.
 *
 * Searched over the OPERATIONAL regions only, so a currency that maps to a region we
 * do not run cannot select a binding that has no credentials behind it. Many regions
 * share EUR, and all of them sit on the same platform, so the first match is the answer.
 */
export function regionForCurrency(currency: string | null | undefined): RegionCode {
  const code = currency?.trim().toLowerCase();
  if (!code) return DEFAULT_CONFIG_REGION;

  for (const region of operationalRegions()) {
    if (regionCurrency(region) === code) return platformRegion(region) ?? region;
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

/** A member's region as their platform, when it is operational; else the default. */
function platformForMemberRegion(value: unknown): RegionCode {
  const code = normalizeRegionCode(value);
  return code && operationalRegions().has(code)
    ? (platformRegion(code) ?? code)
    : DEFAULT_CONFIG_REGION;
}

/**
 * The platform-account region for a MEMBER, from their profile.
 *
 * For the cases a contract's currency cannot answer: placing trade collateral before
 * the trade has a frozen currency, and a member's own payer/Connect/Identity records,
 * which live on their platform. Both traders share a platform by the time collateral
 * is sought — `openTradeNegotiation` refused the offer otherwise.
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
  return platformForMemberRegion(data?.region_code);
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
  return platformForMemberRegion(data?.region_code);
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

/**
 * A Trade's frozen currency, for the money calls that must be denominated in it.
 * Undefined when the row cannot be read, which leaves the provider on its platform's
 * settlement currency, the behaviour before one platform served several currencies.
 */
export async function currencyForTrade(tradeId: string): Promise<string | undefined> {
  const { data } = await createAdminClient()
    .from('trades')
    .select('currency')
    .eq('id', tradeId)
    .maybeSingle();
  return (data?.currency as string | null) ?? undefined;
}
