// components/identity/TrustedSellerBadge.tsx
//
// The public mark for a Trusted Seller (0152): `public_profiles.is_trusted_seller`.
//
// A DIFFERENT FACT FROM `IdentityBadge`, SO A DIFFERENT MARK. "ID verified" is Stripe's
// document-and-selfie check. "Trusted Seller" is NoDitto's own team having looked into
// a seller's history by hand. Neither implies the other on screen, and this badge never
// claims anything about identity, payouts or buyer protection: protection is the same
// for every seller, and copy must not suggest a trusted seller's buyers get more of it.
//
// Renders nothing for a seller who is not trusted. An absent badge is the normal case,
// not a warning.

import { HugeiconsIcon } from '@hugeicons/react';
import { CheckmarkBadge01Icon } from '@hugeicons/core-free-icons';

import { cn } from '@/lib/utils';

const DESCRIPTION = "Trusted Seller: the NoDitto team reviewed this seller's selling history";

export interface TrustedSellerBadgeProps {
  /** `public_profiles.is_trusted_seller`. */
  trusted: boolean;
  /** Icon size in pixels. */
  size?: number;
  /** Hide the text, leaving only the icon. */
  iconOnly?: boolean;
  className?: string;
}

export function TrustedSellerBadge({
  trusted,
  size = 14,
  iconOnly = false,
  className,
}: TrustedSellerBadgeProps) {
  if (!trusted) return null;

  return (
    <span
      className={cn('inline-flex items-center gap-tight font-medium text-iris-ink', className)}
      title={DESCRIPTION}
      // `role="img"` so the icon-only form is announced at all; see `IdentityBadge`.
      role="img"
      aria-label={DESCRIPTION}
    >
      <HugeiconsIcon
        icon={CheckmarkBadge01Icon}
        style={{ width: size, height: size, minWidth: size }}
        aria-hidden
      />
      {!iconOnly && <span className="text-meta">Trusted Seller</span>}
    </span>
  );
}
