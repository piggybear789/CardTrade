'use client';

// Copies or system-shares the current listing URL. Lives in listing chrome so
// the page body does not need a second share control.

import { HugeiconsIcon } from '@hugeicons/react';
import { Forward01Icon } from '@hugeicons/core-free-icons';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';

export function ShareListingButton({ className }: { className?: string }) {
  async function handleShare() {
    const url = window.location.href;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ url, title: document.title });
        return;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      
    } catch {
      toast.error('Could not share this listing');
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleShare()}
      aria-label="Share listing"
      className={cn(
        'inline-flex size-10 shrink-0 touch-manipulation items-center justify-center rounded-full border border-transparent text-foreground transition-colors hover:bg-foreground/5 focus:outline-none focus-visible:border-iris',
        className,
      )}
    >
      <HugeiconsIcon icon={Forward01Icon} className="size-5" strokeWidth={1.75} aria-hidden />
    </button>
  );
}