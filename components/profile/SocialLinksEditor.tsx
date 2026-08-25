'use client';

// components/profile/SocialLinksEditor.tsx
//
// Resting state is only the platforms that have a value, plus "Add a link".
// Empty uses the same dashed placeholder as Payment method.
//
// Two shapes in one card: socials store a username (the domain module builds
// the profile URL); Website stores one https URL. Inline validation is per
// kind so a pasted store link is accepted on Website and refused on Instagram.

import { useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Check, Loader2, Plus, X } from 'lucide-react';

import { updateSocialLinks } from '@/lib/actions/socialLinks';
import {
  isValidHandle,
  isValidWebsiteUrl,
  normalizeHandle,
  normalizeLinkValue,
  SOCIAL_PLATFORMS,
  type SocialPlatform,
  type SocialPlatformSlug,
} from '@/domain/social/socialLinks';
import { SettingsPlaceholder } from '@/components/account/SettingsPrimitives';
import { SocialPlatformIcon } from '@/components/profile/SocialPlatformIcon';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

function emptyValues(): Record<string, string> {
  const init: Record<string, string> = {};
  for (const platform of SOCIAL_PLATFORMS) {
    init[platform.slug] = '';
  }
  return init;
}

function valuesFromStored(
  links: Record<string, string> | null,
): Record<string, string> {
  const init = emptyValues();
  for (const platform of SOCIAL_PLATFORMS) {
    init[platform.slug] = links?.[platform.slug] ?? '';
  }
  return init;
}

function filledSlugs(links: Record<string, string> | null): SocialPlatformSlug[] {
  return SOCIAL_PLATFORMS.filter((platform) => links?.[platform.slug]).map(
    (platform) => platform.slug,
  );
}

/** Empty is allowed (omit). Typed values must match the platform kind. */
function valueIssue(platform: SocialPlatform, raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  if (platform.kind === 'url') {
    if (!isValidWebsiteUrl(trimmed)) {
      return 'Enter a valid https link, like yourstore.com.';
    }
    return null;
  }

  if (
    /https?:\/\//i.test(trimmed) ||
    trimmed.includes('/') ||
    /^www\./i.test(trimmed)
  ) {
    return 'Username only — not the full link.';
  }
  if (/\s/.test(trimmed)) return "Handles can't contain spaces.";
  if (normalizeHandle(trimmed).length > 100) {
    return 'Keep it under 100 characters.';
  }
  if (!isValidHandle(trimmed)) return "That handle isn't valid.";
  return null;
}

