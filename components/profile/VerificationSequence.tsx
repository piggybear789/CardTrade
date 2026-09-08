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
// and completion offers a LINK onward instead of a wizard exit — see the `completion`
// prop below for why the ticks alone were not enough.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowRight01Icon } from '@hugeicons/core-free-icons';

import { UnifiedOnboardingSurface } from '@/components/onboarding/UnifiedOnboardingSurface';
import { Button } from '@/components/ui/button';

/**
 * Where Stripe sends the member back to. Shared with the page so the return markers
 * (`identity=complete`, `payouts=complete`) land on the tab that started the flow —
 * `IdentityReturnRefresh` and `PayoutReturnRefresh` reconcile them there.
 */
export const VERIFICATION_RETURN_PATH = '/profile?tab=verification';

export interface VerificationSequenceProps {
  identityDone: boolean;
  /**
   * Whether the last identity attempt was declined, so the first paint says so instead
   * of offering a fresh "Continue with Stripe" and correcting itself a moment later.
   */
  identityFailed?: boolean;
  payoutDone: boolean;
  /** The document-backed name, shown as step one's receipt once it exists. */
  verifiedName: string | null;
}

export function VerificationSequence({
  identityDone,
  identityFailed = false,
  payoutDone,
  verifiedName,
}: VerificationSequenceProps) {
  const { refresh } = useRouter();

  return (
    <UnifiedOnboardingSurface
      returnPath={VERIFICATION_RETURN_PATH}
      // The page already read both gates on the server, so the spine opens on the
      // answer instead of a skeleton it would resolve to the same thing.
      initialStatus={{ identityDone, identityFailed, payoutDone, verifiedName }}
      // Hand the decision back to the server rather than routing away: this tab's
      // content is derived from the same two gates, so a re-render is the update.
      // Only the mock provider finishes in-page — the hosted flow leaves for Stripe
      // and comes back through `PayoutReturnRefresh`, which refreshes as well.
      onComplete={refresh}
      // A WAY ONWARD, NOT A WIZARD EXIT, and that is why this is a link rather than
      // `onComplete`. This used to pass `null` on the reasoning that a settings tab is
      // already where the member chose to be, so the two ticks could be the whole
      // confirmation. That holds for a member who opened Verification to look at it,
      // and not at all for the one who just finished the second step: they came here to
      // become a seller, both gates are now green, and the page answered by going
      // quiet. Listing is the only thing the sequence just unlocked, so it is the one
      // thing worth offering.
      //
      // Navigating rather than completing also keeps the wizard's semantics intact —
      // `onComplete` means "this flow is over, take me out of it", which is false on a
      // settings page the member can simply stay on.
      completion={
        <Button asChild className="w-full sm:w-auto">
          <Link href="/listings/new">
            List an item
            <HugeiconsIcon icon={ArrowRight01Icon} className="ml-2 size-4" aria-hidden />
          </Link>
        </Button>
      }
    />
  );
}
