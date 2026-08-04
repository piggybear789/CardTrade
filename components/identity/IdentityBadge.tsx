// components/identity/IdentityBadge.tsx
//
// The PUBLIC face of identity verification.
//
// WHAT THIS BADGE MAY CLAIM, AND WHAT IT MAY NOT. It reports the Identity_Gate:
// Stripe Connect onboarding APPROVED with settlements enabled. That proves the
// provider verified a payout recipient and returned a legal name it stands behind —
// which is a real assurance, and enough to trade on.
//
// It does NOT prove a government document was inspected or a selfie matched. Connect's
// verification burden on a recipient-only account is lighter than that, and Stripe may
// defer document collection until volume thresholds. This file used to say otherwise in
// its `title`, its `aria-label` and its header comment, so a buyer hovering the badge
// was told a check had happened that may not have. Copy here must not overstate the
// assurance — see `product.md`.
//
// The full legal name is deliberately NOT available here: it is released only at a
// commitment point, by `getCounterpartyIdentity`, to someone already transacting with
// the User.
//
// Why that split matters. A globally readable verified name does not really publish a
// name — it publishes a LINK between a pseudonymous handle and a provider-verified
// identity. Combined with the public listing values and meetup locations this app
// stores, that would let anyone assemble "real person, this area, this much inventory".
// A given name plus a badge carries the trust signal without being a lookup key.

import { ShieldCheck } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface IdentityBadgeProps {
  /**
   * True when the Identity_Gate is satisfied, read as `public_profiles.is_verified`:
   * Connect onboarding APPROVED with settlements enabled.
   *
   * There is exactly one such column. The view previously also carried
   * `identity_verified`, the identical SQL expression under a name that invited the
   * document-and-selfie claim; both were collapsed in migration 0049.
   */
  verified: boolean;
  /**
   * Provider-verified GIVEN name, from `public_profiles.identity_first_name`.
   * Never the full legal name.
   */
  firstName?: string | null;
  /** Icon size in pixels. */
  size?: number;
  /** Hide the text, leaving only the icon. */
  iconOnly?: boolean;
  className?: string;
}

/**
 * A trust marker for a User whose identity the payment provider has verified.
 *
 * Renders nothing when unverified — an absent badge is the correct signal, and a
 * "not verified" label would read as an accusation. A buy-only member holds no
 * verified identity by design, so its absence is not a warning about them.
 */
export function IdentityBadge({
  verified,
  firstName,
  size = 14,
  iconOnly = false,
  className,
}: IdentityBadgeProps) {
  if (!verified) return null;

  const name = firstName?.trim();
  const label = name ? `ID verified · ${name}` : 'ID verified';

  return (
    <span
      className={cn('text-trust inline-flex items-center gap-1 font-medium', className)}
      title="Identity verified by Stripe as part of payout onboarding"
      aria-label={
        name
          ? `Identity verified by the payment provider, given name ${name}`
          : 'Identity verified by the payment provider'
      }
    >
      <ShieldCheck style={{ width: size, height: size, minWidth: size }} aria-hidden />
      {!iconOnly && <span className="text-xs">{label}</span>}
    </span>
  );
}
