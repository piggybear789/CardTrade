'use client';

// components/listings/WatchButton.tsx
//
// Client entry point for saving / un-saving an item to the caller's WATCHLIST
// (Phase 4). It calls the `toggleWatch` server action inside a transition and
// optimistically flips the local watching state so the UI feels instant, then
// reconciles with the action result (rolling back on failure). Feedback is
// surfaced with a sonner toast.
//
// Two visual variants:
//   * `icon`    — a compact heart-only overlay button (for catalog cards).
//   * `labeled` — a full "Save" / "Saved" button (for the item detail page).
//
// Visibility (authenticated, non-owner) is decided by the caller; the action
// re-enforces authentication, so this component only drives the interaction.

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Heart, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toggleWatch } from '@/lib/actions/watchlist';

/** Human-readable messages for the toggle-watch action error codes. */
const ERROR_MESSAGES: Record<string, string> = {
  unauthenticated: 'Please sign in to save this item.',
  'persistence-error': 'Could not update your saved items. Please try again.',
};

export interface WatchButtonProps {
  itemId: string;
  /** The server-computed initial watching state. */
  initialWatching: boolean;
  /**
   * `labeled` renders a full "Save"/"Saved" button (detail page); `icon`
   * renders a compact heart-only overlay button (catalog cards).
   */
  variant?: 'labeled' | 'icon';
  className?: string;
}

/**
 * A heart toggle that saves / un-saves {@link itemId} for the current user.
 * Optimistically toggles, calls {@link toggleWatch}, and reconciles the result.
 */
export function WatchButton({
  itemId,
  initialWatching,
  variant = 'labeled',
  className,
}: WatchButtonProps) {
  const [watching, setWatching] = useState(initialWatching);
  const [isPending, startTransition] = useTransition();

  function handleToggle() {
    // Optimistically flip so the UI responds immediately.
    const previous = watching;
    const next = !previous;
    setWatching(next);

    startTransition(async () => {
      const result = await toggleWatch(itemId);
      if (result.ok) {
        setWatching(result.watching);
        toast.success(result.watching ? 'Saved to your watchlist' : 'Removed from your watchlist');
        return;
      }
      // Roll back the optimistic change and report the failure.
      setWatching(previous);
      toast.error(
        ERROR_MESSAGES[result.error] ?? 'Unable to update your saved items.',
      );
    });
  }

  const label = watching ? 'Saved' : 'Save';

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={handleToggle}
        disabled={isPending}
        aria-pressed={watching}
        aria-label={watching ? 'Remove from saved items' : 'Save item'}
        aria-busy={isPending}
        className={cn(
          'inline-flex size-10 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-background focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60',
          className,
        )}
      >
        {isPending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <Heart
            className={cn(
              'size-4 transition-colors',
              watching && 'fill-red-500 text-red-500',
            )}
            aria-hidden
          />
        )}
      </button>
    );
  }

  return (
    <Button
      type="button"
      variant={watching ? 'secondary' : 'outline'}
      size="lg"
      className={cn('w-full sm:w-auto', className)}
      onClick={handleToggle}
      disabled={isPending}
      aria-pressed={watching}
      aria-busy={isPending}
    >
      {isPending ? (
        <Loader2 className="animate-spin" aria-hidden />
      ) : (
        <Heart
          className={cn(watching && 'fill-red-500 text-red-500')}
          aria-hidden
        />
      )}
      {label}
    </Button>
  );
}
