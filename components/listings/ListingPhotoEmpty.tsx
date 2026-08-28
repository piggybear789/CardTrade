import { HugeiconsIcon } from '@hugeicons/react';
import { Layers01Icon } from '@hugeicons/core-free-icons';

import { cn } from '@/lib/utils';

/**
 * Mist empty photo — a card-shaped absence, not a broken-image slash.
 * Used by the listing cover and catalog tiles when Storage has nothing to show.
 */
export function ListingPhotoEmpty({
  title,
  hint,
  compact = false,
}: {
  title: string;
  hint?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex h-full w-full flex-col items-center justify-center bg-mist text-muted-foreground',
        compact ? 'gap-0' : 'gap-2 px-6 text-center',
      )}
    >
      <HugeiconsIcon icon={Layers01Icon}
        className={compact ? 'size-6 opacity-40' : 'size-8 opacity-40'}
        aria-hidden
      />
      <span className="sr-only">No photo available for {title}</span>
      {compact ? null : (
        <p className="max-w-56 text-balance text-body text-muted-foreground">
          {hint ?? 'No photo yet'}
        </p>
      )}
    </div>
  );
}
