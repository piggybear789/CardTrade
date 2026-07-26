// components/listings/VerifiedBadge.tsx
//
// A tiny reusable "Verified" badge shown next to a seller whose provider
// merchant identity is approved. Presentational only; purchase authorization
// still rechecks the provider-controlled identity server-side.

import { BadgeCheck } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface VerifiedBadgeProps {
  /** Icon size in pixels. */
  size?: number;
  /** Hide the "Verified" text label, showing only the shield/check icon. */
  iconOnly?: boolean;
  className?: string;
}

/** A small trust-teal marker for a provider-approved seller identity. */
export function VerifiedBadge({
  size = 14,
  iconOnly = false,
  className,
}: VerifiedBadgeProps) {
  return (
    <span
      className={cn(
        'text-trust inline-flex items-center gap-1 font-medium',
        className,
      )}
      title="Pinch merchant identity verified"
      aria-label="Pinch-verified seller"
    >
      <BadgeCheck
        style={{ width: size, height: size, minWidth: size }}
        aria-hidden
      />
      {!iconOnly && <span className="text-xs">Verified</span>}
    </span>
  );
}
