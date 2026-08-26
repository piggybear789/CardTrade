'use client';

// Game switcher. Phones get a fading icon strip + a persistent chevron that
// drops a cream category grid. Desktop shows the pills that fit and parks a
// pullout at the end of the row for everything else — never over a badge.

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

import { GameIcon, GameMark } from '@/components/listings/GameIcon';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface GenrePillLink {
  slug: string;
  name: string;
}

// Cells size to their label — a fixed column made "One Piece" and "Yu-Gi-Oh"
// spill past their own width and collide with the next game.
const STRIP_CELL =
  'grid h-14 min-w-14 shrink-0 place-content-center place-items-center gap-0.5 px-2';

const SHORT_LABEL: Record<string, string> = {
  pokemon: 'Pokémon',
  'one-piece': 'One Piece',
  'yu-gi-oh': 'Yu-Gi-Oh',
  'magic-the-gathering': 'Magic',
  riftbound: 'Riftbound',
  'disney-lorcana': 'Lorcana',
  gundam: 'Gundam',
  'flesh-and-blood': 'Flesh',
  'star-wars-unlimited': 'Star Wars',
  digimon: 'Digimon',
  'dragon-ball-super': 'Dragon Ball',
  'weiss-schwarz': 'Weiss',
  'cardfight-vanguard': 'Vanguard',
  'union-arena': 'Union',
  'sports-cards': 'Sports',
  'other-tcg': 'Other',
};

export function GenrePills({
  selected,
  games,
  onSelect,
}: {
  selected: readonly string[];
  games: readonly GenrePillLink[];
  onSelect: (name: string | null) => void;
}) {
  return (
    <>
      <div className="md:hidden">
        <MobileGenreStrip selected={selected} games={games} onSelect={onSelect} />
      </div>
      <div className="hidden md:block">
        <DesktopGenrePills selected={selected} games={games} onSelect={onSelect} />
      </div>
    </>
  );
}

function MobileGenreStrip({
  selected,
  games,
  onSelect,
}: {
  selected: readonly string[];
  games: readonly GenrePillLink[];
  onSelect: (name: string | null) => void;
}) {
  const [allOpen, setAllOpen] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const allActive = selected.length === 0;

  function closePanel() {
    setAllOpen(false);
    triggerRef.current?.focus();
  }

  function pick(name: string | null) {
    onSelect(name);
    if (allOpen) closePanel();
  }

  useEffect(() => {
    if (!allOpen) return;

    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closePanel();
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      setAllOpen(false);
    }

    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [allOpen]);

  return (
    <nav
      ref={rootRef}
      aria-label="Categories"
      className={cn('relative min-w-0', allOpen && 'z-40')}
    >
      {/* Anchored below the row, not `inset-0`: a viewport scrim dimmed the
          search strip above and left a grey band between it and the sheet. */}
      {allOpen ? (
        <button
          type="button"
          aria-label="Dismiss categories"
          className="absolute left-1/2 top-full z-0 h-[100dvh] w-screen -translate-x-1/2 bg-foreground/25 md:hidden"
          onClick={() => setAllOpen(false)}
        />
      ) : null}
      <div className="relative bg-background">
        {/* The sheet spans the viewport, not the padded content column, so it
            reads as an overlay dropping from the search rather than a card. */}
        {allOpen ? (
          <div
            className="absolute left-1/2 top-0 h-14 w-screen -translate-x-1/2 bg-background"
            aria-hidden
          />
        ) : null}
        <div className="relative h-14">
          {allOpen ? (
            <div className="flex h-14 items-center pr-12">
              <p className="text-body font-semibold text-foreground">Categories</p>
            </div>
          ) : (
            <div
              className={cn(
                // One page gutter left so equal columns don't park "All" mid-tile.
                '-ml-2 flex h-14 w-[calc(100%+0.5rem)] min-w-0 overflow-x-auto pr-12 [overflow-anchor:none] [overscroll-behavior-x:contain]',
                '[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
                // Fully transparent by the chevron's left edge, so the gradient
                // itself is visible instead of hiding under the opaque button.
                '[mask-image:linear-gradient(to_right,black_calc(100%-5.5rem),transparent_calc(100%-2.75rem))] [-webkit-mask-image:linear-gradient(to_right,black_calc(100%-5.5rem),transparent_calc(100%-2.75rem))]',
              )}
            >
              <CategoryCell
                active={allActive}
                slug="all"
                label="All"
                title="All games"
                onSelect={() => pick(null)}
              />
              {games.map((game) => (
                <CategoryCell
                  key={game.slug}
                  active={selected.length === 1 && selected[0] === game.name}
                  slug={game.slug}
                  label={SHORT_LABEL[game.slug] ?? game.name}
                  title={game.name}
                  onSelect={() => pick(game.name)}
                />
              ))}
            </div>
          )}
        </div>

        {allOpen ? (
          <div
            id={panelId}
            className="absolute left-1/2 top-14 z-10 w-screen -translate-x-1/2 rounded-b-2xl bg-background px-4 pb-4 shadow-[0_18px_32px_-20px_hsl(var(--obsidian)/0.35)]"
          >
            <div className="grid grid-cols-4 gap-2">
              <CategoryChip
                active={allActive}
                slug="all"
                label="All"
                onSelect={() => pick(null)}
              />
              {games.map((game) => (
                <CategoryChip
                  key={game.slug}
                  active={selected.length === 1 && selected[0] === game.name}
                  slug={game.slug}
                  label={SHORT_LABEL[game.slug] ?? game.name}
                  onSelect={() => pick(game.name)}
                />
              ))}
            </div>
          </div>
        ) : null}

        <button
          ref={triggerRef}
          type="button"
          onClick={() => (allOpen ? closePanel() : setAllOpen(true))}
          aria-expanded={allOpen}
          aria-haspopup="true"
          aria-controls={allOpen ? panelId : undefined}
          aria-label="All categories"
          className={cn(
            'absolute right-0 top-1.5 z-10 flex size-11 items-center justify-center rounded-full text-foreground outline-none transition-colors hover:text-gold focus-visible:ring-1 focus-visible:ring-gold/50',
            allOpen ? 'bg-transparent' : 'bg-background',
          )}
        >
          {allOpen ? (
            <ChevronUp className="size-5" strokeWidth={1.75} aria-hidden />
          ) : (
            <ChevronDown className="size-5" strokeWidth={1.75} aria-hidden />
          )}
        </button>
      </div>
    </nav>
  );
}

