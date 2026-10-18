'use client';

// components/references/ReferenceSearch.tsx
//
// /references (0155): literally a search bar. Autofill carries the decision
// in miniature (handle, ID shield, platform, reference count); a miss offers
// Add-a-person, which creates an unclaimed, searchable, vouchable handle.

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import { PlusIcon, Search01Icon, ShieldCheckIcon } from '@hugeicons/core-free-icons';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  addUnclaimedHandle,
  searchReferences,
  type ReferenceSuggestion,
} from '@/lib/actions/references';
import { CLAIM_PLATFORMS, platformLabel } from '@/domain/references/reference';
import { regionLabel } from '@/domain/region';
import { cn } from '@/lib/utils';

function suggestionHref(s: ReferenceSuggestion): string {
  if (s.profileId) return `/sellers/${s.profileId}`;
  return `/references/${s.platform}/${encodeURIComponent(s.handle.replace(/^@/, ''))}`;
}

export function ReferenceSearch() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<ReferenceSuggestion[]>([]);
  const [adding, setAdding] = useState(false);
  const [addPlatform, setAddPlatform] = useState<string>('instagram');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      startTransition(async () => {
        const result = await searchReferences(query);
        if (result.ok) setSuggestions(result.data);
      });
    }, 180);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query]);

  const needle = query.trim().replace(/^@/, '');
  const showAdd = needle.length >= 2;

  const addPerson = () => {
    setError(null);
    startTransition(async () => {
      const result = await addUnclaimedHandle({ platform: addPlatform, handle: needle });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.push(suggestionHref(result.data));
    });
  };

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="relative">
        <HugeiconsIcon
          icon={Search01Icon}
          className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setAdding(false);
          }}
          placeholder="Search @handle or name…"
          aria-label="Search a handle or name"
          className="h-14 rounded-full pl-12 text-lead"
          autoFocus
        />
      </div>

      {error ? (
        <p role="alert" className="mt-snug rounded-lg bg-destructive/10 px-cozy py-snug text-body text-destructive">
          {error}
        </p>
      ) : null}

      {!adding ? (
        <div className="mt-snug overflow-hidden rounded-xl border border-border bg-card">
          {suggestions.map((s, i) => (
            <button
              key={`${s.kind}-${s.id}-${s.platform}`}
              type="button"
              onClick={() =>
                s.profileId
                  ? router.push(`/sellers/${s.profileId}`)
                  : router.push(`/references/${s.platform}/${encodeURIComponent(s.handle.replace(/^@/, ''))}`)
              }
              className={cn(
                'flex w-full items-center gap-cozy px-cozy py-snug text-left transition-colors hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                i > 0 && 'border-t border-border',
              )}
            >
              <Avatar avatarPath={s.avatarPath} displayName={s.name} size="md" />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-tight text-body font-semibold text-foreground">
                  {s.handle}
                  {s.identityVerified ? (
                    <HugeiconsIcon icon={ShieldCheckIcon} className="size-4 text-trust" aria-hidden />
                  ) : null}
                  {s.unclaimed ? (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-meta font-medium text-muted-foreground">
                      Unclaimed
                    </span>
                  ) : null}
                </span>
                <span className="block truncate text-body text-muted-foreground">
                  {s.name} · {s.platformLabel}
                  {s.regionCode ? ` · ${regionLabel(s.regionCode)}` : ''}
                  {s.firstName ? ` · ${s.firstName}` : ''}
                </span>
              </span>
              <span className="shrink-0 text-body font-medium tabular-nums text-foreground">
                {s.referenceCount} {s.referenceCount === 1 ? 'reference' : 'references'}
              </span>
            </button>
          ))}

          {suggestions.length === 0 && needle && !pending ? (
            <p className="px-cozy py-group text-center text-body text-muted-foreground">
              No one found for &ldquo;{query}&rdquo;.
            </p>
          ) : null}

          {showAdd ? (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex w-full items-center gap-cozy border-t border-border bg-muted/30 px-cozy py-snug text-left transition-colors hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-trust/10 text-trust">
                <HugeiconsIcon icon={PlusIcon} className="size-5" aria-hidden />
              </span>
              <span className="text-body text-muted-foreground">
                Not them?{' '}
                <span className="font-semibold text-foreground">Add @{needle} as a new person</span>
              </span>
            </button>
          ) : null}
        </div>
      ) : (
        <div className="mt-snug rounded-xl border border-border bg-card p-group">
          <h2 className="text-lead font-semibold text-foreground">Add someone new</h2>
          <p className="mt-tight text-body text-muted-foreground">
            They don&rsquo;t need a NoDitto account. They&rsquo;ll show as Unclaimed until they
            verify their ID and claim it, and your reference can be their first.
          </p>
          <div className="mt-cozy flex flex-wrap gap-tight" role="group" aria-label="Platform">
            {CLAIM_PLATFORMS.map((slug) => (
              <button
                key={slug}
                type="button"
                onClick={() => setAddPlatform(slug)}
                aria-pressed={addPlatform === slug}
                className={cn(
                  'h-9 rounded-full border px-cozy text-body transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  addPlatform === slug
                    ? 'border-foreground bg-foreground font-semibold text-background'
                    : 'border-border bg-card hover:border-foreground/40',
                )}
              >
                {platformLabel(slug)}
              </button>
            ))}
          </div>
          <p className="mt-cozy rounded-lg border border-input bg-card px-cozy py-snug text-body text-foreground">
            <span className="text-muted-foreground">@</span>
            {needle}
          </p>
          {error ? (
            <p role="alert" className="mt-snug text-body text-destructive">
              {error}
            </p>
          ) : null}
          <div className="mt-group flex items-center gap-snug">
            <Button variant="ghost" onClick={() => setAdding(false)}>
              Back
            </Button>
            <span className="flex-1" />
            <Button disabled={pending} onClick={addPerson}>
              {pending ? 'Adding…' : 'Add & share experience'}
            </Button>
          </div>
        </div>
      )}

      <p className="mt-group text-center text-meta text-muted-foreground">
        Every experience behind these results comes from someone who passed a Stripe ID check.
      </p>
    </div>
  );
}
