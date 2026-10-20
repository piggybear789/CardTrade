import type { Metadata } from 'next';

import { PlatformChip } from '@/components/references/referenceLabels';
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

const PLATFORMS = ['instagram', 'facebook', 'discord', 'whatnot', 'ebay', 'noditto'] as const;

export default async function ReferencesPage() {
  const initial = await searchReferences('').catch(() => null);
  const initialSuggestions = initial && initial.ok ? initial.data : [];

  return (
    <div className="relative flex flex-1 flex-col">
      <article className="relative mx-auto w-full max-w-3xl px-group pt-12 pb-72 sm:px-6 sm:pt-16 md:pt-20 md:pb-80">
        <header className="mx-auto max-w-2xl text-center">
          <div className="mx-auto inline-flex items-center gap-1.5" aria-label="Supported platforms">
            {PLATFORMS.map((slug) => (
              <PlatformChip key={slug} slug={slug} className="size-7 bg-card shadow-2xs" />
            ))}
          </div>

          <h1 className="mt-4 text-balance text-[2rem] font-semibold tracking-tight text-foreground sm:text-[2.75rem] sm:leading-[1.1]">
            Check their references before you buy, sell, or trade.
          </h1>

          <p className="mx-auto mt-3 max-w-lg text-pretty text-body text-muted-foreground sm:text-[1.0625rem]">
            Look up any handle to see their references across every platform, or leave them a reference.
          </p>
        </header>

        <div className="mt-8">
          <ReferenceSearch initialSuggestions={initialSuggestions} />
        </div>
      </article>
    </div>
  );
}
