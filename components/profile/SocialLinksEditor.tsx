'use client';

// components/profile/SocialLinksEditor.tsx
//
// One row per platform inside a single divided card: fixed-width platform name, a
// dimmed `@`, then a borderless input that fills the rest. The row itself carries
// the border, so six handles read as one control rather than six stacked boxes.
//
// HANDLES, NOT URLS. Only the username is stored; `domain/social/socialLinks.ts`
// builds the canonical profile URL. That is what stops a member pasting a link to
// somewhere other than the profile they are claiming.
//
// The save button appears only once something differs from what is stored, so the
// resting state of an untouched form has no call to action in it.

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Check, Loader2 } from 'lucide-react';

import { updateSocialLinks } from '@/lib/actions/socialLinks';
import { SOCIAL_PLATFORMS } from '@/domain/social/socialLinks';
import { Button } from '@/components/ui/button';

export function SocialLinksEditor({
  initialLinks,
}: {
  initialLinks: Record<string, string> | null;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const platform of SOCIAL_PLATFORMS) {
      init[platform.slug] = initialLinks?.[platform.slug] ?? '';
    }
    return init;
  });
  const [isPending, startTransition] = useTransition();
  const [justSaved, setJustSaved] = useState(false);

  // Compared against what is STORED, not against the last save, so reverting an
  // edit by hand correctly hides the button again.
  const dirty = SOCIAL_PLATFORMS.some(
    (platform) =>
      (values[platform.slug] ?? '').trim() !== (initialLinks?.[platform.slug] ?? ''),
  );

  function save() {
    startTransition(async () => {
      const entries = SOCIAL_PLATFORMS.map((platform) => ({
        slug: platform.slug,
        handle: values[platform.slug] ?? '',
      })).filter((entry) => entry.handle.trim().length > 0);

      const result = await updateSocialLinks(entries);
      if (!result.ok) {
        toast.error(result.message ?? 'Those links could not be saved.');
        return;
      }
      setJustSaved(true);
      toast.success('Social links saved.');
      window.setTimeout(() => setJustSaved(false), 2000);
    });
  }

  return (
    <div className="space-y-3">
      <div className="divide-y overflow-hidden rounded-xl border bg-card">
        {SOCIAL_PLATFORMS.map((platform) => {
          const inputId = `social-${platform.slug}`;
          return (
            <div key={platform.slug} className="flex items-center gap-1">
              {/* A real <label>, not a bare span: the input has no visible border
                  of its own, so the platform name is the only thing identifying it. */}
              <label
                htmlFor={inputId}
                className="w-24 shrink-0 cursor-text px-4 py-3 text-sm text-muted-foreground sm:w-28"
              >
                {platform.label}
              </label>
              <span className="shrink-0 text-sm text-muted-foreground/60" aria-hidden>
                @
              </span>
              <input
                id={inputId}
                type="text"
                inputMode="text"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="username"
                value={values[platform.slug] ?? ''}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [platform.slug]: event.target.value,
                  }))
                }
                disabled={isPending}
                className="min-w-0 flex-1 bg-transparent py-3 pr-4 text-sm font-medium text-foreground outline-none placeholder:text-muted-foreground/50 focus-visible:outline-none disabled:opacity-65"
              />
            </div>
          );
        })}
      </div>

      {dirty || justSaved ? (
        <Button
          type="button"
          size="sm"
          onClick={save}
          disabled={isPending || !dirty}
          aria-busy={isPending}
        >
          {isPending ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : justSaved ? (
            <Check aria-hidden />
          ) : null}
          {justSaved && !dirty ? 'Saved' : 'Save links'}
        </Button>
      ) : null}
    </div>
  );
}
