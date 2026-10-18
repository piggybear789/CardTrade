import type { Metadata } from 'next';

import { ReferenceSearch } from '@/components/references/ReferenceSearch';
import { searchReferences } from '@/lib/actions/references';

// app/(marketing)/references/page.tsx
//
// References (0155): minimalist SaaS command-palette landing. Search any
// handle and open their unified cross-platform vector graph at
// `/references/[handle]`.

export const metadata: Metadata = {
  title: 'References · NoDitto',
  description:
    'Search a handle and view their cross-platform reference graph from ID-verified traders.',
};

export default async function ReferencesPage() {
  const initial = await searchReferences('').catch(() => null);
  const initialSuggestions = initial && initial.ok ? initial.data : [];

  return (
    <article className="mx-auto max-w-4xl px-group py-section sm:px-6 md:py-16">
      <header className="mx-auto max-w-xl space-y-2.5 text-center">
        <p className="text-meta font-semibold uppercase tracking-widest text-iris-ink">
          Cross-Platform Trust Graph
        </p>
        <h1 className="text-head font-semibold tracking-tight text-foreground md:text-[2.5rem] md:leading-tight">
          Search the handle
        </h1>
        <p className="text-pretty text-body text-muted-foreground">
          One unified reference network across Instagram, Facebook, Discord, eBay, Whatnot, and
          NoDitto. Every experience is backed by a verified ID.
        </p>
      </header>

      <div className="mt-8">
        <ReferenceSearch initialSuggestions={initialSuggestions} />
      </div>
    </article>
  );
}
