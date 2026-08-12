// app/page.tsx
//
// NoDitto landing page. Presents one concrete, collateral-backed trade so
// collectors can understand the clearinghouse before entering the marketplace.

import Link from 'next/link';
import { ArrowRight, Check, X } from 'lucide-react';

import { LogoMark } from '@/components/layout/Logo';

import { ListingCarousel } from '@/components/listings/ListingCarousel';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { searchCatalog } from '@/lib/actions/listings';
import { createClient } from '@/lib/supabase/server';
import { resolveBrowseRegion } from '@/lib/location/resolveRegion';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components

// Reads the authenticated user's session, so render dynamically.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'NoDitto',
  description:
    'Buy, sell, and swap high-value collectibles. Sellers are identity-verified through Stripe, swaps are backed by collateral from both traders, and buyers are protected until they approve.',
};

export default async function HomePage() {
  const supabase = await createClient();
  // The landing carousel is region-scoped for the same reason the catalog is: an
  // unscoped preview is a shop window of items the visitor cannot buy, and the
  // contract guards would refuse every one of them.
  const region = await resolveBrowseRegion();
  const [authResult, catalogResult] = await Promise.all([
    supabase.auth.getUser(),
    searchCatalog({ sort: 'newest', pageSize: 12, regionCode: region.code }),
  ]);
  const user = authResult.data.user;
  const previewItems = catalogResult.ok ? catalogResult.items : [];
  const isAuthenticated = Boolean(user);
  // Deals are withdrawn (Req 12): a private deal was a Trade negotiated in its own
  // room, which is what opening a trade offer now does.
  const tradeHref = isAuthenticated ? '/trades' : '/sign-up';

  return (
    // ALL ONE SURFACE. The page used to alternate obsidian hero, light listings
    // section, obsidian comparison — three bands with two hard seams, and the
    // marquee landed on the seam. One dark surface end to end lets the card wall
    // bleed out of the hero instead of starting a new section, which is the whole
    // point of putting it there.
    <div className="flex flex-col bg-obsidian text-parchment">
      {/* Clip only the horizontal axis: decorative layers can bleed sideways,
          but vertical clipping would eat focus rings at section edges. */}
      <main className="flex-1 overflow-x-clip">
        <section className="relative isolate overflow-hidden">
          <div
            className="pointer-events-none absolute inset-0 opacity-35 [background-image:linear-gradient(rgba(227,192,106,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(227,192,106,0.08)_1px,transparent_1px)] [background-size:4rem_4rem] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]"
            aria-hidden="true"
          />
          {/* CENTRED HERO. The card wall below carries the visual weight, using
              listings that actually exist — the hero stays clean copy and CTAs. */}
          <div className="relative mx-auto max-w-7xl px-6 pb-20 pt-24 sm:pt-28 lg:px-24 lg:pt-36">
            <div className="mx-auto max-w-2xl text-center">
              <p className="market-label text-ditto">Safety-first trading</p>
              <h1 className="mt-5 text-balance font-display text-5xl font-semibold leading-[1.02] tracking-[-0.04em] text-parchment sm:text-6xl lg:text-7xl">
                A marketplace without{' '}
                <span className="text-parchment/45">imposters.</span>
              </h1>
              <p className="mx-auto mt-6 max-w-xl text-base leading-6 text-parchment/65 sm:text-lg sm:leading-7">
                Buy from verified sellers with confirmed identities.
                <br />
                Trade with strangers backed by collateral and full disclosure.
                <br />
                Zero tolerance for imposters or fraudulent activity.
              </p>
              <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
                <Button
                  asChild
                  size="lg"
                  className="border-parchment/20 bg-parchment text-obsidian hover:bg-parchment/90"
                >
                  <Link href="/listings">
                    Browse Marketplace
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="border-parchment/20 bg-white/[0.03] text-parchment shadow-none backdrop-blur-sm hover:border-parchment/40 hover:bg-white/[0.07] hover:text-parchment"
                >
                  <Link href={tradeHref}>Start a Trade</Link>
                </Button>
              </div>

              <ul className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs font-medium text-parchment sm:text-sm">
                <li className="flex items-center gap-1.5">
                  <Check className="size-3.5 shrink-0 text-trust" aria-hidden="true" />
                  Sellers verified via Stripe Identity
                </li>
                <li className="flex items-center gap-1.5">
                  <Check className="size-3.5 shrink-0 text-trust" aria-hidden="true" />
                  Flat 5% Fee
                </li>
              </ul>
            </div>
          </div>

          {/* THE CARD WALL — a full-bleed marquee of real listings that gives the
              hero visual weight without stock art. */}
          {previewItems.length > 0 ? (
            <div className="relative py-8">
              {/* Edge fades — the carousel floats into the background rather than
                  cutting off at a hard edge. Mirrors the reference landing page. */}
              <div
                className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-obsidian to-transparent"
                aria-hidden="true"
              />
              <div
                className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-obsidian to-transparent"
                aria-hidden="true"
              />
              <ListingCarousel items={previewItems} />
            </div>
          ) : (
            <div className="mx-auto max-w-7xl px-6 pb-14 lg:px-24">
              <EmptyState
                title="No Public Listings Yet"
                description="You can still make a protected deal with another collector."
                action={{ label: 'Start a Trade', href: tradeHref }}
                titleAs="h2"
                compact
                className="border-white/10 bg-white/[0.02]"
              />
            </div>
          )}
        </section>

        {/* A slightly lifted surface, not a second colour. All-black end to end left the
            page with no rhythm at all — every section looked like the same section. One
            step of elevation is enough to separate them without reinstating the hard
            light/dark seam this replaced. */}
        <section
          aria-labelledby="why-noditto"
          className="border-t border-white/10 bg-white/[0.02]"
        >
          <div className="mx-auto grid max-w-7xl gap-12 px-6 py-16 lg:grid-cols-[0.8fr_1.2fr] lg:items-center lg:gap-20 lg:px-24 lg:py-24">
            <header className="max-w-xl">
              <p className="market-label text-gold">Why NoDitto</p>
              <h2
                id="why-noditto"
                className="mt-3 text-balance font-sans text-4xl font-semibold leading-[1.08] tracking-[-0.03em] sm:text-5xl"
              >
                Know who you&apos;re dealing with.
              </h2>
              <p className="mt-5 text-pretty leading-7 text-parchment/60">
                DittoShield verifies identity through Stripe. Contracts show the
                terms, collateral, and next action before anything moves.
              </p>
            </header>

            <div className="border-t border-parchment/15">
              {/* Below `sm` the rows stack and carry their own inline
                  "Elsewhere:"/"Us:" labels, so a column-header row has nothing
                  to line up with — hide it entirely. */}
              <div className="market-label hidden gap-x-6 border-b border-parchment/15 py-3 text-parchment/60 sm:grid sm:grid-cols-[1.1fr_1fr_1fr]">
                <span aria-hidden="true" />
                <span className="text-center">Typical marketplace</span>
                <span className="text-center text-gold">NoDitto</span>
              </div>
              <ComparisonRow
                aspect="Card-for-card swaps"
                typical="Trust and hope"
                ours="Backed by locked collateral"
              />
              <ComparisonRow
                aspect="Who you're dealing with"
                typical="Anonymous accounts"
                ours="DittoShield identity status"
              />
              {/* Was "Contract-backed collateral protection", which is not what happens
                  when a CASH SALE goes wrong — those carry no collateral. What actually
                  happens on every contract type is that funds stop moving and a person
                  decides, which is a stronger claim and a true one. */}
              <ComparisonRow
                aspect="If a deal goes wrong"
                typical="“Sort it out yourselves”"
                ours="Funds frozen, reviewed by support"
              />
              <ComparisonRow
                aspect="Mixing cash and cards"
                typical="Meetups and PayPal F&F"
                ours="One contract with Stripe"
              />
            </div>
          </div>
        </section>
      </main>
      <footer className="border-t border-white/10">
        <div className="mx-auto grid max-w-7xl gap-8 px-6 py-10 text-sm md:grid-cols-[1fr_auto] md:items-start lg:px-24">
          <div className="max-w-xl">
            <div className="flex items-center gap-2 font-display text-lg font-semibold">
              <LogoMark className="size-6" />
              <span translate="no">NoDitto</span>
            </div>
            <p className="mt-2 text-pretty leading-6 text-parchment/55">
              Safer contracts for trading cards, coins, stamps, comics, and memorabilia.
            </p>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-3">
            <Link
              className="rounded-sm text-parchment/60 hover:text-parchment focus:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-obsidian"
              href="/listings"
            >
              Marketplace
            </Link>
            <Link
              className="rounded-sm text-parchment/60 hover:text-parchment focus:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-obsidian"
              href="/trades"
            >
              Trades
            </Link>
            <Link
              className="rounded-sm text-parchment/60 hover:text-parchment focus:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-obsidian"
              href="/profile/payouts#identity"
            >
              DittoShield
            </Link>
          </nav>
          <p className="border-t border-white/10 pt-5 text-xs leading-5 text-parchment/45 md:col-span-2">
            Demo card imagery provided by the{' '}
            <a
              href="https://docs.pokemontcg.io/"
              target="_blank"
              rel="noreferrer"
              className="underline decoration-gold/50 underline-offset-4 hover:text-parchment"
            >
              Pokémon TCG API
            </a>
            . Pokémon names and artwork belong to their respective owners. NoDitto is not
            affiliated with or endorsed by The Pokémon Company. Payments are processed by
            Stripe.
          </p>
        </div>
      </footer>
    </div>
  );
}

function ComparisonRow({
  aspect,
  typical,
  ours,
}: {
  aspect: string;
  typical: string;
  ours: string;
}) {
  return (
    <div className="grid gap-2 border-b border-parchment/15 py-5 sm:grid-cols-[1.1fr_1fr_1fr] sm:items-center sm:gap-6">
      <h3 className="text-sm font-semibold">{aspect}</h3>
      <p className="flex items-center gap-2 text-sm text-parchment/60">
        <X className="size-4 shrink-0 text-parchment/45" aria-hidden="true" />
        <span>
          <span className="market-label mr-1.5 text-parchment/50 sm:hidden">
            Elsewhere:
          </span>
          {typical}
        </span>
      </p>
      <p className="flex items-center gap-2 text-sm font-medium">
        <Check className="size-4 shrink-0 text-trust" aria-hidden="true" />
        <span>
          <span className="market-label mr-1.5 text-gold sm:hidden">Us:</span>
          {ours}
        </span>
      </p>
    </div>
  );
}
