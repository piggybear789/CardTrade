import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { referenceHref } from '@/domain/references/address';
import { parseReferenceLookupInput, referencesSearchHref } from '@/domain/references/lookup';

// app/(marketing)/references/check/page.tsx
//
// Legacy redirect shim: there is no separate check page anymore. Handles route straight
// to their unified `/references/[handle]` profile page, and non-handle lookups (names,
// numeric FB IDs) render inline on `/references?q=...`.

export const metadata: Metadata = {
  title: 'References · NoDitto',
  robots: { index: false, follow: true },
};

type SearchParams = Promise<{
  q?: string | string[];
  location?: string | string[];
  fb?: string | string[];
  handle?: string | string[];
}>;

function first(value: string | string[] | undefined): string {
  const v = Array.isArray(value) ? value[0] : value;
  return (v ?? '').trim();
}

export default async function ReferenceBackgroundCheckPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const query = await searchParams;
  const q = first(query.q);
  const location = first(query.location);
  const fb = first(query.fb);
  const handle = first(query.handle);

  if (!q && !fb && !handle) {
    redirect('/references');
  }

  if (q && !fb && !handle) {
    const parsed = parseReferenceLookupInput(q);
    if (parsed?.kind === 'handle' && !parsed.isNumericFbId) {
      redirect(referenceHref({ slug: parsed.handle, on: parsed.platform }, { check: '1' }));
    }
  }

  redirect(
    referencesSearchHref({
      q: q || null,
      location: location || null,
      fb: fb || null,
      handle: handle || null,
    }),
  );
}
