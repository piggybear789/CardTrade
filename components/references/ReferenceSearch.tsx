'use client';

// components/references/ReferenceSearch.tsx
//
// /references (0155): command-palette search input with the list already visible,
// showing the top 3 most-referenced traders (or an empty state while there are none),
// and narrowing to matching profiles as the member types.
//
// A COMBOBOX, NOT A ROW OF BUTTONS. Focus stays in the input; the arrow keys move the
// active option and `aria-activedescendant` tells assistive tech which one it is. The
// options are not tab stops. The "Open @x & leave a reference" row is the last option,
// so the keyboard and the pointer reach the same place with the same result.
//
// A FAILED SEARCH SAYS SO. A refused or failed request is a toast and an honest line in
// the list, never "No references for @x yet", which would be false.
//
// OPENING SOMEONE SHOWS IT IS WORKING. A person's page can take a moment to build, so the
// chosen row shows a spinner while the navigation is pending, and the active row is
// prefetched as the member moves to it.

import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowRight01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Loading03Icon,
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

/** Long enough that typing a handle is one request, not one per letter. */
const SEARCH_DEBOUNCE_MS = 200;

/** The handle a suggestion shows, lower-cased and without `@`, for matching what is typed. */
function handleText(suggestion: ReferenceSuggestion): string {
  return suggestion.handle.replace(/^@/, '').toLowerCase();
}

/** One navigable row: a suggestion, or the typed handle itself. */
type Option =
  | { kind: 'suggestion'; key: string; suggestion: ReferenceSuggestion; href: string }
  | { kind: 'typed'; key: string; handle: string; href: string };

