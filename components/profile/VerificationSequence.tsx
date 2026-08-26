'use client';

// components/profile/VerificationSequence.tsx
//
// The Verification tab's mount of the two-step seller sequence.
//
// WHY A WRAPPER AND NOT A SECOND IMPLEMENTATION. Settings used to render its own pair
// of cards — `IdentityCheckCard` and `PayoutOnboarding`, each a full card with its own
// badge, its own explanatory prose and its own "Verify with Stripe" button — beside the
// spine `UnifiedOnboardingSurface` already drove at signup. Two surfaces answering one
// question is the failure the rest of this flow is commented against, and these had
// already drifted apart in the way that matters: the pair offered BOTH buttons at once
// for two steps that are strictly sequential, so the tab asked a member to choose
// between "verify who you are" and "tell us where money goes" when only the first was
// actually available to them. The sequence now has one definition and this supplies the
// two things a settings page answers differently from a wizard.
//
// WHAT DIFFERS. The hosted Stripe flows return to this tab rather than `/onboarding`,
// and there is no exit CTA: a wizard has somewhere to send you, a settings tab is
// already where the member chose to be, so the spine's ticks are the confirmation.

import { useRouter } from 'next/navigation';

import { UnifiedOnboardingSurface } from '@/components/onboarding/UnifiedOnboardingSurface';

/**
 * Where Stripe sends the member back to. Shared with the page so the return markers
 * (`identity=complete`, `payouts=complete`) land on the tab that started the flow —
 * `IdentityReturnRefresh` and `PayoutReturnRefresh` reconcile them there.
 */
export const VERIFICATION_RETURN_PATH = '/profile?tab=verification';

export interface VerificationSequenceProps {
  identityDone: boolean;
  payoutDone: boolean;
  /** The document-backed name, shown as step one's receipt once it exists. */
  verifiedName: string | null;
}

export function VerificationSequence({
  identityDone,
  payoutDone,
  verifiedName,
}: VerificationSequenceProps) {
  const { refresh } = useRouter();

  return (
    <UnifiedOnboardingSurface
      returnPath={VERIFICATION_RETURN_PATH}
      // The page already read both gates on the server, so the spine opens on the
      // answer instead of a skeleton it would resolve to the same thing.
      initialStatus={{ identityDone, payoutDone, verifiedName }}
      // Hand the decision back to the server rather than routing away: this tab's
      // content is derived from the same two gates, so a re-render is the update.
      // Only the mock provider finishes in-page — the hosted flow leaves for Stripe
      // and comes back through `PayoutReturnRefresh`, which refreshes as well.
      onComplete={refresh}
      completion={null}
    />
  );
}
