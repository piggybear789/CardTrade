'use client';

// components/deals/DealVerificationNotice.tsx
//
// What Stripe Identity (and, for a seller, showing their verified name) still has to happen before
// a deal can go through, said plainly. Rendered for the host on the link screen and,
// in the third person, for the other person on the invite.
//
// THE REQUIREMENT IS NEVER WORDED AS OPTIONAL. Only the timing is the reader's
// choice: a seller must be verified (and agree to their name being shown) before the buyer can pay, and both
// traders must verify before a swap can start (`acceptCashSaleTerms`,
// `acceptTradeTerms`). Doing it now just means nobody waits later.

import Link from 'next/link';
import { useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/icon';
import { CheckCircleIcon, ClockIcon, WarningCircleIcon } from '@/components/ui/icons';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { PendingLabel } from '@/components/ui/pending-label';
import type { HostReadiness } from '@/lib/actions/dealInvites';
import { allowSellerNameDisclosure } from '@/lib/actions/identity';
import { cn } from '@/lib/utils';

const VERIFY_HREF = '/profile?tab=verification';

type DealKind = 'CASH_SALE' | 'TRADE';

/**
 * The host's all-done sentence. It lives on the deal ticket's face rather than in a
 * notice of its own: once nothing is left to do, the readiness is a fact about the
 * deal, not a task.
 */
export function hostReadyLine(kind: DealKind): string {
  return kind === 'TRADE'
    ? "You're verified with Stripe Identity."
    : "You're verified. They can pay as soon as they join.";
}

/**
 * What a seller is told about payouts while there is nothing left to do before the
 * buyer pays. The money waits in NoDitto until they accept the card and the seller
 * has set up payouts; it is never a reason the buyer cannot pay.
 */
export const PAYOUT_LATER_NOTE =
  "Set up payouts any time before you're paid. Their money waits with NoDitto until then.";

/**
 * The host's own to-do, on the link screen, with the way to do it. Only for a host
 * who still has something to do — the ready state is {@link hostReadyLine}.
 */
export function HostVerificationNotice({
  kind,
  readiness,
  className,
}: {
  kind: DealKind;
  readiness: Exclude<HostReadiness, 'ready'>;
  className?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // PAYOUT SETUP IS NOT ASKED FOR BEFORE PAY, except where Stripe needs it: a sale in
  // a currency the platform does not settle in is charged on behalf of the seller's
  // own account (`readSellerPayReadiness`). Everywhere else the buyer's money waits in
  // the platform balance until the seller sets payouts up.
  const copy =
    kind === 'TRADE'
      ? {
          title: 'Stripe Identity required',
          body: 'Both of you verify before the holds go on. It takes a few minutes with a photo ID.',
          action: 'Verify now',
        }
      : readiness === 'disclosure-needed'
        ? {
            title: 'Show your verified name',
            body: 'Before they pay, they see the name on your ID, and nothing else about it.',
            action: 'Allow',
          }
        : readiness === 'payout-setup-needed'
          ? {
              title: 'Finish payout setup',
              body: 'Stripe needs your payout account live before it can take a payment in this currency.',
              action: 'Finish setup',
            }
          : {
              title: 'Verify with Stripe Identity',
              body: 'Required before they can pay. It takes a few minutes with a photo ID. Payouts can be set up later.',
              action: 'Verify now',
            };

  function allow() {
    startTransition(async () => {
      const result = await allowSellerNameDisclosure();
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      router.refresh();
    });
  }

  // Amber for the mark: this is the host's own move, which is what `--action` means.
  return (
    <div className={cn('grid gap-group rounded-lg border p-group', className)}>
      <div className="flex items-center gap-cozy">
        <Icon icon={WarningCircleIcon} className="size-5 shrink-0 text-action-edge" aria-hidden />
        <div className="grid gap-tight">
          <p className="text-body font-medium text-foreground">{copy.title}</p>
          <p className="text-pretty text-body text-muted-foreground">{copy.body}</p>
        </div>
      </div>
      {kind !== 'TRADE' && readiness === 'disclosure-needed' ? (
        // Pressing this IS the disclosure consent (Req 4.8-4.12), stated above it.
        <Button type="button" variant="outline" size="lg" onClick={allow} disabled={isPending} aria-busy={isPending}>
          <PendingLabel pending={isPending} pendingLabel="Saving…">
            {copy.action}
          </PendingLabel>
        </Button>
      ) : (
        <Button asChild variant="outline" size="lg">
          <Link href={VERIFY_HREF}>{copy.action}</Link>
        </Button>
      )}
    </div>
  );
}

interface InviteeVerificationProps {
  kind: DealKind;
  readiness: HostReadiness | null;
  hostName: string;
}

/**
 * The other person's view, on the join form: where the host stands with Stripe and,
 * for a swap, the requirement it puts on the person about to join.
 */
export function InviteeVerificationNotice(props: InviteeVerificationProps) {
  if (props.kind !== 'TRADE') return <InviteeVerificationStatus {...props} />;
  return (
    <div className="grid gap-tight">
      <InviteeVerificationStatus {...props} />
      <p className="text-body text-muted-foreground">
        Stripe Identity is required for both of you. You can verify after joining.
      </p>
    </div>
  );
}

/**
 * Where the host stands with Stripe, and nothing else. The signed-out preview stops
 * here: the requirement on the joiner is said on the join form, where it applies.
 */
export function InviteeVerificationStatus({ kind, readiness, hostName }: InviteeVerificationProps) {
  if (kind === 'TRADE') {
    return (
      <StatusLine tone={readiness === 'ready' ? 'done' : 'waiting'}>
        {readiness === 'ready'
          ? `${hostName} has verified with Stripe Identity.`
          : `${hostName} hasn't verified with Stripe Identity yet.`}
      </StatusLine>
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
        : readiness === 'disclosure-needed'
          ? `${hostName} is verified, and still has to confirm their name for you.`
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
      <Icon
        icon={tone === 'done' ? CheckCircleIcon : ClockIcon}
        className={tone === 'done' ? 'size-4 shrink-0 text-trust' : 'size-4 shrink-0 text-muted-foreground'}
        aria-hidden
      />
      <span>{children}</span>
    </p>
  );
}
