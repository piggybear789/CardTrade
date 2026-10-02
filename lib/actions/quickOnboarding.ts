'use server';

// lib/actions/quickOnboarding.ts
//
// The two questions the deal composer and an invite ask a brand-new account: the
// name other members see, and where they trade. Answering them completes
// onboarding, so the room the deal opens (which `proxy.ts` gates on
// `onboarding_completed_at`) lets them in.
//
// NOT the wizard's buy-or-sell step, and not its Stripe Identity step. The deal
// already says whether they are selling, buying or swapping, and Stripe Identity is
// required where money or a hold moves: before a buyer can pay, and before a swap
// can start. See `acceptCashSaleTerms` and `acceptTradeTerms`.

import { withActionLog } from '@/lib/errors/withActionLog';
import { completeOnboarding } from '@/lib/actions/profile';
import { setTradingRegion } from '@/lib/actions/region';
import { fail, ok, type ActionResult } from '@/lib/actions/result';

export type QuickOnboardingError = 'region' | 'display-name';

/**
 * Save the trading region, then the display name, and mark onboarding complete.
 *
 * Region first, because it is the answer that can be refused for a reason the
 * member cannot fix by retyping (a region that is not open, or one pinned to an
 * existing payout account), and a completed onboarding with no region would admit
 * them to rooms whose contracts then refuse them.
 */
export const completeQuickOnboarding = withActionLog(
  'quickOnboarding.completeQuickOnboarding',
  async function completeQuickOnboarding(input: {
    displayName: string;
    regionCode: string;
  }): Promise<ActionResult<{ displayName: string; regionCode: string }, QuickOnboardingError>> {
    const region = await setTradingRegion(input.regionCode);
    if (!region.ok) return fail('region', region.message, 'regionCode');

    const completed = await completeOnboarding(input.displayName);
    if (!completed.ok) return fail('display-name', completed.message, 'displayName');

    return ok({ displayName: completed.data.displayName, regionCode: region.data.regionCode });
  },
);
