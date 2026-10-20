import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { createAdminClient } from '@/lib/supabase/admin';
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';
import { loadHandleReferenceGraph } from '@/lib/references/graph';
import { getMyHandleClaim } from '@/lib/actions/references';
import { ReferenceProfile } from '@/components/references/ReferenceProfile';

// app/(marketing)/references/[handle]/page.tsx
//
// Unified Cross-Platform Reference Profile & Vector Graph (0155).
// Synthesises every deal for `[handle]` across Instagram, Facebook, Discord,
// eBay, Whatnot, and NoDitto Escrow into one vector network.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const decoded = decodeURIComponent(handle).replace(/^@/, '');
  return {
    title: `@${decoded} · References · NoDitto`,
    description: `Cross-platform reference graph and verified trading history for @${decoded} on NoDitto.`,
  };
}

export default async function HandleReferencePage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{ experience?: string | string[] }>;
}) {
  const [{ handle }, { experience }] = await Promise.all([params, searchParams]);
  const [graph, user] = await Promise.all([
    loadHandleReferenceGraph(handle),
    getCachedAuthUser(),
  ]);
  if (!graph) notFound();

  const { centre } = graph;
  const admin = createAdminClient();

  let viewerIdentityVerified = false;
  if (user) {
    const { data: profile } = await admin
      .from('profiles')
      .select('identity_check_status')
      .eq('id', user.id)
      .maybeSingle();
    viewerIdentityVerified = profile?.identity_check_status === 'VERIFIED';
  }

  const myClaim =
    centre.unclaimed && centre.claimId ? await getMyHandleClaim(centre.claimId) : null;

  const autoOpen = (Array.isArray(experience) ? experience[0] : experience) === '1';

  return (
    <article className="mx-auto w-full max-w-5xl px-group py-section sm:px-6 md:py-10">
      <ReferenceProfile
        data={graph}
        viewer={{ id: user?.id ?? null, identityVerified: viewerIdentityVerified }}
        autoOpen={autoOpen}
        initialClaim={myClaim}
      />
    </article>
  );
}
