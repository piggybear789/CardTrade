import 'server-only';

// lib/references/trackRecord.ts
//
// The accounts on other platforms that belong on a person's references page (0170).
// Two sources, strongest first, merged by username:
//
//   1. OWNER_CLAIMED: the member signed in to the eBay account themselves (the 0155 claim
//      flow writes a `social_claims` row on platform `ebay`). That is proof of ownership no
//      staff note could add to, so it needs no `external_seller_links` row.
//   2. STAFF_CHECKED: an admin confirmed the account belongs to a handle on this page.
//
// A NAME MATCH IS NEVER ENOUGH, so there is no third source: nothing here guesses.
//
// The figures themselves are read live from eBay (`lookupEbayRecord`, cached an hour).
//
// NEVER BREAKS A PAGE. This is an extra on top of the references. A failed read is logged
// and the section is simply absent: a missing track record is honest, and an error screen
// on a seller's references page because a side table failed would not be.

import { logBackgroundFailure } from '@/lib/errors/errorLog';
import { lookupEbayRecord } from '@/lib/references/ebaySeller';
import { rowsOrThrow } from '@/lib/references/people';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  ebayProfileUrl,
  isValidEbayUsername,
  type ExternalLinkProof,
  type ExternalTrackRecord,
} from '@/domain/references/externalSeller';

type Admin = ReturnType<typeof createAdminClient>;

/** More than a few accounts on one person is a list, not a track record. */
const MAX_RECORDS = 3;

export async function loadTrackRecord(
  admin: Admin,
  target: { profileId: string | null; claimIds: readonly string[] },
): Promise<ExternalTrackRecord[]> {
  try {
    const none = { data: [], error: null };
    const [linkResult, ownedResult] = await Promise.all([
      target.claimIds.length > 0
        ? admin
            .from('external_seller_links')
            .select('external_username')
            .eq('platform', 'ebay')
            .eq('status', 'CONFIRMED')
            .in('claim_id', [...target.claimIds])
            .order('decided_at', { ascending: true })
        : Promise.resolve(none),
      target.profileId
        ? admin
            .from('social_claims')
            .select('handle')
            .eq('platform', 'ebay')
            .eq('claimed_profile_id', target.profileId)
            .order('claimed_at', { ascending: true })
        : Promise.resolve(none),
    ]);

    const accounts = new Map<string, { username: string; proof: ExternalLinkProof }>();
    for (const row of rowsOrThrow<{ handle: string }>(ownedResult, 'owned eBay accounts')) {
      if (isValidEbayUsername(row.handle) && !accounts.has(row.handle.toLowerCase())) {
        accounts.set(row.handle.toLowerCase(), { username: row.handle, proof: 'OWNER_CLAIMED' });
      }
    }
    for (const row of rowsOrThrow<{ external_username: string }>(linkResult, 'confirmed eBay links')) {
      if (!accounts.has(row.external_username.toLowerCase())) {
        accounts.set(row.external_username.toLowerCase(), { username: row.external_username, proof: 'STAFF_CHECKED' });
      }
    }

    return await Promise.all(
      Array.from(accounts.values())
        .slice(0, MAX_RECORDS)
        .map(
          async ({ username, proof }): Promise<ExternalTrackRecord> => ({
            platform: 'ebay',
            username,
            profileUrl: ebayProfileUrl(username),
            proof,
            record: await lookupEbayRecord(username),
          }),
        ),
    );
  } catch (error) {
    await logBackgroundFailure({
      name: 'references.trackRecord',
      errorCode: 'TRACK_RECORD_READ_FAILED',
      error,
    });
    return [];
  }
}
