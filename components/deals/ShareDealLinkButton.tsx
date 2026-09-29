'use client';

// components/deals/ShareDealLinkButton.tsx
//
// Opens the phone's share sheet with the deal link, which is how most links end up
// in the chat where the deal was agreed. Where there is no share sheet (most
// desktop browsers) it copies instead, so the button never does nothing.

import { HugeiconsIcon } from '@hugeicons/react';
import { Share08Icon } from '@hugeicons/core-free-icons';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

export function ShareDealLinkButton({ path, text }: { path: string; text: string }) {
  async function share() {
    const url = `${window.location.origin}${path}`;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'NoDitto deal', text, url });
        return;
      } catch (error) {
        // Closing the sheet is a choice, not a failure.
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied');
    } catch {
      toast.error('Could not share that link');
    }
  }

  return (
    <Button type="button" variant="outline" onClick={share}>
      <HugeiconsIcon icon={Share08Icon} aria-hidden />
      Share
    </Button>
  );
}
