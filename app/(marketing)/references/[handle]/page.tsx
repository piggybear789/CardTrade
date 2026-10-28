import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { IdentityReturnRefresh } from '@/components/identity/IdentityReturnRefresh';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';
import { cachedReferencePage } from '@/lib/references/graph';
import { HandleChooser } from '@/components/references/HandleChooser';
import { ReferenceProfile } from '@/components/references/ReferenceProfile';
import { satisfiesIdentityGate, type IdentityCheckStatus } from '@/domain/identity/identityGate';
import { referenceHref } from '@/domain/references/address';

// app/(marketing)/references/[handle]/page.tsx
//
// One person's references (0155): `/references/<handle>?on=<platform>`, or by id. A bare
// handle that more than one person goes by asks which one is meant (`HandleChooser`).

type SearchParams = Promise<{ on?: string | string[]; experience?: string | string[] }>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Who is looking: their id, whether they have passed the ID check, and whether they moderate. */
async function loadViewer(): Promise<{ id: string | null; identityVerified: boolean; isAdmin: boolean }> {
  const user = await getCachedAuthUser();
  if (!user) return { id: null, identityVerified: false, isAdmin: false };
  const { data: profile } = await createAdminClient()
    .from('profiles')
    .select('identity_check_status, is_admin')
    .eq('id', user.id)
    .maybeSingle();
  return {
    id: user.id,
    identityVerified: satisfiesIdentityGate({
      identityCheckStatus: (profile?.identity_check_status ?? 'NONE') as IdentityCheckStatus,
    }),
    isAdmin: Boolean(profile?.is_admin),
  };
}

/**
 * Titles, canonical address and indexing for a references page. Built from the same
 * cached graph the page renders, so it costs no extra reads.
 *
 * INDEX ONLY WHAT SAYS SOMETHING. Any well-formed handle has a page, so an address made
 * up in a URL would otherwise be an indexable page titled with whatever was typed. A page
 * is indexed only when it is a member's or carries at least one reference; a handle
 * nobody has referenced, a "which one?" chooser and a bad address are `noindex`. The
 * canonical drops `?experience=1`, which opens the composer, and keeps `?on=`.
 */
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>;
  searchParams: SearchParams;
}): Promise<Metadata> {
  const [{ handle }, query] = await Promise.all([params, searchParams]);
  const page = await cachedReferencePage(handle, first(query.on) ?? null).catch(() => null);
  const noindex = { index: false, follow: true } as const;
  if (!page) return { title: 'References · NoDitto', robots: noindex };
  if (page.kind === 'choose') {
    return {
      title: `@${page.handle} · References · NoDitto`,
      description: `More than one person goes by @${page.handle}. Choose who you mean.`,
      robots: noindex,
    };
  }
  const { centre } = page.graph;
  const label = centre.handle;
  const said = centre.peopleCount + centre.neutralCount + centre.negativeCount;
  return {
    title: `${label} · References · NoDitto`,
    description:
      centre.peopleCount > 0
        ? `${centre.peopleCount} ID-verified ${centre.peopleCount === 1 ? 'person vouches' : 'people vouch'} for ${label}.`
        : `References for ${label} from ID-verified traders.`,
    alternates: { canonical: referenceHref(centre.address) },
    ...(centre.profileId === null && said === 0 ? { robots: noindex } : {}),
  };
}

export default async function HandleReferencePage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>;
  searchParams: SearchParams;
}) {
  const [{ handle }, query] = await Promise.all([params, searchParams]);
  const experience = first(query.experience);
  const [page, viewer] = await Promise.all([
    cachedReferencePage(handle, first(query.on) ?? null),
    loadViewer(),
  ]);
  if (!page) notFound();

  if (page.kind === 'choose') {
    return (
      <article className="mx-auto flex w-full max-w-[clamp(64rem,70vw,96rem)] flex-1 flex-col px-group py-section sm:px-6 md:py-10">
        <HandleChooser
          handle={page.handle}
          choices={page.choices}
          params={experience === '1' ? { experience: '1' } : {}}
        />
      </article>
    );
  }

  // SCALES WITH THE SCREEN. The column is 64rem up to a 1440px screen and then grows with
  // it (70vw, capped at 96rem), so a large monitor shows the same composition at a larger
  // size rather than a small card in a sea of background. It is a flex column so the
  // Trust Network card fills the height left above the footer.
  return (
    <article className="mx-auto flex w-full max-w-[clamp(64rem,70vw,96rem)] flex-1 flex-col px-group py-section sm:px-6 md:py-10">
      {/* Leaving a reference and a manual claim both send an unverified member through
          the ID check, which returns here with `?identity=complete`. Read the result
          from Stripe now instead of waiting on its webhook, or the page still says
          "not verified" to someone who just was. Renders nothing; `useSearchParams`
          needs the boundary. */}
      <Suspense fallback={null}>
        <IdentityReturnRefresh />
      </Suspense>
      <ReferenceProfile data={page.graph} viewer={viewer} autoOpen={experience === '1'} />
    </article>
  );
}
