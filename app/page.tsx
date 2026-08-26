// app/page.tsx
//
// NoDitto landing page. Presents one concrete, collateral-backed trade so
// collectors can understand the clearinghouse before entering the marketplace.

import Link from 'next/link';
import { ArrowRight, Check, X } from 'lucide-react';

import { DittoNotWelcome } from '@/components/brand/DittoNotWelcome';
import { LogoMark } from '@/components/layout/Logo';

import { StartDealButton, StartDealEmptyState } from '@/components/deals/StartDealButton';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { ListingCarousel } from '@/components/listings/ListingCarousel';
import { DirectionalTransition } from '@/components/motion/DirectionalTransition';
import { Button } from '@/components/ui/button';
import { searchCatalog } from '@/lib/actions/listings';
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';
import { resolveBrowseRegion } from '@/lib/location/resolveRegion';
import { cn } from '@/lib/utils';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components

// Reads the authenticated user's session, so render dynamically.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'NoDitto',
  description:
    'Buy, sell, and swap high-value collectibles. Sellers verify with Stripe Identity. Payments stay Stripe. Swaps are backed by collateral from both traders.',
};

export default async function HomePage() {
  // The landing carousel is region-scoped for the same reason the catalog is: an
  // unscoped preview is a shop window of items the visitor cannot buy, and the
  // contract guards would refuse every one of them.
  const userPromise = getCachedAuthUser();
  const region = await resolveBrowseRegion();
  const [user, catalogResult] = await Promise.all([
    userPromise,
    searchCatalog({ sort: 'newest', pageSize: 12, regionCode: region.code }),
  ]);
  const previewItems = catalogResult.ok ? catalogResult.items : [];
  const isAuthenticated = Boolean(user);

  return (
    <>
    {isAuthenticated ? <MobileBottomNav /> : null}
    <DirectionalTransition>
    <div
      className={cn(
        'landing-selection flex flex-col bg-background text-foreground',
        isAuthenticated && 'pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0',
      )}
    >
      {/* Clip only the horizontal axis: decorative layers can bleed sideways,
          but vertical clipping would eat focus rings at section edges. */}
      <main className="flex-1 overflow-x-clip">
        <section className="relative isolate overflow-hidden">
          <div
            className="landing-ledger pointer-events-none absolute inset-0 z-0"
            aria-hidden="true"
          />
          {/* CENTRED HERO. The card wall below carries the visual weight, using
              listings that actually exist — the hero stays clean copy and CTAs. */}
          <div className="relative z-10 mx-auto max-w-workspace px-6 pb-8 pt-10 sm:pt-24 md:pb-16 lg:px-24 lg:pt-28">
            <div className="mx-auto max-w-2xl text-center">
              <DittoNotWelcome />
              <h1 className="mt-5 break-words text-balance font-display text-display font-semibold leading-[1.08] tracking-[-0.04em] text-foreground sm:text-5xl md:mt-3 lg:text-7xl">
                A marketplace without{' '}
                <span className="group relative inline-block isolate">
                  <LogoMark className="absolute -top-2 right-6 -z-10 hidden size-7 rotate-[10deg] opacity-80 motion-safe:transition-[opacity,transform] motion-safe:duration-300 motion-safe:ease-out md:block [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:translate-y-3 [@media(hover:hover)]:group-hover:opacity-100 motion-safe:[@media(hover:hover)]:group-hover:-translate-y-3" />
                  <span className="text-muted-foreground">imposters.</span>
                  {/* The same squiggle as the "ditto not welcome" underline,
                      stretched across the word as a strike. `non-scaling-stroke`
                      keeps the line weight constant while the wave stretches. */}
                  <svg
                    viewBox="0 0 168 10"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                    className="pointer-events-none absolute -left-[0.05em] top-[58%] h-[0.35em] w-[calc(100%+0.05em)] -translate-y-1/2 -rotate-[1.2deg] text-ditto"
                  >
                    <path
                      d="M2 6.5c28-4 52 3.5 80-1.5 22-4 42 3 84 0"
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeWidth="4"
                      vectorEffect="non-scaling-stroke"
                      opacity="0.9"
                    />
                  </svg>
                </span>
              </h1>
              <p className="mx-auto mt-5 max-w-xl text-pretty text-body leading-6 text-muted-foreground md:mt-6 md:text-lead">
                Buy, sell, and trade cards with full protection.   
              </p>
              <div className="mx-auto mt-7 flex w-full max-w-xs flex-col items-stretch gap-3 md:mt-10 md:max-w-none md:flex-row md:flex-wrap md:items-center md:justify-center md:gap-3">
                <Button asChild className="h-11 w-full md:h-11 md:w-auto">
                  <Link href="/listings" transitionTypes={['nav-forward']}>
                    Browse Marketplace
                    <span className="hidden md:inline" aria-hidden="true">
                      <ArrowRight />
                    </span>
                  </Link>
                </Button>
                <StartDealButton
                  isAuthenticated={isAuthenticated}
                  variant="outline"
                  className="h-11 w-full hover:border-ditto/50 hover:bg-ditto/10 md:w-auto"
                />
              </div>

              <ul className="mt-10 hidden flex-wrap items-center justify-center gap-x-6 gap-y-2 text-body font-medium text-foreground md:flex">
                <li className="flex items-center gap-tight">
                  <Check className="size-3.5 shrink-0 text-trust" aria-hidden="true" />
                  Photo ID on every seller
                </li>
                <li className="flex items-center gap-tight">
                  <Check className="size-3.5 shrink-0 text-trust" aria-hidden="true" />
                  Collateral locked on trades
                </li>
                <li className="flex items-center gap-tight">
                  <Check className="size-3.5 shrink-0 text-trust" aria-hidden="true" />
                  Powered by Stripe
                </li>
              </ul>
            </div>
          </div>

          {/* THE CARD WALL — a full-bleed marquee of real listings that gives the
              hero visual weight without stock art. */}
          {!catalogResult.ok ? (
            <div className="mx-auto max-w-workspace px-6 pb-14 lg:px-24">
              <p
                role="alert"
                className="mx-auto max-w-xl text-center text-pretty text-body leading-6 text-muted-foreground"
              >
                Public listings could not be loaded. Try again shortly.
              </p>
            </div>
          ) : previewItems.length > 0 ? (
            <div className="relative pt-8 pb-12 md:py-8">
              <div
                className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-background to-transparent md:w-24"
                aria-hidden="true"
              />
              <div
                className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-background to-transparent md:w-24"
                aria-hidden="true"
              />
              <ListingCarousel items={previewItems} />
            </div>
          ) : (
            <div className="mx-auto max-w-workspace px-6 pb-14 lg:px-24">
              <StartDealEmptyState
                isAuthenticated={isAuthenticated}
                title="The shop window is empty for now."
                description="You can still start a trade or a protected contract with another collector."
                help={{ label: 'How it works', href: '/help' }}
                titleAs="h2"
                compact
                showAction={false}
              />
            </div>
          )}
        </section>

        <section
          aria-labelledby="why-noditto"
          className="relative border-t border-border bg-card"
        >
          <LogoMark className="absolute -top-4 right-8 hidden size-8 rotate-[9deg] md:block lg:right-24" />
          <div className="mx-auto grid max-w-workspace gap-16 px-6 py-20 lg:grid-cols-[0.8fr_1.2fr] lg:items-center lg:gap-20 lg:px-24 lg:py-24">
            <header className="max-w-xl">
              <p className="market-label text-gold">Why NoDitto</p>
              <h2
                id="why-noditto"
                className="mt-4 text-balance font-sans text-display font-semibold leading-[1.08] tracking-[-0.03em] md:mt-3"
              >
                Know who you&apos;re dealing with.
              </h2>
              <p className="mt-6 text-pretty text-lead leading-7 text-muted-foreground md:mt-5">
                Sellers verify with Stripe Identity. Payments stay Stripe.
                You see the terms, the collateral, and who moves next, before
                anything leaves a binder.
              </p>
            </header>

            <div className="border-t border-border">
              {/* Below `md` the rows stack and carry their own inline
                  "Elsewhere:"/"Us:" labels, so a column-header row has nothing
                  to line up with — hide it entirely. */}
              <div className="market-label hidden gap-x-6 border-b border-border py-3 text-muted-foreground md:grid md:grid-cols-[1.1fr_1fr_1fr]">
                <span aria-hidden="true" />
                <span className="text-center">The usual</span>
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
                ours="Stripe Identity check"
              />
              {/* Was "Contract-backed collateral protection", which is not what happens
                  when a CASH SALE goes wrong — those carry no collateral. What actually
                  happens on every contract type is that funds stop moving and a person
                  decides, which is a stronger claim and a true one. */}
              <ComparisonRow
                aspect="If a contract goes wrong"
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
      <footer className="border-t border-border">
        <div className="mx-auto max-w-workspace px-6 py-14 text-body md:py-10 lg:px-24">
          <div className="grid gap-10 md:grid-cols-[1fr_auto] md:items-center md:gap-8">
            <div className="max-w-xl">
              <p className="font-display text-subhead font-semibold md:hidden" translate="no">
                NoDitto
              </p>
              <div className="group hidden items-center gap-2 font-display text-subhead font-semibold md:flex">
                <LogoMark className="size-6 origin-center transition-transform duration-300 ease-out motion-safe:group-hover:-rotate-[12deg]" />
                <span translate="no">NoDitto</span>
              </div>
              <p className="mt-3 text-pretty text-body leading-6 text-muted-foreground md:mt-2">
                Safer contracts for trading cards.
              </p>
            </div>
            <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-4 md:gap-y-3">
              <Link className={footerLinkClass} href="/listings" transitionTypes={['nav-forward']}>
                Marketplace
              </Link>
              <Link className={footerLinkClass} href="/trades" transitionTypes={['nav-forward']}>
                Trades
              </Link>
              <Link className={footerLinkClass} href="/profile?tab=verification">
                Verification
              </Link>
              <Link className={footerLinkClass} href="/help#holds">
                How it works
              </Link>
              <Link className={footerLinkClass} href="/help">
                Help
              </Link>
              <Link className={footerLinkClass} href="/terms">
                Terms
              </Link>
              <Link className={footerLinkClass} href="/privacy">
                Privacy
              </Link>
            </nav>
          </div>
          <DittoNotWelcome quiet className="mx-0 mt-8 items-start md:mt-3" />
        </div>
      </footer>
    </div>
    </DirectionalTransition>
    </>
  );
}

const footerLinkClass =
  'inline-flex min-h-11 items-center rounded-sm text-muted-foreground hover:text-foreground border border-transparent focus:outline-none focus-visible:border-gold/40';

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
    <div className="grid gap-2 border-b border-border py-6 md:grid-cols-[1.1fr_1fr_1fr] md:items-center md:gap-6 md:py-5">
      <h3 className="text-body font-semibold">{aspect}</h3>
      <p className="flex items-center gap-2 text-body text-muted-foreground">
        <X className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span>
          <span className="market-label mr-1.5 text-muted-foreground md:hidden">
            Elsewhere:
          </span>
          {typical}
        </span>
      </p>
      <p className="flex items-center gap-2 text-body font-medium">
        <Check className="size-4 shrink-0 text-trust" aria-hidden="true" />
        <span>
          <span className="market-label mr-1.5 text-gold md:hidden">Us:</span>
          {ours}
        </span>
      </p>
    </div>
  );
}
