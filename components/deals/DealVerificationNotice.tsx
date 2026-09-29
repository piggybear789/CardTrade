// components/deals/DealVerificationNotice.tsx
//
// What Stripe Identity (and, for a seller, payout setup) still has to happen before
// a deal can go through, said plainly. Rendered for the host on the link screen and,
// in the third person, for the other person on the invite.
//
// THE REQUIREMENT IS NEVER WORDED AS OPTIONAL. Only the timing is the reader's
// choice: a seller must be verified and set up before the buyer can pay, and both
// traders must verify before a swap can start (`acceptCashSaleTerms`,
// `acceptTradeTerms`). Doing it now just means nobody waits later.

import Link from 'next/link';
import type { ReactNode } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { AlertCircleIcon, CheckmarkCircle02Icon, Clock01Icon } from '@hugeicons/core-free-icons';

import { Button } from '@/components/ui/button';
import type { HostReadiness } from '@/lib/actions/dealInvites';

const VERIFY_HREF = '/profile?tab=verification';

type DealKind = 'CASH_SALE' | 'TRADE';

/**
 * The host's own view, on the link screen: a quiet tick once there is nothing left
 * to do, and otherwise a to-do with the way to do it.
 */
export function HostVerificationNotice({
  kind,
  readiness,
}: {
  kind: DealKind;
  readiness: HostReadiness;
}) {
  if (readiness === 'ready') {
    return (
      <StatusLine tone="done">
        {kind === 'TRADE'
          ? "You're verified with Stripe Identity."
          : "You're verified and set up to be paid."}
      </StatusLine>
    );
  }

  const copy =
    kind === 'TRADE'
      ? {
          title: 'Stripe Identity required',
          body: 'Both of you verify before the holds go on. It takes a few minutes with a photo ID.',
          action: 'Verify now',
        }
      : readiness === 'payout-setup-needed'
        ? {
            title: 'Finish payout setup',
            body: 'Required before they can pay.',
            action: 'Finish setup',
          }
        : {
            title: 'Verify with Stripe',
            body: 'Stripe Identity and payout setup are required before they can pay. It takes a few minutes with a photo ID.',
            action: 'Verify now',
          };

  // Amber for the mark: this is the host's own move, which is what `--action` means.
  return (
    <div className="grid gap-group rounded-lg border p-group">
      <div className="flex items-center gap-cozy">
        <HugeiconsIcon icon={AlertCircleIcon} className="size-5 shrink-0 text-action-edge" aria-hidden />
        <div className="grid gap-tight">
          <p className="text-body font-medium text-foreground">{copy.title}</p>
          <p className="text-pretty text-body text-muted-foreground">{copy.body}</p>
        </div>
      </div>
      <Button asChild variant="outline" size="lg">
        <Link href={VERIFY_HREF}>{copy.action}</Link>
      </Button>
    </div>
  );
}

/** The other person's view, on the invite. */
export function InviteeVerificationNotice({
  kind,
  readiness,
  hostName,
}: {
  kind: DealKind;
  readiness: HostReadiness | null;
  hostName: string;
}) {
  if (kind === 'TRADE') {
    return (
      <div className="grid gap-tight">
        <StatusLine tone={readiness === 'ready' ? 'done' : 'waiting'}>
          {readiness === 'ready'
            ? `${hostName} has verified with Stripe Identity.`
            : `${hostName} hasn't verified with Stripe Identity yet.`}
        </StatusLine>
        <p className="text-body text-muted-foreground">
          Stripe Identity is required for both of you. You can verify after joining.
        </p>
      </div>
    );
  }

  if (readiness === null) return null;
  if (readiness === 'ready') {
    return <StatusLine tone="done">{`${hostName} is verified with Stripe Identity.`}</StatusLine>;
  }
  return (
    <StatusLine tone="waiting">
      {readiness === 'payout-setup-needed'
        ? `${hostName} hasn't finished payout setup yet.`
        : `${hostName} hasn't verified with Stripe Identity yet.`}
    </StatusLine>
  );
}

/**
 * A room whose deal still needs someone to verify.
 *
 * Rooms open before verification now, and a room looks official whether or not
 * anyone in it has verified. That is exactly the moment a scammer asks to be paid
 * some other way, so the warning comes first, above the room, in words rather than
 * a colour.
 */
export function OffPlatformWarning({ children }: { children: ReactNode }) {
  return (
    <div className="cardtrade-warning rounded-lg border p-cozy" role="note">
      <p className="text-body font-medium text-foreground">Keep the whole deal on NoDitto</p>
      <p className="mt-tight text-pretty text-body">{children}</p>
    </div>
  );
}

/**
 * The swap's hard requirement, in the room where terms are agreed.
 *
 * `acceptTradeTerms` refuses until BOTH traders have verified, so this says so
 * before either of them presses Accept, names who is still to do it, and gives the
 * viewer the way to do it. Nothing here reads as optional.
 */
export function SwapIdentityRequirement({
  youVerified,
  theyVerified,
  theirName,
}: {
  youVerified: boolean;
  theyVerified: boolean;
  theirName: string;
}) {
  if (youVerified && theyVerified) return null;
  const outstanding =
    !youVerified && !theyVerified
      ? 'Neither of you has verified yet.'
      : !youVerified
        ? "You haven't verified yet."
        : `${theirName} hasn't verified yet.`;
  return (
    <div className="cardtrade-warning grid gap-snug rounded-lg border p-cozy" role="note">
      <p className="text-body font-medium text-foreground">Stripe Identity required for both of you</p>
      <p className="text-pretty text-body">{outstanding}</p>
      {!youVerified ? (
        <div>
          <Button asChild variant="outline" size="sm">
            <Link href={VERIFY_HREF}>Verify with Stripe</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function StatusLine({ tone, children }: { tone: 'done' | 'waiting'; children: string }) {
  return (
    <p className="flex items-center gap-snug text-body text-muted-foreground">
      <HugeiconsIcon
        icon={tone === 'done' ? CheckmarkCircle02Icon : Clock01Icon}
        className={tone === 'done' ? 'size-4 shrink-0 text-trust' : 'size-4 shrink-0 text-muted-foreground'}
        aria-hidden
      />
      <span>{children}</span>
    </p>
  );
}
