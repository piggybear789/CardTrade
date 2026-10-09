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
//   * `icon`    — quiet glyph in listing chrome (catalog cards, detail header).
//   * `labeled` — full "Save" / "Saved" button.
//   * `action`  — round chip + label below (item detail action row).
//
// Visibility (authenticated, non-owner) is decided by the caller; the action
// re-enforces authentication, so this component only drives the interaction.

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { HeartIcon } from '@hugeicons/core-free-icons';

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
   * `icon` — quiet glyph in listing chrome;
   * `action` — round chip + label (item detail action row).
   */
  variant?: 'labeled' | 'icon' | 'action';
  className?: string;
  /** Glyph size for the `icon` variant; `size-3.5` suits dense cards, page chrome wants more. */
  glyphClassName?: string;
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
  glyphClassName = 'size-3.5',
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
        icon={HeartIcon}
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
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          handleToggle();
        }}
        disabled={isPending}
        aria-pressed={watching}
        aria-label={watching ? 'Remove from saved items' : 'Save item'}
        aria-busy={isPending}
        className={cn(
          // Same weight as the watching count: a glyph in the chrome, not a
          // chip on the photo. 闲鱼 keeps the artwork clean and puts 收藏
          // with the price / want-count.
          'relative inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors after:absolute md:after:-inset-2 hover:text-foreground border border-transparent focus:outline-none focus-visible:border-iris disabled:opacity-60 md:size-8',
          className,
        )}
      >
        {/* THE SAVED COLOUR LIVES ON THE GLYPH, NOT THE BUTTON. Callers restyle
            the button's text colour for their surface — the catalog chip passes
            `text-foreground`, the phone buyer bar `text-muted-foreground` — and
            `cn()` resolves the later of two text colours, so a `text-destructive`
            on the button lost to every caller that set one. `fill-current` then
            filled the heart with the winner: black on the catalog, grey on the
            listing bar, red only where nobody passed a colour. A class on the svg
            is outside that merge, so a saved heart is red on every surface. */}
        <HugeiconsIcon icon={HeartIcon}
          className={cn(glyphClassName, watching && 'fill-destructive text-destructive')}
          strokeWidth={1.75}
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
      <HugeiconsIcon icon={HeartIcon}
        className={cn(watching && 'fill-destructive text-destructive')}
        aria-hidden
      />
      {label}
    </Button>
  );
}
