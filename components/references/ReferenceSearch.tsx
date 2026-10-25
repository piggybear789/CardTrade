'use client';

// components/references/ReferenceSearch.tsx
//
// /references (0155): command-palette search input with the dropdown already
// visible showing the top 3 most-referred traders (or an empty state while there
// are none), and expanding to matching profiles as the member types.

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowRight01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  PlusIcon,
  Search01Icon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons';

import { PlatformChip } from '@/components/references/referenceLabels';
import { Avatar } from '@/components/ui/avatar';
import { searchReferences, type ReferenceSuggestion } from '@/lib/actions/references';
import { referenceHref, type ReferenceAddress } from '@/domain/references/address';
import { regionLabel } from '@/domain/region';
import { cn } from '@/lib/utils';

const MAX_VISIBLE_RESULTS = 3;

/** The handle a suggestion shows, lower-cased and without `@`, for matching what is typed. */
function handleText(suggestion: ReferenceSuggestion): string {
  return suggestion.handle.replace(/^@/, '').toLowerCase();
}

export function ReferenceSearch({
  initialSuggestions = [],
}: {
  /** `null` when the read failed, so the empty state doesn't claim there are no references. */
  initialSuggestions?: ReferenceSuggestion[] | null;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [knownSuggestions, setKnownSuggestions] = useState<ReferenceSuggestion[]>(
    initialSuggestions ?? [],
  );
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeq = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Focus the search on arrival with a mouse and keyboard only. On a touch screen
  // `autoFocus` raised the software keyboard over the "Most referenced" list before the
  // member had looked at the page, the same reason the dialogs focus their container.
  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) {
      inputRef.current?.focus({ preventScroll: true });
    }
  }, []);

  const needle = query.trim().replace(/^@/, '');
  const needleLower = needle.toLowerCase();

  const topReferred = [...(initialSuggestions ?? [])]
    .sort((a, b) => b.referenceCount - a.referenceCount || a.handle.localeCompare(b.handle))
    .slice(0, MAX_VISIBLE_RESULTS);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (!needle) {
      requestSeq.current += 1;
      setActiveIndex(0);
      return;
    }

    const seq = ++requestSeq.current;
    debounce.current = setTimeout(async () => {
      const result = await searchReferences(needle);
      if (seq !== requestSeq.current) return;
      if (result.ok && result.data.length > 0) {
        setKnownSuggestions((prev) => {
          const map = new Map<string, ReferenceSuggestion>();
          for (const item of prev) map.set(`${item.kind}:${item.id}`, item);
          for (const item of result.data) map.set(`${item.kind}:${item.id}`, item);
          return Array.from(map.values());
        });
      }
    }, 80);

    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [needle]);

  // Filter synchronously on every keystroke and cap to 3 results so it never overflows.
  const visibleSuggestions = !needleLower
    ? topReferred
    : knownSuggestions
        .filter(
          (s) =>
            handleText(s).includes(needleLower) ||
            s.name.toLowerCase().includes(needleLower),
        )
        .sort((a, b) => {
          const aStarts = handleText(a).startsWith(needleLower) ? 1 : 0;
          const bStarts = handleText(b).startsWith(needleLower) ? 1 : 0;
          if (aStarts !== bStarts) return bStarts - aStarts;
          return b.referenceCount - a.referenceCount || a.handle.localeCompare(b.handle);
        })
        .slice(0, MAX_VISIBLE_RESULTS);

  const hasResults = visibleSuggestions.length > 0;
  const loadFailed = initialSuggestions === null;
  const isHandle = !/\s/.test(needle);
  const showDirectOpen = needle.length >= 1 && isHandle;

  const openPage = (address: ReferenceAddress, withExperience = false) => {
    router.push(referenceHref(address, withExperience ? { experience: '1' } : {}));
  };

  /** A handle typed in, platform unknown: its page asks which one when several people share it. */
  const openTyped = (typed: string, withExperience = false) => {
    const clean = typed.replace(/^@/, '').trim();
    if (clean) openPage({ slug: clean, on: null }, withExperience);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(Math.max(0, visibleSuggestions.length - 1), i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = visibleSuggestions[activeIndex];
      if (target) {
        openPage(target.address);
      } else if (needle.length >= 2) {
        openTyped(needle);
      }
    }
  };

  return (
    // Grows with the screen like the page around it (`app/(marketing)/references/page.tsx`).
    // Same edge and radius as every other field and card: `border-input`, `rounded-lg`.
    <div className="relative mx-auto w-full max-w-[clamp(36rem,42vw,54rem)]">
      {/* Search bar */}
      {/* Focus: a softened 1px edge plus a faint halo. The full `--ring` edge doubled by an
          inset ring read as a heavy dark frame on a field this large. */}
      <div className="group relative flex items-center rounded-lg border border-input bg-card shadow-market transition-[border-color,box-shadow] focus-within:border-ring/50 focus-within:ring-[3px] focus-within:ring-ring/10">
        <HugeiconsIcon
          icon={Search01Icon}
          className="pointer-events-none ml-4 size-4 shrink-0 text-muted-foreground transition-colors group-focus-within:text-foreground"
          aria-hidden
        />
        <input
          type="text"
          inputMode="search"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search @handle or name..."
          aria-label="Search a handle or name"
          aria-expanded={hasResults}
          aria-autocomplete="list"
          // `text-body`, the same size as the handles in the suggestion list under it, so
          // what you type and what you pick read as one control.
          className="h-[clamp(3rem,3vw,3.75rem)] w-full bg-transparent pl-3 pr-4 text-body text-foreground placeholder:text-muted-foreground/75 focus:outline-none"
          ref={inputRef}
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setActiveIndex(0);
            }}
            aria-label="Clear search"
            className="mr-1 inline-flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring sm:mr-2 sm:size-8"
          >
            <HugeiconsIcon icon={Cancel01Icon} className="size-3.5" aria-hidden />
          </button>
        ) : null}
      </div>

      {/* RESULTS. From `sm`: a dropdown anchored below the input, so filtering never
          shifts the centred page. PHONE: in the page flow under the search, so the list
          scrolls with the page instead of floating over the footer and keyboard. Always
          rendered: with nothing to list it holds an empty state, so the page never ends
          at a bare search box. */}
      <div className="relative mt-2 overflow-hidden rounded-lg border border-border bg-card shadow-market sm:absolute sm:inset-x-0 sm:top-full sm:z-20 sm:bg-card/95 sm:shadow-xl sm:backdrop-blur-md">
        {hasResults ? (
          <>
            {!needle ? (
              // Visible caption only: the listbox's own label already names it.
              <p aria-hidden className="px-4 pb-1 pt-3 text-meta font-semibold uppercase tracking-wider text-muted-foreground">
                Most referenced
              </p>
            ) : null}
            {/* Options only: a listbox may hold nothing else for assistive tech, so the
                empty states and the open-handle row sit beside it. */}
            <div
              role="listbox"
              aria-label={needle ? 'Matching profiles' : 'Top referred traders'}
              className="divide-y divide-border/60"
            >
              {visibleSuggestions.map((s, i) => {
                const active = i === activeIndex;
                const subtext = [
                  s.name !== s.handle.replace(/^@/, '') ? s.name : null,
                  s.regionCode ? regionLabel(s.regionCode) : null,
                ]
                  .filter(Boolean)
                  .join(' · ');

                return (
                  <button
                    key={`${s.kind}-${s.id}`}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => openPage(s.address)}
                    className={cn(
                      'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors focus:outline-none',
                      active ? 'bg-muted/60' : 'hover:bg-muted/30',
                    )}
                  >
                    <Avatar avatarPath={s.avatarPath} displayName={s.name} size="sm" />

                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="break-all text-body font-semibold text-foreground">
                          {s.handle}
                        </span>
                        {s.platforms.map((plat) => (
                          <PlatformChip key={plat} slug={plat} className="size-5" />
                        ))}
                      </span>

                      {subtext ? (
                        <span className="mt-0.5 block text-meta text-muted-foreground">
                          {subtext}
                        </span>
                      ) : null}
                    </span>

                    <span className="flex shrink-0 items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded-full bg-trust/10 px-2 py-0.5 text-meta font-semibold tabular-nums text-trust">
                        <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-3" aria-hidden />
                        {s.referenceCount}
                      </span>
                      <HugeiconsIcon icon={ArrowRight01Icon} className="size-4 text-muted-foreground" aria-hidden />
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        ) : needle ? (
          <div className="px-4 py-5 text-center">
            <p className="text-body font-medium text-foreground">
              No references for {isHandle ? `@${needle}` : `“${needle}”`} yet
            </p>
            <p className="mt-0.5 text-meta text-muted-foreground">
              Be the first to leave them a reference.
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center px-4 py-6 text-center sm:py-8">
            <span
              aria-hidden
              className="grid size-10 place-items-center rounded-full border bg-muted text-muted-foreground"
            >
              <HugeiconsIcon icon={loadFailed ? Search01Icon : UserGroupIcon} className="size-5" />
            </span>
            <p className="mt-snug text-body font-semibold text-foreground">
              {loadFailed ? 'Look someone up' : 'No references yet'}
            </p>
            <p className="mt-tight max-w-sm text-pretty text-meta text-muted-foreground">
              {loadFailed
                ? "Search the handle of someone you've traded with to see their references."
                : "Search the handle of someone you've traded with and be the first to leave them a reference."}
            </p>
          </div>
        )}

        {showDirectOpen ? (
          <button
            type="button"
            onClick={() => openTyped(needle, true)}
            className="flex w-full items-center justify-between gap-3 border-t border-border/80 bg-muted/25 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex items-center gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-foreground text-background">
                <HugeiconsIcon icon={PlusIcon} className="size-4" aria-hidden />
              </span>
              <span>
                <span className="block text-body font-semibold text-foreground">
                  Open @{needle} &amp; leave a reference
                </span>
                <span className="block text-meta text-muted-foreground">
                  Add a reference for this handle
                </span>
              </span>
            </span>
            <HugeiconsIcon icon={ArrowRight01Icon} className="size-4 shrink-0 text-iris-ink" aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
  );
}
