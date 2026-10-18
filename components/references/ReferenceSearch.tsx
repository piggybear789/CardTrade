'use client';

// components/references/ReferenceSearch.tsx
//
// /references (0155): Apple/SaaS command-palette search surface.
// Searches across all platforms at once and routes every handle to its
// unified cross-platform graph at `/references/[handle]`.

import { useEffect, useRef, useState, useTransition, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Cancel01Icon,
  PlusIcon,
  Search01Icon,
  ShieldCheckIcon,
} from '@hugeicons/core-free-icons';

import { Avatar } from '@/components/ui/avatar';
import { searchReferences, type ReferenceSuggestion } from '@/lib/actions/references';
import { platformLabel } from '@/domain/references/reference';
import { regionLabel } from '@/domain/region';
import { cn } from '@/lib/utils';

const PLATFORM_DOT_COLOR: Record<string, string> = {
  instagram: '#E1306C',
  facebook: '#1877F2',
  discord: '#5865F2',
  ebay: '#E53238',
  whatnot: '#F59E0B',
  'in-person': '#10B981',
  noditto: '#6366F1',
  other: '#71717A',
};

function platformColor(slug: string): string {
  return PLATFORM_DOT_COLOR[slug] ?? '#6366F1';
}

export function ReferenceSearch({
  initialSuggestions = [],
}: {
  initialSuggestions?: ReferenceSuggestion[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<ReferenceSuggestion[]>(initialSuggestions);
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [pending, startTransition] = useTransition();
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      startTransition(async () => {
        const result = await searchReferences(query);
        if (result.ok) {
          setSuggestions(result.data);
          setActiveIndex(0);
        }
      });
    }, 140);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query]);

  const needle = query.trim().replace(/^@/, '');
  const hasExactMatch = suggestions.some(
    (s) => s.handleSlug.toLowerCase() === needle.toLowerCase(),
  );
  const showDirectOpen = needle.length >= 2 && !hasExactMatch && !/\s/.test(needle);

  const openHandle = (slug: string, withExperience = false) => {
    const clean = slug.replace(/^@/, '').trim();
    if (!clean) return;
    router.push(
      withExperience
        ? `/references/${encodeURIComponent(clean)}?experience=1`
        : `/references/${encodeURIComponent(clean)}`,
    );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(suggestions.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = suggestions[activeIndex];
      if (target) {
        openHandle(target.handleSlug);
      } else if (needle.length >= 2) {
        openHandle(needle);
      }
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl">
      {/* Command-palette search input */}
      <div className="group relative flex items-center rounded-2xl border border-border/90 bg-card shadow-sm transition-all focus-within:border-foreground/40 focus-within:ring-4 focus-within:ring-foreground/5">
        <HugeiconsIcon
          icon={Search01Icon}
          className="pointer-events-none ml-4 size-5 shrink-0 text-muted-foreground transition-colors group-focus-within:text-foreground"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search @handle or name across all platforms..."
          aria-label="Search a handle or name"
          className="h-14 w-full bg-transparent px-3.5 text-[1.0625rem] text-foreground placeholder:text-muted-foreground/75 focus:outline-none"
          autoFocus
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="mr-2 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:text-foreground"
          >
            <HugeiconsIcon icon={Cancel01Icon} className="size-3.5" aria-hidden />
          </button>
        ) : null}
        <span
          aria-hidden
          className="mr-3.5 hidden shrink-0 rounded-md border border-border/80 bg-muted/50 px-2 py-0.5 text-meta font-medium text-muted-foreground sm:inline-block"
        >
          ↵
        </span>
      </div>

      {/* Results container */}
      <div className="mt-3 overflow-hidden rounded-2xl border border-border/90 bg-card shadow-xs">
        <div className="flex items-center justify-between border-b border-border/60 bg-muted/25 px-4 py-2 text-meta font-medium text-muted-foreground">
          <span>{needle ? 'Matching profiles' : 'Active profiles'}</span>
          <span>Synthesised across platforms</span>
        </div>

        {suggestions.length > 0 ? (
          <div className="divide-y divide-border/70">
            {suggestions.map((s, i) => {
              const active = i === activeIndex;
              return (
                <button
                  key={`${s.kind}-${s.id}`}
                  type="button"
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => router.push(`/references/${encodeURIComponent(s.handleSlug)}`)}
                  className={cn(
                    'flex w-full items-center gap-3.5 px-4 py-3 text-left transition-colors focus:outline-none',
                    active ? 'bg-muted/50' : 'hover:bg-muted/30',
                  )}
                >
                  <Avatar avatarPath={s.avatarPath} displayName={s.name} size="md" />

                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-body font-semibold text-foreground">
                        {s.handle}
                      </span>
                      {s.identityVerified ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-trust/10 px-2 py-0.5 text-meta font-medium text-trust">
                          <HugeiconsIcon icon={ShieldCheckIcon} className="size-3.5" aria-hidden />
                          {s.firstName ? `Verified · ${s.firstName}` : 'Verified'}
                        </span>
                      ) : null}
                      {s.unclaimed ? (
                        <span className="rounded-full border border-border bg-muted/60 px-2 py-0.5 text-meta font-medium text-muted-foreground">
                          Unclaimed
                        </span>
                      ) : null}
                    </span>

                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-meta text-muted-foreground">
                      {s.name !== s.handle.replace(/^@/, '') ? (
                        <>
                          <span className="font-medium text-foreground/80">{s.name}</span>
                          <span aria-hidden>·</span>
                        </>
                      ) : null}
                      {s.platforms.map((plat) => (
                        <span
                          key={plat}
                          className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-card px-1.5 py-0.2 text-meta text-foreground/90"
                        >
                          <span
                            className="size-1.5 rounded-full"
                            style={{ backgroundColor: platformColor(plat) }}
                            aria-hidden
                          />
                          {platformLabel(plat)}
                        </span>
                      ))}
                      {s.regionCode ? (
                        <>
                          <span aria-hidden>·</span>
                          <span>{regionLabel(s.regionCode)}</span>
                        </>
                      ) : null}
                    </span>
                  </span>

                  <span className="flex shrink-0 items-center gap-2">
                    <span className="rounded-full border border-border/80 bg-muted/40 px-2.5 py-1 text-meta font-semibold tabular-nums text-foreground">
                      {s.referenceCount} {s.referenceCount === 1 ? 'ref' : 'refs'}
                    </span>
                    <span className="text-muted-foreground" aria-hidden>
                      →
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}

        {suggestions.length === 0 && needle && !pending ? (
          <div className="px-4 py-6 text-center">
            <p className="text-body font-medium text-foreground">
              No existing profile for &ldquo;@{needle}&rdquo; yet
            </p>
            <p className="mt-1 text-meta text-muted-foreground">
              Open their page to start their cross-platform reference graph.
            </p>
          </div>
        ) : null}

        {showDirectOpen ? (
          <button
            type="button"
            onClick={() => router.push(`/references/${encodeURIComponent(needle)}?experience=1`)}
            className="flex w-full items-center justify-between gap-3 border-t border-border/80 bg-muted/25 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex items-center gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-foreground text-background">
                <HugeiconsIcon icon={PlusIcon} className="size-4" aria-hidden />
              </span>
              <span>
                <span className="block text-body font-semibold text-foreground">
                  Open @{needle} &amp; share your experience
                </span>
                <span className="block text-meta text-muted-foreground">
                  Creates their unified reference graph across Instagram, Facebook, Discord, and
                  more
                </span>
              </span>
            </span>
            <span className="shrink-0 text-meta font-semibold text-iris-ink">Open →</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
