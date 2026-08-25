// components/identity/IdentityBadge.tsx
//
// The PUBLIC face of identity verification.
//
// WHAT THIS BADGE MAY CLAIM, AND WHY THAT CHANGED. It reports the Identity_Gate,
// which since migration 0069 is a Stripe **Identity** check: a government document
// plus a matching selfie, with the legal name taken from the provider's own reading
// of the document.
//
// SO IT MAY NOW SAY DOCUMENT AND SELFIE, AND THAT IS NEW. While the gate was Connect
// payout onboarding, this file carried the opposite instruction — a recipient-only
// account's verification burden is lighter and Stripe may defer document collection,
// so a badge claiming a document check would have overstated the assurance. It said
// so in its `title`, its `aria-label` and its header, and that disclaimer was correct
// at the time. The underlying check is now real, so the claim is honest.
//
// WHAT IT STILL MAY NOT CLAIM. Anything about being payable. Payout setup is a
// separate later step, and a verified member may legitimately have no bank account
// attached — see `canReceiveFunds`. Never mention payouts here.
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
   * `identity_check_status = 'VERIFIED'` (0069).
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
  /**
   * When the given name already appears next to this badge, drop it from the
   * label so the row does not read "test · ID verified · test".
   */
  hideNameWhen?: string | null;
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
  hideNameWhen,
  className,
}: IdentityBadgeProps) {
  if (!verified) return null;

  const name = firstName?.trim();
  const redundant =
    Boolean(name) &&
    Boolean(hideNameWhen?.trim()) &&
    name!.toLowerCase() === hideNameWhen!.trim().toLowerCase();
  const shownName = redundant ? undefined : name;
  const label = shownName ? `ID verified · ${shownName}` : 'ID verified';

  return (
    <span
      className={cn('text-trust inline-flex items-center gap-1 font-medium', className)}
      title="Identity verified by Stripe with a photo ID and a selfie"
      // `role="img"` so the label is actually exposed. In `iconOnly` mode the
      // ShieldCheck is `aria-hidden` and there is no visible text, so without a
      // role this badge could be announced as nothing — silently dropping the
      // one trust signal a buyer is looking for.
      role="img"
      aria-label={
        shownName
          ? `Identity verified by Stripe with a photo ID and a selfie, given name ${shownName}`
          : 'Identity verified by Stripe with a photo ID and a selfie'
      }
    >
      <ShieldCheck style={{ width: size, height: size, minWidth: size }} aria-hidden />
      {!iconOnly && <span className="text-meta">{label}</span>}
    </span>
  );
}