export function SocialLinksEditor({
  initialLinks,
}: {
  initialLinks: Record<string, string> | null;
}) {
  const [values, setValues] = useState(() => valuesFromStored(initialLinks));
  const [baseline, setBaseline] = useState(() => valuesFromStored(initialLinks));
  const [openSlugs, setOpenSlugs] = useState<SocialPlatformSlug[]>(() =>
    filledSlugs(initialLinks),
  );
  const [isPending, startTransition] = useTransition();
  const [justSaved, setJustSaved] = useState(false);

  const pendingFocus = useRef<SocialPlatformSlug | null>(null);
  const inputRefs = useRef<Partial<Record<SocialPlatformSlug, HTMLInputElement | null>>>(
    {},
  );

  useEffect(() => {
    const slug = pendingFocus.current;
    if (!slug) return;
    inputRefs.current[slug]?.focus();
    pendingFocus.current = null;
  }, [openSlugs]);

  const visible = SOCIAL_PLATFORMS.filter((platform) =>
    openSlugs.includes(platform.slug),
  );
  const remaining = SOCIAL_PLATFORMS.filter(
    (platform) => !openSlugs.includes(platform.slug),
  );

  const issues = Object.fromEntries(
    visible.map((platform) => [
      platform.slug,
      valueIssue(platform, values[platform.slug] ?? ''),
    ]),
  ) as Partial<Record<SocialPlatformSlug, string | null>>;
  const hasIssue = visible.some((platform) => issues[platform.slug]);

  const dirty = SOCIAL_PLATFORMS.some(
    (platform) =>
      normalizeLinkValue(platform.slug, values[platform.slug] ?? '') !==
      (baseline[platform.slug] ?? ''),
  );

  function add(slug: SocialPlatformSlug) {
    setOpenSlugs((current) =>
      current.includes(slug) ? current : [...current, slug],
    );
    pendingFocus.current = slug;
  }

  function remove(slug: SocialPlatformSlug) {
    setValues((current) => ({ ...current, [slug]: '' }));
    setOpenSlugs((current) => current.filter((item) => item !== slug));
  }

  function save() {
    if (hasIssue) return;
    startTransition(async () => {
      const entries = SOCIAL_PLATFORMS.map((platform) => ({
        slug: platform.slug,
        value: values[platform.slug] ?? '',
      })).filter((entry) => normalizeLinkValue(entry.slug, entry.value).length > 0);

      const result = await updateSocialLinks(entries);
      if (!result.ok) {
        toast.error(result.message ?? 'Those links could not be saved.');
        return;
      }

      const saved = valuesFromStored(buildBaselineFromValues(values));
      setBaseline(saved);
      setValues(saved);
      setOpenSlugs(filledSlugs(saved));
      setJustSaved(true);
      toast.success('Links saved.');
      window.setTimeout(() => setJustSaved(false), 2000);
    });
  }

  const addControl = (
    <AddPlatformControl remaining={remaining} onAdd={add} disabled={isPending} />
  );

  const saveButton =
    dirty || justSaved ? (
      <Button
        type="button"
        size="sm"
        onClick={save}
        disabled={isPending || !dirty || hasIssue}
        aria-busy={isPending}
      >
        {isPending ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : justSaved ? (
          <Check aria-hidden />
        ) : null}
        {justSaved && !dirty ? 'Saved' : 'Save links'}
      </Button>
    ) : null;

  if (visible.length === 0) {
    return (
      <div className="flex flex-col gap-cozy">
        <SettingsPlaceholder action={addControl}>
          None yet.
        </SettingsPlaceholder>
        {saveButton}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-cozy">
      <div className="divide-y overflow-hidden rounded-xl border bg-card">
        {visible.map((platform) => {
          const inputId = `social-${platform.slug}`;
          const errorId = `${inputId}-error`;
          const issue = issues[platform.slug];
          const isUrl = platform.kind === 'url';
          const showAt = !isUrl && platform.prefix !== null;

          return (
            <div
              key={platform.slug}
              className={cn(
                'has-[input:focus-visible]:border-gold/40 has-[input:focus-visible]:bg-muted',
                issue ? 'bg-destructive/5' : null,
              )}
            >
              <div className="flex flex-col gap-1 px-group py-snug sm:flex-row sm:items-center sm:gap-snug sm:py-0">
                <label
                  htmlFor={inputId}
                  className="flex w-auto shrink-0 cursor-text items-center gap-snug pt-snug text-body text-muted-foreground sm:w-28 sm:py-cozy sm:pt-cozy"
                >
                  <SocialPlatformIcon slug={platform.slug} className="size-4" />
                  <span className="truncate">{platform.label}</span>
                </label>
                <div className="flex min-w-0 flex-1 items-center gap-snug">
                {showAt ? (
                  <span
                    className="shrink-0 text-body text-muted-foreground"
                    aria-hidden
                  >
                    @
                  </span>
                ) : null}
                <input
                  id={inputId}
                  ref={(node) => {
                    inputRefs.current[platform.slug] = node;
                  }}
                  type={isUrl ? 'url' : 'text'}
                  inputMode={isUrl ? 'url' : 'text'}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder={isUrl ? 'https://yourstore.com' : 'username'}
                  value={values[platform.slug] ?? ''}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [platform.slug]: event.target.value,
                    }))
                  }
                  disabled={isPending}
                  aria-invalid={issue ? true : undefined}
                  aria-describedby={issue ? errorId : undefined}
                  className="min-w-0 flex-1 bg-transparent py-cozy text-body font-medium text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none disabled:text-muted-foreground"
                />
                <button
                  type="button"
                  onClick={() => remove(platform.slug)}
                  disabled={isPending}
                  aria-label={`Remove ${platform.label}`}
                  className="flex size-11 shrink-0 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:border-gold/40 disabled:opacity-65 sm:size-8"
                >
                  <X className="size-4" aria-hidden />
                </button>
                </div>
              </div>
              {issue ? (
                <p
                  id={errorId}
                  role="alert"
                  className="px-group pb-snug text-meta text-destructive"
                >
                  {issue}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-cozy">
        {addControl}
        {saveButton}
      </div>
    </div>
  );
}

function buildBaselineFromValues(
  values: Record<string, string>,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const platform of SOCIAL_PLATFORMS) {
    const normalized = normalizeLinkValue(platform.slug, values[platform.slug] ?? '');
    if (normalized) next[platform.slug] = normalized;
  }
  return next;
}

function AddPlatformControl({
  remaining,
  onAdd,
  disabled,
}: {
  remaining: SocialPlatform[];
  onAdd: (slug: SocialPlatformSlug) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (remaining.length === 0) return null;

  if (remaining.length === 1) {
    const only = remaining[0];
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => onAdd(only.slug)}
      >
        <Plus aria-hidden />
        Add {only.label}
      </Button>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled}>
          <Plus aria-hidden />
          Add a link
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 p-1">
        <div className="flex flex-col">
          {remaining.map((platform) => (
            <button
              key={platform.slug}
              type="button"
              onClick={() => {
                onAdd(platform.slug);
                setOpen(false);
              }}
              className="flex h-9 items-center gap-snug rounded-md px-2.5 text-left text-body font-medium text-foreground hover:bg-accent border border-transparent focus-visible:outline-none focus-visible:border-gold/40"
            >
              <SocialPlatformIcon slug={platform.slug} className="size-3.5" />
              {platform.label}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