function CategoryChip({
  active,
  slug,
  label,
  onSelect,
}: {
  active: boolean;
  slug: string;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        'flex h-16 flex-col items-center justify-center gap-1 rounded-lg px-1.5 text-center text-meta leading-tight text-balance transition-colors outline-none focus-visible:ring-1 focus-visible:ring-gold/50',
        active
          ? 'bg-gold/15 font-semibold text-foreground ring-1 ring-gold/45'
          : 'bg-card font-medium text-foreground hover:bg-accent',
      )}
    >
      <GameIcon slug={slug} active={active} />
      {label}
    </button>
  );
}

function CategoryCell({
  active,
  slug,
  label,
  title,
  onSelect,
}: {
  active: boolean;
  slug: string;
  label: string;
  title: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      title={title}
      className={cn(
        'border border-transparent focus:outline-none focus-visible:border-gold/40',
        STRIP_CELL,
      )}
    >
      <GameIcon slug={slug} active={active} />
      <span
        className={cn(
          'hyphens-none whitespace-nowrap text-center text-meta font-medium leading-none',
          active ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {label}
      </span>
      <span
        aria-hidden
        className={cn(
          'mt-1 h-0.5 w-4 rounded-full',
          active ? 'bg-gold' : 'bg-transparent',
        )}
      />
    </button>
  );
}

type GenreItem = {
  slug: string;
  name: string | null;
  label: string;
};

const PILL_GAP_PX = 6;

function DesktopGenrePills({
  selected,
  games,
  onSelect,
}: {
  selected: readonly string[];
  games: readonly GenrePillLink[];
  onSelect: (name: string | null) => void;
}) {
  const items: GenreItem[] = [
    { slug: 'all', name: null, label: 'All' },
    ...games.map((game) => ({
      slug: game.slug,
      name: game.name,
      label: game.name,
    })),
  ];
  const selectedName = selected.length === 1 ? selected[0] : null;
  const allActive = selectedName == null;

  const trackRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(items.length);
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    const track = trackRef.current;
    const measure = measureRef.current;
    if (!track || !measure) return;

    // An arrow const, not a hoisted declaration: `function fit()` is hoisted
    // above the null guard, so TypeScript won't narrow `track`/`measure` inside.
    const fit = () => {
      const pills = [...measure.children] as HTMLElement[];
      if (pills.length === 0) return;
      const available = track.clientWidth;
      let used = 0;
      let count = 0;
      for (const pill of pills) {
        const next = used + (count > 0 ? PILL_GAP_PX : 0) + pill.offsetWidth;
        if (next > available + 0.5) break;
        used = next;
        count += 1;
      }
      setVisibleCount(Math.max(1, count));
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(track);
    return () => observer.disconnect();
  }, [items.length]);

  const { visible, rest } = partitionVisible(items, visibleCount, selectedName);

  function pick(name: string | null) {
    onSelect(name);
    setOpen(false);
  }

  return (
    <nav aria-label="Categories" className="relative min-w-0">
      <div
        ref={measureRef}
        aria-hidden
        inert
        className="pointer-events-none invisible absolute left-0 top-0 flex gap-1.5"
      >
        {items.map((item) => (
          <GenrePill
            key={item.slug}
            active={false}
            slug={item.slug}
            label={item.label}
            onSelect={() => {}}
          />
        ))}
      </div>

      <div className="flex min-w-0 items-center gap-1.5">
        <div ref={trackRef} className="flex min-w-0 flex-1 items-center gap-1.5">
          {visible.map((item) => (
            <GenrePill
              key={item.slug}
              active={item.name == null ? allActive : item.name === selectedName}
              slug={item.slug}
              label={item.label}
              onSelect={() => pick(item.name)}
            />
          ))}
        </div>

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="More games"
              className="flex size-11 shrink-0 items-center justify-center rounded-full border border-foreground/20 bg-card text-foreground shadow-sm transition-colors hover:border-gold/40 hover:bg-accent focus:outline-none focus-visible:border-gold/40"
            >
              {open ? (
                <ChevronUp className="size-4" strokeWidth={1.75} aria-hidden />
              ) : (
                <ChevronDown className="size-4" strokeWidth={1.75} aria-hidden />
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-2">
            <p className="px-2 pb-1.5 text-meta font-semibold text-muted-foreground">
              {rest.length > 0 ? 'More games' : 'Games'}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {(rest.length > 0 ? rest : items).map((item) => (
                <GenrePill
                  key={item.slug}
                  active={item.name == null ? allActive : item.name === selectedName}
                  slug={item.slug}
                  label={item.label}
                  onSelect={() => pick(item.name)}
                />
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </nav>
  );
}

function partitionVisible(
  items: GenreItem[],
  visibleCount: number,
  selectedName: string | null,
): { visible: GenreItem[]; rest: GenreItem[] } {
  const count = Math.max(1, Math.min(visibleCount, items.length));
  let visible = items.slice(0, count);
  const selected = selectedName
    ? items.find((item) => item.name === selectedName)
    : null;

  if (selected && !visible.some((item) => item.slug === selected.slug)) {
    visible = [...visible.slice(0, Math.max(1, count - 1)), selected];
  }

  const visibleSlugs = new Set(visible.map((item) => item.slug));
  const rest = items.filter((item) => !visibleSlugs.has(item.slug));
  return { visible, rest };
}

function GenrePill({
  active,
  slug,
  label,
  onSelect,
}: {
  active: boolean;
  slug: string;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      title={label}
      className={cn(
        'inline-flex h-9 min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-meta font-semibold tracking-tight transition-colors md:h-11 md:min-h-11 md:px-3',
        'border border-transparent focus:outline-none focus-visible:border-gold/40',
        active
          ? 'border-foreground bg-foreground text-primary-foreground'
          : 'border-foreground/20 bg-card text-foreground shadow-sm hover:border-gold/40 hover:bg-accent',
      )}
    >
      {/* Drawn mark, not the brand logo: the active pill inverts to a near-black
          fill, and a full-colour logo cannot follow the foreground. */}
      <GameMark
        slug={slug}
        className={active ? 'text-gold' : 'text-muted-foreground'}
      />
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}
