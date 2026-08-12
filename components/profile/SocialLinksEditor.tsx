'use client';

// components/profile/SocialLinksEditor.tsx
//
// Inline editor for the member's social media handles. Renders one field per
// platform with an icon label. Saves on blur or submit.

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Globe, AtSign, Video, Music, MessageCircle, Loader2, Save, Camera } from 'lucide-react';

import { updateSocialLinks } from '@/lib/actions/socialLinks';
import { SOCIAL_PLATFORMS, normalizeHandle } from '@/domain/social/socialLinks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const ICON_MAP: Record<string, typeof Globe> = {
  instagram: Camera,
  facebook: Globe,
  twitter: AtSign,
  youtube: Video,
  music: Music,
  'message-circle': MessageCircle,
};

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

  function handleSave() {
    startTransition(async () => {
      const entries = SOCIAL_PLATFORMS
        .map((p) => ({ slug: p.slug, handle: values[p.slug] ?? '' }))
        .filter((e) => e.handle.trim().length > 0);
      const result = await updateSocialLinks(entries);
      if (result.ok) {
        toast.success('Social links saved.');
      } else {
        toast.error(result.message ?? 'Could not save.');
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {SOCIAL_PLATFORMS.map((platform) => {
          const Icon = ICON_MAP[platform.icon] ?? MessageCircle;
          return (
            <div key={platform.slug} className="flex items-center gap-2">
              <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <Input
                placeholder={platform.label}
                value={values[platform.slug]}
                onChange={(e) => setValues((v) => ({ ...v, [platform.slug]: e.target.value }))}
                className="h-9 text-sm"
                disabled={isPending}
              />
            </div>
          );
        })}
      </div>
      <Button
        type="button"
        size="sm"
        onClick={handleSave}
        disabled={isPending}
        aria-busy={isPending}
      >
        {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
        Save socials
      </Button>
    </div>
  );
}
