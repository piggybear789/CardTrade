// app/page.tsx
//
// Poke-xchange landing page. Presents one concrete, collateral-backed trade so
// collectors can understand the clearinghouse before entering the marketplace.

import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, Check, X } from 'lucide-react';

import { LogoMark } from '@/components/layout/Logo';

import { ListingCarousel } from '@/components/listings/ListingCarousel';
import { Button } from '@/components/ui/button';
import { searchCatalog } from '@/lib/actions/listings';
import { createClient } from '@/lib/supabase/server';

// Reads the authenticated user's session, so render dynamically.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Poke-xchange — Protected Trades for Serious Collectors',
  description:
    'Buy, sell, and swap high-value collectibles with identity verification, live trade contracts, and collateral-backed escrow.',
};

// Iconic chase cards so the example trade reads as a serious, high-value swap:
// "Moonbreon" (Prismatic Evolutions SIR), Pikachu ex SIR (Ascended Heroes),
// and the "bubble Mew" SIR from Paldean Fates (#232).
const CARD_IMAGES = {
  umbreon: 'https://images.pokemontcg.io/sv8pt5/161.png',
  pikachu: 'https://images.scrydex.com/pokemon/me2pt5-276/large',
  mew: 'https://images.pokemontcg.io/sv4pt5/232.png',
} as const;

export default async function HomePage() {
  const supabase = await createClient();
  const [authResult, catalogResult] = await Promise.all([
    supabase.auth.getUser(),
    searchCatalog({ sort: 'newest', pageSize: 12 }),
  ]);
  const user = authResult.data.user;
  const previewItems = catalogResult.ok ? catalogResult.items : [];
  const isAuthenticated = Boolean(user);
  const dealHref = isAuthenticated ? '/deals/new' : '/sign-up';

  return (
    <div className="flex flex-col">
      {/* Clip only the horizontal axis: decorative layers can bleed sideways,
          but vertical clipping would eat focus rings at section edges. */}
      <main className="flex-1 overflow-x-clip">
        <section className="relative isolate overflow-hidden bg-obsidian text-parchment">
          <div
            className="pointer-events-none absolute inset-0 opacity-35 [background-image:linear-gradient(rgba(227,192,106,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(227,192,106,0.08)_1px,transparent_1px)] [background-size:4rem_4rem] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]"
            aria-hidden="true"
          />
          <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1.02fr_0.98fr] lg:gap-8 lg:px-8 lg:py-24">
            <div className="max-w-2xl">
              <p className="market-label text-gold">Clearinghouse for Collectors</p>
              <h1 className="mt-5 max-w-xl text-balance font-display text-5xl font-semibold leading-[1.04] tracking-[-0.03em] text-parchment sm:text-6xl sm:leading-[1.02] lg:text-7xl">
                Full transparency{' '}
                <span className="text-parchment/55">in every transaction.</span>
              </h1>
              <p className="mt-7 max-w-xl text-pretty text-base leading-7 text-parchment/68 sm:text-lg sm:leading-8">
                Every trader verifies their identity, and every transaction is backed by
                collateral, so you can buy, sell, and trade with less risk.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Button
                  asChild
                  size="lg"
                  className="border-gold bg-gold text-obsidian hover:bg-gold/90"
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
                  className="border-parchment/25 bg-transparent text-parchment shadow-none hover:border-gold/70 hover:bg-white/10 hover:text-parchment"
                >
                  <Link href={dealHref}>Start a Private Deal</Link>
                </Button>
              </div>
            </div>

            <ProtectedTradePreview />
          </div>
        </section>

        <section aria-labelledby="recent-listings" className="bg-background">
          <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
            {previewItems.length > 0 ? (
              <ListingCarousel items={previewItems} />
            ) : (
              <>
                <header>
                  <p className="market-label text-gold">Live Marketplace</p>
                  <h2
                    id="recent-listings"
                    className="mt-2 text-balance font-sans text-4xl font-semibold leading-[1.08] tracking-[-0.025em] sm:text-5xl"
                  >
                    Recently listed
                  </h2>
                </header>
                <div className="mt-9 flex flex-col items-start justify-between gap-5 rounded-lg border border-dashed border-border bg-card/60 p-6 sm:flex-row sm:items-center">
                  <div>
                    <h3 className="font-semibold">No Public Listings Yet</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      You can still make a protected deal with another collector.
                    </p>
                  </div>
                  <Button asChild>
                    <Link href={dealHref}>Start a Private Deal</Link>
                  </Button>
                </div>
              </>
            )}
          </div>
        </section>

        <section aria-labelledby="why-pokexchange" className="border-y border-white/10 bg-obsidian text-parchment">
          <div className="mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:items-center lg:gap-20 lg:px-8 lg:py-20">
            <header className="max-w-xl">
              <p className="market-label text-gold">Why Poke-xchange</p>
              <h2
                id="why-pokexchange"
                className="mt-3 text-balance font-sans text-4xl font-semibold leading-[1.08] tracking-[-0.025em] sm:text-5xl"
              >
                Nobody wants to deal with Team Rocket.
              </h2>
              <p className="mt-5 text-pretty leading-7 text-parchment/60">
                Every trader is KYC-verified, and every transaction is backed by collateral.
                Buy, sell, and trade with less risk.
              </p>
            </header>

            <div className="border-t border-parchment/15">
              {/* Below `sm` the rows stack and carry their own inline
                  "Elsewhere:"/"Us:" labels, so a column-header row has nothing
                  to line up with — hide it entirely. */}
              <div className="hidden gap-x-6 border-b border-parchment/15 py-3 font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-parchment/60 sm:grid sm:grid-cols-[1.1fr_1fr_1fr]">
                <span aria-hidden="true" />
                <span className="text-left">Typical marketplace</span>
                <span className="text-left text-gold">Poke-xchange</span>
              </div>
              <ComparisonRow
                aspect="Card-for-card swaps"
                typical="Trust and hope"
                ours="Backed by locked collateral"
              />
              <ComparisonRow
                aspect="Who you're dealing with"
                typical="Anonymous accounts"
                ours="Government-ID-verified traders"
              />
              <ComparisonRow
                aspect="If a deal goes wrong"
                typical="“Sort it out yourselves”"
                ours="Escrowed collateral pays you out"
              />
              <ComparisonRow
                aspect="Mixing cash and cards"
                typical="Meetups and PayPal F&F"
                ours="One contract, signed by both sides"
              />
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t bg-card">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 text-sm sm:px-6 md:grid-cols-[1fr_auto] md:items-start lg:px-8">
          <div className="max-w-xl">
            <div className="flex items-center gap-2 font-display text-lg font-semibold">
              <LogoMark className="size-6" />
              <span translate="no">Poke-xchange</span>
            </div>
            <p className="mt-2 text-pretty leading-6 text-muted-foreground">
              Safety-first escrow for trading cards, coins, stamps, comics, and memorabilia.
            </p>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-3">
            <Link
              className="rounded-sm text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              href="/listings"
            >
              Marketplace
            </Link>
            <Link
              className="rounded-sm text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              href="/deals"
            >
              Deals
            </Link>
            <Link
              className="rounded-sm text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              href="/profile#payouts"
            >
              Verification
            </Link>
          </nav>
          <p className="border-t pt-5 text-xs leading-5 text-muted-foreground md:col-span-2">
            Demo card imagery provided by the{' '}
            <a
              href="https://docs.pokemontcg.io/"
              target="_blank"
              rel="noreferrer"
              className="underline decoration-gold/50 underline-offset-4 hover:text-foreground"
            >
              Pokémon TCG API
            </a>
            . Pokémon names and artwork belong to their respective owners. Poke-xchange is not affiliated with or endorsed by The Pokémon Company.
          </p>
        </div>
      </footer>
    </div>
  );
}

