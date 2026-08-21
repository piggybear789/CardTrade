'use client';

// Compact game switcher beside the catalog heading. Single-select: All, or
// one card game. Overflow is a real scroller — chevrons, swipe, and wheel.
// Chevron fades overlay the strip; they must not add padding as they appear,
// or the content jumps and the browser's scroll-anchor snaps it back.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { GameIcon } from '@/components/listings/GameIcon';
import { cn } from '@/lib/utils';

export interface GenrePillLink {
  slug: string;
  name: string;
}

export function GenrePills({
  selected,
  games,
  onSelect,
}: {
  selected: readonly string[];
  games: readonly GenrePillLink[];
  onSelect: (name: string | null) => void;
}) {
  const allActive = selected.length === 0;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [{ canLeft, canRight }, setOverflow] = useState({
    canLeft: false,
    canRight: false,
  });

  const updateOverflow = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const overflowing = max > 1;
    setOverflow({
      canLeft: overflowing && el.scrollLeft > 1,
      canRight: overflowing && el.scrollLeft < max - 1,
    });
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    updateOverflow();
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(el);
    el.addEventListener('scroll', updateOverflow, { passive: true });

    return () => {
      observer.disconnect();
      el.removeEventListener('scroll', updateOverflow);
    };
  }, [updateOverflow]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const active = el.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!active) return;

    const edge = 8;
    const left = active.offsetLeft;
    const right = left + active.offsetWidth;
    const viewLeft = el.scrollLeft;
    const viewRight = viewLeft + el.clientWidth;
    if (left < viewLeft + edge) {
      el.scrollTo({ left: Math.max(0, left - edge) });
    } else if (right > viewRight - edge) {
      el.scrollTo({ left: right - el.clientWidth + edge });
    }
  }, [selected]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      if (el.scrollWidth <= el.clientWidth) return;
      event.preventDefault();
      el.scrollLeft += event.deltaY;
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  function scrollByPage(direction: -1 | 1) {
    const el = scrollerRef.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({
      left: direction * Math.max(el.clientWidth * 0.7, 160),
      behavior: reduce ? 'auto' : 'smooth',
    });
  }

  return (
    <nav aria-label="Categories" className="relative min-w-0">
      {canLeft ? (
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 flex items-center bg-gradient-to-r from-background from-40% to-transparent pr-8">
          <ScrollButton
            direction="left"
            onClick={() => scrollByPage(-1)}
          />
        </div>
      ) : null}
      {canRight ? (
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 flex items-center justify-end bg-gradient-to-l from-background from-40% to-transparent pl-8">
          <ScrollButton
            direction="right"
            onClick={() => scrollByPage(1)}
          />
        </div>
      ) : null}

      <div
        ref={scrollerRef}
        className={cn(
          'flex gap-1.5 overflow-x-auto [overflow-anchor:none] [overscroll-behavior-x:contain]',
          '[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        )}
      >
        <GenrePill
          active={allActive}
          slug="all"
          label="All"
          onSelect={() => onSelect(null)}
        />
        {games.map((game) => (
          <GenrePill
            key={game.slug}
            active={selected.length === 1 && selected[0] === game.name}
            slug={game.slug}
            label={game.name}
            onSelect={() => onSelect(game.name)}
          />
        ))}
      </div>
    </nav>
  );
}

function ScrollButton({
  direction,
  onClick,
}: {
  direction: 'left' | 'right';
  onClick: () => void;
}) {
  const Icon = direction === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={direction === 'left' ? 'Show earlier games' : 'Show more games'}
      className="pointer-events-auto flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-sm transition-colors hover:border-gold/40 hover:bg-gold/10 focus:outline-none focus-visible:border-gold/40"
    >
      <Icon className="size-3.5" aria-hidden />
    </button>
  );
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
        'inline-flex h-11 min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-meta font-semibold tracking-tight transition-colors',
        'border border-transparent focus:outline-none focus-visible:border-gold/40',
        active
          ? 'border-border bg-gold/10 text-foreground'
          : 'border-border text-muted-foreground hover:border-gold/40 hover:bg-muted/70 hover:text-foreground',
      )}
    >
      <GameIcon
        slug={slug}
        className={active ? 'text-gold' : 'opacity-80'}
      />
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}
