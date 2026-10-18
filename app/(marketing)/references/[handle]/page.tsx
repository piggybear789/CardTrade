import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import { ShieldCheckIcon } from '@hugeicons/core-free-icons';

import { createAdminClient } from '@/lib/supabase/admin';
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';
import { loadHandleReferenceGraph } from '@/lib/references/graph';
import { getMyHandleClaim } from '@/lib/actions/references';
import { ReferenceGraph } from '@/components/references/ReferenceGraph';
import { ShareExperience } from '@/components/references/ShareExperience';
import { ClaimHandle } from '@/components/references/ClaimHandle';
import { TrustedSellerBadge } from '@/components/identity/TrustedSellerBadge';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { regionLabel } from '@/domain/region';
import { formatMonthYear } from '@/lib/format';

// app/(marketing)/references/[handle]/page.tsx
//
// Unified Cross-Platform Reference Profile & Vector Graph (0155).
// Synthesises every deal for `[handle]` across Instagram, Facebook, Discord,
// eBay, Whatnot, In-person, and NoDitto Escrow into one vector network.

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

  const isSelf = Boolean(user && centre.profileId && user.id === centre.profileId);
  const returnPath = `/references/${encodeURIComponent(centre.handleSlug)}`;
  const autoOpen = (Array.isArray(experience) ? experience[0] : experience) === '1';
  const since = formatMonthYear(centre.memberSince);
  const region = centre.regionCode ? regionLabel(centre.regionCode) : null;

  return (
    <article className="mx-auto max-w-5xl px-group py-section sm:px-6 md:py-10">
      {/* Top Breadcrumb */}
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center justify-between">
        <Link
          href="/references"
          className="inline-flex items-center gap-1.5 text-meta font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <span aria-hidden>←</span>
          <span>Search references</span>
        </Link>
        {centre.profileId ? (
          <Link
            href={`/sellers/${centre.profileId}`}
            className="text-meta font-semibold text-iris-ink hover:underline"
          >
            View storefront &amp; listings →
          </Link>
        ) : null}
      </nav>

      {/* Unified Cross-Platform Identity Header Card */}
      <header className="mb-5 rounded-2xl border border-border/90 bg-card p-5 shadow-xs">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3.5">
            <Avatar avatarPath={centre.avatarPath} displayName={centre.name} size="lg" />
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-subhead font-semibold tracking-tight text-foreground md:text-head">
                  {centre.handle}
                </h1>
                {centre.identityVerified ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-trust/10 px-2.5 py-0.5 text-meta font-semibold text-trust">
                    <HugeiconsIcon icon={ShieldCheckIcon} className="size-3.5" aria-hidden />
                    ID verified{centre.firstName ? ` · ${centre.firstName}` : ''}
                  </span>
                ) : null}
                {centre.isTrustedSeller ? (
                  <TrustedSellerBadge trusted size={14} />
                ) : null}
                {centre.unclaimed ? (
                  <span className="rounded-full border border-border bg-muted/60 px-2.5 py-0.5 text-meta font-medium text-muted-foreground">
                    Unclaimed handle
                  </span>
                ) : null}
              </div>

              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-body text-muted-foreground">
                {centre.name !== centre.handle.replace(/^@/, '') ? (
                  <span className="font-medium text-foreground/85">{centre.name}</span>
                ) : null}
                {region ? (
                  <span>
                    {centre.name !== centre.handle.replace(/^@/, '') ? '· ' : ''}
                    {region}
                  </span>
                ) : null}
                {since ? <span>· Since {since}</span> : null}
                {centre.unclaimed ? (
                  <span>
                    Community-referenced handle across platforms. Not yet claimed on NoDitto.
                  </span>
                ) : null}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {centre.profileId ? (
              <Button asChild variant="outline" size="sm" className="h-9 rounded-full px-3.5">
                <Link href={`/sellers/${centre.profileId}`}>Storefront</Link>
              </Button>
            ) : null}
            <ShareExperience
              target={{
                kind: centre.kind,
                id: centre.id,
                profileId: centre.profileId,
                handle: centre.handle,
                handleSlug: centre.handleSlug,
                name: centre.name,
                platform: centre.platforms[0]?.slug ?? 'instagram',
                firstName: centre.firstName,
                identityVerified: centre.identityVerified,
                unclaimed: centre.unclaimed,
              }}
              viewer={{
                signedIn: Boolean(user),
                identityVerified: viewerIdentityVerified,
                isSelf,
              }}
              returnPath={returnPath}
              autoOpen={autoOpen}
            />
          </div>
        </div>
      </header>

      {/* Synthesised Cross-Platform Vector Graph */}
      <ReferenceGraph data={graph} />

      {/* Unclaimed handle claim card (only when unclaimed and a claim row exists) */}
      {centre.unclaimed && centre.claimId ? (
        <div className="mt-5">
          <ClaimHandle
            claimId={centre.claimId}
            handle={centre.handle}
            platformLabel="social"
            signedIn={Boolean(user)}
            identityVerified={viewerIdentityVerified}
            initialClaim={myClaim}
            returnPath={returnPath}
          />
        </div>
      ) : null}
    </article>
  );
}
