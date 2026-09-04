'use client';

// Game switcher. Phones get a fading icon strip + a persistent chevron that
// drops a cream category grid. Desktop lets the pills run under the same
// overlaid chevron — the trailing chip fades as it slides out of view.

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ChevronDownIcon, ChevronUpIcon } from '@hugeicons/core-free-icons';

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
      {/* `fixed`, not `absolute top-full h-[100dvh]`. An absolutely positioned
          child still contributes to the document's scrollable overflow, so a
          viewport-tall scrim hung off the bottom of this row added most of a
          screen of dead grey below the catalog for as long as the panel was
          open — worst on a short or empty result set, where the page has no
          real content to absorb it.

          The strip and the panel below both sit later in the DOM at the same
          stacking level, so they still paint over this as one unbroken cream
          sheet. What changed is that the chrome above is now dimmed too, which
          is what a scrim behind an open sheet should do anyway. */}
      {allOpen ? (
        <button
          type="button"
          aria-label="Dismiss categories"
          className="fixed inset-0 z-0 bg-foreground/25 md:hidden"
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

        {/* Capped and scrollable. The panel is absolutely positioned, so it does not
            extend the document — anything past the fold is unreachable rather than
            merely below it. Five rows of categories run 534px on a 568px iPhone SE,
            which put the last row ("Other") under the fixed hub bar with no way to
            scroll to it. `60dvh` tracks the viewport instead of guessing at the
            header stack above it, and taller phones never scroll at all. */}
        {allOpen ? (
          <div
            id={panelId}
            className="absolute left-1/2 top-14 z-10 max-h-[60dvh] w-screen -translate-x-1/2 overflow-y-auto overscroll-contain rounded-b-2xl bg-background px-4 pb-4 shadow-[0_18px_32px_-20px_hsl(var(--obsidian)/0.35)]"
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
            'absolute right-0 top-1.5 z-10 flex size-11 items-center justify-center rounded-full text-foreground outline-none transition-colors hover:text-iris-ink focus-visible:ring-1 focus-visible:border-iris',
            allOpen ? 'bg-transparent' : 'bg-background',
          )}
        >
          {allOpen ? (
            <HugeiconsIcon icon={ChevronUpIcon} className="size-5" strokeWidth={1.75} aria-hidden />
          ) : (
            <HugeiconsIcon icon={ChevronDownIcon} className="size-5" strokeWidth={1.75} aria-hidden />
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
        // `min-h-16`, not `h-16`. Four columns inside a `px-4` gutter leaves each
        // cell about 79px at 375px, and the two-word labels that survive
        // `SHORT_LABEL` — "Dragon Ball", "Star Wars" — wrap to a second line
        // under the icon. At a fixed height that second line was clipped; the
        // grid row can just grow instead, and every cell in the row grows with it.
        'flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg px-1.5 py-1.5 text-center text-meta leading-tight text-balance transition-colors outline-none focus-visible:ring-1 focus-visible:border-iris',
        active
          ? 'bg-accent font-semibold text-accent-foreground ring-1 ring-iris'
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
        'border border-transparent focus:outline-none focus-visible:border-iris',
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
          active ? 'bg-iris' : 'bg-transparent',
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

// Matches the size-11 chevron so a selected pill can sit fully left of it.
const CHEVRON_RESERVE_PX = 44;

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
  const selectedSlug = selectedName
    ? items.find((item) => item.name === selectedName)?.slug ?? 'all'
    : 'all';

  const trackRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [fadeRight, setFadeRight] = useState(true);
  const [hidden, setHidden] = useState<GenreItem[]>([]);
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const update = () => {
      const maxScroll = track.scrollWidth - track.clientWidth;
      setFadeRight(maxScroll > 1 && track.scrollLeft < maxScroll - 1);
      const visible = visibleTrackSlugs(track);
      setHidden(itemsRef.current.filter((item) => !visible.has(item.slug)));
    };

    update();
    track.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(track);
    return () => {
      track.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [items.length]);

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    scrollSlugIntoView(track, selectedSlug);
  }, [selectedSlug]);

  function pick(name: string | null) {
    onSelect(name);
    setOpen(false);
  }

  return (
    <nav aria-label="Categories" className="relative min-w-0">
      <div
        ref={trackRef}
        className={cn(
          'flex min-w-0 items-center gap-1.5 overflow-x-auto [overflow-anchor:none] [overscroll-behavior-x:contain]',
          '[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          hidden.length > 0 && 'scroll-pe-14 pr-14',
          fadeRight &&
            '[mask-image:linear-gradient(to_right,black_calc(100%-5.5rem),transparent_calc(100%-2.75rem))] [-webkit-mask-image:linear-gradient(to_right,black_calc(100%-5.5rem),transparent_calc(100%-2.75rem))]',
        )}
      >
        {items.map((item) => (
          <GenrePill
            key={item.slug}
            active={item.name == null ? allActive : item.name === selectedName}
            slug={item.slug}
            label={item.label}
            onSelect={() => pick(item.name)}
          />
        ))}
      </div>

      {hidden.length > 0 ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="More games"
              className="absolute right-0 top-0 z-10 flex size-11 items-center justify-center rounded-full border border-foreground/20 bg-background text-foreground shadow-sm transition-colors hover:border-iris/50 hover:bg-accent focus:outline-none focus-visible:border-iris"
            >
              {open ? (
                <HugeiconsIcon icon={ChevronUpIcon} className="size-4" strokeWidth={1.75} aria-hidden />
              ) : (
                <HugeiconsIcon icon={ChevronDownIcon} className="size-4" strokeWidth={1.75} aria-hidden />
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-96 p-2">
            <p className="px-2 pb-1.5 text-meta font-semibold text-muted-foreground">
              More games
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {hidden.map((item) => (
                <GenrePill
                  key={item.slug}
                  active={item.name == null ? allActive : item.name === selectedName}
                  slug={item.slug}
                  label={item.label}
                  stretched
                  onSelect={() => pick(item.name)}
                />
              ))}
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
    </nav>
  );
}

function visibleTrackSlugs(track: HTMLElement): Set<string> {
  const trackRect = track.getBoundingClientRect();
  const viewLeft = track.scrollLeft;
  const viewRight = viewLeft + track.clientWidth - CHEVRON_RESERVE_PX;
  const slugs = new Set<string>();

  for (const node of track.querySelectorAll('[data-genre-slug]')) {
    if (!(node instanceof HTMLElement)) continue;
    const slug = node.dataset.genreSlug;
    if (!slug) continue;
    const rect = node.getBoundingClientRect();
    const left = rect.left - trackRect.left + track.scrollLeft;
    const width = node.offsetWidth;
    const visible = Math.min(left + width, viewRight) - Math.max(left, viewLeft);
    if (width > 0 && visible / width >= 0.5) slugs.add(slug);
  }

  return slugs;
}

function scrollSlugIntoView(track: HTMLElement, slug: string) {
  const el = track.querySelector(`[data-genre-slug="${CSS.escape(slug)}"]`);
  if (!(el instanceof HTMLElement)) return;

  const elRect = el.getBoundingClientRect();
  const trackRect = track.getBoundingClientRect();
  const left = elRect.left - trackRect.left + track.scrollLeft;
  const right = left + el.offsetWidth;
  const viewLeft = track.scrollLeft;
  const viewRight = viewLeft + track.clientWidth - CHEVRON_RESERVE_PX;

  if (left < viewLeft) {
    track.scrollTo({ left, behavior: 'auto' });
  } else if (right > viewRight) {
    track.scrollTo({
      left: right - (track.clientWidth - CHEVRON_RESERVE_PX),
      behavior: 'auto',
    });
  }
}

function GenrePill({
  active,
  slug,
  label,
  stretched = false,
  onSelect,
}: {
  active: boolean;
  slug: string;
  label: string;
  stretched?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      data-genre-slug={slug}
      onClick={onSelect}
      aria-pressed={active}
      title={label}
      className={cn(
        'flex h-9 min-h-9 items-center gap-1.5 rounded-full border px-2.5 text-left text-meta font-semibold tracking-tight transition-colors md:h-11 md:min-h-11 md:px-3',
        'border border-transparent focus:outline-none focus-visible:border-iris',
        stretched ? 'min-w-0 w-full' : 'shrink-0',
        active
          ? 'border-foreground bg-foreground text-primary-foreground'
          : 'border-foreground/20 bg-card text-foreground shadow-sm hover:border-iris/50 hover:bg-accent',
      )}
    >
      {/* Drawn mark, not the brand logo: the active pill inverts to a near-black
          fill, and a full-colour logo cannot follow the foreground. */}
      <GameMark
        slug={slug}
        className={cn(
          'shrink-0',
          active ? 'text-iris-ink' : 'text-muted-foreground',
        )}
      />
      <span className="min-w-0 truncate whitespace-nowrap">{label}</span>
    </button>
  );
}
