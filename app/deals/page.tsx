// Compose a private deal. Open to signed-out visitors: the composer asks for an
// account at Get link, after the deal is written, and keeps the draft through the
// sign-in. Bookmarks and the header action land here so the form, and the browser
// Supabase client it uses to upload a photo, stay off the catalog's first load.
//
// A FOCUSED EDITOR, OUTSIDE `(workspace)` ON PURPOSE: no rail and no phone hub bar.
// Creating a link takes the screen, with its own close button and action, the way
// Stripe, Contra and Square build theirs; see `DealComposeForm`. It used to draw the
// form in an always-open dialog over this empty route. The URL is unchanged, so
// `proxy.ts`, `?deal=1` and `DEAL_RESUME_PATH` all still point here.

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { DealComposeForm } from '@/components/deals/DealComposeForm';
import { regionCurrency } from '@/domain/region';
import { getDealInvitePreview } from '@/lib/actions/dealInvites';
import { listSelectableRegions } from '@/lib/actions/regionOptions';
import { DEAL_LINK_PARAM, DEAL_RESUME_PARAM, dealInvitePath } from '@/lib/deals/paths';
import { readIdentityGate } from '@/lib/identityGate';
import { automaticBrowseRegion } from '@/lib/location/resolveRegion';
import { readSellerPayReadiness } from '@/lib/sellerIdentity';
import { getCachedAuthUser, getCachedProfile } from '@/lib/supabase/cachedAuth';

export const metadata: Metadata = {
  title: 'Start a private deal · NoDitto',
  description: 'Sell or swap a card with anyone. Send them a link and agree the details together.',
};

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [user, regions, browse, params] = await Promise.all([
    getCachedAuthUser(),
    listSelectableRegions(),
    automaticBrowseRegion(),
    searchParams,
  ]);
  // AN EXISTING DEAL OF THE HOST'S (?link=<token>): the composer is that deal's own
  // page, the form filled in and the link above the preview. Anyone else holding the
  // address goes to the invite itself, and so does a deal that can no longer change
  // (joined, cancelled, expired), which /t/[token] explains.
  const linkParam = params[DEAL_LINK_PARAM];
  const linkToken = (Array.isArray(linkParam) ? linkParam[0] : linkParam)?.trim() || null;
  const deal = linkToken ? await getDealInvitePreview(linkToken) : null;
  if (linkToken && deal) {
    if (!deal.isHost || deal.status !== 'open' || !deal.editable || !deal.id || !deal.kind) {
      redirect(dealInvitePath(linkToken));
    }
  }
  const createdParam = params.created;

  // Read alongside the profile. The host's standing with Stripe is what the invite's
  // status line says ("Sam hasn't verified with Stripe Identity yet"), so the live
  // preview can say it too: a swap asks for Identity, a sale for Identity and their
  // agreement to show the verified name. Payout setup is not asked for before Pay.
  // A signed-out visitor has done neither.
  const [profile, identityGate, payReadiness] = user
    ? await Promise.all([
        getCachedProfile(user.id),
        readIdentityGate(user.id),
        readSellerPayReadiness(user.id),
      ])
    : [null, null, null];
  const hostReadiness = {
    sale: payReadiness?.state ?? 'identity-needed',
    trade: identityGate?.satisfied ? 'ready' : 'identity-needed',
  } as const;

  // The member's own trading region when they have one. Otherwise the region they
  // browse from, if a deal can be written there, so a guest's price is quoted in the
  // currency they will most likely trade in. This is a starting point for the
  // picker, never a trading region: that is only ever what the member chooses.
  const selectable = new Set(regions.map((region) => region.code));
  const suggestedRegion =
    profile?.region_code ??
    (browse.code && selectable.has(browse.code) ? browse.code : (regions[0]?.code ?? null));

  const resumeParam = params[DEAL_RESUME_PARAM];

  return (
    // KEYED BY THE DEAL, so Get link (which replaces `/deals` with `?link=`) mounts
    // the deal's page fresh: its saved photos, its saved snapshot for Save changes.
    // Carried over, the draft's unsaved photo files would be uploaded again on save.
    <DealComposeForm
      key={linkToken ?? 'new'}
      viewer={{
        signedIn: Boolean(user),
        needsOnboarding: Boolean(user) && (!profile?.onboarding_completed_at || !profile.region_code),
        displayName: profile?.display_name ?? null,
      }}
      regions={regions}
      suggestedRegion={suggestedRegion}
      quoteCurrency={regionCurrency(suggestedRegion) ?? 'aud'}
      resume={(Array.isArray(resumeParam) ? resumeParam[0] : resumeParam) === '1'}
      hostReadiness={hostReadiness}
      existing={
        deal && deal.id && deal.kind && deal.editable && linkToken
          ? {
              inviteId: deal.id,
              token: linkToken,
              kind: deal.kind,
              editable: deal.editable,
              expiresAt: deal.expiresAt,
              readiness: deal.hostReadiness,
              justCreated: (Array.isArray(createdParam) ? createdParam[0] : createdParam) === '1',
            }
          : null
      }
    />
  );
}
