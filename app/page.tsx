// app/page.tsx
//
// Poke-xchange landing page. Presents one concrete, collateral-backed trade so
// collectors can understand the clearinghouse before entering the marketplace.

import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

import { LogoMark } from '@/components/layout/Logo';

import { ListingCarousel } from '@/components/listings/ListingCarousel';
import { Button } from '@/components/ui/button';
import { searchCatalog } from '@/lib/actions/listings';
import { createClient } from '@/lib/supabase/server';

// Reads the authenticated user's session, so render dynamically.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Poke-xchange - Protected Trades for Serious Collectors',
  description:
    'Buy, sell, and swap high-value collectibles with identity verification, live trade contracts, and collateral-backed escrow.',
};

const CARD_IMAGES = {
  mew: 'https://images.pokemontcg.io/sv3pt5/151.png',
  pikachu: 'https://images.pokemontcg.io/sv3pt5/25.png',
  venusaur: 'https://images.pokemontcg.io/sv3pt5/3.png',
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
      <main className="flex-1 overflow-hidden">
        <section className="relative isolate overflow-hidden bg-obsidian text-parchment">
          <div
            className="pointer-events-none absolute inset-0 opacity-35 [background-image:linear-gradient(rgba(227,192,106,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(227,192,106,0.08)_1px,transparent_1px)] [background-size:4rem_4rem] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]"
            aria-hidden="true"
          />
          <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1.02fr_0.98fr] lg:gap-8 lg:px-8 lg:py-24">
            <div className="max-w-2xl">
              <p className="market-label text-gold">Clearinghouse for Collectors</p>
              <h1 className="mt-5 max-w-xl text-balance font-display text-5xl font-semibold leading-[0.98] tracking-[-0.045em] text-parchment sm:text-6xl lg:text-7xl">
                The Deal Is Done When Both Collectors Agree.
              </h1>
              <p className="mt-7 max-w-xl text-pretty text-base leading-7 text-parchment/68 sm:text-lg sm:leading-8">
                Poke-exchange requires all buyers to personally identify
                themselves and put up 100% of the cards&apos; value before either
                package leaves the door.
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
                    className="mt-2 text-balance font-sans text-4xl font-bold tracking-[-0.035em] sm:text-5xl"
                  >
                    Recently Listed
                  </h2>
                </header>
                <div className="mt-9 flex flex-col items-start justify-between gap-5 rounded-lg border border-dashed border-border bg-card/60 p-6 sm:flex-row sm:items-center">
                  <div>
                    <h3 className="font-bold">No Public Listings Yet</h3>
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

        <section className="bg-obsidian text-parchment">
          <div className="mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:items-center lg:gap-20 lg:px-8 lg:py-20">
            <header className="max-w-xl">
              <p className="market-label text-gold">Protection in Plain Terms</p>
              <h2 className="mt-3 text-balance font-sans text-4xl font-bold tracking-[-0.035em] sm:text-5xl">
                Nothing Moves Until Everyone Agrees.
              </h2>
              <p className="mt-5 text-pretty leading-7 text-parchment/60">
                Cash sale, swap, or private deal: the protection adapts to the transaction.
              </p>
            </header>

            <div className="border-t border-parchment/15">
              <ProcessStatement
                label="KYC First"
                text="Anyone listing an item or putting up collateral completes identity checks first."
              />
              <ProcessStatement
                label="Shared Terms"
                text="A deal starts only after both people accept the same items, values, and conditions."
              />
              <ProcessStatement
                label="Settle Last"
                text="Payment or held funds are released only after everyone receives and accepts the deal."
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
            <Link className="text-muted-foreground hover:text-foreground" href="/listings">
              Marketplace
            </Link>
            <Link className="text-muted-foreground hover:text-foreground" href="/deals">
              Deals
            </Link>
            <Link className="text-muted-foreground hover:text-foreground" href="/profile#payouts">
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
        <div className="absolute inset-x-5 top-5 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-[0.1em] text-parchment/55">
            Collateral Protected
          </span>
          <span className="size-2 rounded-full bg-trust shadow-[0_0_0_5px_hsl(var(--trust)/0.12)]" aria-hidden="true" />
        </div>
        <Image
          src={CARD_IMAGES.pikachu}
          alt=""
          width={245}
          height={342}
          sizes="(max-width: 639px) 34vw, 10rem"
          className="absolute left-[7%] top-[24%] w-[31%] -rotate-[9deg] rounded-[4%] opacity-80 shadow-2xl"
        />
        <Image
          src={CARD_IMAGES.venusaur}
          alt=""
          width={245}
          height={342}
          sizes="(max-width: 639px) 34vw, 10rem"
          className="absolute right-[7%] top-[24%] w-[31%] rotate-[9deg] rounded-[4%] opacity-80 shadow-2xl"
        />
        <Image
          src={CARD_IMAGES.mew}
          alt="Mew ex Pokémon trading card"
          width={245}
          height={342}
          sizes="(max-width: 639px) 47vw, 14rem"
          priority
          className="absolute left-1/2 top-[16%] z-10 w-[42%] -translate-x-1/2 rounded-[4%] drop-shadow-[0_22px_28px_rgba(0,0,0,0.65)]"
        />
        <div className="ledger-strip absolute inset-x-0 bottom-0 z-20 border-t border-gold/30 px-5 py-4 sm:px-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="market-label text-obsidian/55">Protected Card Value</p>
              <p className="display-value mt-1 text-3xl">$380</p>
            </div>
            <div className="text-right">
              <p className="market-label text-obsidian/55">Cash Exchanged</p>
              <p className="display-value mt-1 text-xl">$0</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProcessStatement({ label, text }: { label: string; text: string }) {
  return (
    <div className="grid gap-2 border-b border-parchment/15 py-6 sm:grid-cols-[9rem_1fr] sm:items-center sm:gap-6">
      <h3 className="text-sm font-bold uppercase tracking-[0.08em] text-gold">{label}</h3>
      <p className="max-w-xl text-pretty leading-7 text-parchment/75">{text}</p>
    </div>
  );
}
