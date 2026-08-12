'use client';

// components/profile/SocialLinksEditor.tsx
//
// Modern social links editor. Each platform is a compact row with an icon,
// platform label, and inline input. Feels like a settings panel, not a form.

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
    for (const p of SOCIAL_PLATFORMS) {
      init[p.slug] = initialLinks?.[p.slug] ?? '';
    }
    return init;
  });
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  function handleSave() {
    startTransition(async () => {
      const entries = SOCIAL_PLATFORMS
        .map((p) => ({ slug: p.slug, handle: values[p.slug] ?? '' }))
        .filter((e) => e.handle.trim().length > 0);
      const result = await updateSocialLinks(entries);
      if (result.ok) {
        setSaved(true);
        toast.success('Social links saved.');
        setTimeout(() => setSaved(false), 2000);
      } else {
        toast.error(result.message ?? 'Could not save.');
      }
    });
  }

  const hasChanges = SOCIAL_PLATFORMS.some(
    (p) => (values[p.slug]?.trim() ?? '') !== (initialLinks?.[p.slug] ?? ''),
  );

  return (
    <div className="space-y-4">
      <div className="divide-y rounded-lg border">
        {SOCIAL_PLATFORMS.map((platform) => (
          <div
            key={platform.slug}
            className="flex items-center gap-3 px-3 py-2.5"
          >
            <span className="w-20 shrink-0 text-xs font-medium text-muted-foreground">
              {platform.label}
            </span>
            <span className="text-sm text-muted-foreground">@</span>
            <input
              type="text"
              placeholder="username"
              value={values[platform.slug]}
              onChange={(e) =>
                setValues((v) => ({ ...v, [platform.slug]: e.target.value }))
              }
              disabled={isPending}
              className="min-w-0 flex-1 border-0 bg-transparent py-0 text-sm font-medium outline-none placeholder:text-muted-foreground/50 focus:outline-none"
            />
          </div>
        ))}
      </div>

      {hasChanges ? (
        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={isPending}
          aria-busy={isPending}
        >
          {isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : saved ? (
            <Check className="size-4" aria-hidden />
          ) : null}
          {saved ? 'Saved' : 'Save changes'}
        </Button>
      ) : null}
    </div>
  );
}
