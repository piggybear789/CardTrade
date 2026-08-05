'use client';

// components/listings/WatchButton.tsx
//
// Client entry point for saving / un-saving an item to the caller's WATCHLIST
// (Phase 4). It calls the `toggleWatch` server action inside a transition and
// optimistically flips the local watching state so the UI feels instant, then
// reconciles with the action result (rolling back on failure). Feedback is
// surfaced with a sonner toast.
//
// Visual variants:
//   * `icon`    — heart-only overlay (catalog cards).
//   * `labeled` — full "Save" / "Saved" button.
//   * `action`  — round chip + label below (item detail action row).
//
// Visibility (authenticated, non-owner) is decided by the caller; the action
// re-enforces authentication, so this component only drives the interaction.

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Heart } from 'lucide-react';

import { ListingActionIcon } from '@/components/listings/ListingActionIcon';
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
   * `labeled` — full "Save"/"Saved" button;
   * `icon` — heart-only overlay (catalog cards);
   * `action` — round chip + label (item detail action row).
   */
  variant?: 'labeled' | 'icon' | 'action';
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

  if (variant === 'action') {
    return (
      <ListingActionIcon
        icon={Heart}
        label={label}
        onClick={handleToggle}
        disabled={isPending}
        aria-pressed={watching}
        aria-label={watching ? 'Remove from saved items' : 'Save item'}
        aria-busy={isPending}
        className={cn(
          watching && '[&_svg]:fill-destructive [&_svg]:text-destructive',
          className,
        )}
      />
    );
  }

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
          'inline-flex size-11 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-background focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60',
          className,
        )}
      >
        <Heart
          className={cn(
            'size-4 transition-colors',
            watching && 'fill-destructive text-destructive',
          )}
          aria-hidden
        />
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
      <Heart
        className={cn(watching && 'fill-destructive text-destructive')}
        aria-hidden
      />
      {label}
    </Button>
  );
}
