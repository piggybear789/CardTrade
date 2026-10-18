import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { createAdminClient } from '@/lib/supabase/admin';
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';
import { loadClaimReferenceGraph } from '@/lib/references/graph';
import { isClaimPlatform, platformLabel } from '@/domain/references/reference';
import { ReferenceGraph } from '@/components/references/ReferenceGraph';
import { ShareExperience } from '@/components/references/ShareExperience';
import { ClaimHandle } from '@/components/references/ClaimHandle';
import { getMyHandleClaim } from '@/lib/actions/references';
import { Button } from '@/components/ui/button';

// app/(marketing)/references/[platform]/[handle]/page.tsx
//
// An unclaimed handle's reference graph (0155). Members vouched for this
// handle before its owner joined NoDitto; the graph exists and is searchable,
// and the owner can claim it later (claim flow reuses the ID check). Once
// claimed, this route redirects to the member's seller profile, where the
// same graph lives.

export const metadata: Metadata = {
  title: 'References · NoDitto',
};

export default async function UnclaimedHandlePage({
  params,
}: {
  params: Promise<{ platform: string; handle: string }>;
}) {
  const { platform, handle } = await params;
  if (!isClaimPlatform(platform)) notFound();

  const admin = createAdminClient();
  const { data: claim } = await admin
    .from('social_claims')
    .select('id, claimed_profile_id')
    .eq('platform', platform)
    .eq('handle_norm', decodeURIComponent(handle).replace(/^@/, '').trim().toLowerCase())
    .maybeSingle();
  if (!claim) notFound();
  if (claim.claimed_profile_id) redirect(`/sellers/${claim.claimed_profile_id}`);

  const [graph, user, myClaim] = await Promise.all([
    loadClaimReferenceGraph(claim.id),
    getCachedAuthUser(),
    getMyHandleClaim(claim.id),
  ]);
  if (!graph) notFound();

  let identityVerified = false;
  if (user) {
    const { data: profile } = await admin
      .from('profiles')
      .select('identity_check_status')
      .eq('id', user.id)
      .maybeSingle();
    identityVerified = profile?.identity_check_status === 'VERIFIED';
  }

  const returnPath = `/references/${platform}/${encodeURIComponent(handle)}`;

  return (
    <article className="mx-auto max-w-5xl px-group py-section sm:px-6 md:py-12">
      <header className="space-y-snug">
        <p className="text-meta font-semibold uppercase tracking-wide text-iris-ink">
          {platformLabel(platform)} · Unclaimed profile
        </p>
        <h1 className="text-head font-semibold tracking-tight text-foreground">
          {graph.centre.handle}
        </h1>
        <p className="max-w-xl text-pretty text-body text-muted-foreground md:text-lead">
          Traders have shared experiences with this handle, but its owner hasn&rsquo;t joined
          NoDitto or claimed it yet, so there&rsquo;s no verified name here.
        </p>
        <div className="max-w-xl pt-snug">
          <ClaimHandle
            claimId={claim.id}
            handle={graph.centre.handle}
            platformLabel={platformLabel(platform)}
            signedIn={Boolean(user)}
            identityVerified={identityVerified}
            initialClaim={myClaim}
            returnPath={returnPath}
          />
        </div>
      </header>

      <div className="mt-section">
        <ReferenceGraph
          data={graph}
          action={
            <ShareExperience
              target={{
                kind: 'claim',
                id: claim.id,
                profileId: null,
                handle: graph.centre.handle,
                name: graph.centre.name,
                platform,
                firstName: null,
                identityVerified: false,
                unclaimed: true,
              }}
              viewer={{
                signedIn: Boolean(user),
                identityVerified,
                isSelf: false,
              }}
              returnPath={returnPath}
            />
          }
        />
      </div>

      <div className="mt-group">
        <Button asChild variant="ghost">
          <Link href="/references">Search someone else</Link>
        </Button>
      </div>
    </article>
  );
}
