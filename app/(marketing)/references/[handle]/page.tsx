import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { IdentityReturnRefresh } from '@/components/identity/IdentityReturnRefresh';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';
import { loadReferencePage } from '@/lib/references/graph';
import { getMyHandleClaim } from '@/lib/actions/references';
import { HandleChooser } from '@/components/references/HandleChooser';
import { ReferenceProfile } from '@/components/references/ReferenceProfile';
import { isUuid } from '@/domain/references/reference';

// app/(marketing)/references/[handle]/page.tsx
//
// One person's references (0155): `/references/<handle>?on=<platform>`, or by id. A bare
// handle that more than one person goes by asks which one is meant (`HandleChooser`).

type SearchParams = Promise<{ on?: string | string[]; experience?: string | string[] }>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function decodeSlug(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const decoded = decodeSlug(handle).replace(/^@/, '');
  const label = isUuid(decoded) ? null : `@${decoded}`;
  return {
    title: label ? `${label} · References · NoDitto` : 'References · NoDitto',
    description: label
      ? `References for ${label} from ID-verified traders.`
      : 'References from ID-verified traders.',
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
  const [page, user] = await Promise.all([
    loadReferencePage(handle, first(query.on) ?? null),
    getCachedAuthUser(),
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

  const { graph } = page;
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
      <ReferenceProfile
        data={graph}
        viewer={{ id: user?.id ?? null, identityVerified: viewerIdentityVerified }}
        autoOpen={experience === '1'}
        initialClaim={myClaim}
      />
    </article>
  );
}
