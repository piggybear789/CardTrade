import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowLeft01Icon, CheckmarkCircle02Icon, UserCheck01Icon } from '@hugeicons/core-free-icons';

import { IdentityReturnRefresh } from '@/components/identity/IdentityReturnRefresh';
import { BackgroundCheckPanel } from '@/components/references/BackgroundCheckPanel';
import { ReferenceOrbit } from '@/components/references/ReferenceOrbit';
import { PlatformChip } from '@/components/references/referenceLabels';
import { ReferenceSearch } from '@/components/references/ReferenceSearch';
import { referenceHref } from '@/domain/references/address';
import { parseReferenceLookupInput } from '@/domain/references/lookup';
import { MOST_REFERENCED_ROWS, byMostReferenced } from '@/lib/references/ranking';
import { cachedTopPeople } from '@/lib/references/search';

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
  { icon: CheckmarkCircle02Icon, label: 'Good and bad experiences shown' },
] as const;

// A soft violet light behind the search, the brand's only wash on this page. `closest-side`
// makes it fade to nothing exactly at its box's edge, and the stops ease out, so there is
// no visible rim or banding where it ends (a single linear stop drew an oval edge).
const GLOW =
  'radial-gradient(closest-side, hsl(var(--iris) / 0.12), hsl(var(--iris) / 0.08) 35%, hsl(var(--iris) / 0.035) 65%, hsl(var(--iris) / 0.01) 85%, transparent)';

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

export default async function ReferencesPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const sp = searchParams ? await searchParams : {};
  const q = first(sp.q);
  const location = first(sp.location);
  const fb = first(sp.fb);
  const secondaryHandle = first(sp.handle);
  const hasLookup = Boolean(q || fb || secondaryHandle);

  // If the lookup is a handle or non-numeric social URL, land straight on its unified
  // `/references/[handle]` profile page instead of duplicating it here.
  if (q && !fb && !secondaryHandle) {
    const parsed = parseReferenceLookupInput(q);
    if (parsed?.kind === 'handle' && !parsed.isNumericFbId) {
      redirect(referenceHref({ slug: parsed.handle, on: parsed.platform }, { check: '1' }));
    }
  }

  // Read straight from the shared cache, not through the search action: rendering the
  // page must not spend a visitor's search allowance. A failure renders the list's
  // honest "Look someone up" state instead of claiming there are no references.
  const people = await cachedTopPeople().catch(() => null);
  const ranked = people ? [...people].sort(byMostReferenced) : null;

  // Non-handle lookups (e.g. Facebook Marketplace names, numeric FB IDs) render right
  // on `/references` beneath the unified search bar — no separate `/references/check` page.
  if (hasLookup) {
    return (
      <div className="relative flex flex-1 flex-col">
        <Suspense fallback={null}>
          <IdentityReturnRefresh />
        </Suspense>
        <article className="mx-auto flex w-full max-w-[clamp(64rem,70vw,96rem)] flex-1 flex-col gap-group px-group py-section sm:px-6 md:py-10">
          <div className="flex flex-col gap-cozy">
            <div className="flex items-center justify-between gap-2">
              <Link
                href="/references"
                className="inline-flex items-center gap-1.5 text-meta font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <HugeiconsIcon icon={ArrowLeft01Icon} className="size-3.5" aria-hidden />
                All references
              </Link>
              <h1 className="sr-only">References lookup for {q || secondaryHandle || fb}</h1>
            </div>
            <ReferenceSearch
              initialSuggestions={ranked}
              initialQuery={q || secondaryHandle || fb}
              compact
            />
          </div>

          <BackgroundCheckPanel
            key={`inline-${q}-${fb}-${secondaryHandle}`}
            mode="search"
            initialQuery={q}
            initialLocation={location}
            initialFacebookUrl={fb}
            initialSecondaryHandle={secondaryHandle}
            autoRun
          />
        </article>
      </div>
    );
  }

  // The faces around the search are the people AFTER the list's rows, so nobody appears
  // twice, and only those with a photo.
  const orbit = (ranked ?? []).slice(MOST_REFERENCED_ROWS).filter((person) => Boolean(person.avatarPath));

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
  //
  // PHONE TOP PADDING FOLLOWS THE SCREEN HEIGHT. A fixed 2rem left the block hugging the
  // top with a wide gap above the bar on a tall phone. `50svh - 19rem` is half the slack
  // left once the block (with its three default suggestion rows) and the bottom bar are
  // placed, minus a little, so the block sits just above the middle. It is still a fixed
  // offset (typing never moves the heading), floors at 2rem on short phones, where there
  // is no slack, and caps at 7rem. `svh`, so the browser toolbar hiding does not shift it.
  //
  // STACKING. The article is its own stacking context (`isolate`). The glow sits under
  // everything in it (`-z-10`), the orbit above the glow (`z-0`), and the hero text and
  // search above the orbit (`z-10`), so neither decoration can ever paint over text.
  return (
    <div className="relative flex flex-1 flex-col overflow-x-clip">
      {/* The onboarding wizard's "I'm adding a reference" path returns here from the ID
          check (`?identity=complete`). Read the result from Stripe now rather than
          waiting on its webhook. Renders nothing. */}
      <Suspense fallback={null}>
        <IdentityReturnRefresh />
      </Suspense>
      <article className="relative isolate mx-auto flex w-full max-w-[clamp(48rem,55vw,72rem)] flex-1 flex-col justify-start px-group pb-section pt-[clamp(2rem,calc(50svh-19rem),7rem)] sm:justify-center sm:px-6 sm:pt-[clamp(3rem,8vh,7rem)] sm:pb-[clamp(18rem,32vh,26rem)]">
        <header className="relative z-10 mx-auto max-w-[clamp(42rem,48vw,64rem)] text-center">
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
            References, <span className="text-iris-ink">all in one place</span>
          </h1>

          <p className="mx-auto mt-[clamp(0.5rem,0.7vw,0.875rem)] max-w-[clamp(28rem,34vw,40rem)] text-pretty text-[clamp(0.875rem,0.95vw,1.0625rem)] text-muted-foreground">
            Look up any handle, eBay seller, or Facebook Marketplace name to check references and see if they&rsquo;re real.
          </p>
        </header>

        {/* WHY THE REFERENCES CAN BE TRUSTED: one quiet row of small icon + label
            items, the hero pattern on Rentalcars and Pin (Mobbin), not cards. ABOVE the
            search, because below it the suggestion list (open from first load) would
            cover it. Wraps to two lines on a phone. */}
        <ul
          aria-label="How references are kept honest"
          className="relative z-10 mx-auto mt-[clamp(1rem,1.3vw,1.5rem)] flex flex-wrap items-center justify-center gap-x-[clamp(1rem,1.6vw,2rem)] gap-y-snug"
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

        {/* The search is the centre of the composition: the glow and the orbit are both
            anchored to this box, so they stay on it at every width and height. On a phone
            the box also holds the in-flow list; the orbit is hidden there. */}
        <div className="relative mt-[clamp(1.25rem,1.8vw,2.25rem)]">
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[clamp(30rem,40vw,48rem)] w-[clamp(40rem,72vw,96rem)] -translate-x-1/2 -translate-y-1/2"
            style={{ backgroundImage: GLOW }}
          />
          <div className="relative z-10">
            <ReferenceSearch initialSuggestions={ranked} />
          </div>
          {/* After the search in the DOM, so a keyboard reaches the search first. */}
          <ReferenceOrbit people={orbit} />
        </div>
      </article>
    </div>
  );
}