export function ReferenceSearch({
  initialSuggestions = [],
}: {
  /** `null` when the read failed, so the empty state doesn't claim there are no references. */
  initialSuggestions?: ReferenceSuggestion[] | null;
}) {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [knownSuggestions, setKnownSuggestions] = useState<ReferenceSuggestion[]>(
    initialSuggestions ?? [],
  );
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [searchFailed, setSearchFailed] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [navigating, startNavigation] = useTransition();
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
    setSearchFailed(false);
    if (!needle) {
      requestSeq.current += 1;
      return;
    }

    const seq = ++requestSeq.current;
    debounce.current = setTimeout(async () => {
      const result = await searchReferences(needle).catch(() => null);
      if (seq !== requestSeq.current) return;
      if (!result || !result.ok) {
        setSearchFailed(true);
        toast.error(result?.message ?? "We couldn't search references just now. Please try again.");
        return;
      }
      if (result.data.length > 0) {
        setKnownSuggestions((prev) => {
          const map = new Map<string, ReferenceSuggestion>();
          for (const item of prev) map.set(`${item.kind}:${item.id}`, item);
          for (const item of result.data) map.set(`${item.kind}:${item.id}`, item);
          return Array.from(map.values());
        });
      }
    }, SEARCH_DEBOUNCE_MS);

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

  const loadFailed = initialSuggestions === null;
  const isHandle = needle.length > 0 && !/\s/.test(needle);

  const options: Option[] = [
    ...visibleSuggestions.map(
      (suggestion): Option => ({
        kind: 'suggestion',
        key: `${suggestion.kind}-${suggestion.id}`,
        suggestion,
        href: referenceHref(suggestion.address),
      }),
    ),
    ...(isHandle
      ? [
          {
            kind: 'typed' as const,
            key: `typed-${needleLower}`,
            handle: needle,
            href: referenceHref({ slug: needle, on: null } satisfies ReferenceAddress, { experience: '1' }),
          },
        ]
      : []),
  ];
  // The list changes under the cursor as the member types; never point past its end.
  const active = options.length === 0 ? -1 : Math.min(activeIndex, options.length - 1);
  const optionId = (index: number) => `${listId}-option-${index}`;
  const suggestionCount = visibleSuggestions.length;

  // Prefetch whoever the cursor is on, so Enter usually lands on a page already loaded.
  const activeHref = active >= 0 ? options[active]?.href : undefined;
  useEffect(() => {
    if (activeHref) router.prefetch(activeHref);
  }, [activeHref, router]);

  const open = (option: Option) => {
    setOpening(option.key);
    startNavigation(() => {
      router.push(option.href);
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(Math.min(options.length - 1, active + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(Math.max(0, active - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = active >= 0 ? options[active] : undefined;
      if (target) open(target);
    } else if (e.key === 'Escape' && query) {
      e.preventDefault();
      setQuery('');
      setActiveIndex(0);
    }
  };

  const status = !needle
    ? ''
    : searchFailed
      ? 'Search failed.'
      : suggestionCount === 0
        ? 'No matching profiles.'
        : `${suggestionCount} matching ${suggestionCount === 1 ? 'profile' : 'profiles'}.`;

  return (
    // Grows with the screen like the page around it (`app/(marketing)/references/page.tsx`).
    // Same edge and radius as every other field and card: `border-input`, `rounded-lg`.
    <div className="relative mx-auto w-full max-w-[clamp(36rem,42vw,54rem)]">
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
          role="combobox"
          inputMode="search"
          enterKeyHint="go"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search @handle or name..."
          aria-label="Search a handle or name"
          aria-expanded={options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? optionId(active) : undefined}
          // `text-body` from `sm`, the same size as the handles in the list under it. On a
          // phone 16px, the size below which iOS zooms the page into a focused field.
          className="h-[clamp(3rem,3vw,3.75rem)] w-full bg-transparent pl-3 pr-4 text-base text-foreground placeholder:text-muted-foreground/75 focus:outline-none sm:text-body"
          ref={inputRef}
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setActiveIndex(0);
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
            className="mr-1 inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring sm:mr-2 sm:size-8"
          >
            <HugeiconsIcon icon={Cancel01Icon} className="size-3.5" aria-hidden />
          </button>
        ) : null}
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>

      {/* RESULTS. From `sm`: a dropdown anchored below the input, so filtering never
          shifts the page. PHONE: in the page flow under the search, which the page
          top-aligns there, so a list that grows or shrinks moves only what is below it.
          Always rendered: with nothing to list it holds an empty state. */}
      <div className="relative mt-2 overflow-hidden rounded-lg border border-border bg-card shadow-market sm:absolute sm:inset-x-0 sm:top-full sm:z-20 sm:bg-card/95 sm:shadow-xl sm:backdrop-blur-md">
        {suggestionCount > 0 && !needle ? (
          // Visible caption only: the listbox's own label already names it.
          <p aria-hidden className="px-4 pb-1 pt-3 text-meta font-semibold uppercase tracking-wider text-muted-foreground">
            Most referenced
          </p>
        ) : null}

        {suggestionCount === 0 ? (
          needle ? (
            <div className="px-4 py-5 text-center">
              <p className="text-body font-medium text-foreground">
                {searchFailed
                  ? "Couldn't search just now"
                  : `No references for ${isHandle ? `@${needle}` : `“${needle}”`} yet`}
              </p>
              <p className="mt-0.5 text-meta text-muted-foreground">
                {searchFailed
                  ? 'You can still open the handle below, or try again in a moment.'
                  : 'Be the first to leave them a reference.'}
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
          )
        ) : null}

        <ul
          id={listId}
          role="listbox"
          aria-label={needle ? 'Matching profiles' : 'Most referenced traders'}
          className={cn('divide-y divide-border/60', options.length === 0 && 'hidden')}
        >
          {options.map((option, i) => {
            const isActive = i === active;
            const isOpening = navigating && opening === option.key;
            const common = {
              id: optionId(i),
              role: 'option' as const,
              'aria-selected': isActive,
              // Keep focus in the input: a click on an option must not blur it first.
              onMouseDown: (event: MouseEvent) => event.preventDefault(),
              onMouseMove: () => {
                if (!isActive) setActiveIndex(i);
              },
              onClick: () => open(option),
            };

            if (option.kind === 'typed') {
              return (
                <li
                  key={option.key}
                  {...common}
                  className={cn(
                    'flex min-h-14 cursor-pointer items-center justify-between gap-3 border-t border-border/80 px-4 py-3 transition-colors',
                    isActive ? 'bg-muted/60' : 'bg-muted/25 hover:bg-muted/40',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-foreground text-background">
                      <HugeiconsIcon icon={PlusIcon} className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block break-all text-body font-semibold text-foreground">
                        Open @{option.handle} &amp; leave a reference
                      </span>
                      <span className="block text-meta text-muted-foreground">
                        Add a reference for this handle
                      </span>
                    </span>
                  </span>
                  <RowEnd opening={isOpening} />
                </li>
              );
            }

            const s = option.suggestion;
            const subtext = [
              s.name !== s.handle.replace(/^@/, '') ? s.name : null,
              s.regionCode ? regionLabel(s.regionCode) : null,
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <li
                key={option.key}
                {...common}
                className={cn(
                  'flex min-h-14 cursor-pointer items-center gap-3 px-4 py-3 transition-colors',
                  isActive ? 'bg-muted/60' : 'hover:bg-muted/30',
                )}
              >
                <Avatar avatarPath={s.avatarPath} displayName={s.name} size="sm" />

                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="break-all text-body font-semibold text-foreground">{s.handle}</span>
                    {s.platforms.map((plat) => (
                      <PlatformChip key={plat} slug={plat} className="size-5" />
                    ))}
                  </span>
                  {subtext ? (
                    <span className="mt-0.5 block truncate text-meta text-muted-foreground">{subtext}</span>
                  ) : null}
                </span>

                <span className="flex shrink-0 items-center gap-2">
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-trust/10 px-2 py-0.5 text-meta font-semibold tabular-nums text-trust"
                    aria-label={`${s.referenceCount} ${s.referenceCount === 1 ? 'person' : 'people'} vouch`}
                  >
                    <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-3" aria-hidden />
                    {s.referenceCount}
                  </span>
                  <RowEnd opening={isOpening} />
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/** The arrow at the end of a row, or a spinner while that row's page is opening. */
function RowEnd({ opening }: { opening: boolean }) {
  return opening ? (
    <span role="status" aria-label="Opening" className="inline-flex shrink-0">
      <HugeiconsIcon
        icon={Loading03Icon}
        className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none"
        aria-hidden
      />
    </span>
  ) : (
    <HugeiconsIcon icon={ArrowRight01Icon} className="size-4 shrink-0 text-muted-foreground" aria-hidden />
  );
}
