'use server';

// lib/actions/region.ts
//
// Region Server Actions. Two of them, for the two region values, and they are
// deliberately not interchangeable:
//
//   * `setBrowseRegion`  — a display preference. Writes a cookie. No gate.
//   * `setTradingRegion` — `profiles.region_code`, which the contract guards read
//     and which must agree with the member's Stripe Connect account country.
//
// Nothing here ever writes a trading region from an IP address. See
// `domain/region/regions.ts` for why, and `lib/location/resolveRegion.ts` for
// where the guess is allowed to be used instead.

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';

import { createClient } from '@/lib/supabase/server';
import { fail, ok, type ActionResult } from '@/lib/actions/result';
import {
  REGION_COOKIE,
  regionCookieOptions,
} from '@/lib/location/resolveRegion';
import {
  isTradingRegion,
  normalizeRegionCode,
  regionLabel,
  type RegionCode,
} from '@/domain/region';

/** Why a browse-region preference was refused. */
export type SetBrowseRegionError = 'invalid-region';

/** Why a trading region could not be set. */
export type SetTradingRegionError =
  | 'not-authenticated'
  | 'invalid-region'
  /** The region exists but the platform cannot settle deals there yet. */
  | 'region-not-enabled'
  /** A Connect account already pins the region to its country. */
  | 'region-locked'
  | 'persistence-error';

/**
 * Remember which region's listings to show.
 *
 * A preference, not a capability: no authentication, no Identity_Gate, and it has
 * no bearing on what the caller may transact. Signed-in members are resolved from
 * their profile first anyway (see `resolveBrowseRegion`), so this mainly serves
 * anonymous visitors and members deliberately looking at another region.
 *
 * Clearing is supported by passing null — that returns the visitor to the IP guess
 * rather than pinning them to a default.
 */
export async function setBrowseRegion(
  regionCode: string | null,
): Promise<ActionResult<{ regionCode: RegionCode | null }, SetBrowseRegionError>> {
  const cookieStore = await cookies();

  if (regionCode == null) {
    cookieStore.delete(REGION_COOKIE);
    revalidatePath('/listings');
    return ok({ regionCode: null });
  }

  const normalized = normalizeRegionCode(regionCode);
  if (!normalized) {
    return fail('invalid-region', 'That is not a region we list.');
  }

  cookieStore.set(REGION_COOKIE, normalized, regionCookieOptions());
  revalidatePath('/listings');
  return ok({ regionCode: normalized });
}

/**
 * Set the jurisdiction the caller transacts in.
 *
 * WRITE-ONCE IN PRACTICE. Changing it after Connect onboarding would leave
 * `profiles.region_code` disagreeing with the country on the member's connected
 * account, and a transfer to an account registered elsewhere fails — so a member
 * who has already onboarded is refused here and has to go through support. That is
 * a smaller cost than a payout that fails after goods have shipped.
 *
 * Only regions with `tradingEnabled` are accepted. Letting a member select a region
 * the platform cannot settle in would badge them as ready to trade and then refuse
 * every contract they opened, which is the shape of the 0060 mistake: a state that
 * looks complete and is not.
 */
export async function setTradingRegion(
  regionCode: string,
): Promise<ActionResult<{ regionCode: RegionCode }, SetTradingRegionError>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail('not-authenticated', 'Sign in to set your region.');

  const normalized = normalizeRegionCode(regionCode);
  if (!normalized) {
    return fail('invalid-region', 'Choose where you are trading from.');
  }
  if (!isTradingRegion(normalized)) {
    return fail(
      'region-not-enabled',
      `${regionLabel(normalized)} is not open for deals yet. You can browse listings there, but not buy or trade.`,
    );
  }

  const { data: existing } = await supabase
    .from('profiles')
    .select('region_code, merchant_ref')
    .eq('id', user.id)
    .maybeSingle();

  // Already correct: succeed rather than reporting a conflict, so re-running
  // onboarding is idempotent.
  if (existing?.region_code === normalized) {
    return ok({ regionCode: normalized });
  }

  // A connected account exists, so the region is pinned to its country.
  if (existing?.merchant_ref && existing.region_code) {
    return fail(
      'region-locked',
      'Your region is tied to your payout account. Contact support to change it.',
    );
  }

  // RLS restricts this to the caller's own row; the explicit `eq` keeps the
  // guarantee visible at the call site, per the enforce-twice convention.
  const { error } = await supabase
    .from('profiles')
    .update({ region_code: normalized })
    .eq('id', user.id);

  if (error) {
    return fail('persistence-error', 'Your region could not be saved. Please retry.');
  }

  revalidatePath('/profile');
  revalidatePath('/listings');
  return ok({ regionCode: normalized });
}
