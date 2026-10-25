import type { Metadata } from 'next';
import { Suspense } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ShieldCheckIcon, UserCheck01Icon } from '@hugeicons/core-free-icons';

import { IdentityReturnRefresh } from '@/components/identity/IdentityReturnRefresh';
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

// The two rules that make a reference worth reading. The first is enforced by
// `giveReference` (identity-unverified). The SECOND IS NOT YET: negatives go live
// immediately (0155 records "no staff review on either sentiment"). Build the review
// queue or change this copy before relying on it.
const TRUST_POINTS = [
  { icon: UserCheck01Icon, label: 'ID-verified references only' },
  { icon: ShieldCheckIcon, label: 'Negatives checked' },
] as const;

export default async function ReferencesPage() {
  const initial = await searchReferences('').catch(() => null);
  const initialSuggestions = initial && initial.ok ? initial.data : null;

  // SCALES WITH THE SCREEN. Every size on this page is a `clamp()` of the viewport width:
  // fixed at its phone value up to a laptop, then growing with the screen, so a large
  // monitor shows the same composition larger instead of a small block near the top.
  // The block sits a little above the vertical middle of the space above the footer,
  // and the bottom padding keeps room for the suggestion list that opens under the search.
  //
  // PHONES CENTRE THE WHOLE BLOCK, LIST INCLUDED. From `sm` the suggestion list floats
  // over the page, so the bottom padding reserves room for it. On a phone the list sits
  // in the page flow under the search, so it is part of the block being centred and
  // nothing needs reserving: equal padding top and bottom, and `justify-center` splits
  // the leftover height evenly instead of leaving it all under the list.
  return (
    <div className="relative flex flex-1 flex-col">
      {/* The onboarding wizard's "I'm adding a reference" path returns here from the ID
          check (`?identity=complete`). Read the result from Stripe now rather than
          waiting on its webhook. Renders nothing. */}
      <Suspense fallback={null}>
        <IdentityReturnRefresh />
      </Suspense>
      <article className="relative mx-auto flex w-full max-w-[clamp(48rem,55vw,72rem)] flex-1 flex-col justify-center px-group py-section sm:px-6 sm:pt-[clamp(3rem,8vh,7rem)] sm:pb-[clamp(18rem,32vh,26rem)]">
        <header className="mx-auto max-w-[clamp(42rem,48vw,64rem)] text-center">
          {/* The platform marks lead the block, so they carry real size; the glyph
              inside each chip scales with it (`[&_svg]`). */}
          <div className="mx-auto inline-flex items-center gap-[clamp(0.5rem,0.7vw,0.875rem)]" aria-label="Supported platforms">
            {PLATFORMS.map((slug) => (
              <PlatformChip
                key={slug}
                slug={slug}
                className="size-[clamp(2.5rem,2.9vw,3.5rem)] bg-card shadow-2xs [&_img]:size-[55%] [&_svg]:size-[55%]"
              />
            ))}
          </div>

          {/* One line from a small tablet up; `text-balance` lets it break evenly on the
              narrowest phones rather than overflow. */}
          {/* PHONE: 32px. The clamp's 24px floor is sized for a laptop column and read
              as body-ish on a phone, where this line is the page's only heading. It
              breaks onto two balanced lines at 375px. */}
          <h1 className="mt-[clamp(1.25rem,1.6vw,2rem)] text-balance text-[clamp(1.5rem,2.6vw,3rem)] font-semibold leading-[1.15] tracking-tight text-foreground max-sm:text-[2rem]">
            References, all in one place
          </h1>

          <p className="mx-auto mt-[clamp(0.5rem,0.7vw,0.875rem)] max-w-[clamp(28rem,34vw,40rem)] text-pretty text-[clamp(0.875rem,0.95vw,1.0625rem)] text-muted-foreground">
            Look up any handle to see their references across every platform.
          </p>
        </header>

        {/* WHY THE REFERENCES CAN BE TRUSTED: one quiet row of small icon + label
            items, the hero pattern on Rentalcars and Pin (Mobbin), not cards. ABOVE the
            search, because below it the suggestion list (open from first load) would
            cover it. Wraps to two lines on a phone. */}
        <ul
          aria-label="How references are kept honest"
          className="mx-auto mt-[clamp(1rem,1.3vw,1.5rem)] flex flex-wrap items-center justify-center gap-x-[clamp(1rem,1.6vw,2rem)] gap-y-snug"
        >
          {TRUST_POINTS.map((point) => (
            <li
              key={point.label}
              className="inline-flex items-center gap-1.5 text-[clamp(0.8125rem,0.85vw,0.9375rem)] font-medium text-muted-foreground"
            >
              <HugeiconsIcon icon={point.icon} className="size-4 shrink-0 text-trust" aria-hidden />
              {point.label}
            </li>
          ))}
        </ul>

        <div className="mt-[clamp(1.25rem,1.8vw,2.25rem)]">
          <ReferenceSearch initialSuggestions={initialSuggestions} />
        </div>
      </article>
    </div>
  );
}