function ProtectedTradePreview() {
  return (
    <div className="relative mx-auto h-[31rem] w-full max-w-[35rem] sm:h-[36rem]">
      <div className="auction-stage absolute inset-x-4 inset-y-0 overflow-hidden rounded-lg border border-white/10 shadow-[0_30px_80px_rgba(0,0,0,0.45)] sm:inset-x-8">
        <Image
          src={CARD_IMAGES.pikachu}
          alt=""
          width={245}
          height={342}
          sizes="(max-width: 639px) 34vw, 10rem"
          className="absolute left-[7%] top-[24%] w-[31%] -rotate-[9deg] rounded-[4%] opacity-80 shadow-2xl"
        />
        <Image
          src={CARD_IMAGES.mew}
          alt=""
          width={245}
          height={342}
          sizes="(max-width: 639px) 34vw, 10rem"
          className="absolute right-[7%] top-[24%] w-[31%] rotate-[9deg] rounded-[4%] opacity-80 shadow-2xl"
        />
        <Image
          src={CARD_IMAGES.umbreon}
          alt="Umbreon ex Pokémon trading card"
          width={245}
          height={342}
          sizes="(max-width: 639px) 47vw, 14rem"
          priority
          className="absolute left-1/2 top-[16%] z-10 w-[42%] -translate-x-1/2 rounded-[4%] drop-shadow-[0_22px_28px_rgba(0,0,0,0.65)]"
        />
        {/* Two guarantees, side by side — the pitch in the fewest possible words. */}
        <ul className="ledger-strip absolute inset-x-0 bottom-0 z-20 grid grid-cols-2 gap-x-4 border-t border-gold/30 px-5 py-4 text-xs font-semibold text-obsidian sm:px-6 sm:text-sm">
          <li className="flex items-center gap-1.5">
            <Check className="size-3.5 shrink-0 text-trust" aria-hidden="true" />
            All Parties ID Verified
          </li>
          <li className="flex items-center justify-end gap-1.5">
            <Check className="size-3.5 shrink-0 text-trust" aria-hidden="true" />
            Full Value Held In Escrow
          </li>
        </ul>
      </div>
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
          <span className="mr-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-parchment/50 sm:hidden">
            Elsewhere:
          </span>
          {typical}
        </span>
      </p>
      <p className="flex items-center gap-2 text-sm font-medium">
        <Check className="size-4 shrink-0 text-trust" aria-hidden="true" />
        <span>
          <span className="mr-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-gold sm:hidden">
            Us:
          </span>
          {ours}
        </span>
      </p>
    </div>
  );
}
