import type { Metadata } from 'next';
import { Suspense } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { StarIcon, UserCheck01Icon } from '@hugeicons/core-free-icons';

import { IdentityReturnRefresh } from '@/components/identity/IdentityReturnRefresh';
import { PlatformChip } from '@/components/references/referenceLabels';
import { ReferenceSearch } from '@/components/references/ReferenceSearch';
import { cachedTopSuggestions } from '@/lib/references/search';

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

// The two rules that make a reference worth reading, both enforced: only ID-verified
// members can leave one (`giveReference`, identity-unverified), and bad experiences are
// published like good ones, never hidden or netted off. Negatives are NOT pre-checked:
// they publish at once, tied to the author's verified ID, and staff can take one down
// (`admin.removeReference`). Do not claim a review step here.
const TRUST_POINTS = [
  { icon: UserCheck01Icon, label: 'ID-verified references only' },
  { icon: StarIcon, label: 'Good and bad experiences shown' },
] as const;

export default async function ReferencesPage() {
  // Read straight from the shared cache, not through the search action: rendering the
  // page must not spend a visitor's search allowance. A failure renders the list's
  // honest "Look someone up" state instead of claiming there are no references.
  const initialSuggestions = await cachedTopSuggestions().catch(() => null);

  // SCALES WITH THE SCREEN. Every size on this page is a `clamp()` of the viewport width:
  // fixed at its phone value up to a laptop, then growing with the screen, so a large
  // monitor shows the same composition larger instead of a small block near the top.
  // The block sits a little above the vertical middle of the space above the footer,
  // and the bottom padding keeps room for the suggestion list that opens under the search.
  //
  // PHONES TOP-ALIGN. On a phone the suggestion list sits in the page flow under the
  // search and its height follows what is typed (rows, an empty state, the open-handle
  // row). Centred, every keystroke moved the heading and the field being typed in. Top
  // aligned, a changing list moves only what is below it. From `sm` the list floats over
  // the page, so the block centres there and the bottom padding reserves its room.
  return (
    <div className="relative flex flex-1 flex-col">
      {/* The onboarding wizard's "I'm adding a reference" path returns here from the ID
          check (`?identity=complete`). Read the result from Stripe now rather than
          waiting on its webhook. Renders nothing. */}
      <Suspense fallback={null}>
        <IdentityReturnRefresh />
      </Suspense>
      <article className="relative mx-auto flex w-full max-w-[clamp(48rem,55vw,72rem)] flex-1 flex-col justify-start px-group pb-section pt-8 sm:justify-center sm:px-6 sm:pt-[clamp(3rem,8vh,7rem)] sm:pb-[clamp(18rem,32vh,26rem)]">
        <header className="mx-auto max-w-[clamp(42rem,48vw,64rem)] text-center">
          {/* The platform marks lead the block, so they carry real size; the glyph
              inside each chip scales with it (`[&_svg]`). */}
          <div className="mx-auto inline-flex items-center gap-[clamp(0.5rem,0.7vw,0.875rem)]" aria-label="Supported platforms">
            {PLATFORMS.map((slug) => (
              <PlatformChip
                key={slug}
                slug={slug}
                className="size-[clamp(2.5rem,2.9vw,3.5rem)] bg-card shadow-2xs max-sm:size-9 [&_img]:size-[55%] [&_svg]:size-[55%]"
              />
            ))}
          </div>

          {/* One line from a small tablet up; `text-balance` lets it break evenly on the
              narrowest phones rather than overflow. */}
          {/* PHONE: 28px. The clamp's 24px floor is sized for a laptop column and read
              as body-ish on a phone, where this line is the page's only heading; 32px
              pushed the search below the fold on a short phone once the block was
              top-aligned. It breaks onto two balanced lines at 375px. */}
          <h1 className="mt-[clamp(1.25rem,1.6vw,2rem)] text-balance text-[clamp(1.5rem,2.6vw,3rem)] font-semibold leading-[1.15] tracking-tight text-foreground max-sm:mt-4 max-sm:text-[1.75rem]">
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
