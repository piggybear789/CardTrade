'use server';

// lib/actions/region.ts
//
// Region Server Actions. Three of them, and they are deliberately not
// interchangeable:
//
//   * `setBrowseRegion`     — a display preference. Writes a cookie. No gate.
//   * `setTradingRegion`    — `profiles.region_code`, which the contract guards read
//     and which must agree with the member's Stripe Connect account country.
//   * `joinRegionWaitlist`  — a `region_waitlist` row for a region that is NOT open,
//     plus the browse cookie, so the member lands somewhere with listings. Never
//     touches the trading region: a waitlisted member has none.
//
// Nothing here ever writes a trading region from an IP address. See
// `domain/region/regions.ts` for why, and `lib/location/resolveRegion.ts` for
// where the guess is allowed to be used instead.

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';

import { createClient } from '@/lib/supabase/server';
import { fail, ok, type ActionResult } from '@/lib/actions/result';
import { friendlyWriteFailure } from '@/lib/actions/writeFailure';
import {
  defaultRegion,
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
    revalidatePath('/');
    return ok({ regionCode: null });
  }

  const normalized = normalizeRegionCode(regionCode);
  if (!normalized) {
    return fail('invalid-region', 'That is not a region we list.');
  }

  cookieStore.set(REGION_COOKIE, normalized, regionCookieOptions());
  revalidatePath('/');
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
  revalidatePath('/');
  return ok({ regionCode: normalized });
}

/** Why a waitlist request was refused. */
export type JoinRegionWaitlistError =
  | 'not-authenticated'
  | 'invalid-region'
  /** The region IS open. There is nothing to wait for — choose it instead. */
  | 'region-open'
  | 'persistence-error';

/** What joining tells the caller: the region waited for, and where to browse meanwhile. */
export interface JoinRegionWaitlistData {
  regionCode: RegionCode;
  /** The open region whose listings the member has been pointed at. */
  browseRegion: RegionCode;
}

/**
 * Record that the caller wants NoDitto in a region it is not open in yet.
 *
 * THE THIRD ANSWER TO "WHERE ARE YOU TRADING FROM?". Onboarding used to offer only
 * the regions a member can transact in, so a member anywhere else had to pick one
 * falsely or leave. This lets them say where they really are and go straight to
 * browsing. It writes a `region_waitlist` row and NOTHING to `profiles.region_code`:
 * the trading region is the jurisdiction a payout account is registered in, 0070's
 * trigger refuses one that is not open, and a waitlisted member simply has none —
 * they browse, and every contract guard keeps refusing them until their region opens.
 *
 * Only regions that are NOT open are accepted, and the database trigger says the
 * same (enforce twice): waiting for a region a member could have chosen is a row that
 * means nothing, and would be read as demand later.
 *
 * ALSO PINS THE BROWSE REGION. Without a trading region the catalog resolves through
 * the IP guess, which for this member is the very region that has no listings —
 * "send them to browsing" would land them on an empty page. The browse cookie is a
 * display preference with no gate behind it (see `setBrowseRegion`), so pointing it
 * at the open default costs nothing and gives them a marketplace to look at.
 *
 * Idempotent: joining a list you are already on is a success, not a conflict.
 */
export async function joinRegionWaitlist(
  regionCode: string,
): Promise<ActionResult<JoinRegionWaitlistData, JoinRegionWaitlistError>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail('not-authenticated', 'Sign in to join the waitlist.');

  const normalized = normalizeRegionCode(regionCode);
  if (!normalized) {
    return fail('invalid-region', 'Choose the country you are in.');
  }
  if (isTradingRegion(normalized)) {
    return fail(
      'region-open',
      `${regionLabel(normalized)} is already open for deals — choose it as your region instead.`,
    );
  }

  // RLS confines the insert to the caller's own row (`profile_id = auth.uid()`);
  // `ignoreDuplicates` makes a second join a no-op rather than a unique violation.
  const { error } = await supabase
    .from('region_waitlist')
    .upsert(
      { profile_id: user.id, region_code: normalized },
      { onConflict: 'profile_id,region_code', ignoreDuplicates: true },
    );

  if (error) {
    return fail(
      'persistence-error',
      friendlyWriteFailure(error, 'We could not add you to the waitlist. Please retry.'),
    );
  }

  const browseRegion = defaultRegion();
  const cookieStore = await cookies();
  cookieStore.set(REGION_COOKIE, browseRegion, regionCookieOptions());

  revalidatePath('/');
  return ok({ regionCode: normalized, browseRegion });
}
