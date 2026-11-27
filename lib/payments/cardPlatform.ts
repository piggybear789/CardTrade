import 'server-only';

// lib/payments/cardPlatform.ts
//
// Which Stripe platform a member's saved card is read from or saved to (0179).
//
// A Stripe Customer and its cards belong to ONE platform account. A member's card on
// their own platform lives on `profiles` (`payer_id`, `payment_source_id`). Since a
// buyer may open a cash sale with a seller on ANOTHER platform (an Australian buying a
// US listing, charged in USD on the US platform), the card for that platform lives in
// `platform_payers`, one row per (member, platform).
//
// Not a Server Action: every export of a `'use server'` module is an endpoint, and
// these are helpers for the actions in `lib/actions/payments.ts` and for server pages.

import { createAdminClient } from '@/lib/supabase/admin';
import {
  crossPlatformCashSalesEnabled,
  operationalPlatforms,
} from '@/domain/services';
import { DEFAULT_CONFIG_REGION } from '@/domain/services/stripe/config';
import { normalizeRegionCode, platformRegion, type RegionCode } from '@/domain/region';

/** Where a card request lands: the platform, and whether it is the member's own. */
export interface CardPlatform {
  platform: RegionCode;
  /** True for the member's own platform, whose pair is on `profiles`. */
  home: boolean;
}

/**
 * Which platform's card a request is about.
 *
 * The caller names the platform of the sale or listing (`platformForCurrency` of its
 * currency). The member's own platform is the answer unless that is a DIFFERENT
 * platform, cross-platform cash sales are switched on, and the platform is
 * operational. Anything else falls back to the home platform, which is the behaviour
 * before 0179, so a forged or stale value cannot reach a platform we do not run. The
 * worst a caller can do is save their own card on a platform they then cannot buy on.
 *
 * @param memberRegion the member's `profiles.region_code`
 * @param requested a PLATFORM code from the client, or nothing
 */
export function cardPlatformFor(
  memberRegion: string | null | undefined,
  requested: string | null | undefined,
): CardPlatform {
  const homePlatform = platformRegion(memberRegion) ?? DEFAULT_CONFIG_REGION;
  const asked = normalizeRegionCode(requested);
  if (
    !asked ||
    platformRegion(asked) !== asked ||
    asked === homePlatform ||
    !crossPlatformCashSalesEnabled() ||
    !operationalPlatforms().has(asked)
  ) {
    return { platform: homePlatform, home: true };
  }
  return { platform: asked, home: false };
}

/**
 * Whether the member has a card saved for purchases on `platform`, from the database
 * alone (no provider call), for a server page deciding whether to ask for one.
 */
export async function hasSavedCardFor(profileId: string, platform: string | null): Promise<boolean> {
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from('profiles')
    .select('payment_source_id, region_code')
    .eq('id', profileId)
    .maybeSingle();
  if (!profile) return false;
  const target = cardPlatformFor(profile.region_code as string | null, platform);
  if (target.home) return Boolean(profile.payment_source_id);
  const { data: away } = await admin
    .from('platform_payers')
    .select('payment_source_id')
    .eq('profile_id', profileId)
    .eq('platform', target.platform)
    .maybeSingle();
  return Boolean(away?.payment_source_id);
}
